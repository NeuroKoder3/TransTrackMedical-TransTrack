/**
 * TransTrack — HL7 ingest service tests.
 * Run with: node tests/hl7Ingest.test.cjs
 */

'use strict';

const assert = require('assert');
const Database = require('better-sqlite3-multiple-ciphers');
const initModule = require('../electron/database/init.cjs');

function buildDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE organizations (id TEXT PRIMARY KEY);
    CREATE TABLE users (id TEXT PRIMARY KEY, org_id TEXT, email TEXT, role TEXT);
    CREATE TABLE patients (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      patient_id TEXT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      date_of_birth TEXT,
      blood_type TEXT,
      organ_needed TEXT,
      medical_urgency TEXT,
      waitlist_status TEXT,
      phone TEXT,
      created_by TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE lab_results (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      test_code TEXT NOT NULL,
      test_name TEXT NOT NULL,
      value TEXT NOT NULL,
      units TEXT,
      reference_range TEXT,
      collected_at TEXT NOT NULL,
      resulted_at TEXT,
      source TEXT NOT NULL DEFAULT 'MANUAL' CHECK(source IN ('MANUAL', 'FHIR_IMPORT')),
      ordering_service TEXT,
      entered_by TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT
    );
    INSERT INTO organizations (id) VALUES ('ORG1');
    INSERT INTO users (id, org_id, email, role) VALUES ('U1','ORG1','admin@local','admin');
  `);
  return db;
}

const db = buildDb();
initModule.getDatabase = () => db;

const hl7 = require('../electron/services/hl7v2.cjs');
const ingest = require('../electron/services/hl7Ingest.cjs');

let PASS = 0, FAIL = 0; const failures = [];
function test(n, fn) {
  try { fn(); PASS++; console.log(`  PASS  ${n}`); }
  catch (e) { FAIL++; failures.push({ n, e }); console.log(`  FAIL  ${n}\n        ${e.message}`); }
}

console.log('\n=== HL7 ingest ===');

const adtA04 = [
  'MSH|^~\\&|EPIC|HOSP|TT|TT|20260423120000||ADT^A04|MSGID0001|P|2.5',
  'PID|1||MRN12345^^^HOSP^MR||DOE^JOHN^Q||19700115|M|||123 MAIN ST^^METRO^MA^02115||(555)123-4567',
  'PV1|1|O|CLINIC^^^HOSP||||1234^SMITH^A',
].join('\r');

const oruR01 = [
  'MSH|^~\\&|LIS|HOSP|TT|TT|20260423120500||ORU^R01|MSGID0002|P|2.5',
  'PID|1||MRN12345^^^HOSP^MR||DOE^JOHN^Q||19700115|M',
  'OBR|1|ORD123^LIS|FILL456^LIS|24323-8^Comprehensive metabolic panel^LN|||20260423120000',
  'OBX|1|NM|2160-0^Creatinine^LN||1.4|mg/dL|0.6-1.3|H|||F|||20260423120000',
  'OBX|2|NM|6690-2^WBC^LN||7.2|10*3/uL|4.0-11.0|N|||F|||20260423120000',
].join('\r');

test('ADT^A04 creates patient when MRN unknown', () => {
  const parsed = hl7.parseMessage(adtA04);
  const summary = ingest.ingest({
    orgId: 'ORG1', parsed, userEmail: 'admin@local', userId: 'U1',
  });
  assert.strictEqual(summary.ok, true);
  assert.ok(summary.patient);
  assert.strictEqual(summary.patient.action, 'created');
  assert.strictEqual(summary.patient.mrn, 'MRN12345');
  const row = db.prepare('SELECT * FROM patients WHERE org_id = ? AND patient_id = ?').get('ORG1', 'MRN12345');
  assert.ok(row);
  assert.strictEqual(row.first_name, 'JOHN');
  assert.strictEqual(row.last_name, 'DOE');
  assert.strictEqual(row.date_of_birth, '1970-01-15');
});

test('Re-ingesting same ADT updates demographics (and is idempotent on duplicate data)', () => {
  // simulate a follow-up ADT^A08 with corrected first name
  const updated = adtA04.replace('JOHN^Q', 'JONATHAN^Q');
  const parsed = hl7.parseMessage(updated);
  const summary = ingest.ingest({
    orgId: 'ORG1', parsed, userEmail: 'admin@local', userId: 'U1',
  });
  assert.strictEqual(summary.ok, true);
  assert.strictEqual(summary.patient.action, 'updated');
  assert.ok(summary.patient.updatedFields.includes('first_name'));

  // second pass with no changes → matched, no update
  const summary2 = ingest.ingest({
    orgId: 'ORG1', parsed, userEmail: 'admin@local', userId: 'U1',
  });
  assert.strictEqual(summary2.patient.action, 'matched');
});

test('ORU^R01 inserts lab_results rows for known patient', () => {
  const parsed = hl7.parseMessage(oruR01);
  const summary = ingest.ingest({
    orgId: 'ORG1', parsed, userEmail: 'admin@local', userId: 'U1',
  });
  assert.strictEqual(summary.ok, true);
  assert.strictEqual(summary.labs.inserted, 2);
  const labs = db.prepare('SELECT * FROM lab_results WHERE patient_id = ? ORDER BY test_code').all(summary.patient.id);
  assert.strictEqual(labs.length, 2);
  assert.strictEqual(labs[0].source, 'FHIR_IMPORT');
  assert.ok(labs[0].ordering_service.startsWith('HL7_v2/'));
  assert.strictEqual(labs[0].entered_by, 'U1');
  // value preserved as string (no clinical interpretation)
  const creat = labs.find(l => l.test_name.includes('Creatinine'));
  assert.ok(creat);
  assert.strictEqual(creat.value, '1.4');
  assert.strictEqual(creat.units, 'mg/dL');
});

test('createPatient=false leaves DB unchanged when no MRN match', () => {
  const newMrnMessage = adtA04.replace('MRN12345', 'NEWMRN999');
  const parsed = hl7.parseMessage(newMrnMessage);
  const before = db.prepare('SELECT COUNT(*) as c FROM patients').get().c;
  const summary = ingest.ingest({
    orgId: 'ORG1', parsed, userEmail: 'admin@local', userId: 'U1',
    options: { createPatient: false },
  });
  assert.strictEqual(summary.ok, true); // nothing failed; just nothing created
  assert.strictEqual(summary.patient, null);
  const after = db.prepare('SELECT COUNT(*) as c FROM patients').get().c;
  assert.strictEqual(before, after);
});

test('Cross-org isolation: ORG2 cannot see/match ORG1 MRNs', () => {
  db.exec(`INSERT INTO organizations (id) VALUES ('ORG2');`);
  const parsed = hl7.parseMessage(adtA04);
  const summary = ingest.ingest({
    orgId: 'ORG2', parsed, userEmail: 'admin@local', userId: 'U1',
  });
  // Different org — MRN12345 not in ORG2, so this creates a new ORG2 patient
  assert.strictEqual(summary.patient.action, 'created');
  const r = db.prepare('SELECT COUNT(*) as c FROM patients WHERE patient_id = ?').get('MRN12345').c;
  assert.strictEqual(r, 2); // one in each org
});

test('Message without PID does not throw and reports a warning', () => {
  const noPid = [
    'MSH|^~\\&|EPIC|HOSP|TT|TT|20260423120000||ADT^A04|MSGID0099|P|2.5',
    'PV1|1|O|CLINIC',
  ].join('\r');
  const parsed = hl7.parseMessage(noPid);
  const summary = ingest.ingest({ orgId: 'ORG1', parsed, userEmail: 'admin@local', userId: 'U1' });
  assert.strictEqual(summary.ok, false);
  assert.ok(summary.warnings.some(w => /No PID/i.test(w)));
});

console.log(`\nResults: ${PASS} passed, ${FAIL} failed.`);
if (FAIL > 0) {
  for (const f of failures) console.error(`\n${f.n}:\n${f.e.stack || f.e.message}`);
  process.exit(1);
}
