/**
 * TransTrack — audit trail fail-closed and sequence integrity tests
 * (findings H-11 and M-6).
 *
 * What these pin:
 *
 *   H-11(a) logAudit never writes a row without hash-chain fields, and a failed
 *           audit write throws so the originating operation fails with it.
 *   H-11(c) a row with no record_hash is reported as an integrity failure
 *           instead of being filtered out of verification.
 *   M-6     every row carries a per-org monotonic sequence, the sequence is
 *           covered by the signature, and verification detects gaps,
 *           renumbering and a backwards-moving clock.
 *
 * Run standalone: node tests/auditFailClosed.test.cjs
 */

'use strict';

const assert = require('assert');
const Database = require('better-sqlite3-multiple-ciphers');

const mockApp = { getPath: () => __dirname, isPackaged: false };
require.cache[require.resolve('electron')] = {
  id: 'electron', filename: 'electron', loaded: true,
  exports: { app: mockApp, ipcMain: { handle: () => {} }, safeStorage: { isEncryptionAvailable: () => false } },
};

const SCHEMA = `
  CREATE TABLE audit_logs (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, action TEXT NOT NULL,
    entity_type TEXT, entity_id TEXT, patient_name TEXT, details TEXT,
    user_id TEXT, user_email TEXT, user_role TEXT, request_id TEXT,
    prev_hash TEXT, record_hash TEXT, record_hmac TEXT, seq INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE users (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, is_active INTEGER DEFAULT 1);
  CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
`;

const db = new Database(':memory:');
db.exec(SCHEMA);

const initPath = require.resolve('../electron/database/init.cjs');
require.cache[initPath] = {
  id: initPath, filename: initPath, loaded: true,
  exports: { getDatabase: () => db, getDatabasePath: () => ':memory:' },
};

const siemPath = require.resolve('../electron/services/siemForwarder.cjs');
require.cache[siemPath] = {
  id: siemPath, filename: siemPath, loaded: true,
  exports: { forwardAuditRow: () => {} },
};

const auditChain = require('../electron/services/auditChain.cjs');
const auditCanonical = require('../electron/services/auditCanonical.cjs');
const shared = require('../electron/ipc/shared.cjs');

let PASS = 0, FAIL = 0;
const failures = [];
function test(name, fn) {
  try { fn(); PASS++; console.log(`  ok  ${name}`); }
  catch (e) { FAIL++; failures.push({ name, error: e }); console.log(`  FAIL ${name}: ${e.message}`); }
}

const ORG = 'ORG_FAILCLOSED';
db.prepare('INSERT INTO users (id, org_id) VALUES (?, ?)').run('u1', ORG);
db.prepare('INSERT INTO sessions (id, user_id) VALUES (?, ?)').run('s1', 'u1');
shared.setSessionState('s1', { id: 'u1', org_id: ORG, email: 'admin@test' }, Date.now() + 3600000, null);

console.log('\n=== H-11(a) the writer never degrades ===');

test('logAudit writes prev_hash, record_hash and seq on every row', () => {
  shared.logAudit('first.action', 'Patient', 'p1', null, 'one', 'admin@test', 'admin');
  shared.logAudit('second.action', 'Patient', 'p2', null, 'two', 'admin@test', 'admin');

  const rows = db.prepare('SELECT * FROM audit_logs WHERE org_id = ? ORDER BY seq').all(ORG);
  assert.strictEqual(rows.length, 2);
  for (const row of rows) {
    assert.ok(row.prev_hash, 'prev_hash must be set');
    assert.strictEqual(row.record_hash.length, 64, 'record_hash must be a SHA-256 hex digest');
    assert.ok(Number.isInteger(row.seq), 'seq must be assigned');
  }
  assert.deepStrictEqual(rows.map((r) => r.seq), [1, 2], 'sequence starts at 1 and increments');
});

test('a failed audit write throws so the audited operation fails with it', () => {
  const brokenDb = new Database(':memory:');
  brokenDb.exec(SCHEMA);
  brokenDb.exec(`
    CREATE TRIGGER audit_logs_reject BEFORE INSERT ON audit_logs
    BEGIN SELECT RAISE(ABORT, 'storage failure'); END;
  `);
  assert.throws(
    () => auditChain.appendAuditRecord({ org_id: ORG, action: 'blocked.action' }, { db: brokenDb }),
    /Audit write failed/,
    'the writer must surface the failure rather than swallow it'
  );
  assert.strictEqual(
    brokenDb.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n, 0,
    'no partial row may survive a failed audit write'
  );
});

