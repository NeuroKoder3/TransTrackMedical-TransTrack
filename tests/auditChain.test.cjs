/**
 * TransTrack — Desktop audit hash chain tests.
 *
 * Uses an in-memory SQLite DB to:
 *   1. Insert audit rows with hash chaining and verify the chain
 *   2. Tamper with a row and confirm verification fails
 *   3. Confirm that logAudit writes prev_hash + record_hash columns
 *
 * Run standalone: node tests/auditChain.test.cjs
 */

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const Database = require('better-sqlite3-multiple-ciphers');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE audit_logs (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    patient_name TEXT,
    details TEXT,
    user_id TEXT,
    user_email TEXT,
    user_role TEXT,
    request_id TEXT,
    prev_hash TEXT,
    record_hash TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL
  );
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    is_active INTEGER DEFAULT 1
  );
  CREATE TABLE login_attempts (
    id TEXT PRIMARY KEY,
    email TEXT,
    attempt_count INTEGER DEFAULT 0,
    locked_until TEXT,
    last_attempt_at TEXT,
    ip_address TEXT,
    created_at TEXT,
    updated_at TEXT
  );
  CREATE INDEX idx_audit_logs_hash_chain ON audit_logs(org_id, id);
`);

// Mock electron
const mockApp = { getPath: () => __dirname, isPackaged: false };
require.cache[require.resolve('electron')] = {
  id: 'electron', filename: 'electron', loaded: true,
  exports: { app: mockApp },
};

// Stub init.cjs to return our in-memory DB.
const initPath = require.resolve('../electron/database/init.cjs');
require.cache[initPath] = {
  id: initPath, filename: initPath, loaded: true,
  exports: {
    getDatabase: () => db,
    getDatabasePath: () => ':memory:',
    getDatabaseEncryptionKey: () => 'aa'.repeat(32),
  },
};

// Stub rateLimiter
try { require('../electron/ipc/rateLimiter.cjs'); } catch {
  const rlPath = require.resolve('../electron/ipc/rateLimiter.cjs');
  require.cache[rlPath] = {
    id: rlPath, filename: rlPath, loaded: true,
    exports: { checkRateLimit: () => ({ allowed: true }) },
  };
}

// Stub SIEM forwarder
const siemPath = require.resolve('../electron/services/siemForwarder.cjs');
require.cache[siemPath] = {
  id: siemPath, filename: siemPath, loaded: true,
  exports: { forwardAuditRow: () => {} },
};

const auditChain = require('../electron/services/auditChain.cjs');

let pass = 0;
let fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  FAIL ${name}: ${e.message}`); }
}

console.log('auditChain — insert + verify + tamper detection');

// Helper: compute hash the same way verifyAuditChain does.
function computeHash(prevHash, payload) {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return crypto.createHash('sha256').update(prevHash + canonical).digest('hex');
}

const ORG = 'ORG_CHAIN_TEST';

// Insert rows with sequential IDs so id ASC matches insertion order.
function insertAuditRow(id, action, entityType, entityId, prevHash) {
  const payload = {
    action,
    details: null,
    entity_id: entityId || null,
    entity_type: entityType || null,
    org_id: ORG,
    patient_name: null,
    user_email: 'admin@test',
    user_id: 'u1',
    user_role: 'admin',
  };
  const recordHash = computeHash(prevHash, payload);
  db.prepare(`
    INSERT INTO audit_logs (id, org_id, action, entity_type, entity_id,
      patient_name, details, user_id, user_email, user_role, prev_hash, record_hash, created_at)
    VALUES (?, ?, ?, ?, ?, NULL, NULL, 'u1', 'admin@test', 'admin', ?, ?, datetime('now'))
  `).run(id, ORG, action, entityType, entityId, prevHash, recordHash);
  return recordHash;
}

test('chain of 3 rows verifies successfully', () => {
  const h1 = insertAuditRow('row-001', 'patient.create', 'Patient', 'p1', 'GENESIS');
  const h2 = insertAuditRow('row-002', 'patient.update', 'Patient', 'p1', h1);
  insertAuditRow('row-003', 'organ_offer.accept', 'OrganOffer', 'oo1', h2);

  const result = auditChain.verifyAuditChain(ORG);
  assert.strictEqual(result.ok, true, 'Chain must verify');
  assert.strictEqual(result.verified, 3, 'Must verify exactly 3 rows');
});

