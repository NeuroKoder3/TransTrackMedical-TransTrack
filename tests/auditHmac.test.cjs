/**
 * TransTrack — audit trail HMAC tamper-evidence tests.
 *
 * The SHA-256 hash chain alone is unkeyed: an attacker with write access to the
 * database file can edit a row and recompute every following record_hash so the
 * chain verifies cleanly. The keyed HMAC closes that hole, because forging it
 * also requires the audit key held in OS secure storage.
 *
 * These tests prove exactly that: a full re-chaining attack that defeats the
 * hash chain is still caught by the HMAC layer.
 *
 * Run standalone: node tests/auditHmac.test.cjs
 */

'use strict';

const assert = require('assert');
const path = require('path');
const Database = require('better-sqlite3-multiple-ciphers');

// Provide a deterministic audit key so the HMAC path runs without a keyring.
// The override is gated on NODE_ENV=test; see auditHmacKey.cjs.
process.env.NODE_ENV = 'test';
process.env.TRANSTRACK_AUDIT_HMAC_KEY = 'ab'.repeat(32);

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
    record_hmac TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
  CREATE TABLE users (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, is_active INTEGER DEFAULT 1);
  CREATE TABLE login_attempts (
    id TEXT PRIMARY KEY, email TEXT, attempt_count INTEGER DEFAULT 0,
    locked_until TEXT, last_attempt_at TEXT, ip_address TEXT,
    created_at TEXT, updated_at TEXT
  );
