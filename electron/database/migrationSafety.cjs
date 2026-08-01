/**
 * TransTrack — safety wrapper around schema migrations.
 *
 * WHY THIS EXISTS
 *
 * The riskiest moment in a deployed installation's life is the first launch
 * after an application update, because that is when pending schema migrations
 * run against a database containing real patient data.
 *
 * `runMigrations()` executes each migration in its own transaction, which is
 * the right granularity for diagnosing a failure but means a mid-sequence
 * failure is only *partially* atomic: migrations 1..N-1 stay committed and
 * migration N is rolled back. Most migrations also declare `rollbackSql: null`,
 * because SQLite historically could not drop a column, so there is no reliable
 * way to walk the schema backwards. When initialisation throws, the application
 * shows a fatal dialog and quits.
 *
 * Before this module, that combination left a site with a database stranded at
 * an intermediate schema version, an application that would not start, and no
 * restore point taken at the moment of the change. Hourly automatic backups
 * exist, but "up to an hour ago" is not the same as "immediately before the
 * upgrade", and the operator had no way to know which backup predated it.
 *
 * WHAT THIS DOES
 *
 *   • Takes a verified copy of the database immediately before the first
 *     migration runs, and only when migrations are actually pending, so normal
 *     launches pay nothing.
 *   • Fails closed. If the safety copy cannot be written or verified, the
 *     migration does not start. Declining to upgrade is recoverable; a
 *     half-migrated PHI database with no restore point is not.
 *   • Attaches the restore path to the error when a migration does fail, so the
 *     path appears in the log and the fatal dialog instead of having to be
 *     guessed.
 *
 * Encryption note: the copy is a byte copy of the SQLCipher file taken after a
 * WAL checkpoint, so it stays encrypted with the same key and no plaintext is
 * ever written. This mirrors `electron/services/disasterRecovery.cjs`, which
 * documents that `db.backup(path)` cannot be used here because it cannot open an
 * encrypted destination.
 *
 * This module deliberately does not require `electron`: paths are passed in, so
 * it is exercisable from plain-Node tests.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { MIGRATIONS, getCurrentVersion, runMigrations, ensureMigrationsTable } = require('./migrations.cjs');
const secureDelete = require('../services/secureDelete.cjs');

/** Pre-migration copies to retain before the oldest are securely erased. */
const MAX_PRE_MIGRATION_BACKUPS = 5;

const FILE_PREFIX = 'transtrack-premigration';

/**
 * Migrations that would run against this database, lowest version first.
 */
