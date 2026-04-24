/**
 * TransTrack — Living donor workflow tests.
 *
 * Run with: node tests/livingDonors.test.cjs
 * (requires `npm rebuild better-sqlite3-multiple-ciphers` once per Node version)
 */

'use strict';

const assert = require('assert');
const Database = require('better-sqlite3-multiple-ciphers');
const initModule = require('../electron/database/init.cjs');

function buildTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT, status TEXT);
    CREATE TABLE patients (id TEXT PRIMARY KEY, org_id TEXT);
    CREATE TABLE living_donors (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      mrn TEXT, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
      date_of_birth TEXT, sex TEXT, blood_type TEXT,
      relationship_to_recipient TEXT, recipient_patient_id TEXT,
      intended_organ TEXT NOT NULL,
      phone TEXT, email TEXT, address TEXT,
      status TEXT NOT NULL DEFAULT 'INQUIRY',
      status_reason TEXT,
      created_by TEXT, updated_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE living_donor_evaluations (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, living_donor_id TEXT NOT NULL,
      step TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING',
      scheduled_date TEXT, completed_date TEXT, owner_role TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE living_donor_followups (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, living_donor_id TEXT NOT NULL,
      milestone_months INTEGER NOT NULL, due_date TEXT NOT NULL,
      completed_date TEXT, status TEXT NOT NULL DEFAULT 'PENDING',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO organizations VALUES ('ORG1', 'Test', 'ACTIVE');
    INSERT INTO patients VALUES ('R1', 'ORG1');
  `);
  return db;
}

const db = buildTestDb();
initModule.getDatabase = () => db;
const ld = require('../electron/services/livingDonors.cjs');

let PASS = 0, FAIL = 0; const failures = [];
function test(n, fn) {
  try { fn(); PASS++; console.log(`  PASS  ${n}`); }
  catch (e) { FAIL++; failures.push({ n, e }); console.log(`  FAIL  ${n}\n        ${e.message}`); }
}

console.log('\n=== Living Donor Workflow ===');

test('createDonor requires first/last name and intended_organ', () => {
  assert.throws(() => ld.createDonor({ orgId: 'ORG1' }));
  assert.throws(() => ld.createDonor({ orgId: 'ORG1', firstName: 'A', lastName: 'B' }));
});

test('createDonor starts in INQUIRY status', () => {
  const d = ld.createDonor({
    orgId: 'ORG1', firstName: 'Alice', lastName: 'Donor',
    intendedOrgan: 'KIDNEY', recipientPatientId: 'R1',
  });
  assert.strictEqual(d.status, 'INQUIRY');
  assert.strictEqual(d.intended_organ, 'KIDNEY');
});

test('valid transition INQUIRY → SCREENING', () => {
  const d = ld.createDonor({ orgId: 'ORG1', firstName: 'Bob', lastName: 'D', intendedOrgan: 'KIDNEY' });
  const u = ld.transitionDonor({ id: d.id, orgId: 'ORG1', toStatus: 'SCREENING' });
  assert.strictEqual(u.status, 'SCREENING');
});

test('illegal transition INQUIRY → DONATED throws', () => {
  const d = ld.createDonor({ orgId: 'ORG1', firstName: 'Cara', lastName: 'D', intendedOrgan: 'KIDNEY' });
  assert.throws(() => ld.transitionDonor({ id: d.id, orgId: 'ORG1', toStatus: 'DONATED', donationDate: '2026-01-01' }));
});

test('DECLINED requires a reason', () => {
  const d = ld.createDonor({ orgId: 'ORG1', firstName: 'Dan', lastName: 'D', intendedOrgan: 'KIDNEY' });
  assert.throws(() => ld.transitionDonor({ id: d.id, orgId: 'ORG1', toStatus: 'DECLINED' }));
  const u = ld.transitionDonor({ id: d.id, orgId: 'ORG1', toStatus: 'DECLINED', reason: 'medical' });
  assert.strictEqual(u.status, 'DECLINED');
});

test('DONATED requires donation_date and creates 6/12/24-month followups', () => {
  const d = ld.createDonor({ orgId: 'ORG1', firstName: 'Eve', lastName: 'D', intendedOrgan: 'KIDNEY' });
  ld.transitionDonor({ id: d.id, orgId: 'ORG1', toStatus: 'SCREENING' });
  ld.transitionDonor({ id: d.id, orgId: 'ORG1', toStatus: 'EVALUATION' });
  ld.transitionDonor({ id: d.id, orgId: 'ORG1', toStatus: 'APPROVED' });
  assert.throws(() => ld.transitionDonor({ id: d.id, orgId: 'ORG1', toStatus: 'DONATED' }));
  ld.transitionDonor({ id: d.id, orgId: 'ORG1', toStatus: 'DONATED', donationDate: '2026-01-01' });
  const f = ld.listFollowups(d.id, 'ORG1');
  assert.strictEqual(f.length, 3);
  assert.deepStrictEqual(f.map(x => x.milestone_months).sort((a, b) => a - b), [6, 12, 24]);
});

test('addEvaluationStep + listEvaluations', () => {
  const d = ld.createDonor({ orgId: 'ORG1', firstName: 'Fay', lastName: 'D', intendedOrgan: 'KIDNEY' });
  ld.addEvaluationStep({ orgId: 'ORG1', livingDonorId: d.id, step: 'CT angiogram' });
  ld.addEvaluationStep({ orgId: 'ORG1', livingDonorId: d.id, step: 'Psychosocial eval' });
  const list = ld.listEvaluations(d.id, 'ORG1');
  assert.strictEqual(list.length, 2);
});

test('markOverdueFollowups flips PENDING items past due_date to OVERDUE', () => {
  const d = ld.createDonor({ orgId: 'ORG1', firstName: 'Gus', lastName: 'D', intendedOrgan: 'KIDNEY' });
  ld.transitionDonor({ id: d.id, orgId: 'ORG1', toStatus: 'SCREENING' });
  ld.transitionDonor({ id: d.id, orgId: 'ORG1', toStatus: 'EVALUATION' });
  ld.transitionDonor({ id: d.id, orgId: 'ORG1', toStatus: 'APPROVED' });
  ld.transitionDonor({ id: d.id, orgId: 'ORG1', toStatus: 'DONATED', donationDate: '2020-01-01' });
  const result = ld.markOverdueFollowups('ORG1');
  assert.ok(result.overdueCount >= 3);
});

test('cross-org isolation: getDonor with wrong orgId returns undefined', () => {
  const d = ld.createDonor({ orgId: 'ORG1', firstName: 'X', lastName: 'Y', intendedOrgan: 'KIDNEY' });
  assert.strictEqual(ld.getDonor(d.id, 'ORG_OTHER'), undefined);
});

console.log(`\nResults: ${PASS} passed, ${FAIL} failed.`);
if (FAIL > 0) {
  for (const f of failures) console.error(`\n${f.n}:\n${f.e.stack || f.e.message}`);
  process.exit(1);
}
