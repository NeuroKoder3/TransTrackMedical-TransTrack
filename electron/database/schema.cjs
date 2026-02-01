/**
 * TransTrack - Database Schema Definition
 * 
 * Multi-Organization Architecture:
 * - Every entity belongs to an organization (org_id)
 * - Hard org isolation at query level
 * - License bound to organization, not machine
 * 
 * HIPAA Compliance:
 * - All PHI is org-scoped
 * - Audit logs are immutable and org-scoped
 * - Access justification logs for sensitive operations
 */

/**
 * Create all database tables with org isolation
 */
function createSchema(db) {
  // =========================================================================
  // ORGANIZATIONS TABLE (First-Class Entity)
  // =========================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'TRANSPLANT_CENTER' CHECK(type IN (
        'TRANSPLANT_CENTER',
        'OPO',
        'TISSUE_BANK',
        'HOSPITAL',
        'CLINIC'
      )),
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'SUSPENDED', 'INACTIVE')),
      address TEXT,
      phone TEXT,
      email TEXT,
      settings TEXT, -- JSON: org-specific settings
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // =========================================================================
  // LICENSES TABLE (Bound to Organization)
  // =========================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS licenses (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      license_key TEXT UNIQUE,
      tier TEXT NOT NULL DEFAULT 'EVALUATION' CHECK(tier IN (
        'EVALUATION',
        'STARTER',
        'PROFESSIONAL',
        'ENTERPRISE'
      )),
      allowed_installations INTEGER DEFAULT 1,
      max_patients INTEGER DEFAULT 50,
      max_users INTEGER DEFAULT 1,
      enabled_features TEXT, -- JSON array of enabled features
      issued_at TEXT DEFAULT (datetime('now')),
      activated_at TEXT,
      maintenance_expires_at TEXT,
      license_expires_at TEXT,
      customer_name TEXT,
      customer_email TEXT,
      machine_id TEXT,
      activation_history TEXT, -- JSON array of activation events
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
    )
  `);

  // =========================================================================
  // USERS TABLE (Org-Scoped)
  // =========================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT,
      role TEXT DEFAULT 'user' CHECK(role IN (
        'admin',
        'coordinator', 
        'physician',
        'user',
        'viewer',
        'regulator'
      )),
      is_active INTEGER DEFAULT 1,
      must_change_password INTEGER DEFAULT 0,
      failed_login_attempts INTEGER DEFAULT 0,
      locked_until TEXT,
      last_login TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
      UNIQUE(org_id, email)
    )
  `);

  // =========================================================================
  // SESSIONS TABLE (Org-Scoped)
  // =========================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
    )
  `);

  // =========================================================================
  // LOGIN ATTEMPTS TABLE (Security - Persisted across restarts)
  // =========================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      attempt_count INTEGER DEFAULT 1,
      last_attempt_at TEXT NOT NULL,
      locked_until TEXT,
      ip_address TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  
  // Index for efficient lockout checks
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email);
    CREATE INDEX IF NOT EXISTS idx_login_attempts_locked ON login_attempts(locked_until);
  `);

  // =========================================================================
  // PATIENTS TABLE (Org-Scoped)
  // =========================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      patient_id TEXT,
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
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      created_by TEXT,
      updated_by TEXT,
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
      UNIQUE(org_id, patient_id)
    )
  `);

  // =========================================================================
  // DONOR ORGANS TABLE (Org-Scoped)
  // =========================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS donor_organs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      donor_id TEXT,
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
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      created_by TEXT,
      updated_by TEXT,
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
      UNIQUE(org_id, donor_id)
    )
  `);

  // =========================================================================
  // MATCHES TABLE (Org-Scoped)
  // =========================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
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
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      created_by TEXT,
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (donor_organ_id) REFERENCES donor_organs(id),
      FOREIGN KEY (patient_id) REFERENCES patients(id)
    )
  `);

  // =========================================================================
  // NOTIFICATIONS TABLE (Org-Scoped)
  // =========================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
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
      created_at TEXT DEFAULT (datetime('now')),
      read_date TEXT,
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (related_patient_id) REFERENCES patients(id)
    )
  `);

  // =========================================================================
  // NOTIFICATION RULES TABLE (Org-Scoped)
  // =========================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_rules (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      rule_name TEXT NOT NULL,
      description TEXT,
      trigger_event TEXT,
      conditions TEXT,
      notification_template TEXT,
      priority_level TEXT DEFAULT 'normal',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      created_by TEXT,
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
    )
  `);

  // =========================================================================
  // PRIORITY WEIGHTS TABLE (Org-Scoped)
  // =========================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS priority_weights (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT,
      description TEXT,
      medical_urgency_weight REAL DEFAULT 30,
      time_on_waitlist_weight REAL DEFAULT 25,
      organ_specific_score_weight REAL DEFAULT 25,
      evaluation_recency_weight REAL DEFAULT 10,
      blood_type_rarity_weight REAL DEFAULT 10,
      evaluation_decay_rate REAL DEFAULT 0.5,
      is_active INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      created_by TEXT,
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
    )
  `);

  // =========================================================================
  // EHR INTEGRATIONS TABLE (Org-Scoped)
  // =========================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS ehr_integrations (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT,
      base_url TEXT,
      api_key_encrypted TEXT,
      is_active INTEGER DEFAULT 0,
      last_sync_date TEXT,
      sync_frequency_minutes INTEGER DEFAULT 60,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      created_by TEXT,
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
    )
  `);

  // =========================================================================
  // EHR IMPORTS TABLE (Org-Scoped)
  // =========================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS ehr_imports (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      integration_id TEXT,
      import_type TEXT,
      status TEXT DEFAULT 'pending',
      records_imported INTEGER DEFAULT 0,
      records_failed INTEGER DEFAULT 0,
      error_details TEXT,
      import_data TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      completed_date TEXT,
      created_by TEXT,
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (integration_id) REFERENCES ehr_integrations(id)
    )
  `);

  // =========================================================================
  // EHR SYNC LOGS TABLE (Org-Scoped)
  // =========================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS ehr_sync_logs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      integration_id TEXT,
      sync_type TEXT,
      direction TEXT,
      status TEXT,
      records_processed INTEGER DEFAULT 0,
      records_failed INTEGER DEFAULT 0,
      error_details TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      completed_date TEXT,
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (integration_id) REFERENCES ehr_integrations(id)
    )
  `);

  // =========================================================================
  // EHR VALIDATION RULES TABLE (Org-Scoped)
  // =========================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS ehr_validation_rules (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      field_name TEXT NOT NULL,
      rule_type TEXT NOT NULL,
      rule_value TEXT,
      error_message TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      created_by TEXT,
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
    )
  `);

  // =========================================================================
  // AUDIT LOGS TABLE (Org-Scoped, Immutable)
  // =========================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
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
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (org_id) REFERENCES organizations(id)
    )
  `);

  // =========================================================================
  // SETTINGS TABLE (Org-Scoped)
  // =========================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
      UNIQUE(org_id, key)
    )
  `);

  // =========================================================================
  // ACCESS JUSTIFICATION LOGS (Org-Scoped, Immutable)
  // =========================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS access_justification_logs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_email TEXT,
      user_role TEXT,
      permission TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      justification_reason TEXT NOT NULL,
      justification_details TEXT,
      access_time TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (org_id) REFERENCES organizations(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // =========================================================================
  // READINESS BARRIERS TABLE (Org-Scoped)
  // =========================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS readiness_barriers (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
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
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `);

  // =========================================================================
  // ADULT HEALTH HISTORY QUESTIONNAIRES TABLE (Org-Scoped)
  // =========================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS adult_health_history_questionnaires (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
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
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `);

  // =========================================================================
  // LAB RESULTS TABLE (Org-Scoped)
  // =========================================================================
  // NOTE: This feature is strictly NON-CLINICAL and NON-ALLOCATIVE.
  // Lab results are stored for OPERATIONAL documentation purposes only.
  // The system does NOT interpret lab values, provide clinical recommendations,
  // or make allocation-related decisions. It only tracks lab currency/completeness.
  // Values are stored as strings to prevent any clinical interpretation.
  db.exec(`
    CREATE TABLE IF NOT EXISTS lab_results (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      
      -- Lab identification
      test_code TEXT NOT NULL,
      test_name TEXT NOT NULL,
      
      -- Result data (stored as strings to prevent clinical interpretation)
      value TEXT NOT NULL,
      units TEXT,
      reference_range TEXT,
      
      -- Timestamps
      collected_at TEXT NOT NULL,
      resulted_at TEXT,
      
      -- Source tracking (for audit purposes)
      source TEXT NOT NULL DEFAULT 'MANUAL' CHECK(source IN ('MANUAL', 'FHIR_IMPORT')),
      ordering_service TEXT,
      
      -- Audit fields
      entered_by TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      updated_by TEXT,
      
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (entered_by) REFERENCES users(id)
    )
  `);

  // =========================================================================
  // REQUIRED LAB TYPES TABLE (Org-Scoped Configuration)
  // =========================================================================
  // Defines which labs are required for operational readiness tracking.
  // This is purely for documentation completeness, not clinical requirements.
  db.exec(`
    CREATE TABLE IF NOT EXISTS required_lab_types (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      
      -- Lab type definition
      test_code TEXT NOT NULL,
      test_name TEXT NOT NULL,
      
      -- Applicability
      organ_type TEXT,
      
      -- Currency requirements (for operational tracking only)
      max_age_days INTEGER DEFAULT 30,
      
      -- Configuration
      is_active INTEGER DEFAULT 1,
      
      -- Audit fields
      created_by TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      updated_by TEXT,
      
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id),
      UNIQUE(org_id, test_code)
    )
  `);

  // NOTE: Indexes are created AFTER migration in init.cjs, not here
  // This is because existing databases may not have org_id columns yet
}

