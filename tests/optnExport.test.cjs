/**
 * TransTrack — OPTN-style CSV export tests.
 * Run with: node tests/optnExport.test.cjs
 */

'use strict';

const assert = require('assert');
const Database = require('better-sqlite3-multiple-ciphers');
const initModule = require('../electron/database/init.cjs');

function buildDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE patients (
      id TEXT PRIMARY KEY, org_id TEXT, patient_id TEXT, last_name TEXT,
      first_name TEXT, date_of_birth TEXT, blood_type TEXT, organ_needed TEXT,
      medical_urgency TEXT, date_added_to_waitlist TEXT, meld_score REAL,
      las_score REAL, pra_percentage REAL, cpra_percentage REAL,
      diagnosis TEXT, height_cm REAL, weight_kg REAL, previous_transplants INTEGER
    );
    CREATE TABLE donor_organs (
      id TEXT PRIMARY KEY, org_id TEXT, donor_age INTEGER,
      cold_ischemia_time_hours REAL
    );
    CREATE TABLE transplant_events (
      id TEXT PRIMARY KEY, org_id TEXT, patient_id TEXT, donor_organ_id TEXT,
      organ_type TEXT, transplant_date TEXT, warm_ischemia_time_min REAL,
      induction_regimen TEXT, discharge_date TEXT, graft_status TEXT,
      patient_status TEXT, deceased_date TEXT, deceased_cause TEXT
    );
    CREATE TABLE rejection_episodes (
      id TEXT PRIMARY KEY, transplant_event_id TEXT, org_id TEXT
    );
    CREATE TABLE biopsies (
      id TEXT PRIMARY KEY, transplant_event_id TEXT, org_id TEXT
    );
    CREATE TABLE post_tx_readmissions (
      id TEXT PRIMARY KEY, transplant_event_id TEXT, org_id TEXT
    );
    CREATE TABLE immunosuppression_regimens (
      id TEXT PRIMARY KEY, patient_id TEXT, org_id TEXT,
      drug_name TEXT, start_date TEXT, end_date TEXT
    );

    INSERT INTO patients VALUES
      ('P1','ORG1','MRN1','Doe','John','1980-01-01','O+','Kidney','Routine','2026-01-10',
       NULL,NULL,NULL,NULL,'ESRD',180,80,0),
      ('P2','ORG1','MRN2','Roe','Jane','1965-05-05','A+','Liver','Status 1A','2026-02-15',
       28,NULL,NULL,NULL,'NASH cirrhosis',165,68,0);
    INSERT INTO donor_organs VALUES ('D1','ORG1',45,12.5);
    INSERT INTO transplant_events VALUES
      ('T1','ORG1','P1','D1','Kidney','2026-03-01',45,'Basiliximab','2026-03-08',
       'FUNCTIONING','ALIVE',NULL,NULL);
    INSERT INTO immunosuppression_regimens VALUES
      ('I1','P1','ORG1','Tacrolimus','2026-03-01',NULL),
      ('I2','P1','ORG1','MMF','2026-03-01',NULL);
  `);
  return db;
}

const db = buildDb();
initModule.getDatabase = () => db;
const optn = require('../electron/services/optnExport.cjs');

let PASS = 0, FAIL = 0; const failures = [];
function test(n, fn) {
  try { fn(); PASS++; console.log(`  PASS  ${n}`); }
  catch (e) { FAIL++; failures.push({ n, e }); console.log(`  FAIL  ${n}\n        ${e.message}`); }
}

console.log('\n=== OPTN exports ===');

test('TCR export contains both patients with correct columns', () => {
  const r = optn.exportTCR('ORG1');
  assert.strictEqual(r.rowCount, 2);
  assert.ok(r.csv.startsWith('# NOT AN OPTN SUBMISSION'));
  assert.ok(r.csv.includes('MRN1'));
  assert.ok(r.csv.includes('MRN2'));
  for (const c of optn.TCR_COLUMNS) assert.ok(r.csv.includes(c), `missing column ${c}`);
});

test('TCR since/until filters by date_added_to_waitlist', () => {
  const r = optn.exportTCR('ORG1', { since: '2026-02-01' });
  assert.strictEqual(r.rowCount, 1);
  assert.ok(r.csv.includes('MRN2'));
  assert.ok(!r.csv.includes('MRN1'));
});

test('TRR export includes donor + transplant fields', () => {
  const r = optn.exportTRR('ORG1');
  assert.strictEqual(r.rowCount, 1);
  assert.ok(r.csv.includes('Kidney'));
  assert.ok(r.csv.includes('Basiliximab'));
});

test('TRF export includes counts of post-tx events', () => {
  const r = optn.exportTRF('ORG1');
  assert.strictEqual(r.rowCount, 1);
  assert.ok(r.csv.includes('FUNCTIONING'));
  assert.ok(r.csv.includes('Tacrolimus') || r.csv.includes('MMF'));
});

test('CSV escapes commas and quotes per RFC 4180', () => {
  db.prepare(`UPDATE patients SET last_name = 'Doe, "Jr"' WHERE id = 'P1'`).run();
  const r = optn.exportTCR('ORG1');
  assert.ok(r.csv.includes('"Doe, ""Jr"""'));
});

test('Disclaimer is always emitted', () => {
  const r = optn.exportTCR('ORG1');
  assert.ok(r.disclaimer.includes('NOT AN OPTN SUBMISSION'));
  assert.ok(r.csv.startsWith('# NOT AN OPTN SUBMISSION'));
});

console.log(`\nResults: ${PASS} passed, ${FAIL} failed.`);
if (FAIL > 0) {
  for (const f of failures) console.error(`\n${f.n}:\n${f.e.stack || f.e.message}`);
  process.exit(1);
}
