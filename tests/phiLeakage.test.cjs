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
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3-multiple-ciphers');
const { createTestDataDir } = require('../scripts/test-temp-dir.cjs');

// --- setup mocks ---

// Layer 3 below executes the error logger, which appends to
// `<userData>/logs`. Pointing userData at tests/ wrote real log files into the
// repository working tree (L-9), so the mock resolves to a scratch directory
// under os.tmpdir() that is removed when this process exits.
const mockUserData = createTestDataDir('phileak');

const mockApp = {
  getPath: () => mockUserData,
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

// These two tests used to read electron/ipc/errorLogger.cjs and assert that the
// strings 'password' and 'ssn' appeared somewhere in it (M-23). That passes for
// a file that merely mentions the words — including one whose redaction has been
// commented out — and fails for a correct implementation that spells its key set
// differently. They now drive the real logger and read back what it wrote to
// disk, which is the artifact that ends up in a support bundle.

const errorLogger = require('../electron/ipc/errorLogger.cjs');

/** Log through errorLogger and return the JSON lines it appended. */
function captureLoggedLines(emit) {
  const before = fs.existsSync(errorLogger.LOG_DIR)
    ? new Set(fs.readdirSync(errorLogger.LOG_DIR))
    : new Set();

  const sizes = new Map();
  for (const name of before) {
    sizes.set(name, fs.statSync(path.join(errorLogger.LOG_DIR, name)).size);
  }

  emit(errorLogger.createLogger('phiLeakage-test'));

  const lines = [];
  for (const name of fs.readdirSync(errorLogger.LOG_DIR)) {
    const full = path.join(errorLogger.LOG_DIR, name);
    const from = sizes.get(name) || 0;
    const text = fs.readFileSync(full, 'utf8').slice(from);
    for (const line of text.split('\n')) {
      if (line.trim()) lines.push(line);
    }
  }
  assert.ok(lines.length > 0, 'errorLogger wrote nothing to disk');
  return lines;
}

const SENSITIVE_SAMPLE = {
  password: 'Sup3rSecret!Pw',
  password_hash: '$2a$12$abcdefghijklmnopqrstuv',
  ssn: '123-45-6789',
  social_security: '987-65-4321',
  credit_card: '4111111111111111',
  api_key: 'ak_live_9f8e7d6c5b4a',
  token: 'eyJhbGciOiJIUzI1NiJ9.payload.sig',
  secret: 'shhh-do-not-log-me',
  encryption_key: 'deadbeefdeadbeefdeadbeefdeadbeef',
  // Non-sensitive context must survive so the log stays diagnosable.
  request_id: 'req-redaction-1',
};

const SENSITIVE_VALUES = Object.entries(SENSITIVE_SAMPLE)
  .filter(([k]) => k !== 'request_id')
  .map(([, v]) => v);

test('errorLogger.info redacts every sensitive key it writes to disk', () => {
  const lines = captureLoggedLines((log) => {
    log.info('handler completed', { ...SENSITIVE_SAMPLE });
  });
  const written = lines.join('\n');

  for (const value of SENSITIVE_VALUES) {
    assert.ok(!written.includes(value), `log contains unredacted value "${value}"`);
  }

  const entry = JSON.parse(lines[lines.length - 1]);
  for (const key of Object.keys(SENSITIVE_SAMPLE)) {
    if (key === 'request_id') continue;
    assert.strictEqual(entry[key], '[REDACTED]', `${key} was not replaced with [REDACTED]`);
  }
  assert.strictEqual(entry.request_id, 'req-redaction-1', 'non-sensitive context must survive');
});

test('errorLogger redacts sensitive keys nested inside objects and arrays', () => {
  const lines = captureLoggedLines((log) => {
    log.error('handler failed', new Error('boom'), {
      request_id: 'req-redaction-2',
      user: { email: 'coord@example.com', password: 'NestedSecret!1' },
      attempts: [{ TOKEN: 'MixedCaseToken' }, { ssn: '111-22-3333' }],
    });
  });
  const written = lines.join('\n');

  for (const value of ['NestedSecret!1', 'MixedCaseToken', '111-22-3333']) {
    assert.ok(!written.includes(value), `log contains unredacted nested value "${value}"`);
  }

  const entry = JSON.parse(lines[lines.length - 1]);
  assert.strictEqual(entry.user.password, '[REDACTED]');
  // Key matching must be case-insensitive, or a handler that names the field
  // TOKEN slips through.
  assert.strictEqual(entry.attempts[0].TOKEN, '[REDACTED]');
  assert.strictEqual(entry.attempts[1].ssn, '[REDACTED]');
  assert.strictEqual(entry.user.email, 'coord@example.com');
});

test('errorLogger.audit redacts and leaves the caller object untouched', () => {
  const details = { ssn: '555-44-3333', action_note: 'break-glass access' };
  const lines = captureLoggedLines((log) => {
    log.audit('phi.view', details);
  });

  const entry = JSON.parse(lines[lines.length - 1]);
  assert.strictEqual(entry.level, 'AUDIT');
  assert.strictEqual(entry.ssn, '[REDACTED]');
  assert.strictEqual(entry.action_note, 'break-glass access');

  // Redaction must copy, not mutate: a caller that logs a live record and then
  // persists it would otherwise write '[REDACTED]' into the database.
  assert.strictEqual(details.ssn, '555-44-3333');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
