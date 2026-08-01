/**
 * TransTrack — waitlist status transitions and IOTA notification records.
 *
 * CMS Increasing Organ Transplant Access (IOTA) Model § 512.442(d) requires a
 * participating kidney transplant hospital to notify a Medicare waitlist
 * patient within 10 days of a waitlist status change that affects offer
 * eligibility, to repeat that notice annually while the patient stays
 * inactive, to notify the dialysis facility or referring provider, and to
 * record a copy of the notice in the medical record.
 *
 * Evidencing that obligation requires two properties the previous schema could
 * not provide:
 *
 *   • the transition itself must be a first-class immutable row, because the
 *     10-day clock starts at its effective time and a mutable row makes the
 *     timeliness claim unverifiable; and
 *   • the notice must carry a frozen content identity (hash + generator
 *     version) even though its delivery and chart-filing state legitimately
 *     change over time.
 *
 * These tests exercise the real tables and triggers created by
 * electron/database/schema.cjs and the forward migration in
 * electron/database/migrations.cjs against a real SQLite database.
 *
 * Run standalone: node tests/iotaNotifications.test.cjs
 */

'use strict';

const assert = require('assert');
const Database = require('better-sqlite3-multiple-ciphers');

const {
  createSchema,
  createIndexes,
  createAuditLogTriggers,
} = require('../electron/database/schema.cjs');
const { runMigrations } = require('../electron/database/migrations.cjs');

let PASS = 0, FAIL = 0;
const failures = [];
function test(name, fn) {
  try { fn(); PASS++; console.log(`  ok  ${name}`); }
  catch (e) {
    FAIL++; failures.push({ name, error: e });
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}

const ORG = 'org-test';
const PATIENT = 'pat-test';

/**
 * A database built the way a fresh install is built, then seeded with the one
 * organization and patient the foreign keys require.
 */
function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('secure_delete = ON');

  createSchema(db);
  createIndexes(db);
  createAuditLogTriggers(db);

  db.prepare('INSERT INTO organizations (id, name) VALUES (?, ?)')
    .run(ORG, 'Test Transplant Center');
  db.prepare(
    'INSERT INTO patients (id, org_id, first_name, last_name, waitlist_status) VALUES (?, ?, ?, ?, ?)',
  ).run(PATIENT, ORG, 'Test', 'Patient', 'active');

  return db;
}

function insertTransition(db, id, overrides = {}) {
  const row = {
    id,
    org_id: ORG,
    patient_id: PATIENT,
    from_status: 'active',
    to_status: 'inactive',
    reason_code: 'EVAL_EXPIRED',
    reason_note: 'Annual evaluation lapsed',
    effective_at: '2026-07-01T14:00:00Z',
    offer_eligibility_impact: 'blocks_offers',
    source: 'manual',
    changed_by: 'user-1',
    changed_by_email: 'coordinator@example.org',
    changed_by_role: 'coordinator',
    ...overrides,
  };
  db.prepare(`
    INSERT INTO waitlist_status_transitions
      (id, org_id, patient_id, from_status, to_status, reason_code, reason_note,
       effective_at, offer_eligibility_impact, source,
       changed_by, changed_by_email, changed_by_role)
    VALUES
      (@id, @org_id, @patient_id, @from_status, @to_status, @reason_code, @reason_note,
       @effective_at, @offer_eligibility_impact, @source,
       @changed_by, @changed_by_email, @changed_by_role)
  `).run(row);
  return row;
}

function insertNotification(db, id, transitionId, overrides = {}) {
  const row = {
    id,
    org_id: ORG,
    transition_id: transitionId,
    patient_id: PATIENT,
    notice_kind: 'status_change',
    generator_version: '1.0.0',
    content_sha256: 'a'.repeat(64),
    content_format: 'pdf',
    due_at: '2026-07-11T14:00:00Z',
    next_annual_due_at: '2027-07-01T14:00:00Z',
    // Format produced by electron/services/iotaNoticeGenerator.cjs: the key
    // identifies the obligation (transition + kind + reissue revision), not the
    // rendered bytes.
    idempotency_key: `${transitionId}:status_change:r0`,
    ...overrides,
  };
  db.prepare(`
    INSERT INTO iota_notifications
      (id, org_id, transition_id, patient_id, notice_kind, generator_version,
       content_sha256, content_format, due_at, next_annual_due_at, idempotency_key)
    VALUES
      (@id, @org_id, @transition_id, @patient_id, @notice_kind, @generator_version,
       @content_sha256, @content_format, @due_at, @next_annual_due_at, @idempotency_key)
  `).run(row);
  return row;
}

