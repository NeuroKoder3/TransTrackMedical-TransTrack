/**
 * TransTrack — pre-migration backup safety.
 *
 * The scenario this protects against: a pilot site launches a new application
 * version, pending schema migrations run against a database full of patient
 * data, and one of them fails part-way through the sequence. Because migrations
 * commit one per transaction and mostly declare no rollback SQL, the database is
 * left on an intermediate schema version, and because initialisation throws, the
 * app quits. Hourly automatic backups exist but none was taken at the moment of
 * the change, and the operator has no way to tell which one predates it.
 *
 * What is asserted here:
 *   • a restore point is taken before the first migration, and only when
 *     migrations are actually pending (a normal launch must cost nothing);
 *   • the copy is real — same bytes as the source, checksummed, with metadata
 *     naming the version range;
 *   • if the copy cannot be made, the migration does NOT run and the database is
 *     left untouched (fail closed);
 *   • when a migration fails, the error names the restore path;
 *   • old copies are pruned so PHI does not accumulate without bound.
 *
 * Run standalone: node tests/migrationSafety.test.cjs
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3-multiple-ciphers');

const safety = require('../electron/database/migrationSafety.cjs');
const { MIGRATIONS, getCurrentVersion } = require('../electron/database/migrations.cjs');
const { createSchema } = require('../electron/database/schema.cjs');

let PASS = 0, FAIL = 0;
const failures = [];
function test(name, fn) {
  try { fn(); PASS++; console.log(`  ok  ${name}`); }
  catch (e) { FAIL++; failures.push({ name, error: e }); console.log(`  FAIL ${name}: ${e.message}`); }
}

const LATEST = Math.max(...MIGRATIONS.map((m) => m.version));
const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-migsafety-'));
  tempDirs.push(dir);
  return dir;
}

/**
 * An on-disk database that looks like a site's installation mid-way through its
 * migration history, with enough content that a truncated copy would be obvious.
 */
