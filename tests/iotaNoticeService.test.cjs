/**
 * TransTrack — CMS IOTA notification pipeline (service layer).
 *
 * `iotaNoticeGenerator.cjs` proves a correct notice can be *rendered*. These
 * tests prove the obligation is actually *tracked*: that recording a status
 * change which blocks organ offers creates a notification duty, that the duty
 * is idempotent, that delivery is recorded honestly (including when it is
 * late), and that the compliance summary reports the states a CMS surveyor
 * asks about.
 *
 * Run standalone: node tests/iotaNoticeService.test.cjs
 */

'use strict';

const assert = require('assert');
const Database = require('better-sqlite3-multiple-ciphers');

const {
  createSchema, createIndexes, createAuditLogTriggers,
} = require('../electron/database/schema.cjs');
const svc = require('../electron/services/iotaNoticeService.cjs');
const generator = require('../electron/services/iotaNoticeGenerator.cjs');

let PASS = 0, FAIL = 0;
const failures = [];
function test(name, fn) {
  try { fn(); PASS++; console.log(`  ok  ${name}`); }
  catch (e) {
    FAIL++; failures.push({ name, error: e });
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}

const ORG = 'org-iota';
const PATIENT = 'pat-iota';
const ACTOR = { id: 'user-1', email: 'coordinator@example.org', role: 'coordinator' };

function makeDb({ configured = true } = {}) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  createSchema(db);
  createIndexes(db);
  createAuditLogTriggers(db);
  svc._resetColumnCache();

  db.prepare('INSERT INTO organizations (id, name, phone, email) VALUES (?, ?, ?, ?)')
    .run(ORG, 'Northern Regional Transplant Center', '555-0100', 'transplant@nrtc.example');
  db.prepare(
    `INSERT INTO patients (id, org_id, patient_id, first_name, last_name, organ_needed, waitlist_status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(PATIENT, ORG, 'MRN-4471', 'Dana', 'Whitfield', 'kidney', 'active');

  if (configured) {
    svc.saveConfig(db, ORG, {
      template: generator.EXAMPLE_TEMPLATE,
      reactivationSteps: 'Complete your annual cardiac clearance and call the office.',
      coordinatorName: 'J. Alvarez, RN',
      coordinatorPhone: '555-0142',
    });
  }
  return db;
}

const BLOCKING = {
  orgId: ORG,
  patientId: PATIENT,
  fromStatus: 'active',
  toStatus: 'inactive',
  reasonCode: 'EVAL_EXPIRED',
  effectiveAt: '2026-07-01T14:00:00Z',
  offerEligibilityImpact: 'blocks_offers',
};

// ---------------------------------------------------------------------------
console.log('\n=== Configuration ===');

test('an unconfigured centre reports exactly what is missing', () => {
  const db = makeDb({ configured: false });
  const c = svc.getConfig(db, ORG);
  assert.strictEqual(c.ready, false);
  assert.ok(c.missing.includes('notice template'));
  assert.ok(c.missing.includes('reactivation instructions'));
  db.close();
});

test('a template missing a required element is rejected at configuration time', () => {
  const db = makeDb({ configured: false });
  // Drop the offer-eligibility statement — the element most consequential to
  // omit, since it is what tells the patient they cannot receive an offer.
  const broken = generator.EXAMPLE_TEMPLATE.replace('{{offerEligibilityStatement}}', '');
  assert.throws(
    () => svc.saveConfig(db, ORG, { template: broken }),
    /rejected.*offerEligibilityStatement/s,
  );
  db.close();
});

test('a valid configuration is stored and reported ready', () => {
  const db = makeDb();
  const c = svc.getConfig(db, ORG);
  assert.strictEqual(c.ready, true);
  assert.strictEqual(c.templateValid, true);
  assert.ok(c.templateSha256 && c.templateSha256.length === 64);
  db.close();
});

// ---------------------------------------------------------------------------
console.log('\n=== Obligation creation ===');

test('a transition that blocks offers creates a notice automatically', () => {
  const db = makeDb();
  const r = svc.recordTransition(db, BLOCKING, ACTOR);
  assert.strictEqual(r.obligated, true);
  assert.strictEqual(r.noticeError, null);
  assert.ok(r.notice, 'a notice should have been generated');
  assert.strictEqual(r.notice.notice_kind, 'status_change');
  db.close();
});

test('the 10-day deadline runs from the effective time, not from generation', () => {
  const db = makeDb();
  const r = svc.recordTransition(db, BLOCKING, ACTOR);
  const expected = Date.parse(BLOCKING.effectiveAt) + generator.NOTICE_DUE_DAYS * 86400000;
  assert.strictEqual(Date.parse(r.notice.due_at), expected);
  db.close();
});

test('a transition that does not block offers creates no obligation', () => {
  const db = makeDb();
  const r = svc.recordTransition(
    db, { ...BLOCKING, toStatus: 'active', offerEligibilityImpact: 'restores_offers' }, ACTOR,
  );
  assert.strictEqual(r.obligated, false);
  assert.strictEqual(r.notice, null);
  assert.strictEqual(svc.listNotifications(db, ORG).length, 0);
  db.close();
});

test('an unconfigured centre still records the transition and surfaces the failure', () => {
  const db = makeDb({ configured: false });
  const r = svc.recordTransition(db, BLOCKING, ACTOR);

  // The transition is the record that proves when the clock started; losing it
  // because a template was missing would be far worse than an unmet notice.
  assert.strictEqual(svc.listTransitions(db, ORG).length, 1);
  assert.strictEqual(r.obligated, true);
  assert.strictEqual(r.notice, null);
  assert.match(r.noticeError, /not configured/i);
  db.close();
});

test('an unmet obligation is visible in the compliance summary', () => {
  const db = makeDb({ configured: false });
  svc.recordTransition(db, BLOCKING, ACTOR);
  const s = svc.getComplianceSummary(db, ORG);
  assert.strictEqual(s.obligatingTransitions, 1);
  assert.strictEqual(s.withoutNotice, 1);
  assert.strictEqual(s.config.ready, false);
  db.close();
});

test('the stored notice body hashes to the frozen content identity', () => {
  const db = makeDb();
  const r = svc.recordTransition(db, BLOCKING, ACTOR);
  assert.strictEqual(r.notice.contentIntegrityOk, true);
  assert.ok(r.notice.content.includes('Dana'), 'the body should be the rendered letter');
  db.close();
});

test('the notice states all five required elements', () => {
  const db = makeDb();
  const { notice } = svc.recordTransition(db, BLOCKING, ACTOR);
  const body = notice.content;
  assert.ok(body.includes('Northern Regional Transplant Center'), 'centre name');
  assert.ok(body.includes('MRN-4471'), 'medical record number');
  assert.ok(body.includes('cardiac clearance'), 'reactivation steps');
  assert.ok(/offer/i.test(body), 'offer eligibility statement');
  assert.ok(body.includes('555-0100') || body.includes('555-0142'), 'contact route');
  db.close();
});

// ---------------------------------------------------------------------------
console.log('\n=== Idempotency ===');

test('regenerating the same obligation does not file a second notice', () => {
  const db = makeDb();
  const { transitionId } = svc.recordTransition(db, BLOCKING, ACTOR);
  const again = svc.generateForTransition(db, { orgId: ORG, transitionId }, ACTOR);
  assert.strictEqual(svc.listNotifications(db, ORG).length, 1);
  assert.ok(again.id, 'the existing record is returned rather than a duplicate');
  db.close();
});

test('a deliberate reissue is a distinct record', () => {
  const db = makeDb();
  const { transitionId } = svc.recordTransition(db, BLOCKING, ACTOR);
  svc.generateForTransition(db, { orgId: ORG, transitionId, revision: 1 }, ACTOR);
  assert.strictEqual(svc.listNotifications(db, ORG).length, 2);
  db.close();
});

// ---------------------------------------------------------------------------
console.log('\n=== Delivery ===');

test('delivery is recorded and the notice leaves the pending queue', () => {
  const db = makeDb();
  const { notice } = svc.recordTransition(db, BLOCKING, ACTOR);
  const updated = svc.markDelivered(db, ORG, notice.id, {
    channel: 'mail', deliveredAt: '2026-07-05T10:00:00Z',
  });
  assert.strictEqual(updated.delivered, true);
  assert.strictEqual(updated.deliveredLate, false);
  assert.strictEqual(svc.listNotifications(db, ORG, { filter: 'pending' }).length, 0);
  db.close();
});

test('a notice delivered after the deadline is counted as late, not as met on time', () => {
  const db = makeDb();
  const { notice } = svc.recordTransition(db, BLOCKING, ACTOR);
  svc.markDelivered(db, ORG, notice.id, {
    channel: 'mail', deliveredAt: '2026-08-01T10:00:00Z', // past the 10-day due date
  });
  const s = svc.getComplianceSummary(db, ORG);
  assert.strictEqual(s.delivered, 1);
  assert.strictEqual(s.deliveredLate, 1);
  assert.strictEqual(s.deliveredOnTime, 0);
  assert.strictEqual(s.onTimeRate, 0);
  db.close();
});

test('a late delivery is no longer reported as overdue', () => {
  const db = makeDb();
  const { notice } = svc.recordTransition(db, BLOCKING, ACTOR);
  svc.markDelivered(db, ORG, notice.id, {
    channel: 'mail', deliveredAt: '2026-08-01T10:00:00Z',
  });
  const s = svc.getComplianceSummary(db, ORG, { now: Date.parse('2026-09-01T00:00:00Z') });
  assert.strictEqual(s.overdue, 0, 'a met obligation is not an open one');
  db.close();
});

test('an undelivered notice past its deadline is overdue', () => {
  const db = makeDb();
  svc.recordTransition(db, BLOCKING, ACTOR);
  const s = svc.getComplianceSummary(db, ORG, { now: Date.parse('2026-08-01T00:00:00Z') });
  assert.strictEqual(s.overdue, 1);
  assert.strictEqual(s.pending, 1);
  db.close();
});

test('delivery cannot be silently recorded twice', () => {
  const db = makeDb();
  const { notice } = svc.recordTransition(db, BLOCKING, ACTOR);
  svc.markDelivered(db, ORG, notice.id, { channel: 'mail' });
  assert.throws(
    () => svc.markDelivered(db, ORG, notice.id, { channel: 'electronic' }),
    /already recorded as delivered/i,
  );
  db.close();
});

test('an invalid delivery channel is refused', () => {
  const db = makeDb();
  const { notice } = svc.recordTransition(db, BLOCKING, ACTOR);
  assert.throws(() => svc.markDelivered(db, ORG, notice.id, { channel: 'carrier-pigeon' }),
    /electronic.*mail/);
  db.close();
});

// ---------------------------------------------------------------------------
console.log('\n=== Secondary recipient ===');

test('a kidney patient routes the required copy to the dialysis facility', () => {
  const db = makeDb();
  const { notice } = svc.recordTransition(db, BLOCKING, ACTOR);
  assert.strictEqual(notice.secondary_recipient_type, 'dialysis_facility');
  db.close();
});

test('an obligation addressed to an unnamed facility is flagged, not hidden', () => {
  // The patient is ESRD so a copy is owed to their dialysis facility, but no
  // facility is on file. Reporting this notice as complete would misrepresent
  // a duty the centre has not actually discharged.
  const db = makeDb();
  const { notice } = svc.recordTransition(db, BLOCKING, ACTOR);
  assert.strictEqual(notice.secondaryRecipientUnknown, true);
  assert.strictEqual(svc.getComplianceSummary(db, ORG).secondaryRecipientUnknown, 1);
  db.close();
});

test('notifying a secondary recipient is recorded', () => {
  const db = makeDb();
  const { notice } = svc.recordTransition(db, BLOCKING, ACTOR);
  const u = svc.markSecondaryNotified(db, ORG, notice.id);
  assert.ok(u.secondary_notified_at);
  db.close();
});

// ---------------------------------------------------------------------------
console.log('\n=== Organization isolation ===');

test('another organization cannot read or alter this centre\'s notices', () => {
  const db = makeDb();
  const { notice } = svc.recordTransition(db, BLOCKING, ACTOR);
  db.prepare('INSERT INTO organizations (id, name) VALUES (?, ?)').run('org-other', 'Other');

  assert.strictEqual(svc.getNotification(db, 'org-other', notice.id), null);
  assert.strictEqual(svc.listNotifications(db, 'org-other').length, 0);
  assert.throws(() => svc.markDelivered(db, 'org-other', notice.id, { channel: 'mail' }),
    /not found/i);
  db.close();
});

test('a transition cannot be recorded against another organization\'s patient', () => {
  const db = makeDb();
  db.prepare('INSERT INTO organizations (id, name) VALUES (?, ?)').run('org-other', 'Other');
  assert.throws(
    () => svc.recordTransition(db, { ...BLOCKING, orgId: 'org-other' }, ACTOR),
    /Patient not found/i,
  );
  db.close();
});

// ---------------------------------------------------------------------------
console.log('\n=== Immutability holds through the service ===');

test('the recorded transition remains immutable at the database level', () => {
  const db = makeDb();
  const { transitionId } = svc.recordTransition(db, BLOCKING, ACTOR);
  assert.throws(
    () => db.prepare('UPDATE waitlist_status_transitions SET to_status = ? WHERE id = ?')
      .run('active', transitionId),
    /immutable/i,
  );
  db.close();
});

test('a filed notice cannot be deleted', () => {
  const db = makeDb();
  const { notice } = svc.recordTransition(db, BLOCKING, ACTOR);
  assert.throws(
    () => db.prepare('DELETE FROM iota_notifications WHERE id = ?').run(notice.id),
    /cannot be deleted/i,
  );
  db.close();
});

// ---------------------------------------------------------------------------
console.log(`\n${PASS} passed, ${FAIL} failed`);
if (FAIL > 0) {
  for (const f of failures) console.error(`\n${f.name}\n${f.error.stack}`);
  process.exit(1);
}
