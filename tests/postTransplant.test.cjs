/**
 * TransTrack — Post-transplant follow-up service tests.
 * Run with: node tests/postTransplant.test.cjs
 */

'use strict';

const assert = require('assert');
const Database = require('better-sqlite3-multiple-ciphers');
const initModule = require('../electron/database/init.cjs');

function buildDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE organizations (id TEXT PRIMARY KEY);
    CREATE TABLE patients (id TEXT PRIMARY KEY, org_id TEXT);
    CREATE TABLE transplant_events (
      id TEXT PRIMARY KEY, org_id TEXT, patient_id TEXT, donor_organ_id TEXT,
      organ_type TEXT, transplant_date TEXT, surgeon TEXT,
      warm_ischemia_time_min REAL, cold_ischemia_time_min REAL,
      induction_regimen TEXT, discharge_date TEXT,
      graft_status TEXT NOT NULL DEFAULT 'FUNCTIONING',
      patient_status TEXT NOT NULL DEFAULT 'ALIVE',
      deceased_date TEXT, deceased_cause TEXT, notes TEXT,
      created_by TEXT, updated_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE immunosuppression_regimens (
      id TEXT PRIMARY KEY, org_id TEXT, patient_id TEXT, transplant_event_id TEXT,
      start_date TEXT, end_date TEXT, drug_name TEXT, dose TEXT, frequency TEXT,
      target_trough TEXT, notes TEXT, created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE rejection_episodes (
      id TEXT PRIMARY KEY, org_id TEXT, patient_id TEXT, transplant_event_id TEXT,
      episode_date TEXT, rejection_type TEXT, severity TEXT,
      treatment TEXT, resolution_date TEXT, biopsy_id TEXT, notes TEXT, created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE biopsies (
      id TEXT PRIMARY KEY, org_id TEXT, patient_id TEXT, transplant_event_id TEXT,
      biopsy_date TEXT, biopsy_type TEXT, finding TEXT, banff_grade TEXT,
      notes TEXT, created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE post_tx_readmissions (
      id TEXT PRIMARY KEY, org_id TEXT, patient_id TEXT, transplant_event_id TEXT,
      admit_date TEXT, discharge_date TEXT, reason TEXT,
      related_to_graft INTEGER DEFAULT 0, notes TEXT, created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO organizations VALUES ('ORG1');
    INSERT INTO patients VALUES ('P1', 'ORG1');
  `);
  return db;
}

const db = buildDb();
initModule.getDatabase = () => db;
const svc = require('../electron/services/postTransplant.cjs');

let PASS = 0, FAIL = 0; const failures = [];
function test(n, fn) {
  try { fn(); PASS++; console.log(`  PASS  ${n}`); }
  catch (e) { FAIL++; failures.push({ n, e }); console.log(`  FAIL  ${n}\n        ${e.message}`); }
}

console.log('\n=== Post-transplant follow-up ===');

test('createTransplantEvent requires patient + organ + date', () => {
  assert.throws(() => svc.createTransplantEvent({ orgId: 'ORG1' }));
  assert.throws(() => svc.createTransplantEvent({ orgId: 'ORG1', patientId: 'P1', organType: 'Kidney' }));
});

test('createTransplantEvent persists with FUNCTIONING/ALIVE defaults', () => {
  const e = svc.createTransplantEvent({
    orgId: 'ORG1', patientId: 'P1', organType: 'Kidney',
    transplantDate: '2026-04-01', surgeon: 'Dr. Smith',
  });
  assert.ok(e.id);
  assert.strictEqual(e.graft_status, 'FUNCTIONING');
  assert.strictEqual(e.patient_status, 'ALIVE');
});

test('updateTransplantEvent only updates allowed fields', () => {
  const e = svc.createTransplantEvent({
    orgId: 'ORG1', patientId: 'P1', organType: 'Liver', transplantDate: '2026-04-02',
  });
  const u = svc.updateTransplantEvent({
    id: e.id, orgId: 'ORG1',
    fields: { surgeon: 'Dr. Lee', graft_status: 'FAILED', not_a_real_field: 'x' },
  });
  assert.strictEqual(u.surgeon, 'Dr. Lee');
  assert.strictEqual(u.graft_status, 'FAILED');
  assert.strictEqual(u.not_a_real_field, undefined);
});

test('immuno regimens, rejections, biopsies and readmissions all persist', () => {
  const e = svc.createTransplantEvent({
    orgId: 'ORG1', patientId: 'P1', organType: 'Kidney', transplantDate: '2026-04-03',
  });
  svc.createImmunoRegimen({
    orgId: 'ORG1', patientId: 'P1', transplantEventId: e.id, startDate: '2026-04-03',
    drugName: 'Tacrolimus',
  });
  svc.createRejection({
    orgId: 'ORG1', patientId: 'P1', transplantEventId: e.id, episodeDate: '2026-05-01',
    rejectionType: 'ACUTE_CELLULAR',
  });
  svc.createBiopsy({
    orgId: 'ORG1', patientId: 'P1', transplantEventId: e.id, biopsyDate: '2026-05-01',
  });
  svc.createReadmission({
    orgId: 'ORG1', patientId: 'P1', transplantEventId: e.id, admitDate: '2026-05-02',
    relatedToGraft: true,
  });
  const summary = svc.getPatientPostTxSummary('P1', 'ORG1');
  assert.ok(summary.transplant_events.length >= 1);
  assert.strictEqual(summary.counts.active_immuno, 1);
  assert.ok(summary.counts.rejections >= 1);
  assert.ok(summary.counts.biopsies >= 1);
  assert.ok(summary.counts.readmissions >= 1);
});

test('cross-org isolation', () => {
  const e = svc.createTransplantEvent({
    orgId: 'ORG1', patientId: 'P1', organType: 'Lung', transplantDate: '2026-04-04',
  });
  assert.strictEqual(svc.getTransplantEvent(e.id, 'ORG_OTHER'), undefined);
});

console.log(`\nResults: ${PASS} passed, ${FAIL} failed.`);
if (FAIL > 0) {
  for (const f of failures) console.error(`\n${f.n}:\n${f.e.stack || f.e.message}`);
  process.exit(1);
}