test('tampered action field breaks the chain', () => {
  db.prepare('UPDATE audit_logs SET action = ? WHERE id = ?').run('EVIL', 'row-001');

  const result = auditChain.verifyAuditChain(ORG);
  assert.strictEqual(result.ok, false, 'Must detect tampered row');
  assert.strictEqual(result.brokenAt, 'row-001');

  // Restore
  db.prepare('UPDATE audit_logs SET action = ? WHERE id = ?').run('patient.create', 'row-001');
});

test('tampered record_hash breaks the chain', () => {
  const original = db.prepare('SELECT record_hash FROM audit_logs WHERE id = ?').get('row-002').record_hash;
  db.prepare('UPDATE audit_logs SET record_hash = ? WHERE id = ?').run('deadbeef', 'row-002');

  const result = auditChain.verifyAuditChain(ORG);
  assert.strictEqual(result.ok, false, 'Must detect hash manipulation');

  db.prepare('UPDATE audit_logs SET record_hash = ? WHERE id = ?').run(original, 'row-002');
});

test('tampered prev_hash breaks the chain', () => {
  const original = db.prepare('SELECT prev_hash FROM audit_logs WHERE id = ?').get('row-002').prev_hash;
  db.prepare('UPDATE audit_logs SET prev_hash = ? WHERE id = ?').run('00000000', 'row-002');

  const result = auditChain.verifyAuditChain(ORG);
  assert.strictEqual(result.ok, false, 'Must detect prev_hash manipulation');

  db.prepare('UPDATE audit_logs SET prev_hash = ? WHERE id = ?').run(original, 'row-002');
});

test('empty org chain returns ok with 0 verified', () => {
  const result = auditChain.verifyAuditChain('NONEXISTENT_ORG');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.verified, 0);
});

test('verifyAuditChain requires orgId', () => {
  assert.throws(() => auditChain.verifyAuditChain(null), /orgId required/);
  assert.throws(() => auditChain.verifyAuditChain(''), /orgId required/);
});

// Test that logAudit actually writes hash chain columns.
console.log('\nauditChain — logAudit writes hash columns');

const shared = require('../electron/ipc/shared.cjs');
const LOG_ORG = 'ORG_LOGAUDIT_' + Date.now();

db.prepare('INSERT INTO users (id, org_id) VALUES (?, ?)').run('u-log', LOG_ORG);
db.prepare('INSERT INTO sessions (id, user_id) VALUES (?, ?)').run('s-log', 'u-log');
shared.setSessionState('s-log', { id: 'u-log', org_id: LOG_ORG }, Date.now() + 3600000, null);

test('logAudit writes prev_hash and record_hash columns', () => {
  shared.logAudit('test.action', 'TestEntity', 'e1', null, 'test details', 'test@test', 'admin', 'r1');

  const rows = db.prepare(
    'SELECT prev_hash, record_hash FROM audit_logs WHERE org_id = ?'
  ).all(LOG_ORG);

  assert.ok(rows.length >= 1, 'Must have inserted at least 1 row');
  const row = rows[0];
  assert.ok(row.prev_hash, 'Must have prev_hash');
  assert.ok(row.record_hash, 'Must have record_hash');
  assert.ok(row.record_hash.length === 64, 'record_hash must be a 64-char hex SHA-256');
});

test('logAudit chains consecutive rows', () => {
  shared.logAudit('test.second', 'TestEntity', 'e2', null, 'second', 'test@test', 'admin', 'r2');

  const rows = db.prepare(
    'SELECT prev_hash, record_hash FROM audit_logs WHERE org_id = ? ORDER BY id DESC'
  ).all(LOG_ORG);

  assert.ok(rows.length >= 2, 'Must have at least 2 rows');
  // The most recent row (id DESC) should have prev_hash equal to another row's record_hash
  const latestRow = rows[0];
  const otherHashes = rows.slice(1).map(r => r.record_hash);
  assert.ok(
    otherHashes.includes(latestRow.prev_hash) || latestRow.prev_hash === 'GENESIS',
    'Latest row must chain from a previous row or GENESIS'
  );
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
