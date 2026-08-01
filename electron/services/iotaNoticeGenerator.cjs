/**
 * TransTrack — CMS IOTA waitlist status notice generator.
 *
 * CMS Increasing Organ Transplant Access Model § 512.442(d) requires a
 * participating kidney transplant hospital, when a Medicare waitlist patient's
 * status changes such that they can no longer receive organ offers, to notify
 * the patient within 10 days and to repeat that notice annually for as long as
 * the patient remains inactive. The notice must state all five of:
 *
 *   1. the most recent date the patient became inactive;
 *   2. the reason for the change in waitlist status;
 *   3. that the patient cannot receive organ offers while inactive;
 *   4. how the patient may become active again; and
 *   5. how the patient may contact the transplant hospital.
 *
 * A copy must be recorded in the patient's medical record, and the dialysis
 * facility (ESRD patients) or referring provider (non-ESRD patients) must also
 * be notified.
 *
 * DESIGN — why this is template-driven rather than canned
 *
 * The notice is patient-facing correspondence issued by the transplant center
 * over its own name. TransTrack must not author that language on a center's
 * behalf, so there is deliberately NO implicit default template: a center
 * supplies its own, reviewed by its own compliance function. `EXAMPLE_TEMPLATE`
 * is exported as a starting point and is never used unless a caller passes it.
 *
 * What the generator does enforce is that a center cannot edit a required
 * element out of its template. Each of the five elements above corresponds to a
 * required placeholder, the generator refuses to render a template that omits
 * one, and the value substituted for element 3 is a fixed system-supplied
 * statement rather than center-editable prose — the center controls the wording
 * around the required assertions, not the assertions themselves.
 *
 * Design rules, matching electron/services/inactivationRiskEngine.cjs:
 *
 *   • Pure: structured input in, structured output out. No database, no clock
 *     (the caller injects `generatedAt`), no file or network access.
 *   • Deterministic: identical input always produces identical bytes and
 *     therefore an identical SHA-256, which is what makes the content hash
 *     usable as an integrity control and as an idempotency key.
 *   • Fail closed: an unknown placeholder, a missing required element, or
 *     missing center configuration raises rather than rendering a notice with a
 *     literal `{{token}}` or an empty required field in it.
 */

'use strict';

const { createHash } = require('node:crypto');

const GENERATOR_VERSION = '1.0.0';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const NOTICE_DUE_DAYS = 10;   // § 512.442(d): within 10 days of the change
const ANNUAL_DUE_DAYS = 365;  // § 512.442(d): annually while inactive

const NOTICE_KINDS = Object.freeze({
  STATUS_CHANGE: 'status_change',
  ANNUAL_INACTIVE: 'annual_inactive',
});

/**
 * The required assertion for element 3. System-supplied so a template edit
 * cannot soften or contradict it.
 */
const OFFER_ELIGIBILITY_STATEMENT =
  'While your status on our waiting list is inactive, you cannot receive organ ' +
  'offers. You remain on the waiting list and you continue to accrue waiting ' +
  'time, but no organ will be offered to you until your status is active again.';

/**
 * Placeholders whose value satisfies one of the five required elements. A
 * template that omits any of these is rejected.
 */
const REQUIRED_TOKENS = Object.freeze([
  'inactiveSinceDate',          // element 1
  'statusChangeReason',         // element 2
  'offerEligibilityStatement',  // element 3
  'reactivationSteps',          // element 4
  'centerContact',              // element 5
]);

/** Placeholders a template may use but is not obliged to. */
const OPTIONAL_TOKENS = Object.freeze([
  'patientFullName',
  'patientFirstName',
  'medicalRecordNumber',
  'centerName',
  'noticeDate',
  'priorStatus',
  'newStatus',
  'coordinatorName',
  'coordinatorPhone',
]);

const KNOWN_TOKENS = Object.freeze([...REQUIRED_TOKENS, ...OPTIONAL_TOKENS]);

/**
 * Patient-facing wording for the structured reason codes TransTrack records on
 * a transition. A center may extend this through `options.reasonLabels`; an
 * unmapped code falls back to the transition's free-text note.
 */
const DEFAULT_REASON_LABELS = Object.freeze({
  EVAL_EXPIRED: 'your annual transplant evaluation is out of date',
  LABS_EXPIRED: 'required laboratory tests are out of date',
  AHHQ_EXPIRED: 'your health history questionnaire needs to be updated',
  INSURANCE_LAPSED: 'we need to confirm your current insurance coverage',
  MEDICAL_HOLD: 'a medical issue needs to be resolved before transplant',
  SURGICAL_HOLD: 'a surgical issue needs to be resolved before transplant',
  PATIENT_REQUEST: 'you asked to be made inactive',
  NON_COMPLIANCE: 'we were unable to complete required follow-up with you',
  WEIGHT_CRITERIA: 'your weight is outside our current transplant criteria',
  MISSING_DOCUMENTATION: 'required documentation is missing from your record',
  CONTACT_LOST: 'we have been unable to reach you',
});