/**
 * Create all database indexes for performance and org isolation
 */
function createIndexes(db) {
  db.exec(`
    -- Organization indexes
    CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations(status);
    
    -- License indexes
    CREATE INDEX IF NOT EXISTS idx_licenses_org_id ON licenses(org_id);
    CREATE INDEX IF NOT EXISTS idx_licenses_tier ON licenses(tier);
    
    -- User indexes (org-scoped)
    CREATE INDEX IF NOT EXISTS idx_users_org_id ON users(org_id);
    CREATE INDEX IF NOT EXISTS idx_users_org_email ON users(org_id, email);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    
    -- Session indexes (org-scoped)
    CREATE INDEX IF NOT EXISTS idx_sessions_org_id ON sessions(org_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    
    -- Patient indexes (org-scoped)
    CREATE INDEX IF NOT EXISTS idx_patients_org_id ON patients(org_id);
    CREATE INDEX IF NOT EXISTS idx_patients_org_patient_id ON patients(org_id, patient_id);
    CREATE INDEX IF NOT EXISTS idx_patients_blood_type ON patients(org_id, blood_type);
    CREATE INDEX IF NOT EXISTS idx_patients_organ_needed ON patients(org_id, organ_needed);
    CREATE INDEX IF NOT EXISTS idx_patients_waitlist_status ON patients(org_id, waitlist_status);
    CREATE INDEX IF NOT EXISTS idx_patients_priority_score ON patients(org_id, priority_score DESC);
    
    -- Donor organ indexes (org-scoped)
    CREATE INDEX IF NOT EXISTS idx_donor_organs_org_id ON donor_organs(org_id);
    CREATE INDEX IF NOT EXISTS idx_donor_organs_org_donor_id ON donor_organs(org_id, donor_id);
    CREATE INDEX IF NOT EXISTS idx_donor_organs_organ_type ON donor_organs(org_id, organ_type);
    CREATE INDEX IF NOT EXISTS idx_donor_organs_blood_type ON donor_organs(org_id, blood_type);
    CREATE INDEX IF NOT EXISTS idx_donor_organs_status ON donor_organs(org_id, organ_status);
    
    -- Match indexes (org-scoped)
    CREATE INDEX IF NOT EXISTS idx_matches_org_id ON matches(org_id);
    CREATE INDEX IF NOT EXISTS idx_matches_donor_organ_id ON matches(donor_organ_id);
    CREATE INDEX IF NOT EXISTS idx_matches_patient_id ON matches(patient_id);
    CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(org_id, match_status);
    
    -- Notification indexes (org-scoped)
    CREATE INDEX IF NOT EXISTS idx_notifications_org_id ON notifications(org_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(org_id, recipient_email);
    CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(org_id, is_read);
    
    -- Audit log indexes (org-scoped)
    CREATE INDEX IF NOT EXISTS idx_audit_logs_org_id ON audit_logs(org_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(org_id, entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(org_id, user_email);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_date ON audit_logs(org_id, created_at DESC);
    
    -- Settings indexes (org-scoped)
    CREATE INDEX IF NOT EXISTS idx_settings_org_key ON settings(org_id, key);
    
    -- Access justification indexes (org-scoped)
    CREATE INDEX IF NOT EXISTS idx_access_logs_org_id ON access_justification_logs(org_id);
    CREATE INDEX IF NOT EXISTS idx_access_logs_user ON access_justification_logs(org_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_access_logs_time ON access_justification_logs(org_id, access_time DESC);
    
    -- Readiness barriers indexes (org-scoped)
    CREATE INDEX IF NOT EXISTS idx_barriers_org_id ON readiness_barriers(org_id);
    CREATE INDEX IF NOT EXISTS idx_barriers_patient_id ON readiness_barriers(org_id, patient_id);
    CREATE INDEX IF NOT EXISTS idx_barriers_status ON readiness_barriers(org_id, status);
    CREATE INDEX IF NOT EXISTS idx_barriers_risk_level ON readiness_barriers(org_id, risk_level);
    
    -- aHHQ indexes (org-scoped)
    CREATE INDEX IF NOT EXISTS idx_ahhq_org_id ON adult_health_history_questionnaires(org_id);
    CREATE INDEX IF NOT EXISTS idx_ahhq_patient_id ON adult_health_history_questionnaires(org_id, patient_id);
    CREATE INDEX IF NOT EXISTS idx_ahhq_status ON adult_health_history_questionnaires(org_id, status);
    CREATE INDEX IF NOT EXISTS idx_ahhq_expiration ON adult_health_history_questionnaires(org_id, expiration_date);
    
    -- Lab results indexes (org-scoped)
    CREATE INDEX IF NOT EXISTS idx_lab_results_org_id ON lab_results(org_id);
    CREATE INDEX IF NOT EXISTS idx_lab_results_patient_id ON lab_results(org_id, patient_id);
    CREATE INDEX IF NOT EXISTS idx_lab_results_test_code ON lab_results(org_id, test_code);
    CREATE INDEX IF NOT EXISTS idx_lab_results_collected ON lab_results(org_id, collected_at DESC);
    CREATE INDEX IF NOT EXISTS idx_lab_results_patient_test ON lab_results(org_id, patient_id, test_code, collected_at DESC);
    
    -- Required lab types indexes (org-scoped)
    CREATE INDEX IF NOT EXISTS idx_required_labs_org_id ON required_lab_types(org_id);
    CREATE INDEX IF NOT EXISTS idx_required_labs_organ ON required_lab_types(org_id, organ_type);
  `);
}

