/**
 * TransTrack — database-enforced immutability of compliance records.
 *
 * 21 CFR 11.10(c)/(e) and HIPAA 164.312(b) require audit records to be
 * protected from modification and deletion. Application-layer checks are not
 * sufficient: anything holding a database handle must be unable to rewrite
 * history. These tests exercise the triggers created by
 * electron/database/schema.cjs against a real SQLite database:
 *
 *   • audit_logs                   — immutable (HIPAA)
 *   • access_justification_logs    — immutable (HIPAA)
 *   • electronic_signatures        — immutable (21 CFR Part 11)
 *
 * They also confirm inserts still work (append-only, not read-only), that a
 * cascading delete from users cannot launder a signature deletion, and that
 * secure_delete is enabled so removed rows are overwritten rather than left in
 * free pages.
 *
 * Run standalone: node tests/auditImmutability.test.cjs
 */

'use strict';

const assert = require('assert');
const Database = require('better-sqlite3-multiple-ciphers');

const { createAuditLogTriggers } = require('../electron/database/schema.cjs');

let PASS = 0, FAIL = 0;
const failures = [];
function test(name, fn) {
  try { fn(); PASS++; console.log(`  ok  ${name}`); }
  catch (e) {
    FAIL++; failures.push({ name, error: e });
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}

/**
 * A minimal database with the three protected tables and the same foreign keys
 * the production schema declares, so cascade behaviour is realistic.
 */
function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('secure_delete = ON');

  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      is_active INTEGER DEFAULT 1
    );

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
      prev_hash TEXT,
      record_hash TEXT,
      record_hmac TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE access_justification_logs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      user_email TEXT,
      user_role TEXT,
      permission TEXT,
      entity_type TEXT,
      entity_id TEXT,
      justification_reason TEXT,
      justification_details TEXT,
      access_time TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE electronic_signatures (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      user_email TEXT,
      user_full_name TEXT,
      meaning TEXT,
      entity_type TEXT,
      entity_id TEXT,
      signed_at TEXT DEFAULT (datetime('now'))
    );
  `);

  createAuditLogTriggers(db);

  db.prepare("INSERT INTO users (id, org_id, email) VALUES ('u1', 'ORG-1', 'coordinator@example.org')").run();
  db.prepare(`
    INSERT INTO audit_logs (id, org_id, action, entity_type, entity_id, user_id, user_email, record_hash, created_at)
    VALUES ('a1', 'ORG-1', 'update', 'Patient', 'p1', 'u1', 'coordinator@example.org', 'hash-1', '2026-07-30T10:00:00.000Z')
  `).run();
  db.prepare(`
    INSERT INTO access_justification_logs (id, org_id, user_id, user_email, permission, justification_reason)
    VALUES ('j1', 'ORG-1', 'u1', 'coordinator@example.org', 'patient:view_phi', 'treatment')
  `).run();
  db.prepare(`
    INSERT INTO electronic_signatures (id, org_id, user_id, user_email, meaning, entity_type, entity_id)
    VALUES ('s1', 'ORG-1', 'u1', 'coordinator@example.org', 'approved', 'Match', 'm1')
  `).run();

  return db;
}

function assertBlocked(db, sql, pattern, description) {
  assert.throws(() => db.prepare(sql).run(), (err) => {
    assert.match(err.message, pattern, `unexpected error for ${description}: ${err.message}`);
    return true;
  }, `${description} must be blocked by the database`);
}

console.log('\n=== audit_logs (HIPAA 164.312(b)) ===');

test('an UPDATE to any audit column is rejected', () => {
  const db = makeDb();
  for (const sql of [
    "UPDATE audit_logs SET action = 'view' WHERE id = 'a1'",
    "UPDATE audit_logs SET user_email = 'someone.else@example.org' WHERE id = 'a1'",
    "UPDATE audit_logs SET details = NULL WHERE id = 'a1'",
    "UPDATE audit_logs SET record_hash = 'forged' WHERE id = 'a1'",
    "UPDATE audit_logs SET created_at = '1999-01-01T00:00:00.000Z' WHERE id = 'a1'",
  ]) {
    assertBlocked(db, sql, /audit logs are immutable/i, sql);
  }
  db.close();
});

test('a DELETE of an audit row is rejected', () => {
  const db = makeDb();
  assertBlocked(db, "DELETE FROM audit_logs WHERE id = 'a1'", /cannot be deleted/i, 'single delete');
  db.close();
});

test('a bulk DELETE cannot truncate the trail', () => {
  const db = makeDb();
  assertBlocked(db, 'DELETE FROM audit_logs', /cannot be deleted/i, 'bulk delete');
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM audit_logs').get().c, 1);
  db.close();
});

test('an UPDATE matching no row is still rejected before it can match one', () => {
  const db = makeDb();
  // Guards against a trigger written as FOR EACH ROW on a filtered subset.
  assertBlocked(db, "UPDATE audit_logs SET action = 'x' WHERE org_id = 'ORG-1'", /immutable/i, 'filtered update');
  db.close();
});

test('the trail remains append-only (INSERT still works)', () => {
  const db = makeDb();
  db.prepare(`
    INSERT INTO audit_logs (id, org_id, action, record_hash, created_at)
    VALUES ('a2', 'ORG-1', 'view', 'hash-2', '2026-07-30T11:00:00.000Z')
  `).run();
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM audit_logs').get().c, 2);
  db.close();
});

test('a failed modification leaves the row byte-identical', () => {
  const db = makeDb();
  const before = db.prepare("SELECT * FROM audit_logs WHERE id = 'a1'").get();
  try { db.prepare("UPDATE audit_logs SET action = 'view' WHERE id = 'a1'").run(); } catch { /* expected */ }
  const after = db.prepare("SELECT * FROM audit_logs WHERE id = 'a1'").get();
  assert.deepStrictEqual(after, before);
  db.close();
});

test('a transaction wrapping a tamper attempt rolls back entirely', () => {
  const db = makeDb();
  const tamper = db.transaction(() => {
    db.prepare(`INSERT INTO audit_logs (id, org_id, action, record_hash) VALUES ('a9', 'ORG-1', 'x', 'h9')`).run();
    db.prepare("UPDATE audit_logs SET action = 'view' WHERE id = 'a1'").run();
  });
  assert.throws(tamper, /immutable/i);
  assert.strictEqual(
    db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE id = 'a9'").get().c, 0,
    'the inserted row must roll back with the failed update'
  );
  db.close();
});

console.log('\n=== access_justification_logs (HIPAA minimum necessary) ===');

test('an UPDATE to a justification record is rejected', () => {
  const db = makeDb();
  assertBlocked(
    db,
    "UPDATE access_justification_logs SET justification_reason = 'emergency' WHERE id = 'j1'",
    /access justification logs are immutable/i,
    'justification update'
  );
  db.close();
});

test('a DELETE of a justification record is rejected', () => {
  const db = makeDb();
  assertBlocked(
    db,
    "DELETE FROM access_justification_logs WHERE id = 'j1'",
    /cannot be deleted/i,
    'justification delete'
  );
  db.close();
});

test('justification logging still appends', () => {
  const db = makeDb();
  db.prepare(`
    INSERT INTO access_justification_logs (id, org_id, user_id, permission, justification_reason)
    VALUES ('j2', 'ORG-1', 'u1', 'audit:export', 'audit_request')
  `).run();
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM access_justification_logs').get().c, 2);
  db.close();
});

console.log('\n=== electronic_signatures (21 CFR Part 11) ===');

test('an UPDATE to a signature is rejected', () => {
  const db = makeDb();
  for (const sql of [
    "UPDATE electronic_signatures SET meaning = 'rejected' WHERE id = 's1'",
    "UPDATE electronic_signatures SET user_email = 'other@example.org' WHERE id = 's1'",
    "UPDATE electronic_signatures SET signed_at = '1999-01-01' WHERE id = 's1'",
  ]) {
    assertBlocked(db, sql, /electronic signatures are immutable/i, sql);
  }
  db.close();
});

test('a DELETE of a signature is rejected', () => {
  const db = makeDb();
  assertBlocked(
    db,
    "DELETE FROM electronic_signatures WHERE id = 's1'",
    /cannot be deleted/i,
    'signature delete'
  );
  db.close();
});

test('a signature cannot be laundered away by deleting its signer', () => {
  // electronic_signatures.user_id is ON DELETE CASCADE, so a user hard-delete
  // would otherwise silently remove Part 11 records. The trigger must abort the
  // whole statement — this is why auth:deleteUser deactivates instead.
  const db = makeDb();
  assert.throws(
    () => db.prepare("DELETE FROM users WHERE id = 'u1'").run(),
    /cannot be deleted/i,
    'cascade must not bypass the immutability trigger'
  );
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM electronic_signatures').get().c, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM users').get().c, 1, 'the user delete must roll back');
  db.close();
});

test('deactivating the signer is permitted and preserves attribution', () => {
  // The Part 11-safe path used by auth:deleteUser.
  const db = makeDb();
  db.prepare("UPDATE users SET is_active = 0 WHERE id = 'u1'").run();
  const signature = db.prepare("SELECT user_email FROM electronic_signatures WHERE id = 's1'").get();
  assert.strictEqual(signature.user_email, 'coordinator@example.org', 'attribution must survive');
  assert.strictEqual(db.prepare("SELECT is_active FROM users WHERE id = 'u1'").get().is_active, 0);
  db.close();
});

test('a user with no compliance records can still be hard-deleted', () => {
  const db = makeDb();
  db.prepare("INSERT INTO users (id, org_id, email) VALUES ('u2', 'ORG-1', 'new@example.org')").run();
  db.prepare("DELETE FROM users WHERE id = 'u2'").run();
  assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM users WHERE id = 'u2'").get().c, 0);
  db.close();
});

console.log('\n=== Trigger installation ===');

test('all six triggers are installed', () => {
  const db = makeDb();
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
    .all().map((r) => r.name);
  for (const expected of [
    'audit_logs_immutable_update', 'audit_logs_immutable_delete',
    'access_justification_logs_immutable_update', 'access_justification_logs_immutable_delete',
    'electronic_signatures_immutable_update', 'electronic_signatures_immutable_delete',
  ]) {
    assert.ok(names.includes(expected), `missing trigger: ${expected}`);
  }
  db.close();
});

test('installation is idempotent', () => {
  const db = makeDb();
  createAuditLogTriggers(db);
  createAuditLogTriggers(db);
  const count = db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type = 'trigger'").get().c;
  assert.strictEqual(count, 6);
  db.close();
});

test('a database missing the optional tables still gets audit_logs protected', () => {
  // Older databases predate access_justification_logs / electronic_signatures.
  const legacy = new Database(':memory:');
  legacy.exec('CREATE TABLE audit_logs (id TEXT PRIMARY KEY, action TEXT, record_hash TEXT);');
  createAuditLogTriggers(legacy);

  legacy.prepare("INSERT INTO audit_logs (id, action, record_hash) VALUES ('a1', 'view', 'h')").run();
  assert.throws(
    () => legacy.prepare("DELETE FROM audit_logs WHERE id = 'a1'").run(),
    /cannot be deleted/i,
    'audit_logs must be protected even on a legacy database'
  );
  legacy.close();
});

console.log('\n=== secure_delete ===');

test('secure_delete is active so removed rows are overwritten', () => {
  const db = makeDb();
  // 1 = on, 2 = fast; both overwrite freed content.
  const value = db.pragma('secure_delete', { simple: true });
  assert.ok(value === 1 || value === 2, `secure_delete must be enabled, got ${value}`);
  db.close();
});

console.log(`\n${PASS} passed, ${FAIL} failed`);
if (FAIL > 0) {
  for (const f of failures) console.error(`\n${f.name}:\n${f.error.stack || f.error.message}`);
  process.exit(1);
}