test('the chain written by logAudit verifies end to end', () => {
  const result = auditChain.verifyAuditChain(ORG);
  assert.strictEqual(result.ok, true, JSON.stringify(result));
  assert.strictEqual(result.verified, 2);
  assert.strictEqual(result.sequence.checked, 2);
  assert.strictEqual(result.sequence.exempt, 0);
});

console.log('\n=== H-11(c) unchained rows are flagged, not hidden ===');

test('a row with no record_hash is an integrity failure', () => {
  const org = 'ORG_UNCHAINED';
  db.prepare(
    `INSERT INTO audit_logs (id, org_id, action, entity_type, details, user_email, user_role, created_at)
     VALUES ('unchained-1', ?, 'system_init', 'System', 'legacy direct insert', 'system', 'system', '2026-01-01T00:00:00.000Z')`
  ).run(org);

  const result = auditChain.verifyAuditChain(org);
  assert.strictEqual(result.ok, false, 'an unchained row must not verify');
  assert.strictEqual(result.failure, 'missing_hash');
  assert.strictEqual(result.brokenAt, 'unchained-1');
});

test('verifyAllOrganizations reports the break and remembers it for healthCheck', () => {
  const summary = auditChain.verifyAllOrganizations();
  assert.strictEqual(summary.ok, false);
  assert.ok(summary.broken.some((b) => b.orgId === 'ORG_UNCHAINED' && b.failure === 'missing_hash'));
  assert.deepStrictEqual(auditChain.getLastVerification(), summary);

  // The healthy org is still reported as verified alongside the broken one.
  assert.ok(summary.broken.every((b) => b.orgId !== ORG));
});

console.log('\n=== M-6 sequence and clock integrity ===');

function freshDb() {
  const d = new Database(':memory:');
  d.exec(SCHEMA);
  return d;
}

/** Append n rows to an isolated database through the production writer. */
function seed(d, org, n, startMs = Date.parse('2026-03-01T10:00:00.000Z')) {
  for (let i = 0; i < n; i += 1) {
    auditChain.appendAuditRecord({
      org_id: org,
      action: `action.${i}`,
      entity_type: 'Patient',
      entity_id: `p${i}`,
      user_email: 'admin@test',
      user_role: 'admin',
      created_at: new Date(startMs + i * 60000).toISOString(),
    }, { db: d });
  }
}

const verify = (d, org) => auditChain.verifyAuditChain(org, { db: d });

test('the sequence is part of the signed payload', () => {
  const withSeq = auditCanonical.canonicalize(
    auditCanonical.buildAuditPayload({ org_id: 'O', action: 'a', seq: 7 })
  );
  const withoutSeq = auditCanonical.canonicalize(
    auditCanonical.buildAuditPayload({ org_id: 'O', action: 'a', seq: null })
  );
  assert.ok(withSeq.includes('"seq":7'), 'a sequenced row must sign its counter');
  assert.ok(!withoutSeq.includes('seq'), 'a pre-migration row must hash exactly as it did before');
  assert.notStrictEqual(withSeq, withoutSeq);
});

test('renumbering a row is detected as a sequence break', () => {
  const d = freshDb();
  seed(d, 'ORG_SEQ', 3);
  assert.strictEqual(verify(d, 'ORG_SEQ').ok, true);

  d.prepare('UPDATE audit_logs SET seq = 9 WHERE seq = 2').run();
  const result = verify(d, 'ORG_SEQ');
  assert.strictEqual(result.ok, false, 'a renumbered row must not verify');
  assert.strictEqual(result.failure, 'sequence');
  assert.match(result.detail, /expected sequence 2/);
});

test('a gap left by a removed row is detected', () => {
  const d = freshDb();
  seed(d, 'ORG_GAP', 3);
  // Deleting a row is blocked by trigger in production; simulate the result of
  // an out-of-band edit to the database file.
  d.prepare('DELETE FROM audit_logs WHERE seq = 2').run();

  const result = verify(d, 'ORG_GAP');
  assert.strictEqual(result.ok, false, 'a sequence gap must not verify');
  assert.ok(['sequence', 'hash_chain'].includes(result.failure), `unexpected failure ${result.failure}`);
});