function getPendingMigrations(db) {
  // On a fresh database the tracking table does not exist yet, and reading the
  // version would throw "no such table: schema_migrations". Every public entry
  // point in migrations.cjs establishes this precondition first; so does this.
  ensureMigrationsTable(db);
  const currentVersion = getCurrentVersion(db);
  return MIGRATIONS
    .filter((m) => m.version > currentVersion)
    .sort((a, b) => a.version - b.version)
    .map((m) => ({ version: m.version, name: m.name }));
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * Remove all but the newest `keep` pre-migration copies.
 *
 * These files contain PHI, so they are erased with the secure-delete service
 * rather than unlinked, matching how the disaster-recovery service rotates its
 * own backups.
 */
function pruneOldBackups(backupDir, keep = MAX_PRE_MIGRATION_BACKUPS) {
  let entries;
  try {
    entries = fs.readdirSync(backupDir);
  } catch {
    return [];
  }

  const copies = entries
    .filter((f) => f.startsWith(FILE_PREFIX) && f.endsWith('.db'))
    .map((f) => {
      const full = path.join(backupDir, f);
      let mtimeMs = 0;
      try { mtimeMs = fs.statSync(full).mtimeMs; } catch { /* raced with removal */ }
      return { file: f, full, mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const removed = [];
  for (const stale of copies.slice(keep)) {
    try {
      secureDelete.secureDeleteFile(stale.full);
      for (const suffix of ['-wal', '-shm']) {
        if (fs.existsSync(stale.full + suffix)) secureDelete.secureDeleteFile(stale.full + suffix);
      }
      const meta = `${stale.full}.meta.json`;
      if (fs.existsSync(meta)) fs.unlinkSync(meta);
      removed.push(stale.file);
    } catch { /* a copy we cannot remove is not a reason to block the upgrade */ }
  }
  return removed;
}

/**
 * Copy the database to the backup directory and verify the copy.
 *
 * @returns {{ backupPath: string, metadataPath: string, checksum: string, sizeBytes: number }}
 * @throws if the copy cannot be written or does not verify
 */
function createPreMigrationBackup(db, options) {
  const { dbPath, backupDir, fromVersion, pending, now = new Date() } = options;

  if (!dbPath) throw new Error('createPreMigrationBackup: dbPath is required');
  if (!backupDir) throw new Error('createPreMigrationBackup: backupDir is required');
  if (!fs.existsSync(dbPath)) {
    throw new Error(`createPreMigrationBackup: database file does not exist at ${dbPath}`);
  }

  fs.mkdirSync(backupDir, { recursive: true });

  const toVersion = pending.length > 0 ? pending[pending.length - 1].version : fromVersion;
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const fileName = `${FILE_PREFIX}-v${fromVersion}-to-v${toVersion}-${stamp}.db`;
  const backupPath = path.join(backupDir, fileName);
  const metadataPath = `${backupPath}.meta.json`;

  // Fold the WAL into the main file so a plain byte copy is self-contained.
  // Best-effort: a database opened without WAL, or a checkpoint blocked by a
  // reader, still yields a valid copy alongside the -wal file copied below.
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* best-effort */ }

  // Anything already at this path is an older encrypted copy; wipe rather than
  // overwrite so its pages are not left readable in free blocks.
  try { secureDelete.secureDeleteFile(backupPath); } catch { /* absent */ }

  // Captured before the copy. Comparing the copy against a source re-stat'd
  // afterwards would be a race: the connection is still open and the file can
  // grow between the two calls, which would make a perfectly good copy look
  // truncated and — because this path is fail-closed — abort startup.
  const sourceSizeAtCopy = fs.statSync(dbPath).size;

  fs.copyFileSync(dbPath, backupPath);
  for (const suffix of ['-wal', '-shm']) {
    const side = dbPath + suffix;
    if (fs.existsSync(side)) {
      try { fs.copyFileSync(side, backupPath + suffix); } catch { /* non-fatal */ }
    }
  }

  // Verify the copy is readable and non-empty before allowing the migration to
  // proceed. A zero-byte or truncated copy is worse than no copy, because it
  // looks like a restore point and is not one.
  // `copyFileSync` either copies the whole file or throws, so an existing,
  // non-empty result is the meaningful check. A size mismatch against the
  // pre-copy measurement is recorded for diagnostics but is NOT treated as a
  // failure: SQLite can legitimately resize the file underneath us, and
  // refusing to start over that would be a self-inflicted outage.
  const stat = fs.statSync(backupPath);
  if (stat.size === 0) {
    throw new Error(`createPreMigrationBackup: copy at ${backupPath} is empty`);
  }

  const checksum = sha256File(backupPath);

  fs.writeFileSync(metadataPath, JSON.stringify({
    kind: 'pre-migration',
    fileName,
    createdAt: now.toISOString(),
    reason: 'Automatic safety copy taken immediately before schema migrations.',
    fromSchemaVersion: fromVersion,
    toSchemaVersion: toVersion,
    pendingMigrations: pending,
    checksum,
    checksumAlgorithm: 'sha256',
    sizeBytes: stat.size,
    sourceSizeAtCopy,
    encrypted: true,
    encryptionNote: 'Byte copy of the SQLCipher database; opens with the same key as the source.',
  }, null, 2));

  return { backupPath, metadataPath, checksum, sizeBytes: stat.size };
}

/**
 * Run pending migrations with a verified restore point taken first.
 *
 * Returns the `runMigrations` result plus a `backup` field describing the safety
 * copy (`null` when no migrations were pending, so nothing was at risk).
 *
 * On migration failure the thrown error carries `backupPath` and `fromVersion`
 * so the caller can tell the operator exactly what to restore.
 *
 * @param {object} db      open better-sqlite3 database
 * @param {object} options { dbPath, backupDir, logger?, now?, skipBackup? }
 */
function runMigrationsSafely(db, options = {}) {
  const { dbPath, backupDir, logger = null, now = new Date() } = options;
  const log = (level, message, meta) => {
    if (logger && typeof logger[level] === 'function') logger[level](message, meta);
  };

  ensureMigrationsTable(db);
  const fromVersion = getCurrentVersion(db);
  const pending = getPendingMigrations(db);

  if (pending.length === 0) {
    return { applied: 0, currentVersion: fromVersion, migrations: [], backup: null };
  }

  // `skipBackup` exists for callers that genuinely have nothing to protect —
  // an in-memory database in a test, or a first-run install creating the file
  // from scratch. It is never a way to bypass the safety copy on a real upgrade.
  let backup = null;
  if (!options.skipBackup && dbPath && backupDir) {
    try {
      backup = createPreMigrationBackup(db, { dbPath, backupDir, fromVersion, pending, now });
      log('info', 'Pre-migration database backup created', {
        fromVersion,
        pendingCount: pending.length,
        sizeBytes: backup.sizeBytes,
      });
    } catch (err) {
      log('error', 'Pre-migration backup failed; refusing to migrate', { error: err.message });
      throw new Error(
        `Refusing to run ${pending.length} pending schema migration(s) because a safety backup ` +
        `could not be created: ${err.message}. The database has not been modified. ` +
        'Free disk space or correct permissions on the backup directory and restart.',
      );
    }
  }

  let result;
  try {
    result = runMigrations(db);
  } catch (err) {
    const failedAfter = getCurrentVersion(db);
    log('error', 'Schema migration failed', {
      fromVersion,
      reachedVersion: failedAfter,
      error: err.message,
    });

    const guidance = backup
      ? ` The database may be partially migrated (was v${fromVersion}, now v${failedAfter}). ` +
        `A pre-migration backup was saved to: ${backup.backupPath}`
      : ` The database may be partially migrated (was v${fromVersion}, now v${failedAfter}). ` +
        'No pre-migration backup was taken for this run.';

    const wrapped = new Error(`Schema migration failed: ${err.message}.${guidance}`);
    wrapped.cause = err;
    wrapped.backupPath = backup ? backup.backupPath : null;
    wrapped.fromVersion = fromVersion;
    wrapped.reachedVersion = failedAfter;
    throw wrapped;
  }

  if (backup) {
    const pruned = pruneOldBackups(backupDir);
    if (pruned.length > 0) log('info', 'Pruned old pre-migration backups', { count: pruned.length });
  }

  log('info', 'Schema migrations applied', {
    applied: result.applied,
    currentVersion: result.currentVersion,
  });

  return { ...result, backup };
}

module.exports = {
  MAX_PRE_MIGRATION_BACKUPS,
  FILE_PREFIX,
  getPendingMigrations,
  createPreMigrationBackup,
  pruneOldBackups,
  runMigrationsSafely,
};