`);

require.cache[require.resolve('electron')] = {
  id: 'electron', filename: 'electron', loaded: true,
  exports: {
    app: { getPath: () => __dirname, isPackaged: false, getVersion: () => '1.2.0-test' },
    safeStorage: { isEncryptionAvailable: () => false },
  },
};

const initPath = require.resolve('../electron/database/init.cjs');
require.cache[initPath] = {
  id: initPath, filename: initPath, loaded: true,
  exports: {
    getDatabase: () => db,
    getDatabasePath: () => ':memory:',
    getDatabaseEncryptionKey: () => 'aa'.repeat(32),
  },
};

const siemPath = require.resolve('../electron/services/siemForwarder.cjs');
require.cache[siemPath] = {
  id: siemPath, filename: siemPath, loaded: true,
  exports: { forwardAuditRow: () => {} },
};

const shared = require('../electron/ipc/shared.cjs');
const auditChain = require('../electron/services/auditChain.cjs');
const auditCanonical = require('../electron/services/auditCanonical.cjs');
const auditHmacKey = require('../electron/services/auditHmacKey.cjs');

let PASS = 0, FAIL = 0;
const failures = [];
function test(name, fn) {
  try { fn(); PASS++; console.log(`  ok  ${name}`); }
  catch (e) {
    FAIL++; failures.push({ name, error: e });
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}

const ORG = 'ORG_HMAC_TEST';
db.prepare('INSERT INTO users (id, org_id) VALUES (?, ?)').run('u-hmac', ORG);
db.prepare('INSERT INTO sessions (id, user_id) VALUES (?, ?)').run('s-hmac', 'u-hmac');
shared.setSessionState('s-hmac', { id: 'u-hmac', org_id: ORG }, Date.now() + 3600000, null);

console.log('\n=== HMAC key management ===');

test('the audit HMAC key is available', () => {
  const status = auditHmacKey.getStatus();
  assert.strictEqual(status.available, true, JSON.stringify(status));
  assert.strictEqual(status.testOverrideInUse, true, 'this suite runs on the test override');
  assert.strictEqual(status.testOverrideRejected, false);
});

test('computeAuditHmac is deterministic and 64 hex chars', () => {
  const a = auditHmacKey.computeAuditHmac('some canonical string');
  const b = auditHmacKey.computeAuditHmac('some canonical string');
  assert.strictEqual(a, b, 'same input must produce the same HMAC');
  assert.ok(/^[a-f0-9]{64}$/.test(a), `expected hex digest, got ${a}`);
});

test('different inputs produce different HMACs', () => {
  const a = auditHmacKey.computeAuditHmac('input one');
  const b = auditHmacKey.computeAuditHmac('input two');
  assert.notStrictEqual(a, b);
});

test('the HMAC differs from the plain SHA-256 of the same input', () => {
  const canonical = 'GENESIS{"action":"x"}';
  const hmac = auditHmacKey.computeAuditHmac(canonical);
  const plain = require('crypto').createHash('sha256').update(canonical).digest('hex');
  assert.notStrictEqual(hmac, plain, 'HMAC must be keyed, not a bare hash');
});

test('hmacMatches compares safely and rejects mismatches', () => {
  const digest = auditHmacKey.computeAuditHmac('x');
  assert.strictEqual(auditHmacKey.hmacMatches(digest, digest), true);
  assert.strictEqual(auditHmacKey.hmacMatches(digest, 'f'.repeat(64)), false);
  assert.strictEqual(auditHmacKey.hmacMatches(digest, 'short'), false);
  assert.strictEqual(auditHmacKey.hmacMatches(null, digest), false);
  assert.strictEqual(auditHmacKey.hmacMatches(digest, undefined), false);
});

console.log('\n=== logAudit writes the HMAC ===');

test('logAudit populates record_hmac when the column exists', () => {
  shared.logAudit('patient.create', 'Patient', 'p-1', null, 'created', 'admin@test', 'admin', 'r1');
  const row = db.prepare('SELECT * FROM audit_logs WHERE org_id = ?').get(ORG);
  assert.ok(row, 'row must be written');
  assert.ok(/^[a-f0-9]{64}$/.test(row.record_hmac), `expected an HMAC, got ${row.record_hmac}`);
  assert.ok(/^[a-f0-9]{64}$/.test(row.record_hash), 'hash chain must still be written');
  assert.strictEqual(row.user_id, 'u-hmac', 'user_id attribution must be preserved');
});

test('the stored HMAC covers the same bytes as the hash', () => {
  const row = db.prepare('SELECT * FROM audit_logs WHERE entity_id = ?').get('p-1');
  const signedString = auditCanonical.buildSignedString(row.prev_hash, row);
  assert.strictEqual(row.record_hmac, auditHmacKey.computeAuditHmac(signedString));
});

test('a multi-row chain verifies on both layers', () => {
  shared.logAudit('patient.update', 'Patient', 'p-1', null, 'updated', 'admin@test', 'admin', 'r2');
  shared.logAudit('patient.view', 'Patient', 'p-1', null, 'viewed', 'admin@test', 'admin', 'r3');

  const result = auditChain.verifyAuditChain(ORG);
  assert.strictEqual(result.ok, true, JSON.stringify(result));
  assert.strictEqual(result.verified, 3);
  assert.strictEqual(result.hmac.available, true);
  assert.strictEqual(result.hmac.checked, 3, 'all three rows must be HMAC-verified');
  assert.strictEqual(result.hmac.unverifiable, 0);
});

console.log('\n=== Tamper detection ===');

test('editing a field without re-chaining is caught by the hash chain', () => {
  const target = db.prepare(
    'SELECT id, details FROM audit_logs WHERE org_id = ? ORDER BY created_at ASC, rowid ASC LIMIT 1'
  ).get(ORG);
  db.prepare('UPDATE audit_logs SET details = ? WHERE id = ?').run('sanitized', target.id);

  const result = auditChain.verifyAuditChain(ORG);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.failure, 'hash_chain');

  db.prepare('UPDATE audit_logs SET details = ? WHERE id = ?').run(target.details, target.id);
  assert.strictEqual(auditChain.verifyAuditChain(ORG).ok, true, 'must verify after restore');
});

test('a FULL re-chaining attack defeats the hash chain but is caught by the HMAC', () => {
  // This is the attack the unkeyed chain cannot stop: rewrite a row, then
  // recompute record_hash for it and every following row so the chain is
  // internally consistent. Without a key the attacker cannot also forge the
  // HMACs, so verification must still fail — and specifically on the HMAC.
  const rows = db.prepare(
    `SELECT ${auditCanonical.CHAIN_SELECT_COLUMNS}, record_hmac
     FROM audit_logs WHERE org_id = ? ${auditCanonical.CHAIN_ORDER_BY}`
  ).all(ORG);
  const originals = rows.map((r) => ({ ...r }));

  // Attacker erases the evidence in the first row.
  rows[0].details = 'nothing to see here';

  let prev = auditCanonical.GENESIS;
  for (const row of rows) {
    const recomputed = auditCanonical.computeRecordHash(prev, row);
    db.prepare('UPDATE audit_logs SET details = ?, prev_hash = ?, record_hash = ? WHERE id = ?')
      .run(row.details, prev, recomputed, row.id);
    prev = recomputed;
  }

  const result = auditChain.verifyAuditChain(ORG);
  assert.strictEqual(result.ok, false, 'the re-chained trail must not verify');
  assert.strictEqual(result.failure, 'hmac', `expected HMAC failure, got ${result.failure}`);
  assert.strictEqual(result.brokenAt, rows[0].id);

  // Restore for the remaining tests.
  for (const row of originals) {
    db.prepare('UPDATE audit_logs SET details = ?, prev_hash = ?, record_hash = ?, record_hmac = ? WHERE id = ?')
      .run(row.details, row.prev_hash, row.record_hash, row.record_hmac, row.id);
  }
  assert.strictEqual(auditChain.verifyAuditChain(ORG).ok, true, 'must verify after restore');
});

test('a forged HMAC is rejected', () => {
  const target = db.prepare(
    'SELECT id, record_hmac FROM audit_logs WHERE org_id = ? ORDER BY created_at ASC, rowid ASC LIMIT 1'
  ).get(ORG);
  db.prepare('UPDATE audit_logs SET record_hmac = ? WHERE id = ?').run('0'.repeat(64), target.id);

  const result = auditChain.verifyAuditChain(ORG);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.failure, 'hmac');

  db.prepare('UPDATE audit_logs SET record_hmac = ? WHERE id = ?').run(target.record_hmac, target.id);
});

test('deleting a middle row is detected', () => {
  // rowid is captured and restored below. created_at has second precision, so
  // rows written in the same second tie on it and the chain order falls back to
  // rowid; reinserting without the original rowid would reorder the row to the
  // end and break the chain for a reason unrelated to what this asserts.
  const rows = db.prepare(
    `SELECT rowid AS _rowid, ${auditCanonical.CHAIN_SELECT_COLUMNS}, record_hmac, user_id, request_id, created_at
     FROM audit_logs WHERE org_id = ? ${auditCanonical.CHAIN_ORDER_BY}`
  ).all(ORG);
  assert.strictEqual(rows.length, 3, 'expected the three rows written above');

  const removed = rows[1];
  db.prepare('DELETE FROM audit_logs WHERE id = ?').run(removed.id);

  const result = auditChain.verifyAuditChain(ORG);
  assert.strictEqual(result.ok, false, 'removing a row must break the chain');
  assert.strictEqual(result.failure, 'hash_chain', JSON.stringify(result));

  db.prepare(
    `INSERT INTO audit_logs (rowid, id, org_id, action, entity_type, entity_id, patient_name, details,
      user_id, user_email, user_role, request_id, prev_hash, record_hash, record_hmac, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    removed._rowid, removed.id, removed.org_id, removed.action, removed.entity_type, removed.entity_id,
    removed.patient_name, removed.details, removed.user_id, removed.user_email, removed.user_role,
    removed.request_id, removed.prev_hash, removed.record_hash, removed.record_hmac, removed.created_at
  );
  assert.strictEqual(auditChain.verifyAuditChain(ORG).ok, true, 'must verify after an exact restore');
});