console.log('\nwaitlist_status_transitions — append-only transition history');

test('a transition row can be inserted and read back', () => {
  const db = makeDb();
  insertTransition(db, 't1');
  const row = db.prepare('SELECT * FROM waitlist_status_transitions WHERE id = ?').get('t1');
  assert.strictEqual(row.to_status, 'inactive');
  assert.strictEqual(row.offer_eligibility_impact, 'blocks_offers');
  assert.strictEqual(row.effective_at, '2026-07-01T14:00:00Z');
  assert.ok(row.recorded_at, 'recorded_at should default to now');
  db.close();
});

test('UPDATE on a transition is refused by the database', () => {
  const db = makeDb();
  insertTransition(db, 't1');
  assert.throws(
    () => db.prepare('UPDATE waitlist_status_transitions SET effective_at = ? WHERE id = ?')
      .run('2026-07-09T14:00:00Z', 't1'),
    /immutable/i,
    'rewriting effective_at would move the 10-day deadline',
  );
  db.close();
});

test('DELETE on a transition is refused by the database', () => {
  const db = makeDb();
  insertTransition(db, 't1');
  assert.throws(
    () => db.prepare('DELETE FROM waitlist_status_transitions WHERE id = ?').run('t1'),
    /cannot be deleted/i,
  );
  db.close();
});

test('offer_eligibility_impact is constrained to the known vocabulary', () => {
  const db = makeDb();
  assert.throws(
    () => insertTransition(db, 't1', { offer_eligibility_impact: 'maybe' }),
    /CHECK constraint/i,
  );
  db.close();
});

test('several transitions for one patient are retained in effective order', () => {
  const db = makeDb();
  insertTransition(db, 't1', { effective_at: '2026-03-01T00:00:00Z' });
  insertTransition(db, 't2', {
    from_status: 'inactive', to_status: 'active',
    effective_at: '2026-05-01T00:00:00Z', offer_eligibility_impact: 'restores_offers',
  });
  insertTransition(db, 't3', { effective_at: '2026-07-01T00:00:00Z' });
  const rows = db.prepare(`
    SELECT id FROM waitlist_status_transitions
    WHERE org_id = ? AND patient_id = ? ORDER BY effective_at DESC
  `).all(ORG, PATIENT);
  assert.deepStrictEqual(rows.map((r) => r.id), ['t3', 't2', 't1']);
  db.close();
});

console.log('\niota_notifications — mutable lifecycle, frozen obligation');

test('delivery and chart-filing state can be advanced', () => {
  const db = makeDb();
  insertTransition(db, 't1');
  insertNotification(db, 'n1', 't1');

  db.prepare(`
    UPDATE iota_notifications
    SET channel = ?, delivered_at = ?, chart_write_status = ?,
        chart_write_channel = ?, epic_document_reference_id = ?
    WHERE id = ?
  `).run('electronic', '2026-07-03T09:00:00Z', 'filed',
    'fhir_documentreference', 'eDoc123', 'n1');

  const row = db.prepare('SELECT * FROM iota_notifications WHERE id = ?').get('n1');
  assert.strictEqual(row.chart_write_status, 'filed');
  assert.strictEqual(row.epic_document_reference_id, 'eDoc123');
  db.close();
});

test('the content hash cannot be rewritten after generation', () => {
  const db = makeDb();
  insertTransition(db, 't1');
  insertNotification(db, 'n1', 't1');
  assert.throws(
    () => db.prepare('UPDATE iota_notifications SET content_sha256 = ? WHERE id = ?')
      .run('b'.repeat(64), 'n1'),
    /immutable/i,
  );
  db.close();
});

test('the 10-day due date cannot be rewritten after generation', () => {
  const db = makeDb();
  insertTransition(db, 't1');
  insertNotification(db, 'n1', 't1');
  assert.throws(
    () => db.prepare('UPDATE iota_notifications SET due_at = ? WHERE id = ?')
      .run('2026-12-31T00:00:00Z', 'n1'),
    /immutable/i,
  );
  db.close();
});

test('a notification cannot be reassigned to a different transition', () => {
  const db = makeDb();
  insertTransition(db, 't1');
  insertTransition(db, 't2', { effective_at: '2026-07-05T00:00:00Z' });
  insertNotification(db, 'n1', 't1');
  assert.throws(
    () => db.prepare('UPDATE iota_notifications SET transition_id = ? WHERE id = ?')
      .run('t2', 'n1'),
    /immutable/i,
  );
  db.close();
});

