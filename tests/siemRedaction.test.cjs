/**
 * TransTrack — SIEM redaction tests.
 *
 * Proves that all SIEM formatters strip patient_name before forwarding,
 * so PHI is never transmitted to external SIEM collectors.
 *
 * Run standalone: node tests/siemRedaction.test.cjs
 */

'use strict';

const assert = require('assert');
const Database = require('better-sqlite3-multiple-ciphers');

// Provide a minimal in-memory DB for the siemForwarder's lazy getDatabase().
const db = new Database(':memory:');
db.exec(`
  CREATE TABLE siem_destinations (
    id TEXT PRIMARY KEY, org_id TEXT, name TEXT, host TEXT, port INTEGER,
    protocol TEXT, format TEXT, enabled INTEGER, severity_filter TEXT,
    last_success_at TEXT, last_failure_at TEXT, last_failure_reason TEXT,
    dropped_count INTEGER DEFAULT 0, created_by TEXT,
    created_at TEXT, updated_at TEXT
  );
`);

const initPath = require.resolve('../electron/database/init.cjs');
require.cache[initPath] = {
  id: initPath, filename: initPath, loaded: true,
  exports: { getDatabase: () => db },
};

const siem = require('../electron/services/siemForwarder.cjs');

let pass = 0;
let fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  FAIL ${name}: ${e.message}`); }
}

const sampleWithPhi = {
  org_id: 'ORG1',
  user_email: 'admin@example.com',
  user_role: 'admin',
  action: 'patient.view_phi',
  entity_type: 'Patient',
  entity_id: 'P123',
  patient_name: 'John Doe',
  details: 'PHI access for transplant candidacy review',
  request_id: 'req-1',
  created_at: '2026-04-23T12:00:00.000Z',
};

console.log('siemRedaction — PHI must never appear in SIEM output');

test('CEF format strips patient_name', () => {
  const output = siem.toCef(sampleWithPhi);
  assert.ok(!output.includes('John Doe'), 'patient_name must not appear in CEF output');
  assert.ok(!output.includes('patient_name'), 'patient_name field must not appear in CEF output');
});

test('JSON format strips patient_name', () => {
  const output = siem.toJson(sampleWithPhi);
  const parsed = JSON.parse(output);
  assert.strictEqual(parsed.patient_name, undefined, 'patient_name must not be in JSON payload');
  assert.ok(!output.includes('John Doe'), 'patient_name value must not appear in JSON output');
});

test('RFC5424 format strips patient_name', () => {
  const output = siem.toRfc5424(sampleWithPhi);
  assert.ok(!output.includes('John Doe'), 'patient_name must not appear in RFC5424 output');
});

test('formatRecord with CEF strips patient_name', () => {
  const output = siem.formatRecord(sampleWithPhi, 'cef');
  assert.ok(!output.includes('John Doe'));
});

test('formatRecord with JSON strips patient_name', () => {
  const output = siem.formatRecord(sampleWithPhi, 'json');
  assert.ok(!output.includes('John Doe'));
});

test('formatRecord with rfc5424 strips patient_name', () => {
  const output = siem.formatRecord(sampleWithPhi, 'rfc5424');
  assert.ok(!output.includes('John Doe'));
});

test('details field is also sanitized (not raw PHI)', () => {
  const output = siem.toJson({
    ...sampleWithPhi,
    details: 'Patient John Doe SSN 123-45-6789',
  });
  const parsed = JSON.parse(output);
  // Details should be redacted to action:entityType:entityId format
  assert.ok(!parsed.details.includes('John Doe'), 'Raw PHI in details must be redacted');
  assert.ok(!parsed.details.includes('123-45-6789'), 'SSN in details must be redacted');
});

test('null patient_name is also handled cleanly', () => {
  const output = siem.toJson({ ...sampleWithPhi, patient_name: null });
  const parsed = JSON.parse(output);
  assert.strictEqual(parsed.patient_name, undefined);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