console.log('\n=== Backward compatibility ===');

test('rows without an HMAC are reported unverifiable, not tampered', () => {
  // Simulates an installation upgraded from before migration 16: the hash
  // chain still covers these rows, so they must not read as tampered.
  const legacyOrg = 'ORG_LEGACY';
  db.prepare('INSERT INTO users (id, org_id) VALUES (?, ?)').run('u-legacy', legacyOrg);

  let prev = auditCanonical.GENESIS;
  for (let i = 0; i < 3; i += 1) {
    const row = {
      org_id: legacyOrg,
      action: `legacy.action.${i}`,
      entity_type: 'Patient',
      entity_id: `p-${i}`,
      patient_name: null,
      details: null,
      user_email: 'old@test',
      user_role: 'admin',
    };
    const hash = auditCanonical.computeRecordHash(prev, row);
    db.prepare(
      `INSERT INTO audit_logs (id, org_id, action, entity_type, entity_id, patient_name, details,
        user_email, user_role, prev_hash, record_hash, record_hmac, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, ?)`
    ).run(
      `legacy-${i}`, row.org_id, row.action, row.entity_type, row.entity_id,
      row.user_email, row.user_role, prev, hash,
      new Date(Date.now() + i * 1000).toISOString()
    );
    prev = hash;
  }

  const result = auditChain.verifyAuditChain(legacyOrg);
  assert.strictEqual(result.ok, true, JSON.stringify(result));
  assert.strictEqual(result.verified, 3);
  assert.strictEqual(result.hmac.checked, 0);
  assert.strictEqual(result.hmac.unverifiable, 3, 'legacy rows must count as unverifiable');
});