test('DELETE on a notification is refused by the database', () => {
  const db = makeDb();
  insertTransition(db, 't1');
  insertNotification(db, 'n1', 't1');
  assert.throws(
    () => db.prepare('DELETE FROM iota_notifications WHERE id = ?').run('n1'),
    /cannot be deleted/i,
  );
  db.close();
});

test('the idempotency key prevents a duplicate notice for the same obligation', () => {
  const db = makeDb();
  insertTransition(db, 't1');
  insertNotification(db, 'n1', 't1');
  assert.throws(
    () => insertNotification(db, 'n2', 't1'),
    /UNIQUE constraint/i,
    'a retried generate/file cycle must not produce a second chart document',
  );
  db.close();
});

test('chart_write_status is constrained to the known vocabulary', () => {
  const db = makeDb();
  insertTransition(db, 't1');
  insertNotification(db, 'n1', 't1');
  assert.throws(
    () => db.prepare('UPDATE iota_notifications SET chart_write_status = ? WHERE id = ?')
      .run('probably-fine', 'n1'),
    /CHECK constraint/i,
  );
  db.close();
});

test('overdue notices are queryable by the 10-day deadline', () => {
  const db = makeDb();
  insertTransition(db, 't1');
  insertNotification(db, 'n1', 't1');
  insertTransition(db, 't2', { effective_at: '2026-07-20T00:00:00Z' });
  insertNotification(db, 'n2', 't2', {
    due_at: '2026-07-30T00:00:00Z',
    idempotency_key: 't2:status_change:r0',
    delivered_at: '2026-07-21T00:00:00Z',
  });

  const overdue = db.prepare(`
    SELECT id FROM iota_notifications
    WHERE org_id = ? AND delivered_at IS NULL AND due_at < ?
  `).all(ORG, '2026-07-25T00:00:00Z');
  assert.deepStrictEqual(overdue.map((r) => r.id), ['n1']);
  db.close();
});

console.log('\nmigration 17 — upgrade path for existing databases');

/**
 * Simulate a pre-migration database: the production schema minus the two new
 * tables, which is what an installed 1.x database looks like on disk.
 */
function makeLegacyDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  createSchema(db);
  db.exec('DROP TABLE IF EXISTS iota_notifications');
  db.exec('DROP TABLE IF EXISTS waitlist_status_transitions');
  db.prepare('INSERT INTO organizations (id, name) VALUES (?, ?)')
    .run(ORG, 'Test Transplant Center');
  db.prepare(
    'INSERT INTO patients (id, org_id, first_name, last_name) VALUES (?, ?, ?, ?)',
  ).run(PATIENT, ORG, 'Test', 'Patient');
  return db;
}

test('migration creates both tables on a database that lacks them', () => {
  const db = makeLegacyDb();
  runMigrations(db);
  const names = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?)",
  ).all('waitlist_status_transitions', 'iota_notifications').map((r) => r.name).sort();
  assert.deepStrictEqual(names, ['iota_notifications', 'waitlist_status_transitions']);
  db.close();
});

test('migration installs the immutability triggers, not just the tables', () => {
  const db = makeLegacyDb();
  runMigrations(db);
  insertTransition(db, 't1');
  assert.throws(
    () => db.prepare('DELETE FROM waitlist_status_transitions WHERE id = ?').run('t1'),
    /cannot be deleted/i,
  );
  db.close();
});

test('migration is idempotent when run twice', () => {
  const db = makeLegacyDb();
  runMigrations(db);
  const second = runMigrations(db);
  assert.strictEqual(second.applied, 0, 'a second run should apply nothing');
  db.close();
});

test('migration records a reversible rollback script', () => {
  const db = makeLegacyDb();
  runMigrations(db);
  const row = db.prepare('SELECT rollback_sql FROM schema_migrations WHERE version = ?').get(17);
  assert.ok(row, 'migration 17 should be recorded');
  assert.match(row.rollback_sql, /DROP TABLE IF EXISTS iota_notifications/);
  db.close();
});

console.log(`\n${PASS} passed, ${FAIL} failed\n`);
if (FAIL > 0) {
  for (const f of failures) console.error(`${f.name}\n${f.error.stack}\n`);
  process.exit(1);
}