const MONTHS = Object.freeze([
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]);

const TOKEN_PATTERN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

// --- helpers ---------------------------------------------------------------

/**
 * Parse an ISO 8601 timestamp into epoch ms, rejecting anything unparseable.
 * Dates drive a regulatory deadline, so a silent NaN is not acceptable.
 */
function parseInstant(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`iotaNoticeGenerator: ${field} is required (ISO 8601 string)`);
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new Error(`iotaNoticeGenerator: ${field} is not a parseable ISO 8601 timestamp: ${value}`);
  }
  return ms;
}

/** UTC ISO 8601 with second precision, so output does not vary by host. */
function toIsoUtc(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * "July 1, 2026" — built from a fixed month table rather than toLocaleDateString
 * so the rendered bytes (and therefore the content hash) do not depend on the
 * host's ICU data or locale.
 */
function formatHumanDateUtc(ms) {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function htmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function requireNonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`iotaNoticeGenerator: ${field} is required and must be a non-empty string`);
  }
  return value.trim();
}

/**
 * Every distinct placeholder in a template, in first-appearance order.
 */
function extractTokens(template) {
  const found = [];
  for (const match of template.matchAll(TOKEN_PATTERN)) {
    if (!found.includes(match[1])) found.push(match[1]);
  }
  return found;
}

/**
 * Validate a center's template without rendering it, so a template can be
 * checked at configuration time rather than at the moment a notice is due.
 *
 * @returns {{ ok: boolean, tokens: string[], unknown: string[], missing: string[] }}
 */
function validateTemplate(template) {
  if (typeof template !== 'string' || template.trim() === '') {
    return { ok: false, tokens: [], unknown: [], missing: [...REQUIRED_TOKENS] };
  }
  const tokens = extractTokens(template);
  const unknown = tokens.filter((t) => !KNOWN_TOKENS.includes(t));
  const missing = REQUIRED_TOKENS.filter((t) => !tokens.includes(t));
  return { ok: unknown.length === 0 && missing.length === 0, tokens, unknown, missing };
}

/**
 * Assert a template is usable, with an error naming exactly what is wrong.
 */
function assertTemplateUsable(template) {
  const report = validateTemplate(template);
  if (report.ok) return report;

  const problems = [];
  if (report.missing.length > 0) {
    problems.push(
      `template omits required element placeholder(s): ${report.missing.join(', ')} ` +
      '(CMS IOTA § 512.442(d) requires all five elements)',
    );
  }
  if (report.unknown.length > 0) {
    problems.push(
      `template references unknown placeholder(s): ${report.unknown.join(', ')} ` +
      `(known placeholders: ${KNOWN_TOKENS.join(', ')})`,
    );
  }
  throw new Error(`iotaNoticeGenerator: ${problems.join('; ')}`);
}

// --- generation ------------------------------------------------------------

/**
 * Resolve the patient-facing reason text for a transition.
 */
function resolveReason(transition, reasonLabels) {
  const code = transition.reasonCode;
  if (code && Object.prototype.hasOwnProperty.call(reasonLabels, code)) {
    return reasonLabels[code];
  }
  const note = typeof transition.reasonNote === 'string' ? transition.reasonNote.trim() : '';
  if (note !== '') return note;
  throw new Error(
    'iotaNoticeGenerator: the transition carries neither a mapped reasonCode nor a reasonNote, ' +
    'so the required "reason for the change" element cannot be stated. ' +
    `Known reason codes: ${Object.keys(reasonLabels).join(', ')}`,
  );
}

/**
 * Build the substitution values for every known placeholder.
 */
