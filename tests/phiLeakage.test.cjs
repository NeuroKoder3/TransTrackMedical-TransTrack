/**
 * TransTrack — PHI leakage prevention tests.
 *
 * Validates multiple layers of PHI protection:
 * 1. SIEM formatters exclude patient_name
 * 2. Offline reconciliation disabled (throws when called)
 * 3. Error logger redacts sensitive keys
 *
 * Run standalone: node tests/phiLeakage.test.cjs
 */

'use strict';

const assert = require('assert');
const Database = require('better-sqlite3-multiple-ciphers');

// --- setup mocks ---

const mockApp = {
  getPath: () => __dirname,
  isPackaged: false,
};
require.cache[require.resolve('electron')] = {
  id: 'electron', filename: 'electron', loaded: true,
  exports: { app: mockApp },
};

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
const recon = require('../electron/services/offlineReconciliation.cjs');

let pass = 0;
let fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  FAIL ${name}: ${e.message}`); }
}

console.log('phiLeakage — multi-layer PHI protection');

// ----------- 1. SIEM redaction -----------

console.log('\n  Layer 1: SIEM formatters');

const phiSample = {
  org_id: 'ORG1',
  user_email: 'coord@example.com',
  user_role: 'coordinator',
  action: 'patient.view_phi',
  entity_type: 'Patient',
  entity_id: 'P999',
  patient_name: 'Jane Smith',
  details: 'Direct patient care',
  request_id: 'req-phi-1',
  created_at: '2026-07-15T10:00:00.000Z',
};

test('SIEM CEF output has no patient_name', () => {
  const out = siem.toCef(phiSample);
  assert.ok(!out.includes('Jane Smith'), 'CEF must not contain patient name');
});

test('SIEM JSON output has no patient_name', () => {
  const out = siem.toJson(phiSample);
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.patient_name, undefined, 'JSON payload must not have patient_name');
  assert.ok(!out.includes('Jane Smith'));
});

test('SIEM RFC5424 output has no patient_name', () => {
  const out = siem.toRfc5424(phiSample);
  assert.ok(!out.includes('Jane Smith'), 'RFC5424 must not contain patient name');
});

// ----------- 2. Offline reconciliation disabled -----------

console.log('\n  Layer 2: Offline reconciliation disabled');

test('offlineReconciliation.queueChangeForReconciliation throws', () => {
  assert.throws(
    () => recon.queueChangeForReconciliation(),
    /disabled|single-workstation/i,
    'Must throw when offline reconciliation is called'
  );
});

test('offlineReconciliation.setOperationMode throws', () => {
  assert.throws(
    () => recon.setOperationMode('DEGRADED'),
    /disabled|single-workstation/i
  );
});

test('offlineReconciliation.detectConflicts throws', () => {
  assert.throws(
    () => recon.detectConflicts(),
    /disabled|single-workstation/i
  );
});

test('offlineReconciliation.getReconciliationStatus returns disabled', () => {
  const status = recon.getReconciliationStatus();
  assert.strictEqual(status.disabled, true);
  assert.ok(status.disabledReason.includes('single-workstation'));
});

test('offlineReconciliation.getPendingChangesCount returns 0', () => {
  assert.strictEqual(recon.getPendingChangesCount(), 0);
});

// ----------- 3. Error logger redaction -----------

console.log('\n  Layer 3: Error logger redaction');

test('errorLogger module has SENSITIVE_KEYS including password and ssn', () => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'ipc', 'errorLogger.cjs'), 'utf8'
  );
  assert.ok(source.includes("'password'"), 'Must redact password');
  assert.ok(source.includes("'ssn'"), 'Must redact SSN');
  assert.ok(source.includes('[REDACTED]'), 'Must replace with [REDACTED]');
});

test('errorLogger SENSITIVE_KEYS includes api_key and token', () => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'ipc', 'errorLogger.cjs'), 'utf8'
  );
  assert.ok(source.includes("'api_key'"), 'Must redact api_key');
  assert.ok(source.includes("'token'"), 'Must redact token');
  assert.ok(source.includes("'encryption_key'"), 'Must redact encryption_key');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
