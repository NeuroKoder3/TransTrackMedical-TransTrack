/**
 * TransTrack — migration behaviour on a partially populated legacy database.
 *
 * Two properties are covered:
 *
 *   1. A database carrying only the bare EHR interoperability tables is
 *      repaired: the columns the FHIR/HL7 code expects are added rather than
 *      left missing.
 *
 *   2. A migration run does not abort because some unrelated table is absent.
 *      `PRAGMA table_info(missing_table)` returns an empty result instead of
 *      raising, so a `!cols.includes(col)` guard passes on a database where the
 *      table itself is missing and the following `ALTER TABLE` then throws,
 *      rolling back the whole run. Migrations must check the table before the
 *      column — see `addColumn` in electron/database/migrations.cjs.
 *
 * Assertions are deliberately version-agnostic. This suite previously pinned
 * the expected end state to schema version 12 and to a single applied
 * migration name, which silently went stale as migrations 13 onward were added.
 *
 * Run standalone: node tests/ehrMigration.test.cjs
 */

'use strict';

const assert = require('assert');
const Database = require('better-sqlite3-multiple-ciphers');
const { runMigrations, MIGRATIONS } = require('../electron/database/migrations.cjs');

const LATEST_VERSION = Math.max(...MIGRATIONS.map((m) => m.version));

/**
 * A legacy database as it exists in the field: the three EHR tables present but
 * bare, a schema_migrations table claiming version 11, and none of the other
 * production tables (audit_logs, users, patients, ...) created at all.
 */
function makeLegacyEhrDb() {
  const db = new Database(':memory:');
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
    INSERT INTO schema_migrations (version, name) VALUES (11, 'legacy_schema');
  `);
  return db;
}

const db = makeLegacyEhrDb();

// Property 2: the run completes even though audit_logs, users, and the rest are
// absent. Before addColumn() existed this threw "no such table: audit_logs".
const result = runMigrations(db);

assert.strictEqual(
  result.currentVersion,
  LATEST_VERSION,
  `migrations should run to completion (reached ${result.currentVersion}, latest is ${LATEST_VERSION})`,
);
assert.ok(
  result.migrations.includes('repair_ehr_integration_columns'),
  'the EHR column repair migration should have been applied',
);
assert.strictEqual(
  result.applied,
  MIGRATIONS.filter((m) => m.version > 11).length,
  'every migration above the recorded version should be applied',
);

// Property 1: the EHR interoperability columns are present afterwards.
for (const [table, expectedColumns] of Object.entries({
  ehr_integrations: [
    'integration_name', 'ehr_system_type', 'endpoint_url', 'auth_type',
    'enable_bidirectional_sync', 'sync_fields_to_ehr', 'auto_create_patients',
    'auto_update_existing', 'sync_frequency', 'total_imports', 'total_exports',
    'last_export_date',
  ],
  ehr_sync_logs: [
    'sync_direction', 'patient_id', 'patient_name', 'fhir_resource_type',
    'fields_synced', 'error_message', 'ehr_response', 'triggered_by',
    'sync_duration_ms',
  ],
  ehr_imports: [
    'source_system', 'records_processed', 'records_created', 'records_updated',
    'imported_by', 'fhir_version',
  ],
})) {
  const actualColumns = db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
  for (const column of expectedColumns) {
    assert(actualColumns.includes(column), `${table}.${column} was not added`);
  }
}

// A migration that could not widen an absent table must not have conjured it.
for (const absent of ['audit_logs', 'users', 'patients']) {
  const cols = db.prepare(`PRAGMA table_info(${absent})`).all();
  assert.strictEqual(cols.length, 0, `${absent} should still be absent, not partially created`);
}

// Re-running is a no-op rather than a second attempt at the same ALTERs.
const second = runMigrations(db);
assert.strictEqual(second.applied, 0, 'a second run should apply nothing');
assert.strictEqual(second.currentVersion, LATEST_VERSION);

db.close();
console.log('EHR migration repair test passed');