/**
 * Migrate existing database to org-scoped schema
 * This handles databases created before multi-org support
 */
function migrateToOrgSchema(db) {
  // Check if organizations table exists
  const orgTableExists = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='organizations'
  `).get();

  if (!orgTableExists) {
    // Need full migration
    return true;
  }

  // Check if existing tables need org_id column
  const usersColumns = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!usersColumns.includes('org_id')) {
    return true;
  }

  return false;
}

/**
 * Add org_id to existing tables during migration
 */
function addOrgIdToExistingTables(db, defaultOrgId) {
  const tablesToMigrate = [
    'users', 'patients', 'donor_organs', 'matches', 'notifications',
    'notification_rules', 'priority_weights', 'ehr_integrations', 'ehr_imports',
    'ehr_sync_logs', 'ehr_validation_rules', 'audit_logs', 'access_justification_logs',
    'readiness_barriers', 'adult_health_history_questionnaires', 'lab_results', 'required_lab_types'
  ];

  for (const table of tablesToMigrate) {
    try {
      // Check if table exists
      const tableExists = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name=?
      `).get(table);

      if (!tableExists) continue;

      // Check if org_id column exists
      const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
      
      if (!columns.includes('org_id')) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN org_id TEXT`);
        db.exec(`UPDATE ${table} SET org_id = '${defaultOrgId}' WHERE org_id IS NULL`);
      }
    } catch (e) {
      // Column might already exist or table doesn't exist
    }
  }
}

module.exports = {
  createSchema,
  createIndexes,
  migrateToOrgSchema,
  addOrgIdToExistingTables,
};
