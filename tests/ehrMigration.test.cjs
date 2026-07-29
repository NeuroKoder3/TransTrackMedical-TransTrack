'use strict';

const assert = require('assert');
const Database = require('better-sqlite3-multiple-ciphers');
const { runMigrations } = require('../electron/database/migrations.cjs');

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

const result = runMigrations(db);

assert.strictEqual(result.currentVersion, 12);
assert.deepStrictEqual(result.migrations, ['repair_ehr_integration_columns']);

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
  const actualColumns = db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
  for (const column of expectedColumns) {
    assert(actualColumns.includes(column), `${table}.${column} was not added`);
  }
}

db.close();
console.log('EHR migration repair test passed');