function buildValues({ transition, patient, center, noticeKind, generatedAtMs, effectiveAtMs, reasonLabels }) {
  return {
    inactiveSinceDate: formatHumanDateUtc(effectiveAtMs),
    statusChangeReason: resolveReason(transition, reasonLabels),
    offerEligibilityStatement: OFFER_ELIGIBILITY_STATEMENT,
    reactivationSteps: requireNonEmpty(center.reactivationSteps, 'center.reactivationSteps'),
    centerContact: requireNonEmpty(center.contact, 'center.contact'),

    patientFullName: [patient.firstName, patient.lastName].filter(Boolean).join(' ').trim(),
    patientFirstName: patient.firstName || '',
    medicalRecordNumber: patient.mrn || '',
    centerName: center.name || '',
    noticeDate: formatHumanDateUtc(generatedAtMs),
    priorStatus: transition.fromStatus || '',
    newStatus: transition.toStatus || '',
    coordinatorName: center.coordinatorName || '',
    coordinatorPhone: center.coordinatorPhone || '',

    // Not a placeholder; carried so callers can label an annual reminder.
    __noticeKind: noticeKind,
  };
}

/**
 * Substitute placeholders. Escapes values when rendering HTML so patient data
 * cannot inject markup into the notice.
 */
function render(template, values, contentFormat) {
  const escape = contentFormat === 'html' ? htmlEscape : (v) => String(v);
  return template.replace(TOKEN_PATTERN, (_full, token) => {
    if (!Object.prototype.hasOwnProperty.call(values, token)) {
      // Unreachable via generateNotice (assertTemplateUsable runs first), but a
      // literal {{token}} must never reach a patient letter.
      throw new Error(`iotaNoticeGenerator: no value for placeholder ${token}`);
    }
    return escape(values[token]);
  });
}

/**
 * Which downstream party must also be notified, per § 512.442(d).
 */
function resolveSecondaryRecipient(patient) {
  if (patient.isEsrd === true) {
    return {
      secondaryRecipientType: 'dialysis_facility',
      secondaryRecipientName: patient.dialysisFacilityName || '',
    };
  }
  if (patient.isEsrd === false) {
    return {
      secondaryRecipientType: 'referring_provider',
      secondaryRecipientName: patient.referringProviderName || '',
    };
  }
  // Unknown ESRD status cannot be guessed: the rule routes the copy differently
  // for each, so the caller must resolve it before a notice can be issued.
  throw new Error(
    'iotaNoticeGenerator: patient.isEsrd must be true or false so the required copy ' +
    'can be routed to the dialysis facility or the referring provider',
  );
}

/**
 * Generate a waitlist status change notice.
 *
 * @param {Object} args
 * @param {Object} args.transition        { id, fromStatus, toStatus, reasonCode,
 *                                         reasonNote, effectiveAt,
 *                                         offerEligibilityImpact }
 * @param {Object} args.patient          { firstName, lastName, mrn, isEsrd,
 *                                         dialysisFacilityName,
 *                                         referringProviderName }
 * @param {Object} args.center           { name, contact, reactivationSteps,
 *                                         coordinatorName, coordinatorPhone }
 * @param {string} args.template         The center's reviewed notice template.
 * @param {Object} [options]
 * @param {string} [options.generatedAt] ISO 8601; defaults to effectiveAt so the
 *                                        function stays clock-free.
 * @param {string} [options.noticeKind]  'status_change' (default) or
 *                                        'annual_inactive'.
 * @param {string} [options.contentFormat] 'text' (default) or 'html'.
 * @param {Object} [options.reasonLabels] Extra or overriding reason-code wording.
 * @param {number} [options.revision]    Reissue counter, default 0. Bump this
 *                                        only to deliberately supersede a notice
 *                                        already filed; see `idempotencyKey`.
 * @returns {Object} the notice plus every field iota_notifications persists.
 */
