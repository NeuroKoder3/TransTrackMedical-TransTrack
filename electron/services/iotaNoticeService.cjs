/**
 * TransTrack — CMS IOTA notification pipeline
 *
 * Turns the pure notice generator into a working obligation tracker:
 * records a waitlist status transition, decides whether that transition
 * creates a § 512.442(d) notification duty, renders the notice from the
 * centre's own template, and tracks it through delivery.
 *
 * WHY A SEPARATE LAYER: `iotaNoticeGenerator.cjs` is deliberately pure — no
 * database, no clock, no configuration — because that is what makes it
 * testable as compliance evidence. Everything impure lives here: reading the
 * template, resolving patient and centre details, enforcing idempotency at the
 * database, and recording delivery. Keeping the split means the generator's
 * OQ evidence stays valid no matter how the plumbing changes.
 *
 * WHAT THIS DOES NOT DO: it does not decide *for* a centre that a status
 * change blocks organ offers. That determination is clinical and operational,
 * so it is an explicit input (`offerEligibilityImpact`). The service acts on
 * it; it does not infer it from status strings, because a wrong inference here
 * either invents a notification duty that does not exist or — far worse —
 * silently misses one.
 */

const { createHash } = require('crypto');
const { v4: uuidv4 } = require('uuid');
const generator = require('./iotaNoticeGenerator.cjs');
const chartFiling = require('./chartFiling.cjs');

/** Settings keys holding the per-centre notice configuration. */
const SETTING_KEYS = {
  template: 'iota.noticeTemplate',
  reactivationSteps: 'iota.reactivationSteps',
  coordinatorName: 'iota.coordinatorName',
  coordinatorPhone: 'iota.coordinatorPhone',
  centerContact: 'iota.centerContact',
};

/**
 * Transitions that create a notification duty. A transition only obligates the
 * centre when it actually stops organ offers reaching the patient.
 */
const OBLIGATING_IMPACT = 'blocks_offers';

