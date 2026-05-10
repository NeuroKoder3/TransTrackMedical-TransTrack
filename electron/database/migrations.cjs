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
  {
    version: 5,
    name: 'add_mfa_and_password_history',
    description: 'TOTP MFA secrets, backup codes, password history (TT-R004/005/006)',
    rollbackSql: 'DROP TABLE IF EXISTS user_mfa; DROP TABLE IF EXISTS user_mfa_backup_codes; DROP TABLE IF EXISTS user_password_history;',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_mfa (
          user_id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL,
          secret_encrypted TEXT NOT NULL,
          enrolled_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_used_at TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS user_mfa_backup_codes (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          org_id TEXT NOT NULL,
          code_hash TEXT NOT NULL,
          used_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_mfa_backup_user ON user_mfa_backup_codes(user_id, used_at);
        CREATE TABLE IF NOT EXISTS user_password_history (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          changed_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_pwhist_user_time ON user_password_history(user_id, changed_at DESC);
      `);
      const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
      if (!cols.includes('password_changed_at')) {
        db.exec(`ALTER TABLE users ADD COLUMN password_changed_at TEXT`);
      }
      if (!cols.includes('mfa_required')) {
        db.exec(`ALTER TABLE users ADD COLUMN mfa_required INTEGER DEFAULT 0`);
      }
    },
  },
  {
    version: 6,
    name: 'add_organ_offers',
    description: 'Organ offer state machine (TT-R066)',
    rollbackSql: 'DROP TABLE IF EXISTS organ_offer_events; DROP TABLE IF EXISTS organ_offers;',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS organ_offers (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL,
          donor_organ_id TEXT,
          patient_id TEXT,
          status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED_PROVISIONAL','ACCEPTED_FINAL','DECLINED','EXPIRED','RESCINDED')),
          rank INTEGER,
          offered_at TEXT NOT NULL DEFAULT (datetime('now')),
          response_due_at TEXT,
          responded_at TEXT,
          decline_reason_code TEXT,
          decline_reason_text TEXT,
          backup_chain_position INTEGER,
          notes TEXT,
          created_by TEXT,
          updated_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
          FOREIGN KEY (donor_organ_id) REFERENCES donor_organs(id),
          FOREIGN KEY (patient_id) REFERENCES patients(id)
        );
        CREATE INDEX IF NOT EXISTS idx_offers_org ON organ_offers(org_id);
        CREATE INDEX IF NOT EXISTS idx_offers_status ON organ_offers(org_id, status);
        CREATE INDEX IF NOT EXISTS idx_offers_donor ON organ_offers(org_id, donor_organ_id);
        CREATE INDEX IF NOT EXISTS idx_offers_patient ON organ_offers(org_id, patient_id);
        CREATE INDEX IF NOT EXISTS idx_offers_due ON organ_offers(org_id, response_due_at);
        CREATE TABLE IF NOT EXISTS organ_offer_events (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL,
          offer_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          from_status TEXT,
          to_status TEXT,
          actor TEXT,
          payload TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (offer_id) REFERENCES organ_offers(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_offer_events_offer ON organ_offer_events(offer_id, created_at);
      `);
    },
  },
  {
    version: 7,
    name: 'add_post_transplant_tracking',
    description: 'Post-transplant follow-up: events, immunosuppression, rejection, biopsies, readmissions (TT-R067)',
    rollbackSql: null,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS transplant_events (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL,
          patient_id TEXT NOT NULL,
          donor_organ_id TEXT,
          organ_type TEXT NOT NULL,
          transplant_date TEXT NOT NULL,
          surgeon TEXT,
          warm_ischemia_time_min REAL,
          cold_ischemia_time_min REAL,
          induction_regimen TEXT,
          discharge_date TEXT,
          graft_status TEXT NOT NULL DEFAULT 'FUNCTIONING' CHECK(graft_status IN ('FUNCTIONING','FAILED','LOST_PRIMARY_NON_FUNCTION','RETRANSPLANTED')),
          patient_status TEXT NOT NULL DEFAULT 'ALIVE' CHECK(patient_status IN ('ALIVE','DECEASED','LOST_TO_FOLLOWUP')),
          deceased_date TEXT,
          deceased_cause TEXT,
          notes TEXT,
          created_by TEXT,
          updated_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
          FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_tx_events_org ON transplant_events(org_id);
        CREATE INDEX IF NOT EXISTS idx_tx_events_patient ON transplant_events(org_id, patient_id);
        CREATE INDEX IF NOT EXISTS idx_tx_events_date ON transplant_events(org_id, transplant_date);

        CREATE TABLE IF NOT EXISTS immunosuppression_regimens (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL,
          patient_id TEXT NOT NULL,
          transplant_event_id TEXT,
          start_date TEXT NOT NULL,
          end_date TEXT,
          drug_name TEXT NOT NULL,
          dose TEXT,
          frequency TEXT,
          target_trough TEXT,
          notes TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
          FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
          FOREIGN KEY (transplant_event_id) REFERENCES transplant_events(id)
        );
        CREATE INDEX IF NOT EXISTS idx_immuno_patient ON immunosuppression_regimens(org_id, patient_id, start_date DESC);

        CREATE TABLE IF NOT EXISTS rejection_episodes (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL,
          patient_id TEXT NOT NULL,
          transplant_event_id TEXT,
          episode_date TEXT NOT NULL,
          rejection_type TEXT CHECK(rejection_type IN ('ACUTE_CELLULAR','ANTIBODY_MEDIATED','MIXED','CHRONIC','BORDERLINE','OTHER')),
          severity TEXT,
          treatment TEXT,
          resolution_date TEXT,
          biopsy_id TEXT,
          notes TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
          FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_rej_patient ON rejection_episodes(org_id, patient_id, episode_date DESC);

        CREATE TABLE IF NOT EXISTS biopsies (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL,
          patient_id TEXT NOT NULL,
          transplant_event_id TEXT,
          biopsy_date TEXT NOT NULL,
          biopsy_type TEXT,
          finding TEXT,
          banff_grade TEXT,
          notes TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
          FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_biopsy_patient ON biopsies(org_id, patient_id, biopsy_date DESC);

        CREATE TABLE IF NOT EXISTS post_tx_readmissions (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL,
          patient_id TEXT NOT NULL,
          transplant_event_id TEXT,
          admit_date TEXT NOT NULL,
          discharge_date TEXT,
          reason TEXT,
          related_to_graft INTEGER DEFAULT 0,
          notes TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
          FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_readmit_patient ON post_tx_readmissions(org_id, patient_id, admit_date DESC);
      `);
    },
  },
  {
    version: 8,
    name: 'add_living_donor_workflow',
    description: 'Living donor evaluation, donation, OPTN Policy 14 follow-up (TT-R068)',
    rollbackSql: null,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS living_donors (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL,
          mrn TEXT,
          first_name TEXT NOT NULL,
          last_name TEXT NOT NULL,
          date_of_birth TEXT,
          sex TEXT,
          blood_type TEXT,
          relationship_to_recipient TEXT,
          recipient_patient_id TEXT,
          intended_organ TEXT NOT NULL CHECK(intended_organ IN ('KIDNEY','LIVER_LEFT','LIVER_RIGHT','LIVER_LATERAL','LUNG_LOBE','OTHER')),
          phone TEXT,
          email TEXT,
          address TEXT,
          status TEXT NOT NULL DEFAULT 'INQUIRY' CHECK(status IN ('INQUIRY','SCREENING','EVALUATION','APPROVED','DEFERRED','DECLINED','DONATED','WITHDRAWN')),
          status_reason TEXT,
          created_by TEXT,
          updated_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
          FOREIGN KEY (recipient_patient_id) REFERENCES patients(id)
        );
        CREATE INDEX IF NOT EXISTS idx_ld_org ON living_donors(org_id);
        CREATE INDEX IF NOT EXISTS idx_ld_status ON living_donors(org_id, status);
        CREATE INDEX IF NOT EXISTS idx_ld_recipient ON living_donors(org_id, recipient_patient_id);

        CREATE TABLE IF NOT EXISTS living_donor_evaluations (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL,
          living_donor_id TEXT NOT NULL,
          step TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SCHEDULED','COMPLETE','DEFERRED','FAILED')),
          scheduled_date TEXT,
          completed_date TEXT,
          owner_role TEXT,
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
          FOREIGN KEY (living_donor_id) REFERENCES living_donors(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_lde_donor ON living_donor_evaluations(org_id, living_donor_id);

        CREATE TABLE IF NOT EXISTS living_donor_followups (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL,
          living_donor_id TEXT NOT NULL,
          milestone_months INTEGER NOT NULL CHECK(milestone_months IN (6,12,24)),
          due_date TEXT NOT NULL,
          completed_date TEXT,
          status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SCHEDULED','COMPLETE','OVERDUE','LOST_TO_FOLLOWUP')),
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
          FOREIGN KEY (living_donor_id) REFERENCES living_donors(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_ldfu_donor ON living_donor_followups(org_id, living_donor_id);
        CREATE INDEX IF NOT EXISTS idx_ldfu_due ON living_donor_followups(org_id, due_date);
      `);
    },
  },
  {
    version: 9,
    name: 'add_siem_destinations',
    description: 'External SIEM/syslog forwarder destinations (TT-R026)',
    rollbackSql: 'DROP TABLE IF EXISTS siem_destinations;',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS siem_destinations (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL,
          name TEXT NOT NULL,
          host TEXT NOT NULL,
          port INTEGER NOT NULL,
          protocol TEXT NOT NULL DEFAULT 'udp' CHECK(protocol IN ('udp','tcp','tls')),
          format TEXT NOT NULL DEFAULT 'cef' CHECK(format IN ('cef','json','rfc5424')),
          enabled INTEGER NOT NULL DEFAULT 1,
          severity_filter TEXT NOT NULL DEFAULT 'all',
          last_success_at TEXT,
          last_failure_at TEXT,
          last_failure_reason TEXT,
          dropped_count INTEGER NOT NULL DEFAULT 0,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_siem_org ON siem_destinations(org_id, enabled);
      `);
    },
  },
  {
    version: 10,
    name: 'add_siem_verify_tls',
    description:
      'Per-destination TLS certificate verification toggle (TT-R026, default ON). ' +
      'Closes CodeQL js/disabling-certificate-validation: TLS forwarders now ' +
      'verify peer certificates by default; disabling requires an explicit ' +
      'admin opt-in per destination (e.g. for self-signed dev SIEMs).',
    // No rollback — making the column NOT NULL DEFAULT 1 is forward-only.
    rollbackSql: null,
    up(db) {
      const cols = db
        .prepare("PRAGMA table_info(siem_destinations)")
        .all()
        .map((c) => c.name);
      if (!cols.includes('verify_tls')) {
        db.exec(
          'ALTER TABLE siem_destinations ADD COLUMN verify_tls INTEGER NOT NULL DEFAULT 1'
        );
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