test('an unsequenced row appended after sequenced rows is rejected', () => {
  const d = freshDb();
  seed(d, 'ORG_MIX', 2);
  const tail = d.prepare('SELECT record_hash FROM audit_logs ORDER BY seq DESC LIMIT 1').get();
  const row = {
    org_id: 'ORG_MIX', action: 'sneaked.in', entity_type: null, entity_id: null,
    patient_name: null, details: null, user_email: null, user_role: null,
  };
  d.prepare(
    `INSERT INTO audit_logs (id, org_id, action, prev_hash, record_hash, seq, created_at)
     VALUES ('sneak-1', 'ORG_MIX', 'sneaked.in', ?, ?, NULL, '2026-03-01T12:00:00.000Z')`
  ).run(tail.record_hash, auditCanonical.computeRecordHash(tail.record_hash, row));

  // An unsequenced row sorts into the pre-migration prefix, ahead of the
  // sequenced rows, so it is caught by the hash chain rather than by the
  // sequence check — it claims to chain from a row that does not precede it.
  const result = verify(d, 'ORG_MIX');
  assert.strictEqual(result.ok, false, 'an injected unsequenced row must not verify');
  assert.ok(['sequence', 'hash_chain'].includes(result.failure), `unexpected failure ${result.failure}`);
});

test('pre-migration rows are sequence-exempt and reported as such', () => {
  const d = freshDb();
  let prev = auditCanonical.GENESIS;
  for (let i = 0; i < 2; i += 1) {
    const row = {
      org_id: 'ORG_LEGACY', action: `legacy.${i}`, entity_type: null, entity_id: null,
      patient_name: null, details: null, user_email: null, user_role: null,
    };
    const hash = auditCanonical.computeRecordHash(prev, row);
    d.prepare(
      `INSERT INTO audit_logs (id, org_id, action, prev_hash, record_hash, seq, created_at)
       VALUES (?, 'ORG_LEGACY', ?, ?, ?, NULL, ?)`
    ).run(`legacy-${i}`, row.action, prev, hash, `2026-01-0${i + 1}T00:00:00.000Z`);
    prev = hash;
  }
  // A new row written after the migration continues the same chain.
  auditChain.appendAuditRecord({ org_id: 'ORG_LEGACY', action: 'modern' }, { db: d });

  const result = verify(d, 'ORG_LEGACY');
  assert.strictEqual(result.ok, true, JSON.stringify(result));
  assert.strictEqual(result.sequence.exempt, 2, 'legacy rows must be counted, not silently skipped');
  assert.strictEqual(result.sequence.checked, 1);
});

test('a database without the seq column still verifies', () => {
  const d = new Database(':memory:');
  d.exec(`
    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, action TEXT NOT NULL,
      entity_type TEXT, entity_id TEXT, patient_name TEXT, details TEXT,
      user_id TEXT, user_email TEXT, user_role TEXT,
      prev_hash TEXT, record_hash TEXT, created_at TEXT
    );
  `);
  auditChain.appendAuditRecord({ org_id: 'ORG_OLD', action: 'a' }, { db: d });
  auditChain.appendAuditRecord({ org_id: 'ORG_OLD', action: 'b' }, { db: d });

  const result = verify(d, 'ORG_OLD');
  assert.strictEqual(result.ok, true, JSON.stringify(result));
  assert.strictEqual(result.verified, 2);
  assert.strictEqual(result.sequence.available, false);
});

test('a backwards clock jump is detected', () => {
  const d = freshDb();
  seed(d, 'ORG_CLOCK', 2);
  // Rewrite the second row as if the administrator had moved the clock back an
  // hour before it was written; the chain and sequence are untouched.
  const second = d.prepare('SELECT id FROM audit_logs WHERE seq = 2').get();
  d.prepare('UPDATE audit_logs SET created_at = ? WHERE id = ?')
    .run('2026-03-01T09:00:00.000Z', second.id);

  const result = verify(d, 'ORG_CLOCK');
  assert.strictEqual(result.ok, false, 'a clock regression must be reported');
  assert.strictEqual(result.failure, 'timestamp');
});

test('second-truncated legacy timestamps do not read as a clock regression', () => {
  const d = freshDb();
  auditChain.appendAuditRecord({
    org_id: 'ORG_TS', action: 'a', created_at: '2026-03-01T10:00:00.900Z',
  }, { db: d });
  auditChain.appendAuditRecord({
    org_id: 'ORG_TS', action: 'b', created_at: '2026-03-01 10:00:00',
  }, { db: d });

  const result = verify(d, 'ORG_TS');
  assert.strictEqual(result.ok, true, JSON.stringify(result));
});

console.log(`\n${PASS} passed, ${FAIL} failed`);
if (FAIL > 0) {
  for (const f of failures) console.error(`\n${f.name}:\n${f.error.stack || f.error.message}`);
  process.exit(1);
}