test('a database without the record_hmac column still verifies', () => {
  const legacyDb = new Database(':memory:');
  legacyDb.exec(`
    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, action TEXT NOT NULL,
      entity_type TEXT, entity_id TEXT, patient_name TEXT, details TEXT,
      user_id TEXT, user_email TEXT, user_role TEXT,
      prev_hash TEXT, record_hash TEXT, created_at TEXT
    );
  `);

  const row = {
    org_id: 'OLD', action: 'a', entity_type: null, entity_id: null,
    patient_name: null, details: null, user_email: null, user_role: null,
  };
  const hash = auditCanonical.computeRecordHash(auditCanonical.GENESIS, row);
  legacyDb.prepare(
    `INSERT INTO audit_logs (id, org_id, action, prev_hash, record_hash, created_at)
     VALUES ('r1', 'OLD', 'a', 'GENESIS', ?, '2026-01-01T00:00:00.000Z')`
  ).run(hash);

  // auditChain destructures getDatabase at module load, so the verifier has to
  // be re-required after repointing init.cjs at the pre-migration database.
  const chainPath = require.resolve('../electron/services/auditChain.cjs');
  const originalGetDatabase = require.cache[initPath].exports.getDatabase;
  require.cache[initPath].exports.getDatabase = () => legacyDb;
  delete require.cache[chainPath];

  try {
    const legacyVerifier = require('../electron/services/auditChain.cjs');
    const result = legacyVerifier.verifyAuditChain('OLD');
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    assert.strictEqual(result.verified, 1);
    assert.strictEqual(result.hmac.checked, 0);
    assert.strictEqual(result.hmac.unverifiable, 0, 'no HMAC column means nothing to flag');
  } finally {
    require.cache[initPath].exports.getDatabase = originalGetDatabase;
    delete require.cache[chainPath];
  }
});

console.log(`\n${PASS} passed, ${FAIL} failed`);
if (FAIL > 0) {
  for (const f of failures) console.error(`\n${f.name}:\n${f.error.stack || f.error.message}`);
  process.exit(1);
}
