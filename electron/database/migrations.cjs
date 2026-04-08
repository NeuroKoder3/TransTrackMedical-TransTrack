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
    rollbackSql: 'DROP INDEX IF EXISTS idx_audit_logs_request_id',
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
    rollbackSql: null, // SQLite cannot DROP COLUMN in older versions; safe to leave
    up(db) {
      const cols = db.prepare("PRAGMA table_info(access_justification_logs)").all().map(c => c.name);
      if (!cols.includes('request_id')) {
        db.exec(`ALTER TABLE access_justification_logs ADD COLUMN request_id TEXT`);
      }
    },
  },
  {
    version: 3,
    name: 'add_ehr_integration_columns',
    description: 'Add EHR integration, sync log, and import columns for FHIR interoperability',
    rollbackSql: null,
    up(db) {
      const addCol = (table, col, type) => {
        const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
        if (!cols.includes(col)) {
          db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
        }
      };

      addCol('ehr_integrations', 'integration_name', 'TEXT');
      addCol('ehr_integrations', 'ehr_system_type', 'TEXT');
      addCol('ehr_integrations', 'endpoint_url', 'TEXT');
      addCol('ehr_integrations', 'auth_type', "TEXT DEFAULT 'bearer_token'");
      addCol('ehr_integrations', 'enable_bidirectional_sync', 'INTEGER DEFAULT 0');
      addCol('ehr_integrations', 'sync_fields_to_ehr', 'TEXT');
      addCol('ehr_integrations', 'auto_create_patients', 'INTEGER DEFAULT 0');
      addCol('ehr_integrations', 'auto_update_existing', 'INTEGER DEFAULT 1');
      addCol('ehr_integrations', 'sync_frequency', 'TEXT');
      addCol('ehr_integrations', 'total_imports', 'INTEGER DEFAULT 0');
      addCol('ehr_integrations', 'total_exports', 'INTEGER DEFAULT 0');
      addCol('ehr_integrations', 'last_export_date', 'TEXT');

      addCol('ehr_sync_logs', 'sync_direction', 'TEXT');
      addCol('ehr_sync_logs', 'patient_id', 'TEXT');
      addCol('ehr_sync_logs', 'patient_name', 'TEXT');
      addCol('ehr_sync_logs', 'fhir_resource_type', 'TEXT');
      addCol('ehr_sync_logs', 'fields_synced', 'TEXT');
      addCol('ehr_sync_logs', 'error_message', 'TEXT');
      addCol('ehr_sync_logs', 'ehr_response', 'TEXT');
      addCol('ehr_sync_logs', 'triggered_by', 'TEXT');
      addCol('ehr_sync_logs', 'sync_duration_ms', 'INTEGER');

      addCol('ehr_imports', 'source_system', 'TEXT');
      addCol('ehr_imports', 'records_processed', 'INTEGER DEFAULT 0');
      addCol('ehr_imports', 'records_created', 'INTEGER DEFAULT 0');
      addCol('ehr_imports', 'records_updated', 'INTEGER DEFAULT 0');
      addCol('ehr_imports', 'imported_by', 'TEXT');
      addCol('ehr_imports', 'fhir_version', 'TEXT');
    },
  },
  {
    version: 4,
    name: 'add_schema_version_setting',
    description: 'Record schema version in settings for external tools',
    rollbackSql: "DELETE FROM settings WHERE key = 'schema_version'",
    up(db) {
      const { v4: uuidv4 } = require('uuid');
      const existing = db.prepare(
        "SELECT id FROM settings WHERE key = 'schema_version' LIMIT 1"
      ).get();
      if (!existing) {
        const org = db.prepare("SELECT id FROM organizations LIMIT 1").get();
        if (org) {
          db.prepare(
            "INSERT INTO settings (id, org_id, key, value, updated_at) VALUES (?, ?, 'schema_version', '3', datetime('now'))"
          ).run(uuidv4(), org.id);
        }
      }
    },
  },
];

/**
 * Ensure the migrations tracking table exists (with rollback SQL storage).
 */
function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      checksum TEXT,
      rollback_sql TEXT
    )
  `);

  // Add rollback_sql column if upgrading from older schema
  const cols = db.prepare("PRAGMA table_info(schema_migrations)").all().map(c => c.name);
  if (!cols.includes('rollback_sql')) {
    db.exec('ALTER TABLE schema_migrations ADD COLUMN rollback_sql TEXT');
  }
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
        INSERT INTO schema_migrations (version, name, description, applied_at, rollback_sql)
        VALUES (?, ?, ?, datetime('now'), ?)
      `).run(migration.version, migration.name, migration.description || '', migration.rollbackSql || null);
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
 * Roll back the most recently applied migration.
 * Executes the stored rollback_sql in a transaction and removes the
 * migration record. Returns the rolled-back migration info or null if
 * no rollback was possible.
 */
function rollbackLastMigration(db) {
  ensureMigrationsTable(db);
  const last = db.prepare(
    'SELECT * FROM schema_migrations ORDER BY version DESC LIMIT 1'
  ).get();

  if (!last) return null;

  const tx = db.transaction(() => {
    if (last.rollback_sql) {
      db.exec(last.rollback_sql);
    }
    db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(last.version);
  });

  tx();

  // Update schema_version setting
  const newVersion = getCurrentVersion(db);
  try {
    db.prepare(
      "UPDATE settings SET value = ?, updated_at = datetime('now') WHERE key = 'schema_version'"
    ).run(String(newVersion));
  } catch { /* settings row may not exist */ }

  return { rolledBack: last.name, version: last.version, newVersion };
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
  rollbackLastMigration,
  getMigrationStatus,
  getCurrentVersion,
  MIGRATIONS,
};