function generateNotice(args, options = {}) {
  if (!args) throw new Error('iotaNoticeGenerator: args is required');
  const { transition, patient, center, template } = args;
  if (!transition) throw new Error('iotaNoticeGenerator: args.transition is required');
  if (!patient)    throw new Error('iotaNoticeGenerator: args.patient is required');
  if (!center)     throw new Error('iotaNoticeGenerator: args.center is required');

  const noticeKind = options.noticeKind || NOTICE_KINDS.STATUS_CHANGE;
  if (!Object.values(NOTICE_KINDS).includes(noticeKind)) {
    throw new Error(`iotaNoticeGenerator: unsupported noticeKind: ${noticeKind}`);
  }

  const contentFormat = options.contentFormat || 'text';
  if (contentFormat !== 'text' && contentFormat !== 'html') {
    throw new Error(`iotaNoticeGenerator: unsupported contentFormat: ${contentFormat}`);
  }

  const revision = options.revision === undefined ? 0 : options.revision;
  if (!Number.isInteger(revision) || revision < 0) {
    throw new Error(`iotaNoticeGenerator: options.revision must be a non-negative integer (received ${revision})`);
  }

  // A notice is only owed for a transition that actually removes offer
  // eligibility. Generating one for an activation would tell a patient they
  // cannot receive offers when they can.
  if (transition.offerEligibilityImpact !== 'blocks_offers') {
    throw new Error(
      'iotaNoticeGenerator: a status change notice is only owed for a transition with ' +
      `offerEligibilityImpact "blocks_offers" (received "${transition.offerEligibilityImpact}")`,
    );
  }

  requireNonEmpty(transition.id, 'transition.id');
  assertTemplateUsable(template);

  const effectiveAtMs = parseInstant(transition.effectiveAt, 'transition.effectiveAt');
  const generatedAtMs = options.generatedAt
    ? parseInstant(options.generatedAt, 'options.generatedAt')
    : effectiveAtMs;

  if (generatedAtMs < effectiveAtMs) {
    throw new Error(
      'iotaNoticeGenerator: options.generatedAt precedes transition.effectiveAt; ' +
      'a notice cannot be generated before the change it describes',
    );
  }

  const reasonLabels = { ...DEFAULT_REASON_LABELS, ...(options.reasonLabels || {}) };
  const values = buildValues({
    transition, patient, center, noticeKind,
    generatedAtMs, effectiveAtMs, reasonLabels,
  });

  const content = render(template, values, contentFormat);
  const contentSha256 = createHash('sha256').update(content, 'utf8').digest('hex');
  const { secondaryRecipientType, secondaryRecipientName } = resolveSecondaryRecipient(patient);

  return {
    generatorVersion: GENERATOR_VERSION,
    noticeKind,
    contentFormat,
    content,
    contentSha256,

    effectiveAt: toIsoUtc(effectiveAtMs),
    generatedAt: toIsoUtc(generatedAtMs),
    dueAt: toIsoUtc(effectiveAtMs + NOTICE_DUE_DAYS * ONE_DAY_MS),
    nextAnnualDueAt: toIsoUtc(effectiveAtMs + ANNUAL_DUE_DAYS * ONE_DAY_MS),

    secondaryRecipientType,
    secondaryRecipientName,

    // Matches the UNIQUE(org_id, idempotency_key) constraint on
    // iota_notifications. The key identifies the notification *obligation* —
    // this transition, this kind of notice — and deliberately excludes both
    // generatedAt and contentSha256. Keying on content would let a retry whose
    // letterhead date has rolled over hash differently and file a second copy of
    // the same notice into the patient's chart, which is the exact outcome the
    // constraint exists to prevent. Superseding a filed notice is therefore an
    // explicit act: bump options.revision.
    idempotencyKey: `${transition.id}:${noticeKind}:r${revision}`,
    revision,

    // The resolved value behind each required element, so an OQ protocol or an
    // auditor can confirm all five were stated without parsing the prose.
    requiredElements: {
      inactiveSinceDate: values.inactiveSinceDate,
      statusChangeReason: values.statusChangeReason,
      offerEligibilityStatement: values.offerEligibilityStatement,
      reactivationSteps: values.reactivationSteps,
      centerContact: values.centerContact,
    },
  };
}

/**
 * A starting point for a center's own template, NOT a default. Nothing in
 * TransTrack renders this unless a caller passes it to `generateNotice`. A
 * center's compliance function is expected to review and adapt the wording
 * before use; the required placeholders must survive that edit.
 */
const EXAMPLE_TEMPLATE = [
  '{{centerName}}',
  '',
  '{{noticeDate}}',
  '',
  '{{patientFullName}}',
  'Medical record number: {{medicalRecordNumber}}',
  '',
  'Dear {{patientFirstName}},',
  '',
  'We are writing to let you know that your status on our kidney transplant',
  'waiting list changed to inactive on {{inactiveSinceDate}}.',
  '',
  'The reason for this change is that {{statusChangeReason}}.',
  '',
  '{{offerEligibilityStatement}}',
  '',
  'How to become active again:',
  '{{reactivationSteps}}',
  '',
  'If you have any questions, or if you believe this information is not correct,',
  'please contact us:',
  '{{centerContact}}',
  '',
  'Sincerely,',
  '{{coordinatorName}}',
  '{{coordinatorPhone}}',
].join('\n');

module.exports = {
  GENERATOR_VERSION,
  NOTICE_KINDS,
  NOTICE_DUE_DAYS,
  ANNUAL_DUE_DAYS,
  OFFER_ELIGIBILITY_STATEMENT,
  REQUIRED_TOKENS,
  OPTIONAL_TOKENS,
  KNOWN_TOKENS,
  DEFAULT_REASON_LABELS,
  EXAMPLE_TEMPLATE,
  validateTemplate,
  generateNotice,
};
