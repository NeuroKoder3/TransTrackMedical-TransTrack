/**
 * TransTrack - Database Migration Strategy
 *
 * Versioned, forward-only migrations for production schema updates.
 * Each migration runs inside a transaction and is recorded in a
 * `schema_migrations` tracking table.
 *
 * Usage:
 *   const { runMigrations } = require('./migrations.cjs');
 *   runMigrations(db);  // called after initDatabase()
 */

'use strict';

const MIGRATIONS = [
  {
    version: 1,
    name: 'add_request_id_to_audit_logs',
    description: 'Add request_id column for end-to-end tracing',
    up(db) {
      const cols = db.prepare("PRAGMA table_info(audit_logs)").all().map(c => c.name);
      if (!cols.includes('request_id')) {
        db.exec(`ALTER TABLE audit_logs ADD COLUMN request_id TEXT`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_logs_request_id ON audit_logs(request_id)`);
      }
    },
  },
  {
    version: 2,
    name: 'add_request_id_to_access_justification',
    description: 'Add request_id to access justification logs',
    up(db) {
      const cols = db.prepare("PRAGMA table_info(access_justification_logs)").all().map(c => c.name);
      if (!cols.includes('request_id')) {
        db.exec(`ALTER TABLE access_justification_logs ADD COLUMN request_id TEXT`);
      }
    },
  },
  {
    version: 3,
    name: 'add_schema_version_setting',
    description: 'Record schema version in settings for external tools',
    up(db) {
      const { v4: uuidv4 } = require('uuid');
      const existing = db.prepare(
        "SELECT id FROM settings WHERE key = 'schema_version' LIMIT 1"
      ).get();
      if (!existing) {
        db.prepare(
          "INSERT INTO settings (id, org_id, key, value, updated_at) VALUES (?, 'SYSTEM', 'schema_version', '3', datetime('now'))"
        ).run(uuidv4());
      }
    },
  },
];

/**
 * Ensure the migrations tracking table exists.
 */
function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      checksum TEXT
    )
  `);
}

/**
 * Get the current schema version (highest applied migration).
 */
function getCurrentVersion(db) {
  const row = db.prepare('SELECT MAX(version) as version FROM schema_migrations').get();
  return row?.version || 0;
}

/**
 * Run all pending migrations in order.
 * Returns { applied: number, currentVersion: number, migrations: string[] }
 */
function runMigrations(db) {
  ensureMigrationsTable(db);
  const currentVersion = getCurrentVersion(db);
  const pending = MIGRATIONS.filter(m => m.version > currentVersion).sort((a, b) => a.version - b.version);

  if (pending.length === 0) {
    return { applied: 0, currentVersion, migrations: [] };
  }

  const appliedNames = [];

  for (const migration of pending) {
    const tx = db.transaction(() => {
      migration.up(db);

      db.prepare(`
        INSERT INTO schema_migrations (version, name, description, applied_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run(migration.version, migration.name, migration.description || '');
    });

    tx();
    appliedNames.push(migration.name);

    if (process.env.NODE_ENV === 'development') {
      console.log(`  Migration ${migration.version}: ${migration.name} ✓`);
    }
  }

  const newVersion = getCurrentVersion(db);

  // Update schema_version setting if it exists
  try {
    db.prepare(
      "UPDATE settings SET value = ?, updated_at = datetime('now') WHERE key = 'schema_version'"
    ).run(String(newVersion));
  } catch { /* settings table might not have the row yet */ }

  return {
    applied: appliedNames.length,
    currentVersion: newVersion,
    migrations: appliedNames,
  };
}

/**
 * Get migration status for diagnostics.
 */
function getMigrationStatus(db) {
  ensureMigrationsTable(db);
  const applied = db.prepare('SELECT * FROM schema_migrations ORDER BY version').all();
  const currentVersion = getCurrentVersion(db);
  const pending = MIGRATIONS.filter(m => m.version > currentVersion);

  return {
    currentVersion,
    totalAvailable: MIGRATIONS.length,
    applied: applied.length,
    pending: pending.length,
    pendingMigrations: pending.map(m => ({ version: m.version, name: m.name })),
    appliedMigrations: applied,
  };
}

module.exports = {
  runMigrations,
  getMigrationStatus,
  getCurrentVersion,
  MIGRATIONS,
};