function sha256(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function readSetting(db, orgId, key) {
  const row = db
    .prepare('SELECT value FROM settings WHERE org_id = ? AND key = ?')
    .get(orgId, key);
  return row && row.value !== null && row.value !== undefined && row.value !== ''
    ? row.value
    : null;
}

function writeSetting(db, orgId, key, value) {
  db.prepare(
    `INSERT INTO settings (id, org_id, key, value, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(org_id, key) DO UPDATE SET value = excluded.value,
                                            updated_at = datetime('now')`,
  ).run(uuidv4(), orgId, key, value);
}

/**
 * Columns vary across installations because several were added by later
 * migrations and optional EHR imports. Probing once keeps the service working
 * on a database that predates them instead of throwing at query time.
 */
const columnCache = new Map();
function patientColumns(db) {
  if (!columnCache.has(db)) {
    columnCache.set(
      db,
      new Set(db.prepare('PRAGMA table_info(patients)').all().map((c) => c.name)),
    );
  }
  return columnCache.get(db);
}

function _resetColumnCache() {
  columnCache.clear();
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Read the centre's notice configuration and report whether it is usable.
 *
 * Returned even when incomplete, because the UI needs to tell an administrator
 * precisely what is missing rather than failing opaquely at the moment a
 * patient's notice is due.
 */
function getConfig(db, orgId) {
  const template = readSetting(db, orgId, SETTING_KEYS.template);
  const validation = template
    ? generator.validateTemplate(template)
    : { ok: false, tokens: [], unknown: [], missing: generator.REQUIRED_TOKENS.slice() };

  const reactivationSteps = readSetting(db, orgId, SETTING_KEYS.reactivationSteps);
  const missing = [];
  if (!template) missing.push('notice template');
  else if (!validation.ok) missing.push('a valid notice template');
  if (!reactivationSteps) missing.push('reactivation instructions');

  return {
    template,
    templateSha256: template ? sha256(template) : null,
    templateValid: validation.ok,
    templateProblems: {
      missingTokens: validation.missing,
      unknownTokens: validation.unknown,
    },
    reactivationSteps,
    coordinatorName: readSetting(db, orgId, SETTING_KEYS.coordinatorName),
    coordinatorPhone: readSetting(db, orgId, SETTING_KEYS.coordinatorPhone),
    centerContact: readSetting(db, orgId, SETTING_KEYS.centerContact),
    ready: missing.length === 0,
    missing,
    exampleTemplate: generator.EXAMPLE_TEMPLATE,
    requiredTokens: generator.REQUIRED_TOKENS,
    optionalTokens: generator.OPTIONAL_TOKENS,
  };
}

/**
 * Save the centre's configuration. The template is validated before it is
 * stored: a template missing a statutorily required element must be rejected
 * at configuration time, when someone can fix it, rather than at the moment a
 * notice is due.
 */
function saveConfig(db, orgId, config = {}) {
  if (typeof config.template === 'string' && config.template.trim() !== '') {
    const validation = generator.validateTemplate(config.template);
    if (!validation.ok) {
      const problems = [];
      if (validation.missing.length) {
        problems.push(`missing required placeholder(s): ${validation.missing.join(', ')}`);
      }
      if (validation.unknown.length) {
        problems.push(`unrecognised placeholder(s): ${validation.unknown.join(', ')}`);
      }
      throw new Error(`Notice template rejected — ${problems.join('; ')}`);
    }
    writeSetting(db, orgId, SETTING_KEYS.template, config.template);
  }

  for (const key of ['reactivationSteps', 'coordinatorName', 'coordinatorPhone', 'centerContact']) {
    if (typeof config[key] === 'string') {
      writeSetting(db, orgId, SETTING_KEYS[key], config[key]);
    }
  }

  return getConfig(db, orgId);
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

/**
 * Record a waitlist status transition (append-only) and, when it blocks organ
 * offers, create the notification obligation it triggers.
 *
 * Notice generation is attempted inside the same transaction as the status
 * change wherever configuration allows it. If the centre has not finished
 * configuring its template, the transition is still recorded and the
 * obligation is reported as unmet rather than lost — losing the transition
 * would destroy the very record that proves when the clock started.
 */
function recordTransition(db, input, actor = {}) {
  const {
    orgId, patientId, fromStatus, toStatus,
    reasonCode, reasonNote, effectiveAt,
    offerEligibilityImpact = 'unknown',
    source = 'manual',
  } = input || {};

  if (!orgId) throw new Error('orgId is required');
  if (!patientId) throw new Error('patientId is required');
  if (!toStatus) throw new Error('toStatus is required');
  if (!effectiveAt) throw new Error('effectiveAt is required');

  const patient = db
    .prepare('SELECT id FROM patients WHERE id = ? AND org_id = ?')
    .get(patientId, orgId);
  if (!patient) throw new Error('Patient not found in this organization');

  const id = uuidv4();
  db.prepare(
    `INSERT INTO waitlist_status_transitions
       (id, org_id, patient_id, from_status, to_status, reason_code, reason_note,
        effective_at, offer_eligibility_impact, source,
        changed_by, changed_by_email, changed_by_role)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, orgId, patientId, fromStatus || null, toStatus,
    reasonCode || null, reasonNote || null, effectiveAt,
    offerEligibilityImpact, source,
    actor.id || null, actor.email || null, actor.role || null,
  );

  const result = { transitionId: id, notice: null, noticeError: null, obligated: false };

  if (offerEligibilityImpact === OBLIGATING_IMPACT) {
    result.obligated = true;
    try {
      result.notice = generateForTransition(db, { orgId, transitionId: id }, actor);
    } catch (err) {
      // Surfaced, never swallowed: an unmet obligation must be visible on the
      // compliance dashboard so someone can act before the 10-day deadline.
      result.noticeError = err.message;
    }
  }

  return result;
}

function listTransitions(db, orgId, { patientId, limit = 100 } = {}) {
  const params = [orgId];
  let sql = `SELECT t.*, p.first_name, p.last_name
             FROM waitlist_status_transitions t
             JOIN patients p ON p.id = t.patient_id
             WHERE t.org_id = ?`;
  if (patientId) {
    sql += ' AND t.patient_id = ?';
    params.push(patientId);
  }
  sql += ' ORDER BY t.effective_at DESC LIMIT ?';
  params.push(Math.min(Number(limit) || 100, 500));
  return db.prepare(sql).all(...params);
}

// ---------------------------------------------------------------------------
// Notice generation
// ---------------------------------------------------------------------------

function loadPatientForNotice(db, patientId, orgId) {
  const cols = patientColumns(db);
  const optional = ['dialysis_facility_name', 'referring_provider_name']
    .filter((c) => cols.has(c));
  const select = ['id', 'first_name', 'last_name', 'patient_id', 'organ_needed', ...optional];

  const row = db
    .prepare(`SELECT ${select.join(', ')} FROM patients WHERE id = ? AND org_id = ?`)
    .get(patientId, orgId);
  if (!row) throw new Error('Patient not found in this organization');

  return {
    firstName: row.first_name,
    lastName: row.last_name,
    mrn: row.patient_id,
    // IOTA applies to kidney transplant candidates; ESRD is the qualifying
    // condition, so the organ being sought is the available signal. When it is
    // unset we leave this false rather than guessing, which routes the notice
    // to the referring provider instead of a dialysis facility.
    isEsrd: String(row.organ_needed || '').toLowerCase().includes('kidney'),
    dialysisFacilityName: row.dialysis_facility_name || null,
    referringProviderName: row.referring_provider_name || null,
  };
}

function loadCenter(db, orgId, config) {
  const org = db
    .prepare('SELECT name, address, phone, email FROM organizations WHERE id = ?')
    .get(orgId);
  if (!org) throw new Error('Organization not found');

  const contact = config.centerContact
    || [org.phone, org.email, org.address].filter(Boolean).join('\n')
    || null;

  return {
    name: org.name,
    contact,
    reactivationSteps: config.reactivationSteps,
    coordinatorName: config.coordinatorName,
    coordinatorPhone: config.coordinatorPhone,
  };
}

/**
 * Render and persist the notice for a transition.
 *
 * Idempotent by construction: the generator's idempotency key identifies the
 * obligation, and the database carries UNIQUE(org_id, idempotency_key). A
 * repeated call returns the existing record instead of filing a second copy of
 * the same letter into a patient's chart.
 */
function generateForTransition(db, { orgId, transitionId, noticeKind, revision = 0 }, actor = {}) {
  const transition = db
    .prepare('SELECT * FROM waitlist_status_transitions WHERE id = ? AND org_id = ?')
    .get(transitionId, orgId);
  if (!transition) throw new Error('Status transition not found in this organization');

  const config = getConfig(db, orgId);
  if (!config.ready) {
    throw new Error(
      `IOTA notices are not configured for this centre — missing ${config.missing.join(' and ')}. `
      + 'Set them on the IOTA Compliance page before a notice can be issued.',
    );
  }

  const notice = generator.generateNotice(
    {
      transition: {
        id: transition.id,
        fromStatus: transition.from_status,
        toStatus: transition.to_status,
        reasonCode: transition.reason_code,
        reasonNote: transition.reason_note,
        effectiveAt: transition.effective_at,
        offerEligibilityImpact: transition.offer_eligibility_impact,
      },
      patient: loadPatientForNotice(db, transition.patient_id, orgId),
      center: loadCenter(db, orgId, config),
      template: config.template,
    },
    { noticeKind, revision, generatedAt: new Date().toISOString() },
  );

  const existing = db
    .prepare('SELECT id FROM iota_notifications WHERE org_id = ? AND idempotency_key = ?')
    .get(orgId, notice.idempotencyKey);
  if (existing) return getNotification(db, orgId, existing.id);

  const id = uuidv4();
  db.prepare(
    `INSERT INTO iota_notifications
       (id, org_id, transition_id, patient_id, notice_kind, generator_version,
        content_sha256, content_format, content, template_sha256,
        due_at, generated_at, generated_by, next_annual_due_at,
        secondary_recipient_type, secondary_recipient_name, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, orgId, transition.id, transition.patient_id, notice.noticeKind,
    notice.generatorVersion, notice.contentSha256, notice.contentFormat,
    notice.content, config.templateSha256,
    notice.dueAt, notice.generatedAt, actor.id || null, notice.nextAnnualDueAt,
    notice.secondaryRecipientType, notice.secondaryRecipientName,
    notice.idempotencyKey,
  );

  return getNotification(db, orgId, id);
}

// ---------------------------------------------------------------------------
// Reading and delivery
// ---------------------------------------------------------------------------

function decorate(row, nowMs) {
  const dueMs = Date.parse(row.due_at);
  const delivered = !!row.delivered_at;
  const deliveredMs = delivered ? Date.parse(row.delivered_at) : null;

  return {
    ...row,
    patientName: [row.first_name, row.last_name].filter(Boolean).join(' '),
    delivered,
    // Overdue means the deadline passed with nothing delivered. A notice
    // delivered late is not "overdue" any more — it is a completed obligation
    // that was met late, and the two are counted separately because a surveyor
    // asks different questions about each.
    overdue: !delivered && Number.isFinite(dueMs) && nowMs > dueMs,
    deliveredLate: delivered && Number.isFinite(dueMs) && Number.isFinite(deliveredMs)
      && deliveredMs > dueMs,
    daysUntilDue: Number.isFinite(dueMs)
      ? Math.ceil((dueMs - nowMs) / 86400000)
      : null,
    contentIntegrityOk: row.content === null || row.content === undefined
      ? null
      : sha256(row.content) === row.content_sha256,
    // § 512.442(d) requires a copy go to the dialysis facility or referring
    // provider. The routing is decided from the patient's ESRD status, but the
    // recipient's *name* may simply not be on file — leaving a real obligation
    // addressed to nobody. Flagged so the queue can show it instead of
    // presenting the notice as complete.
    secondaryRecipientUnknown:
      !!row.secondary_recipient_type
      && row.secondary_recipient_type !== 'none'
      && !row.secondary_recipient_name,
  };
}

function getNotification(db, orgId, id, { now = Date.now() } = {}) {
  const row = db
    .prepare(
      `SELECT n.*, p.first_name, p.last_name, p.patient_id AS mrn,
              t.to_status, t.from_status, t.effective_at, t.reason_code
       FROM iota_notifications n
       JOIN patients p ON p.id = n.patient_id
       JOIN waitlist_status_transitions t ON t.id = n.transition_id
       WHERE n.id = ? AND n.org_id = ?`,
    )
    .get(id, orgId);
  return row ? decorate(row, now) : null;
}

/**
 * @param {'all'|'pending'|'overdue'|'delivered'} [filter]
 */
function listNotifications(db, orgId, { filter = 'all', limit = 200, now = Date.now() } = {}) {
  const rows = db
    .prepare(
      `SELECT n.*, p.first_name, p.last_name, p.patient_id AS mrn,
              t.to_status, t.from_status, t.effective_at, t.reason_code
       FROM iota_notifications n
       JOIN patients p ON p.id = n.patient_id
       JOIN waitlist_status_transitions t ON t.id = n.transition_id
       WHERE n.org_id = ?
       ORDER BY n.due_at ASC
       LIMIT ?`,
    )
    .all(orgId, Math.min(Number(limit) || 200, 1000))
    .map((r) => decorate(r, now));

  switch (filter) {
    case 'pending': return rows.filter((r) => !r.delivered);
    case 'overdue': return rows.filter((r) => r.overdue);
    case 'delivered': return rows.filter((r) => r.delivered);
    default: return rows;
  }
}

/**
 * Record that the notice reached the patient.
 *
 * `patientDeclined` covers the case where a patient refuses electronic
 * delivery; CMS still expects the attempt to be documented, so it is recorded
 * as a delivery outcome rather than left pending forever.
 */
function markDelivered(db, orgId, id, { channel, deliveredAt, patientDeclined = false } = {}) {
  if (!['electronic', 'mail'].includes(channel)) {
    throw new Error("channel must be 'electronic' or 'mail'");
  }
  const existing = db
    .prepare('SELECT delivered_at FROM iota_notifications WHERE id = ? AND org_id = ?')
    .get(id, orgId);
  if (!existing) throw new Error('Notification not found in this organization');
  if (existing.delivered_at) {
    throw new Error('This notice is already recorded as delivered');
  }

  db.prepare(
    `UPDATE iota_notifications
        SET delivered_at = ?, channel = ?, patient_declined = ?
      WHERE id = ? AND org_id = ?`,
  ).run(deliveredAt || new Date().toISOString(), channel, patientDeclined ? 1 : 0, id, orgId);

  return getNotification(db, orgId, id);
}

/**
 * File the notice into the patient's chart, or show what would be filed.
 *
 * The chart-filing outcome is persisted whatever it is — including failure.
 * A notice that could not be filed is still an outstanding obligation, and
 * hiding the attempt would leave the operator with no way to see why.
 */
async function fileToChart(db, orgId, id, options = {}) {
  const notice = getNotification(db, orgId, id);
  if (!notice) throw new Error('Notification not found in this organization');

  if (notice.chart_write_status === 'filed') {
    // Filing twice puts a second copy of the same statutory notice into the
    // chart, which is the outcome the whole idempotency design exists to
    // prevent. Superseding requires generating a new revision.
    throw new Error('This notice is already filed to the chart');
  }

  const outcome = await chartFiling.fileNotice(notice, options);

  db.prepare(
    `UPDATE iota_notifications
        SET chart_write_status = ?, chart_write_channel = ?,
            chart_write_attempted_at = ?, chart_write_error = ?,
            epic_document_reference_id = ?
      WHERE id = ? AND org_id = ?`,
  ).run(
    outcome.chart_write_status, outcome.chart_write_channel,
    outcome.chart_write_attempted_at, outcome.chart_write_error,
    outcome.epic_document_reference_id, id, orgId,
  );

  return {
    notice: getNotification(db, orgId, id),
    outcome: {
      status: outcome.chart_write_status,
      channel: outcome.chart_write_channel,
      error: outcome.chart_write_error,
      documentReferenceId: outcome.epic_document_reference_id,
    },
    // Returned so a dry run can show the operator the exact resource that
    // would be sent, which is what makes readiness demonstrable before a
    // site's Epic team has enabled anything.
    preview: outcome.prepared
      ? { resource: outcome.prepared.resource, validation: outcome.prepared.validation }
      : null,
  };
}

function markSecondaryNotified(db, orgId, id, { notifiedAt } = {}) {
  const row = db
    .prepare('SELECT secondary_recipient_type FROM iota_notifications WHERE id = ? AND org_id = ?')
    .get(id, orgId);
  if (!row) throw new Error('Notification not found in this organization');
  if (!row.secondary_recipient_type || row.secondary_recipient_type === 'none') {
    throw new Error('This notice has no secondary recipient to notify');
  }

  db.prepare(
    'UPDATE iota_notifications SET secondary_notified_at = ? WHERE id = ? AND org_id = ?',
  ).run(notifiedAt || new Date().toISOString(), id, orgId);

  return getNotification(db, orgId, id);
}

/**
 * Centre-level compliance posture, shaped for the questions a surveyor asks:
 * how many obligations exist, how many were met, how many were met late, and
 * how many are open right now.
 */
function getComplianceSummary(db, orgId, { now = Date.now() } = {}) {
  const all = listNotifications(db, orgId, { filter: 'all', limit: 1000, now });
  const delivered = all.filter((n) => n.delivered);
  const onTime = delivered.filter((n) => !n.deliveredLate);

  const blocking = db
    .prepare(
      `SELECT COUNT(*) AS c FROM waitlist_status_transitions
        WHERE org_id = ? AND offer_eligibility_impact = ?`,
    )
    .get(orgId, OBLIGATING_IMPACT).c;

  return {
    config: (() => {
      const c = getConfig(db, orgId);
      return { ready: c.ready, missing: c.missing, templateValid: c.templateValid };
    })(),
    obligatingTransitions: blocking,
    // A gap here means a transition blocked offers but no notice exists —
    // the most serious state this page can report, because the deadline is
    // running against an obligation nobody has started.
    withoutNotice: Math.max(0, blocking - all.length),
    total: all.length,
    pending: all.filter((n) => !n.delivered).length,
    overdue: all.filter((n) => n.overdue).length,
    dueWithin3Days: all.filter((n) => !n.delivered && n.daysUntilDue !== null
      && n.daysUntilDue >= 0 && n.daysUntilDue <= 3).length,
    secondaryRecipientUnknown: all.filter((n) => n.secondaryRecipientUnknown).length,
    // § 512.442(d) also requires the notice be recorded in the medical record,
    // so a delivered-but-unfiled notice is a partially met obligation.
    notFiledToChart: all.filter((n) => n.chart_write_status !== 'filed').length,
    chartFilingFailed: all.filter((n) => n.chart_write_status === 'failed').length,
    delivered: delivered.length,
    deliveredOnTime: onTime.length,
    deliveredLate: delivered.length - onTime.length,
    onTimeRate: delivered.length ? Math.round((onTime.length / delivered.length) * 100) : null,
    noticeDueDays: generator.NOTICE_DUE_DAYS,
  };
}

module.exports = {
  SETTING_KEYS,
  OBLIGATING_IMPACT,
  getConfig,
  saveConfig,
  recordTransition,
  listTransitions,
  generateForTransition,
  getNotification,
  listNotifications,
  markDelivered,
  markSecondaryNotified,
  fileToChart,
  getComplianceSummary,
  _resetColumnCache,
};
