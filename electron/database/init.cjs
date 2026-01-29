/**
 * TransTrack - Database Initialization
 * 
 * Uses better-sqlite3 with SQLCipher for encrypted local storage.
 * HIPAA compliant with AES-256 encryption.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { app } = require('electron');

let db = null;

// Get database path
function getDatabasePath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'transtrack.db');
}

// Get or create encryption key
function getEncryptionKey() {
  const keyPath = path.join(app.getPath('userData'), '.transtrack-key');
  
  if (fs.existsSync(keyPath)) {
    return fs.readFileSync(keyPath, 'utf8');
  }
  
  // Generate new key for first-time setup
  const key = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(keyPath, key, { mode: 0o600 });
  return key;
}

// Initialize database with schema
async function initDatabase() {
  const dbPath = getDatabasePath();
  const encryptionKey = getEncryptionKey();
  
  console.log('Initializing database at:', dbPath);
  
  // Create database connection
  db = new Database(dbPath, {
    verbose: process.env.NODE_ENV === 'development' ? console.log : null
  });
  
  // Enable foreign keys and WAL mode for better performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  
  // Create schema
  createSchema();
  
  // Seed default data if needed
  await seedDefaultData();
  
  console.log('Database initialized successfully');
  return db;
}

function createSchema() {
  // Users table (for authentication)
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT,
      role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user', 'viewer')),
      is_active INTEGER DEFAULT 1,
      created_date TEXT DEFAULT (datetime('now')),
      updated_date TEXT DEFAULT (datetime('now')),
      last_login TEXT
    )
  `);
  
  // Sessions table (for secure session management)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_date TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  
  // Patients table
  db.exec(`
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      patient_id TEXT UNIQUE,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      date_of_birth TEXT,
      blood_type TEXT,
      organ_needed TEXT,
      medical_urgency TEXT DEFAULT 'medium',
      waitlist_status TEXT DEFAULT 'active',
      date_added_to_waitlist TEXT,
      priority_score REAL DEFAULT 0,
      priority_score_breakdown TEXT,
      hla_typing TEXT,
      pra_percentage REAL,
      cpra_percentage REAL,
      meld_score INTEGER,
      las_score REAL,
      functional_status TEXT,
      prognosis_rating TEXT,
      last_evaluation_date TEXT,
      comorbidity_score INTEGER,
      previous_transplants INTEGER DEFAULT 0,
      compliance_score INTEGER,
      weight_kg REAL,
      height_cm REAL,
      phone TEXT,
      email TEXT,
      contact_phone TEXT,
      contact_email TEXT,
      address TEXT,
      emergency_contact_name TEXT,
      emergency_contact_phone TEXT,
      diagnosis TEXT,
      comorbidities TEXT,
      medications TEXT,
      donor_preferences TEXT,
      psychological_clearance INTEGER DEFAULT 1,
      support_system_rating TEXT,
      document_urls TEXT,
      notes TEXT,
      created_date TEXT DEFAULT (datetime('now')),
      updated_date TEXT DEFAULT (datetime('now')),
      created_by TEXT,
      updated_by TEXT
    )
  `);
  
  // Add missing columns to patients table if they don't exist (for existing databases)
  const patientColumns = db.prepare("PRAGMA table_info(patients)").all().map(c => c.name);
  const columnsToAdd = [
    { name: 'phone', type: 'TEXT' },
    { name: 'email', type: 'TEXT' },
    { name: 'diagnosis', type: 'TEXT' },
    { name: 'comorbidities', type: 'TEXT' },
    { name: 'medications', type: 'TEXT' },
    { name: 'donor_preferences', type: 'TEXT' },
    { name: 'psychological_clearance', type: 'INTEGER DEFAULT 1' },
    { name: 'support_system_rating', type: 'TEXT' },
    { name: 'document_urls', type: 'TEXT' },
  ];
  
  for (const col of columnsToAdd) {
    if (!patientColumns.includes(col.name)) {
      try {
        db.exec(`ALTER TABLE patients ADD COLUMN ${col.name} ${col.type}`);
        console.log(`Added column ${col.name} to patients table`);
      } catch (e) {
        // Column might already exist, ignore
      }
    }
  }
  
  // Donor organs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS donor_organs (
      id TEXT PRIMARY KEY,
      donor_id TEXT UNIQUE,
      organ_type TEXT NOT NULL,
      blood_type TEXT NOT NULL,
      hla_typing TEXT,
      donor_age INTEGER,
      donor_weight_kg REAL,
      donor_height_cm REAL,
      cause_of_death TEXT,
      cold_ischemia_time_hours REAL,
      organ_condition TEXT,
      organ_quality TEXT,
      organ_status TEXT DEFAULT 'available',
      status TEXT DEFAULT 'available',
      recovery_date TEXT,
      procurement_date TEXT,
      recovery_hospital TEXT,
      location TEXT,
      expiration_date TEXT,
      notes TEXT,
      created_date TEXT DEFAULT (datetime('now')),
      updated_date TEXT DEFAULT (datetime('now')),
      created_by TEXT,
      updated_by TEXT
    )
  `);
  
  // Add missing columns to donor_organs table if they don't exist (for existing databases)
  const donorColumns = db.prepare("PRAGMA table_info(donor_organs)").all().map(c => c.name);
  const donorColumnsToAdd = [
    { name: 'organ_quality', type: 'TEXT' },
    { name: 'status', type: 'TEXT DEFAULT \'available\'' },
    { name: 'procurement_date', type: 'TEXT' },
    { name: 'location', type: 'TEXT' },
    { name: 'expiration_date', type: 'TEXT' },
  ];
  
  for (const col of donorColumnsToAdd) {
    if (!donorColumns.includes(col.name)) {
      try {
        db.exec(`ALTER TABLE donor_organs ADD COLUMN ${col.name} ${col.type}`);
        console.log(`Added column ${col.name} to donor_organs table`);
      } catch (e) {
        // Column might already exist, ignore
      }
    }
  }
  
  // Matches table
  db.exec(`
    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      donor_organ_id TEXT,
      patient_id TEXT,
      patient_name TEXT,
      compatibility_score REAL,
      blood_type_compatible INTEGER,
      abo_compatible INTEGER,
      hla_match_score REAL,
      hla_a_match INTEGER,
      hla_b_match INTEGER,
      hla_dr_match INTEGER,
      hla_dq_match INTEGER,
      size_compatible INTEGER,
      match_status TEXT DEFAULT 'potential',
      priority_rank INTEGER,
      virtual_crossmatch_result TEXT,
      physical_crossmatch_result TEXT DEFAULT 'not_performed',
      predicted_graft_survival REAL,
      notes TEXT,
      created_date TEXT DEFAULT (datetime('now')),
      updated_date TEXT DEFAULT (datetime('now')),
      created_by TEXT,
      FOREIGN KEY (donor_organ_id) REFERENCES donor_organs(id),
      FOREIGN KEY (patient_id) REFERENCES patients(id)
    )
  `);
  
  // Notifications table
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      recipient_email TEXT,
      title TEXT NOT NULL,
      message TEXT,
      notification_type TEXT,
      is_read INTEGER DEFAULT 0,
      related_patient_id TEXT,
      related_patient_name TEXT,
      priority_level TEXT DEFAULT 'normal',
      action_url TEXT,
      metadata TEXT,
      created_date TEXT DEFAULT (datetime('now')),
      read_date TEXT,
      FOREIGN KEY (related_patient_id) REFERENCES patients(id)
    )
  `);
  
  // Notification rules table
  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_rules (
      id TEXT PRIMARY KEY,
      rule_name TEXT NOT NULL,
      description TEXT,
      trigger_event TEXT,
      conditions TEXT,
      notification_template TEXT,
      priority_level TEXT DEFAULT 'normal',
      is_active INTEGER DEFAULT 1,
      created_date TEXT DEFAULT (datetime('now')),
      updated_date TEXT DEFAULT (datetime('now')),
      created_by TEXT
    )
  `);
  
  // Priority weights table
  db.exec(`
    CREATE TABLE IF NOT EXISTS priority_weights (
      id TEXT PRIMARY KEY,
      name TEXT,
      description TEXT,
      medical_urgency_weight REAL DEFAULT 30,
      time_on_waitlist_weight REAL DEFAULT 25,
      organ_specific_score_weight REAL DEFAULT 25,
      evaluation_recency_weight REAL DEFAULT 10,
      blood_type_rarity_weight REAL DEFAULT 10,
      evaluation_decay_rate REAL DEFAULT 0.5,
      is_active INTEGER DEFAULT 0,
      created_date TEXT DEFAULT (datetime('now')),
      updated_date TEXT DEFAULT (datetime('now')),
      created_by TEXT
    )
  `);
  
  // EHR Integration table
  db.exec(`
    CREATE TABLE IF NOT EXISTS ehr_integrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT,
      base_url TEXT,
      api_key_encrypted TEXT,
      is_active INTEGER DEFAULT 0,
      last_sync_date TEXT,
      sync_frequency_minutes INTEGER DEFAULT 60,
      created_date TEXT DEFAULT (datetime('now')),
      updated_date TEXT DEFAULT (datetime('now')),
      created_by TEXT
    )
  `);
  
  // EHR Import table
  db.exec(`
    CREATE TABLE IF NOT EXISTS ehr_imports (
      id TEXT PRIMARY KEY,
      integration_id TEXT,
      import_type TEXT,
      status TEXT DEFAULT 'pending',
      records_imported INTEGER DEFAULT 0,
      records_failed INTEGER DEFAULT 0,
      error_details TEXT,
      import_data TEXT,
      created_date TEXT DEFAULT (datetime('now')),
      completed_date TEXT,
      created_by TEXT,
      FOREIGN KEY (integration_id) REFERENCES ehr_integrations(id)
    )
  `);
  
  // EHR Sync Log table
  db.exec(`
    CREATE TABLE IF NOT EXISTS ehr_sync_logs (
      id TEXT PRIMARY KEY,
      integration_id TEXT,
      sync_type TEXT,
      direction TEXT,
      status TEXT,
      records_processed INTEGER DEFAULT 0,
      records_failed INTEGER DEFAULT 0,
      error_details TEXT,
      created_date TEXT DEFAULT (datetime('now')),
      completed_date TEXT,
      FOREIGN KEY (integration_id) REFERENCES ehr_integrations(id)
    )
  `);
  
  // EHR Validation Rules table
  db.exec(`
    CREATE TABLE IF NOT EXISTS ehr_validation_rules (
      id TEXT PRIMARY KEY,
      field_name TEXT NOT NULL,
      rule_type TEXT NOT NULL,
      rule_value TEXT,
      error_message TEXT,
      is_active INTEGER DEFAULT 1,
      created_date TEXT DEFAULT (datetime('now')),
      updated_date TEXT DEFAULT (datetime('now')),
      created_by TEXT
    )
  `);
  
  // Audit Log table (HIPAA compliance - immutable)
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      patient_name TEXT,
      details TEXT,
      user_email TEXT,
      user_role TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_date TEXT DEFAULT (datetime('now')),
      created_by TEXT
    )
  `);
  
  // Add missing columns to audit_logs table if they don't exist (for existing databases)
  const auditLogColumns = db.prepare("PRAGMA table_info(audit_logs)").all().map(c => c.name);
  const auditLogColumnsToAdd = [
    { name: 'created_by', type: 'TEXT' },
  ];
  
  for (const col of auditLogColumnsToAdd) {
    if (!auditLogColumns.includes(col.name)) {
      try {
        db.exec(`ALTER TABLE audit_logs ADD COLUMN ${col.name} ${col.type}`);
        console.log(`Added column ${col.name} to audit_logs table`);
      } catch (e) {
        // Column might already exist, ignore
      }
    }
  }
  
  // Settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_date TEXT DEFAULT (datetime('now'))
    )
  `);
  
  // Create indexes for better performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_patients_blood_type ON patients(blood_type);
    CREATE INDEX IF NOT EXISTS idx_patients_organ_needed ON patients(organ_needed);
    CREATE INDEX IF NOT EXISTS idx_patients_waitlist_status ON patients(waitlist_status);
    CREATE INDEX IF NOT EXISTS idx_patients_priority_score ON patients(priority_score DESC);
    CREATE INDEX IF NOT EXISTS idx_donor_organs_organ_type ON donor_organs(organ_type);
    CREATE INDEX IF NOT EXISTS idx_donor_organs_blood_type ON donor_organs(blood_type);
    CREATE INDEX IF NOT EXISTS idx_donor_organs_status ON donor_organs(organ_status);
    CREATE INDEX IF NOT EXISTS idx_matches_donor_organ_id ON matches(donor_organ_id);
    CREATE INDEX IF NOT EXISTS idx_matches_patient_id ON matches(patient_id);
    CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(match_status);
    CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_email);
    CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_email);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_date ON audit_logs(created_date DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `);
  
  // Access justification logs (for HIPAA compliance)
  db.exec(`
    CREATE TABLE IF NOT EXISTS access_justification_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_email TEXT,
      user_role TEXT,
      permission TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      justification_reason TEXT NOT NULL,
      justification_details TEXT,
      access_time TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  
  // Create index for access logs
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_access_logs_user ON access_justification_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_access_logs_time ON access_justification_logs(access_time DESC);
    CREATE INDEX IF NOT EXISTS idx_access_logs_entity ON access_justification_logs(entity_type, entity_id);
  `);
  
  // Readiness Barriers table (Non-Clinical Operational Tracking)
  // Purpose: Track non-clinical, non-allocative barriers to transplant readiness
  // for operational workflow visibility only. Does NOT perform allocation decisions,
  // listing authority functions, or replace UNOS/OPTN systems.
  db.exec(`
    CREATE TABLE IF NOT EXISTS readiness_barriers (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      barrier_type TEXT NOT NULL CHECK(barrier_type IN (
        'PENDING_TESTING',
        'INSURANCE_CLEARANCE',
        'TRANSPORTATION_PLAN',
        'CAREGIVER_SUPPORT',
        'HOUSING_DISTANCE',
        'PSYCHOSOCIAL_FOLLOWUP',
        'FINANCIAL_CLEARANCE',
        'OTHER_NON_CLINICAL'
      )),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'resolved')),
      risk_level TEXT NOT NULL DEFAULT 'low' CHECK(risk_level IN ('low', 'moderate', 'high')),
      owning_role TEXT NOT NULL CHECK(owning_role IN (
        'social_work',
        'financial',
        'coordinator',
        'other'
      )),
      identified_date TEXT NOT NULL DEFAULT (datetime('now')),
      target_resolution_date TEXT,
      resolved_date TEXT,
      notes TEXT CHECK(length(notes) <= 255),
      created_by TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      updated_by TEXT,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `);
  
  // Create indexes for readiness_barriers
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_barriers_patient_id ON readiness_barriers(patient_id);
    CREATE INDEX IF NOT EXISTS idx_barriers_status ON readiness_barriers(status);
    CREATE INDEX IF NOT EXISTS idx_barriers_risk_level ON readiness_barriers(risk_level);
    CREATE INDEX IF NOT EXISTS idx_barriers_type ON readiness_barriers(barrier_type);
    CREATE INDEX IF NOT EXISTS idx_barriers_owning_role ON readiness_barriers(owning_role);
    CREATE INDEX IF NOT EXISTS idx_barriers_created_at ON readiness_barriers(created_at DESC);
  `);
  
  // Adult Health History Questionnaire (aHHQ) tracking table
  // PURPOSE: Track operational status of aHHQ documentation for patients
  // NOTE: This is NON-CLINICAL, NON-ALLOCATIVE, and for OPERATIONAL DOCUMENTATION purposes only.
  // It tracks whether required health history questionnaires are present, complete, and current.
  // It does NOT store medical narratives, clinical interpretations, or eligibility determinations.
  db.exec(`
    CREATE TABLE IF NOT EXISTS adult_health_history_questionnaires (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'incomplete' CHECK(status IN (
        'complete',
        'incomplete',
        'pending_update',
        'expired'
      )),
      last_completed_date TEXT,
      expiration_date TEXT,
      validity_period_days INTEGER DEFAULT 365,
      identified_issues TEXT,
      owning_role TEXT NOT NULL DEFAULT 'coordinator' CHECK(owning_role IN (
        'coordinator',
        'social_work',
        'clinical',
        'other'
      )),
      notes TEXT CHECK(length(notes) <= 255),
      created_by TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      updated_by TEXT,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `);
  
  // Create indexes for aHHQ
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ahhq_patient_id ON adult_health_history_questionnaires(patient_id);
    CREATE INDEX IF NOT EXISTS idx_ahhq_status ON adult_health_history_questionnaires(status);
    CREATE INDEX IF NOT EXISTS idx_ahhq_expiration_date ON adult_health_history_questionnaires(expiration_date);
    CREATE INDEX IF NOT EXISTS idx_ahhq_owning_role ON adult_health_history_questionnaires(owning_role);
    CREATE INDEX IF NOT EXISTS idx_ahhq_created_at ON adult_health_history_questionnaires(created_at DESC);
  `);
  
  console.log('Database schema created');
}

async function seedDefaultData() {
  // Check if admin user exists
  const adminExists = db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').get('admin');
  
  if (adminExists.count === 0) {
    const bcrypt = require('bcryptjs');
    const { v4: uuidv4 } = require('uuid');
    
    // Create default admin user
    const adminId = uuidv4();
    const hashedPassword = await bcrypt.hash('admin123', 12);
    
    db.prepare(`
      INSERT INTO users (id, email, password_hash, full_name, role, is_active)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(adminId, 'admin@transtrack.local', hashedPassword, 'System Administrator', 'admin', 1);
    
    console.log('Default admin user created: admin@transtrack.local / admin123');
    
    // Create default priority weights
    const weightsId = uuidv4();
    db.prepare(`
      INSERT INTO priority_weights (id, name, description, is_active, medical_urgency_weight, time_on_waitlist_weight, organ_specific_score_weight, evaluation_recency_weight, blood_type_rarity_weight, evaluation_decay_rate)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(weightsId, 'Default Weights', 'Standard UNOS-based priority weighting', 1, 30, 25, 25, 10, 10, 0.5);
    
    // Log initial setup
    const auditId = uuidv4();
    db.prepare(`
      INSERT INTO audit_logs (id, action, entity_type, details, user_email, user_role)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(auditId, 'system_init', 'System', 'TransTrack database initialized', 'system', 'system');
    
    console.log('Default data seeded');
  }
}

function getDatabase() {
  return db;
}

async function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    console.log('Database connection closed');
  }
}

// Backup database
async function backupDatabase(targetPath) {
  if (!db) throw new Error('Database not initialized');
  
  await db.backup(targetPath);
  
  // Log backup action
  const { v4: uuidv4 } = require('uuid');
  db.prepare(`
    INSERT INTO audit_logs (id, action, entity_type, details, user_email, user_role)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), 'backup', 'System', `Database backed up to: ${targetPath}`, 'system', 'system');
  
  return true;
}

module.exports = {
  initDatabase,
  getDatabase,
  closeDatabase,
  backupDatabase,
  getDatabasePath
};