function makeSiteDb({ recordedVersion = 11 } = {}) {
  const dir = makeTempDir();
  const dbPath = path.join(dir, 'transtrack.db');
  const backupDir = path.join(dir, 'backups');

  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE ehr_integrations (id TEXT PRIMARY KEY);
    CREATE TABLE ehr_sync_logs (id TEXT PRIMARY KEY);
    CREATE TABLE ehr_imports (id TEXT PRIMARY KEY);
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      applied_at TEXT,
      checksum TEXT,
      rollback_sql TEXT
    );
    CREATE TABLE bulk (id INTEGER PRIMARY KEY, payload TEXT);
  `);
  db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(recordedVersion, 'legacy');
  const ins = db.prepare('INSERT INTO bulk (payload) VALUES (?)');
  const many = db.transaction(() => {
    for (let i = 0; i < 500; i++) ins.run(crypto.randomBytes(64).toString('hex'));
  });
  many();

  return { db, dbPath, backupDir, dir };
}

function listCopies(backupDir) {
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir).filter((f) => f.startsWith(safety.FILE_PREFIX) && f.endsWith('.db'));
}

console.log('\nA brand-new database (no tracking table yet)');

/**
 * A database with no `schema_migrations` table at all, which is what a fresh
 * install actually looks like at the moment migrations first run.
 *
 * This case escaped the original suite because every fixture below hand-creates
 * the tracking table, which is more convenient than reality. The wrapper read
 * the schema version before ensuring the table existed, so a first launch died
 * with "no such table: schema_migrations" and the application quit on startup —
 * caught only by launching the real app.
 */
function makeFreshDb() {
  const dir = makeTempDir();
  const dbPath = path.join(dir, 'transtrack.db');
  const db = new Database(dbPath);
  // Mirrors initDatabase(): the base schema is created first, then migrations
  // run from version 0. Using the real createSchema keeps this fixture honest —
  // a hand-rolled approximation is what hid the original defect.
  createSchema(db);
  return { db, dbPath, backupDir: path.join(dir, 'backups') };
}

test('pending migrations can be read before the tracking table exists', () => {
  const { db } = makeFreshDb();
  const pending = safety.getPendingMigrations(db);
  assert.strictEqual(pending.length, MIGRATIONS.length, 'every migration is pending on a fresh database');
  assert.strictEqual(pending[0].version, MIGRATIONS[0].version);
  db.close();
});

test('a fresh install migrates from zero without throwing', () => {
  const { db, dbPath, backupDir } = makeFreshDb();
  const result = safety.runMigrationsSafely(db, { dbPath, backupDir });
  assert.strictEqual(result.currentVersion, LATEST);
  assert.ok(result.applied > 0);
  db.close();
});

test('a fresh install with no backup directory configured still starts', () => {
  // The in-memory/first-run path: no dbPath or backupDir supplied at all.
  const db = new Database(':memory:');
  createSchema(db);
  const result = safety.runMigrationsSafely(db);
  assert.strictEqual(result.currentVersion, LATEST);
  assert.strictEqual(result.backup, null);
  db.close();
});

console.log('\nA restore point is taken only when there is something to protect');

test('pending migrations are reported lowest-version first', () => {
  const { db } = makeSiteDb({ recordedVersion: 11 });
  const pending = safety.getPendingMigrations(db);
  assert.ok(pending.length > 0, 'expected migrations above v11');
  assert.strictEqual(pending[0].version, 12);
  const versions = pending.map((p) => p.version);
  assert.deepStrictEqual(versions, [...versions].sort((a, b) => a - b));
  db.close();
});

test('a database already at the latest version takes no backup', () => {
  const { db, dbPath, backupDir } = makeSiteDb({ recordedVersion: LATEST });
  const result = safety.runMigrationsSafely(db, { dbPath, backupDir });
  assert.strictEqual(result.applied, 0);
  assert.strictEqual(result.backup, null, 'a no-op launch must not copy the database');
  assert.deepStrictEqual(listCopies(backupDir), [], 'no backup directory content expected');
  db.close();
});

test('an upgrade with pending migrations takes a backup and applies them', () => {
  const { db, dbPath, backupDir } = makeSiteDb();
  const result = safety.runMigrationsSafely(db, { dbPath, backupDir });
  assert.ok(result.applied > 0, 'migrations should have been applied');
  assert.strictEqual(result.currentVersion, LATEST);
  assert.ok(result.backup, 'a backup must be recorded');
  assert.ok(fs.existsSync(result.backup.backupPath), 'the backup file must exist');
  db.close();
});

console.log('\nThe restore point is a real, verifiable copy');

test('the copy is byte-identical to the pre-migration database', () => {
  const { db, dbPath, backupDir } = makeSiteDb();
  const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  const before = sha(dbPath);

  const pending = safety.getPendingMigrations(db);
  const backup = safety.createPreMigrationBackup(db, {
    dbPath, backupDir, fromVersion: getCurrentVersion(db), pending,
  });

  assert.strictEqual(sha(backup.backupPath), before, 'copy must match the source bytes');
  assert.strictEqual(backup.checksum, before, 'recorded checksum must match');
  db.close();
});

test('the copy is a usable database that still holds the original rows', () => {
  const { db, dbPath, backupDir } = makeSiteDb();
  const originalRows = db.prepare('SELECT COUNT(*) AS n FROM bulk').get().n;

  const result = safety.runMigrationsSafely(db, { dbPath, backupDir });
  db.close();

  const restored = new Database(result.backup.backupPath, { readonly: true });
  assert.strictEqual(restored.prepare('SELECT COUNT(*) AS n FROM bulk').get().n, originalRows);
  assert.strictEqual(
    restored.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v, 11,
    'the copy must be at the PRE-migration schema version — that is the point of it',
  );
  restored.close();
});

test('metadata records the version range and pending migration list', () => {
  const { db, dbPath, backupDir } = makeSiteDb();
  const result = safety.runMigrationsSafely(db, { dbPath, backupDir });
  const meta = JSON.parse(fs.readFileSync(`${result.backup.backupPath}.meta.json`, 'utf8'));

  assert.strictEqual(meta.kind, 'pre-migration');
  assert.strictEqual(meta.fromSchemaVersion, 11);
  assert.strictEqual(meta.toSchemaVersion, LATEST);
  assert.strictEqual(meta.checksum, result.backup.checksum);
  assert.strictEqual(meta.encrypted, true);
  assert.ok(Array.isArray(meta.pendingMigrations) && meta.pendingMigrations.length > 0);
  assert.ok(meta.pendingMigrations.every((m) => typeof m.name === 'string'));
  db.close();
});

test('the filename states the schema range so an operator can pick the right file', () => {
  const { db, dbPath, backupDir } = makeSiteDb();
  const result = safety.runMigrationsSafely(db, { dbPath, backupDir });
  assert.match(path.basename(result.backup.backupPath), new RegExp(`^${safety.FILE_PREFIX}-v11-to-v${LATEST}-`));
  db.close();
});

console.log('\nFail closed: no restore point means no migration');

test('an unwritable backup directory aborts before the schema is touched', () => {
  const { db, dbPath } = makeSiteDb();
  const versionBefore = getCurrentVersion(db);

  // Point the backup directory at a path that cannot be created because a FILE
  // occupies a parent segment. mkdirSync recursive fails with ENOTDIR.
  const blocker = path.join(makeTempDir(), 'not-a-dir');
  fs.writeFileSync(blocker, 'occupied');
  const backupDir = path.join(blocker, 'backups');

  assert.throws(
    () => safety.runMigrationsSafely(db, { dbPath, backupDir }),
    /Refusing to run \d+ pending schema migration\(s\)/,
  );
  assert.strictEqual(
    getCurrentVersion(db), versionBefore,
    'the database must be untouched when the safety copy could not be written',
  );
  db.close();
});

test('a missing source database file is refused', () => {
  const { db, backupDir } = makeSiteDb();
  assert.throws(
    () => safety.runMigrationsSafely(db, { dbPath: path.join(makeTempDir(), 'nope.db'), backupDir }),
    /Refusing to run/,
  );
  db.close();
});

test('the abort message tells the operator the database was not modified', () => {
  const { db, dbPath } = makeSiteDb();
  const blocker = path.join(makeTempDir(), 'file-in-the-way');
  fs.writeFileSync(blocker, 'x');
  try {
    safety.runMigrationsSafely(db, { dbPath, backupDir: path.join(blocker, 'b') });
    assert.fail('expected a throw');
  } catch (err) {
    assert.match(err.message, /has not been modified/);
    assert.match(err.message, /disk space or correct permissions/);
  }
  db.close();
});

console.log('\nWhen a migration fails, the error names the restore point');

test('a failing migration surfaces the backup path and the version reached', () => {
  const { db, dbPath, backupDir } = makeSiteDb();

  // Inject a migration that fails, above the latest real one, so the real
  // sequence applies first and the failure genuinely happens mid-upgrade.
  const poison = {
    version: LATEST + 1,
    name: 'deliberately_failing_migration',
    description: 'test fixture',
    rollbackSql: null,
    up() { throw new Error('simulated migration failure'); },
  };
  MIGRATIONS.push(poison);
  try {
    safety.runMigrationsSafely(db, { dbPath, backupDir });
    assert.fail('expected the poisoned migration to throw');
  } catch (err) {
    assert.match(err.message, /Schema migration failed: simulated migration failure/);
    assert.ok(err.backupPath, 'the error must carry the restore path');
    assert.ok(fs.existsSync(err.backupPath), 'the named restore point must exist on disk');
    assert.strictEqual(err.fromVersion, 11);
    assert.strictEqual(err.reachedVersion, LATEST, 'earlier migrations stayed committed');
    assert.match(err.message, /may be partially migrated/);
    assert.ok(err.message.includes(err.backupPath), 'the path must appear in the message shown to the operator');
  } finally {
    MIGRATIONS.splice(MIGRATIONS.indexOf(poison), 1);
    db.close();
  }
});

test('the restore point captured before a failed upgrade is still openable', () => {
  const { db, dbPath, backupDir } = makeSiteDb();
  const poison = {
    version: LATEST + 1, name: 'failing_2', description: '', rollbackSql: null,
    up() { throw new Error('boom'); },
  };
  MIGRATIONS.push(poison);
  let backupPath = null;
  try {
    safety.runMigrationsSafely(db, { dbPath, backupDir });
  } catch (err) {
    backupPath = err.backupPath;
  } finally {
    MIGRATIONS.splice(MIGRATIONS.indexOf(poison), 1);
    db.close();
  }

  assert.ok(backupPath);
  const restored = new Database(backupPath, { readonly: true });
  assert.strictEqual(restored.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v, 11);
  assert.strictEqual(restored.prepare('SELECT COUNT(*) AS n FROM bulk').get().n, 500);
  restored.close();
});

console.log('\nPHI copies do not accumulate without bound');

test('only the newest copies are kept', () => {
  const backupDir = makeTempDir();
  const keep = 3;

  // Distinct mtimes so ordering is unambiguous.
  const made = [];
  for (let i = 0; i < 7; i++) {
    const f = path.join(backupDir, `${safety.FILE_PREFIX}-v${i}-to-v${i + 1}-stamp${i}.db`);
    fs.writeFileSync(f, `copy ${i}`);
    fs.utimesSync(f, new Date(2026, 0, 1 + i), new Date(2026, 0, 1 + i));
    fs.writeFileSync(`${f}.meta.json`, '{}');
    made.push(f);
  }

  const removed = safety.pruneOldBackups(backupDir, keep);
  const left = listCopies(backupDir);

  assert.strictEqual(left.length, keep, `expected ${keep} copies to remain, found ${left.length}`);
  assert.strictEqual(removed.length, 4);
  // The three newest are indices 4,5,6.
  for (const i of [4, 5, 6]) {
    assert.ok(left.includes(path.basename(made[i])), `copy ${i} (newer) should remain`);
  }
  for (const i of [0, 1, 2, 3]) {
    assert.ok(!fs.existsSync(made[i]), `copy ${i} (older) should be gone`);
    assert.ok(!fs.existsSync(`${made[i]}.meta.json`), `metadata for copy ${i} should be gone`);
  }
});

test('pruning ignores unrelated files in the backup directory', () => {
  const backupDir = makeTempDir();
  const unrelated = path.join(backupDir, 'transtrack-backup-2026-01-01.db');
  fs.writeFileSync(unrelated, 'scheduled backup, not ours');
  for (let i = 0; i < 8; i++) {
    fs.writeFileSync(path.join(backupDir, `${safety.FILE_PREFIX}-v1-to-v2-s${i}.db`), 'x');
  }
  safety.pruneOldBackups(backupDir, 2);
  assert.ok(fs.existsSync(unrelated), 'a scheduled disaster-recovery backup must not be pruned by this routine');
});

test('pruning a directory that does not exist is not an error', () => {
  assert.deepStrictEqual(safety.pruneOldBackups(path.join(makeTempDir(), 'absent'), 3), []);
});

test('a successful upgrade prunes down to the retention limit', () => {
  const { db, dbPath, backupDir } = makeSiteDb();
  fs.mkdirSync(backupDir, { recursive: true });
  for (let i = 0; i < safety.MAX_PRE_MIGRATION_BACKUPS + 4; i++) {
    const f = path.join(backupDir, `${safety.FILE_PREFIX}-v1-to-v2-old${i}.db`);
    fs.writeFileSync(f, 'old');
    fs.utimesSync(f, new Date(2020, 0, 1 + i), new Date(2020, 0, 1 + i));
  }
  safety.runMigrationsSafely(db, { dbPath, backupDir });
  assert.strictEqual(
    listCopies(backupDir).length, safety.MAX_PRE_MIGRATION_BACKUPS,
    'retention limit should hold after an upgrade',
  );
  db.close();
});

console.log('\nEscape hatch is explicit');

test('skipBackup runs migrations without a copy (for in-memory/first-run callers)', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT,
      applied_at TEXT, checksum TEXT, rollback_sql TEXT
    );
    INSERT INTO schema_migrations (version, name) VALUES (11, 'legacy');
  `);
  const result = safety.runMigrationsSafely(db, { skipBackup: true });
  assert.strictEqual(result.backup, null);
  assert.strictEqual(result.currentVersion, LATEST);
  db.close();
});

// --- cleanup ---------------------------------------------------------------
for (const dir of tempDirs) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

console.log(`\n${PASS} passed, ${FAIL} failed\n`);
if (FAIL > 0) {
  for (const f of failures) console.error(`${f.name}\n${f.error.stack}\n`);
  process.exit(1);
}
