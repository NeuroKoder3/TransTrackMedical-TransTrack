/**
 * TransTrack - Database Initialization
 * 
 * Multi-Organization Architecture:
 * - Every entity belongs to an organization (org_id)
 * - License bound to organization, not machine
 * - Hard org isolation at query level
 * 
 * Uses better-sqlite3-multiple-ciphers with SQLCipher for encrypted local storage.
 * HIPAA compliant with AES-256 encryption at rest.
 * 
 * Encryption Details:
 * - Algorithm: AES-256-CBC (SQLCipher default)
 * - Key derivation: PBKDF2-HMAC-SHA512 with 256000 iterations
 * - Page size: 4096 bytes
 * - HMAC: SHA512 for page authentication
 */

const Database = require('better-sqlite3-multiple-ciphers');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { app, safeStorage } = require('electron');
const { createSchema, createIndexes, createAuditLogTriggers, addOrgIdToExistingTables } = require('./schema.cjs');
const { runMigrations } = require('./migrations.cjs');

let db = null;
let encryptionEnabled = false;

// =========================================================================
// DATABASE FILE PATHS
// =========================================================================

function getDatabasePath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'transtrack.db');
}

function getUnencryptedDatabasePath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'transtrack-unencrypted.db.bak');
}

function getKeyPath() {
  return path.join(app.getPath('userData'), '.transtrack-key');
}

function getKeyBackupPath() {
  return path.join(app.getPath('userData'), '.transtrack-key.backup');
}

// =========================================================================
// ENCRYPTION KEY MANAGEMENT
// =========================================================================

/**
 * Check whether Electron's OS-native safeStorage (DPAPI / Keychain / libsecret)
 * is available for encrypting secrets at rest.
 */
function isSafeStorageAvailable() {
  try {
    return safeStorage && typeof safeStorage.isEncryptionAvailable === 'function'
      && safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

/**
 * Write an encryption key to disk.
 * When safeStorage is available the key is encrypted via the OS keychain
 * before being written, so the on-disk file is an opaque binary blob.
 * Falls back to plaintext with restrictive permissions when safeStorage
 * is unavailable (e.g. headless Linux without a keyring daemon).
 */
function writeProtectedKey(filePath, plaintextKey) {
  if (isSafeStorageAvailable()) {
    const encrypted = safeStorage.encryptString(plaintextKey);
    fs.writeFileSync(filePath, encrypted, { mode: 0o600 });
  } else {
    fs.writeFileSync(filePath, plaintextKey, { mode: 0o600 });
  }
}

/**
 * Read an encryption key from disk, handling both safeStorage-encrypted
 * (binary) and legacy plaintext formats.  When a legacy plaintext key is
 * detected and safeStorage is now available, the file is transparently
 * migrated to the encrypted format.
 *
 * Returns the plaintext hex key string, or null if the file cannot be read
 * or does not contain a valid key.
 */
function readProtectedKey(filePath) {
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath);

  // Detect legacy plaintext format: the file is valid UTF-8 containing
  // exactly 64 hex characters (256-bit key).
  const asText = raw.toString('utf8').trim();
  if (/^[a-fA-F0-9]{64}$/.test(asText)) {
    // Migrate to safeStorage-encrypted format if possible
    if (isSafeStorageAvailable()) {
      writeProtectedKey(filePath, asText);
    }
    return asText;
  }

  // Assume safeStorage-encrypted binary blob
  if (isSafeStorageAvailable()) {
    try {
      const decrypted = safeStorage.decryptString(raw);
      if (/^[a-fA-F0-9]{64}$/.test(decrypted)) {
        return decrypted;
      }
    } catch {
      // Decryption failed — file may be corrupt or from a different OS user
    }
  }

  return null;
}

/**
 * Get or create the database encryption key (64-char hex / 256-bit).
 *
 * Storage strategy (in priority order):
 *   1. OS-native safeStorage (DPAPI on Windows, Keychain on macOS,
 *      libsecret on Linux) — key is encrypted before hitting disk.
 *   2. Plaintext file with 0o600 permissions (fallback when no keyring
 *      daemon is available).
 */
function getEncryptionKey() {
  const keyPath = getKeyPath();
  const keyBackupPath = getKeyBackupPath();

  // Try primary key file
  const key = readProtectedKey(keyPath);
  if (key) return key;

  // Primary missing or corrupt — try backup
  const backupKey = readProtectedKey(keyBackupPath);
  if (backupKey) {
    writeProtectedKey(keyPath, backupKey);
    return backupKey;
  }

  // No existing key — generate a new 256-bit key
  const newKey = crypto.randomBytes(32).toString('hex');
  writeProtectedKey(keyPath, newKey);
  writeProtectedKey(keyBackupPath, newKey);
  return newKey;
}

/**
 * Check if a database file is encrypted
 * SQLCipher databases start with different magic bytes than regular SQLite
 */
function isDatabaseEncrypted(dbPath) {
  if (!fs.existsSync(dbPath)) {
    return null; // Database doesn't exist
  }
  
  try {
    // Read first 16 bytes of the file
    const fd = fs.openSync(dbPath, 'r');
    const buffer = Buffer.alloc(16);
    fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);
    
    // SQLite3 magic header: "SQLite format 3\0"
    const sqliteMagic = Buffer.from('SQLite format 3\0');
    
    // If file starts with SQLite magic, it's unencrypted
    if (buffer.compare(sqliteMagic, 0, 16, 0, 16) === 0) {
      return false; // Unencrypted
    }
    
    // Otherwise, assume encrypted (or corrupted)
    return true;
  } catch (e) {
    return null; // Unable to determine
  }
}

// =========================================================================
// DATABASE MIGRATION (Unencrypted to Encrypted)
// =========================================================================

/**
 * Migrate an unencrypted database to encrypted format
 */
async function migrateToEncrypted(unencryptedPath, encryptedPath, encryptionKey) {
  if (process.env.NODE_ENV === 'development') {
    console.log('Migrating database to encrypted format...');
  }
  
  // Open unencrypted database
  const unencryptedDb = new Database(unencryptedPath, {
    verbose: null,
    readonly: true
  });
  
  // Create new encrypted database
  const encryptedDb = new Database(encryptedPath + '.new', {
    verbose: null
  });
  
  // Set encryption key using SQLCipher pragmas
  encryptedDb.pragma(`cipher = 'sqlcipher'`);
  encryptedDb.pragma(`legacy = 4`); // SQLCipher 4.x compatibility
  encryptedDb.pragma(`key = "x'${encryptionKey}'"`);
  
  // Copy schema and data
  try {
    // Get all table names
    const tables = unencryptedDb.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `).all();
    
    // Export and import each table
    for (const { name } of tables) {
      // Get table schema
      const tableInfo = unencryptedDb.prepare(`
        SELECT sql FROM sqlite_master WHERE type='table' AND name=?
      `).get(name);
      
      if (tableInfo && tableInfo.sql) {
        // Create table in encrypted database
        encryptedDb.exec(tableInfo.sql);
        
        // Copy data
        const rows = unencryptedDb.prepare(`SELECT * FROM "${name}"`).all();
        if (rows.length > 0) {
          const columns = Object.keys(rows[0]);
          const placeholders = columns.map(() => '?').join(', ');
          const insertStmt = encryptedDb.prepare(
            `INSERT INTO "${name}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`
          );
          
          const insertMany = encryptedDb.transaction((rows) => {
            for (const row of rows) {
              insertStmt.run(...columns.map(c => row[c]));
            }
          });
          
          insertMany(rows);
        }
      }
    }
    
    // Copy indexes
    const indexes = unencryptedDb.prepare(`
      SELECT sql FROM sqlite_master 
      WHERE type='index' AND sql IS NOT NULL
    `).all();
    
    for (const { sql } of indexes) {
      try {
        encryptedDb.exec(sql);
      } catch (e) {
        // Index might already exist, ignore
      }
    }
    
    // Close databases
    unencryptedDb.close();
    encryptedDb.close();
    
    // Backup original unencrypted database
    const backupPath = getUnencryptedDatabasePath();
    fs.renameSync(unencryptedPath, backupPath);
    
    // Move new encrypted database to final location
    fs.renameSync(encryptedPath + '.new', encryptedPath);
    
    if (process.env.NODE_ENV === 'development') {
      console.log('Database migration to encrypted format completed successfully');
    }
    
    return true;
  } catch (error) {
    // Clean up on failure
    try { unencryptedDb.close(); } catch (e) {}
    try { encryptedDb.close(); } catch (e) {}
    try { fs.unlinkSync(encryptedPath + '.new'); } catch (e) {}
    
    throw new Error(`Database migration failed: ${error.message}`);
  }
}

// =========================================================================
// ORGANIZATION MANAGEMENT
// =========================================================================

/**
 * Generate a unique organization ID
 */
function generateOrgId() {
  return 'ORG-' + crypto.randomBytes(12).toString('hex').toUpperCase();
}

/**
 * Get the default organization ID (creates if needed)
 */
function getDefaultOrganization() {
  const org = db.prepare('SELECT * FROM organizations WHERE status = ? LIMIT 1').get('ACTIVE');
  if (org) {
    return org;
  }
  return null;
}

/**
 * Create the default organization for single-tenant installations
 * or migration from pre-org database
 */
function createDefaultOrganization() {
  const { v4: uuidv4 } = require('uuid');
  
  const orgId = generateOrgId();
  const now = new Date().toISOString();
  
  db.prepare(`
    INSERT INTO organizations (id, name, type, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    orgId,
    'Default Organization',
    'TRANSPLANT_CENTER',
    'ACTIVE',
    now,
    now
  );
  
  // Create an evaluation license for this org
  const licenseId = uuidv4();
  db.prepare(`
    INSERT INTO licenses (id, org_id, tier, max_patients, max_users, issued_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    licenseId,
    orgId,
    'EVALUATION',
    50, // Evaluation limit
    1,  // Single user
    now,
    now,
    now
  );
  
  return { id: orgId, name: 'Default Organization', type: 'TRANSPLANT_CENTER', status: 'ACTIVE' };
}

// =========================================================================
// LICENSE MANAGEMENT (Database-backed)
// =========================================================================

/**
 * Get license for an organization
 */
function getOrgLicense(orgId) {
  return db.prepare(`
    SELECT * FROM licenses WHERE org_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(orgId);
}

/**
 * Check if organization has valid license
 */
function hasValidLicense(orgId) {
  const license = getOrgLicense(orgId);
  if (!license) return false;
  
  // Check expiration
  if (license.license_expires_at) {
    const expiry = new Date(license.license_expires_at);
    if (expiry < new Date()) {
      return false;
    }
  }
  
  return true;
}

/**
 * Get patient count for limit enforcement
 */
function getPatientCount(orgId) {
  const result = db.prepare('SELECT COUNT(*) as count FROM patients WHERE org_id = ?').get(orgId);
  return result ? result.count : 0;
}

/**
 * Get user count for limit enforcement
 */
function getUserCount(orgId) {
  const result = db.prepare('SELECT COUNT(*) as count FROM users WHERE org_id = ? AND is_active = 1').get(orgId);
  return result ? result.count : 0;
}

// =========================================================================
// SCHEMA MIGRATION (Pre-org to Multi-org)
// =========================================================================

/**
 * Check if database needs org migration
 */
function needsOrgMigration() {
  // Check if organizations table exists
  const orgTableExists = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='organizations'
  `).get();

  if (!orgTableExists) {
    return true;
  }

  // Check if existing tables need org_id column
  try {
    const usersColumns = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
    if (!usersColumns.includes('org_id')) {
      return true;
    }
  } catch (e) {
    return true;
  }

  return false;
}

/**
 * Migrate existing data to org-scoped schema
 */
function migrateToOrgSchema(defaultOrgId) {
  if (process.env.NODE_ENV === 'development') {
    console.log('Migrating database to multi-organization schema...');
  }
  
  const tablesToMigrate = [
    'users', 'patients', 'donor_organs', 'matches', 'notifications',
    'notification_rules', 'priority_weights', 'ehr_integrations', 'ehr_imports',
    'ehr_sync_logs', 'ehr_validation_rules', 'audit_logs', 'access_justification_logs',
    'readiness_barriers', 'adult_health_history_questionnaires', 'sessions'
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
        
        if (process.env.NODE_ENV === 'development') {
          console.log(`Added org_id to ${table} table`);
        }
      }
    } catch (e) {
      // Column might already exist or table doesn't exist
      if (process.env.NODE_ENV === 'development') {
        console.warn(`Warning migrating ${table}: ${e.message}`);
      }
    }
  }
  
  // Migrate settings table (different structure - needs key change)
  try {
    const settingsColumns = db.prepare("PRAGMA table_info(settings)").all().map(c => c.name);
    
    if (!settingsColumns.includes('org_id') && !settingsColumns.includes('id')) {
      // Old settings table - need to recreate
      const oldSettings = db.prepare('SELECT * FROM settings').all();
      
      db.exec('DROP TABLE IF EXISTS settings_old');
      db.exec('ALTER TABLE settings RENAME TO settings_old');
      
      db.exec(`
        CREATE TABLE settings (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT,
          updated_at TEXT DEFAULT (datetime('now')),
          UNIQUE(org_id, key)
        )
      `);
      
      // Migrate old settings to new table
      const { v4: uuidv4 } = require('uuid');
      for (const setting of oldSettings) {
        db.prepare(`
          INSERT INTO settings (id, org_id, key, value, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(uuidv4(), defaultOrgId, setting.key, setting.value, new Date().toISOString());
      }
      
      db.exec('DROP TABLE settings_old');
    }
  } catch (e) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`Warning migrating settings: ${e.message}`);
    }
  }
  
  if (process.env.NODE_ENV === 'development') {
    console.log('Multi-organization schema migration completed');
  }
}

// =========================================================================
// DATABASE INITIALIZATION
// =========================================================================

/**
 * Initialize database with encryption and multi-org support
 */
async function initDatabase() {
  const dbPath = getDatabasePath();
  const encryptionKey = getEncryptionKey();
  
  if (process.env.NODE_ENV === 'development') {
    console.log('Initializing encrypted database...');
  }
  
  // Check if database exists and its encryption state
  const encryptionState = isDatabaseEncrypted(dbPath);
  
  if (encryptionState === false) {
    // Database exists but is unencrypted - migrate it
    await migrateToEncrypted(dbPath, dbPath, encryptionKey);
  }
  
  // Open database with encryption
  db = new Database(dbPath, {
    verbose: null // Disable verbose logging for security
  });
  
  // Configure SQLCipher encryption
  db.pragma(`cipher = 'sqlcipher'`);
  db.pragma(`legacy = 4`); // SQLCipher 4.x compatibility mode
  db.pragma(`key = "x'${encryptionKey}'"`); // Hex key format for binary key
  
  // Verify encryption is working by trying to read
  try {
    db.pragma('cipher_version');
    encryptionEnabled = true;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('Warning: Database encryption verification failed');
    }
  }
  
  // Enable foreign keys and WAL mode for better performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  
  // Create schema (new multi-org schema) - tables only, no indexes yet
  createSchema(db);
  
  // Check if we need to migrate from pre-org schema
  const migrateNeeded = needsOrgMigration();
  
  // Create or get default organization
  let defaultOrg = getDefaultOrganization();
  if (!defaultOrg) {
    defaultOrg = createDefaultOrganization();
  }
  
  // Migrate existing data to org-scoped if needed
  if (migrateNeeded) {
    migrateToOrgSchema(defaultOrg.id);
  }
  
  // Now create indexes AFTER migration ensures org_id columns exist
  createIndexes(db);

  // Run versioned schema migrations (adds columns, indexes, etc.)
  const migrationResult = runMigrations(db);
  if (migrationResult.applied > 0 && process.env.NODE_ENV === 'development') {
    console.log(`Applied ${migrationResult.applied} migration(s): ${migrationResult.migrations.join(', ')}`);
  }

  // Enforce audit log immutability at the database layer (HIPAA 164.312(b))
  createAuditLogTriggers(db);
  
  // Seed default data if needed
  await seedDefaultData(defaultOrg.id);

  // Seed demo data for evaluation builds so buyers see a populated system
  seedDemoData(defaultOrg.id);
  
  if (process.env.NODE_ENV === 'development') {
    console.log('Encrypted database initialized successfully');
    console.log(`Encryption enabled: ${encryptionEnabled}`);
    console.log(`Default organization: ${defaultOrg.id}`);
  }
  
  return db;
}

// =========================================================================
// DEFAULT DATA SEEDING
// =========================================================================

async function seedDefaultData(defaultOrgId) {
  const { v4: uuidv4 } = require('uuid');
  
  // Check if admin user exists for this organization
  const adminExists = db.prepare(`
    SELECT COUNT(*) as count FROM users WHERE org_id = ? AND role = ?
  `).get(defaultOrgId, 'admin');
  
  if (!adminExists || adminExists.count === 0) {
    const bcrypt = require('bcryptjs');
    
    const defaultPassword = 'TransTrack#Admin2026!';
    const mustChangePassword = true;
    
    // Create default admin user
    const adminId = uuidv4();
    const hashedPassword = await bcrypt.hash(defaultPassword, 12);
    const now = new Date().toISOString();
    
    db.prepare(`
      INSERT INTO users (id, org_id, email, password_hash, full_name, role, is_active, must_change_password, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      adminId, 
      defaultOrgId,
      'admin@transtrack.local', 
      hashedPassword, 
      'System Administrator', 
      'admin', 
      1,
      mustChangePassword ? 1 : 0,
      now,
      now
    );
    
    if (process.env.NODE_ENV === 'development') {
      console.log('');
      console.log('Initial admin credentials: admin@transtrack.local / TransTrack#Admin2026!');
      console.log('CHANGE YOUR PASSWORD AFTER FIRST LOGIN');
      console.log('');
    }
    
    // Create default priority weights for this organization
    const weightsId = uuidv4();
    db.prepare(`
      INSERT INTO priority_weights (id, org_id, name, description, is_active, medical_urgency_weight, time_on_waitlist_weight, organ_specific_score_weight, evaluation_recency_weight, blood_type_rarity_weight, evaluation_decay_rate, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      weightsId, 
      defaultOrgId,
      'Default Weights', 
      'Standard UNOS-based priority weighting', 
      1, 
      30, 
      25, 
      25, 
      10, 
      10, 
      0.5,
      now,
      now
    );
    
    // Log initial setup (no sensitive data)
    const auditId = uuidv4();
    db.prepare(`
      INSERT INTO audit_logs (id, org_id, action, entity_type, details, user_email, user_role, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      auditId, 
      defaultOrgId,
      'system_init', 
      'System', 
      'TransTrack database initialized with multi-organization support', 
      'system', 
      'system',
      now
    );
  }
}

// =========================================================================
// DEMO DATA SEEDING (Evaluation builds only)
// =========================================================================

function seedDemoData(orgId) {
  const { getCurrentBuildVersion } = require('../license/tiers.cjs');
  if (getCurrentBuildVersion() !== 'evaluation') return;

  const existing = db.prepare('SELECT COUNT(*) as count FROM patients WHERE org_id = ?').get(orgId);
  if (existing.count > 0) return;

  const { v4: uuidv4 } = require('uuid');
  const now = new Date().toISOString();

  const patients = [
    { first: 'James', last: 'Mitchell', dob: '1958-03-14', blood: 'O+', organ: 'Kidney', urgency: 'high', status: 'active', meld: null, las: null, waitlist: '2025-06-10', hla: 'A2,A24,B7,B44,DR15,DR4', weight: 82, height: 178, diagnosis: 'End-stage renal disease (ESRD)', comorbidities: '["Type 2 Diabetes","Hypertension"]' },
    { first: 'Sarah', last: 'Chen', dob: '1972-08-22', blood: 'A+', organ: 'Liver', urgency: 'critical', status: 'active', meld: 34, las: null, waitlist: '2025-09-01', hla: 'A1,A3,B8,B35,DR3,DR11', weight: 61, height: 163, diagnosis: 'Hepatocellular carcinoma with cirrhosis', comorbidities: '["Hepatitis C"]' },
    { first: 'Robert', last: 'Johnson', dob: '1965-11-30', blood: 'B+', organ: 'Heart', urgency: 'critical', status: 'active', meld: null, las: null, waitlist: '2025-11-15', hla: 'A2,A11,B27,B51,DR1,DR7', weight: 90, height: 183, diagnosis: 'Dilated cardiomyopathy, NYHA Class IV', comorbidities: '["Atrial Fibrillation","Chronic Kidney Disease Stage 3"]' },
    { first: 'Maria', last: 'Garcia', dob: '1980-05-17', blood: 'O-', organ: 'Lung', urgency: 'high', status: 'active', meld: null, las: 68.5, waitlist: '2025-07-20', hla: 'A29,A31,B44,B60,DR7,DR13', weight: 55, height: 160, diagnosis: 'Idiopathic pulmonary fibrosis', comorbidities: '["GERD"]' },
    { first: 'William', last: 'Thompson', dob: '1970-01-08', blood: 'A-', organ: 'Kidney', urgency: 'medium', status: 'active', meld: null, las: null, waitlist: '2024-12-01', hla: 'A2,A68,B14,B57,DR4,DR13', weight: 95, height: 188, diagnosis: 'Polycystic kidney disease', comorbidities: '["Hypertension","Sleep Apnea"]' },
    { first: 'Emily', last: 'Davis', dob: '1988-09-25', blood: 'AB+', organ: 'Liver', urgency: 'medium', status: 'active', meld: 22, las: null, waitlist: '2026-01-10', hla: 'A1,A24,B8,B51,DR3,DR4', weight: 68, height: 170, diagnosis: 'Primary sclerosing cholangitis', comorbidities: '["Ulcerative Colitis"]' },
    { first: 'Michael', last: 'Wilson', dob: '1955-07-03', blood: 'O+', organ: 'Heart', urgency: 'high', status: 'active', meld: null, las: null, waitlist: '2025-10-05', hla: 'A3,A32,B7,B62,DR15,DR11', weight: 78, height: 175, diagnosis: 'Ischemic cardiomyopathy post-MI', comorbidities: '["Type 2 Diabetes","Peripheral Vascular Disease"]' },
    { first: 'Jennifer', last: 'Martinez', dob: '1975-12-11', blood: 'B-', organ: 'Kidney', urgency: 'low', status: 'active', meld: null, las: null, waitlist: '2025-03-15', hla: 'A11,A26,B35,B38,DR1,DR8', weight: 70, height: 165, diagnosis: 'Lupus nephritis Stage V', comorbidities: '["Systemic Lupus Erythematosus"]' },
    { first: 'David', last: 'Anderson', dob: '1962-04-19', blood: 'A+', organ: 'Lung', urgency: 'medium', status: 'active', meld: null, las: 45.2, waitlist: '2025-08-28', hla: 'A2,A30,B13,B44,DR7,DR15', weight: 73, height: 172, diagnosis: 'Chronic obstructive pulmonary disease', comorbidities: '["Osteoporosis","Depression"]' },
    { first: 'Lisa', last: 'Taylor', dob: '1983-06-28', blood: 'O+', organ: 'Liver', urgency: 'high', status: 'active', meld: 28, las: null, waitlist: '2025-12-20', hla: 'A1,A2,B57,B58,DR4,DR7', weight: 58, height: 158, diagnosis: 'Alcoholic liver disease with acute-on-chronic failure', comorbidities: '["Malnutrition","Coagulopathy"]' },
    { first: 'Thomas', last: 'Brown', dob: '1968-10-02', blood: 'AB-', organ: 'Kidney', urgency: 'medium', status: 'inactive', meld: null, las: null, waitlist: '2025-04-10', hla: 'A24,A33,B14,B27,DR1,DR11', weight: 88, height: 180, diagnosis: 'IgA nephropathy', comorbidities: '["Hypertension"]' },
    { first: 'Patricia', last: 'Lee', dob: '1990-02-14', blood: 'A+', organ: 'Heart', urgency: 'medium', status: 'active', meld: null, las: null, waitlist: '2026-02-01', hla: 'A3,A11,B7,B35,DR3,DR15', weight: 62, height: 167, diagnosis: 'Restrictive cardiomyopathy', comorbidities: '["Amyloidosis"]' },
  ];

  const insertPatient = db.prepare(`
    INSERT INTO patients (id, org_id, patient_id, first_name, last_name, date_of_birth, blood_type, organ_needed, medical_urgency, waitlist_status, date_added_to_waitlist, hla_typing, meld_score, las_score, weight_kg, height_cm, diagnosis, comorbidities, psychological_clearance, compliance_score, created_at, updated_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'system')
  `);

  for (let i = 0; i < patients.length; i++) {
    const p = patients[i];
    insertPatient.run(
      uuidv4(), orgId, `PT-${String(1001 + i).padStart(4, '0')}`,
      p.first, p.last, p.dob, p.blood, p.organ, p.urgency, p.status,
      p.waitlist, p.hla, p.meld, p.las, p.weight, p.height,
      p.diagnosis, p.comorbidities, 85 + Math.floor(Math.random() * 15),
      now, now
    );
  }

  const donors = [
    { organ: 'Kidney', blood: 'O+', hla: 'A2,A24,B7,B35,DR15,DR7', age: 34, weight: 80, height: 176, cause: 'Motor vehicle accident', condition: 'Excellent', quality: 'Standard', hospital: 'Memorial General Hospital' },
    { organ: 'Liver', blood: 'A+', hla: 'A1,A3,B8,B44,DR3,DR4', age: 28, weight: 65, height: 168, cause: 'Cerebrovascular accident', condition: 'Good', quality: 'Standard', hospital: 'University Medical Center' },
    { organ: 'Heart', blood: 'O+', hla: 'A2,A3,B7,B51,DR1,DR15', age: 22, weight: 75, height: 180, cause: 'Traumatic brain injury', condition: 'Excellent', quality: 'Optimal', hospital: 'St. Francis Trauma Center' },
  ];

  const insertDonor = db.prepare(`
    INSERT INTO donor_organs (id, org_id, donor_id, organ_type, blood_type, hla_typing, donor_age, donor_weight_kg, donor_height_cm, cause_of_death, organ_condition, organ_quality, organ_status, status, recovery_hospital, recovery_date, created_at, updated_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', 'available', ?, ?, ?, ?, 'system')
  `);

  for (let i = 0; i < donors.length; i++) {
    const d = donors[i];
    insertDonor.run(
      uuidv4(), orgId, `DN-${String(2001 + i).padStart(4, '0')}`,
      d.organ, d.blood, d.hla, d.age, d.weight, d.height,
      d.cause, d.condition, d.quality, d.hospital,
      '2026-03-' + String(20 + i).padStart(2, '0'),
      now, now
    );
  }

  const adminUser = db.prepare('SELECT id FROM users WHERE org_id = ? AND role = ? LIMIT 1').get(orgId, 'admin');
  const adminId = adminUser?.id || 'system';

  const barriers = [
    { patient: 0, type: 'INSURANCE_CLEARANCE', notes: 'Pending pre-authorization for transplant', status: 'in_progress', risk: 'moderate', role: 'financial' },
    { patient: 2, type: 'PENDING_TESTING', notes: 'Cardiac catheterization required before listing', status: 'open', risk: 'high', role: 'coordinator' },
    { patient: 3, type: 'CAREGIVER_SUPPORT', notes: 'Caregiver plan needs finalization', status: 'in_progress', risk: 'low', role: 'social_work' },
    { patient: 6, type: 'PENDING_TESTING', notes: 'Requires 30-day antibiotic course', status: 'open', risk: 'high', role: 'coordinator' },
    { patient: 9, type: 'PSYCHOSOCIAL_FOLLOWUP', notes: '6-month sobriety verification per protocol', status: 'in_progress', risk: 'high', role: 'social_work' },
  ];

  const insertBarrier = db.prepare(`
    INSERT INTO readiness_barriers (id, org_id, patient_id, barrier_type, status, risk_level, owning_role, notes, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const patientIds = db.prepare('SELECT id FROM patients WHERE org_id = ? ORDER BY created_at').all(orgId);
  for (const b of barriers) {
    if (patientIds[b.patient]) {
      insertBarrier.run(
        uuidv4(), orgId, patientIds[b.patient].id,
        b.type, b.status, b.risk, b.role, b.notes, adminId, now, now
      );
    }
  }

  const auditId = uuidv4();
  db.prepare(`
    INSERT INTO audit_logs (id, org_id, action, entity_type, details, user_email, user_role, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(auditId, orgId, 'demo_data_loaded', 'System', 'Demo data seeded for evaluation', 'system', 'system', now);
}

// =========================================================================
// ENCRYPTION UTILITIES
// =========================================================================

/**
 * Check if database encryption is enabled
 */
function isEncryptionEnabled() {
  return encryptionEnabled;
}

/**
 * Verify database integrity and encryption
 */
function verifyDatabaseIntegrity() {
  if (!db) return { valid: false, error: 'Database not initialized' };
  
  try {
    // Check integrity
    const integrityCheck = db.pragma('integrity_check');
    const isIntact = integrityCheck[0].integrity_check === 'ok';
    
    // Check cipher configuration
    let cipherInfo = {};
    try {
      cipherInfo = {
        cipher: db.pragma('cipher')[0]?.cipher || 'unknown',
        cipherVersion: db.pragma('cipher_version')[0]?.cipher_version || 'unknown',
      };
    } catch (e) {
      cipherInfo = { error: 'Unable to query cipher info' };
    }
    
    return {
      valid: isIntact,
      encrypted: encryptionEnabled,
      cipher: cipherInfo,
      integrityCheck: integrityCheck[0].integrity_check
    };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

/**
 * Export encryption status for compliance reporting
 */
function getEncryptionStatus() {
  const safeStorageActive = isSafeStorageAvailable();
  return {
    enabled: encryptionEnabled,
    algorithm: encryptionEnabled ? 'AES-256-CBC' : 'none',
    keyDerivation: encryptionEnabled ? 'PBKDF2-HMAC-SHA512' : 'none',
    keyIterations: encryptionEnabled ? 256000 : 0,
    hmacAlgorithm: encryptionEnabled ? 'SHA512' : 'none',
    pageSize: encryptionEnabled ? 4096 : 0,
    keyProtection: safeStorageActive ? 'os-keychain' : 'file-permissions',
    compliant: encryptionEnabled,
    standard: encryptionEnabled ? 'HIPAA' : 'non-compliant'
  };
}

// =========================================================================
// DATABASE OPERATIONS
// =========================================================================

function getDatabase() {
  return db;
}

async function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    encryptionEnabled = false;
    if (process.env.NODE_ENV === 'development') {
      console.log('Database connection closed');
    }
  }
}

/**
 * Backup database (encrypted backup)
 * The backup will also be encrypted with the same key
 */
async function backupDatabase(targetPath) {
  if (!db) throw new Error('Database not initialized');
  
  await db.backup(targetPath);
  
  // Log backup action
  const { v4: uuidv4 } = require('uuid');
  const defaultOrg = getDefaultOrganization();
  
  db.prepare(`
    INSERT INTO audit_logs (id, org_id, action, entity_type, details, user_email, user_role, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(), 
    defaultOrg?.id || 'SYSTEM',
    'backup', 
    'System', 
    'Encrypted database backup created', 
    'system', 
    'system',
    new Date().toISOString()
  );
  
  return true;
}

/**
 * Re-key the database with a new encryption key
 * WARNING: This is a sensitive operation - ensure backups exist
 */
async function rekeyDatabase(newKey) {
  if (!db) throw new Error('Database not initialized');
  
  // Validate new key format
  if (!/^[a-fA-F0-9]{64}$/.test(newKey)) {
    throw new Error('Invalid key format. Must be 64 hex characters (256 bits)');
  }
  
  try {
    // Re-key the database
    db.pragma(`rekey = "x'${newKey}'"`);
    
    const keyPath = getKeyPath();
    const keyBackupPath = getKeyBackupPath();
    
    // Preserve the old key in a separate backup before overwriting
    const oldKey = readProtectedKey(keyPath);
    if (oldKey) {
      writeProtectedKey(keyBackupPath + '.old', oldKey);
    }
    
    // Persist the new key (encrypted via safeStorage when available)
    writeProtectedKey(keyPath, newKey);
    writeProtectedKey(keyBackupPath, newKey);
    
    // Log the rekey action
    const { v4: uuidv4 } = require('uuid');
    const defaultOrg = getDefaultOrganization();
    
    db.prepare(`
      INSERT INTO audit_logs (id, org_id, action, entity_type, details, user_email, user_role, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(), 
      defaultOrg?.id || 'SYSTEM',
      'rekey', 
      'System', 
      'Database encryption key rotated', 
      'system', 
      'system',
      new Date().toISOString()
    );
    
    return true;
  } catch (error) {
    throw new Error(`Database rekey failed: ${error.message}`);
  }
}

// =========================================================================
// EXPORTS
// =========================================================================

module.exports = {
  // Database initialization
  initDatabase,
  getDatabase,
  closeDatabase,
  backupDatabase,
  getDatabasePath,
  
  // Encryption
  isEncryptionEnabled,
  verifyDatabaseIntegrity,
  rekeyDatabase,
  getEncryptionStatus,
  
  // Organization management
  getDefaultOrganization,
  createDefaultOrganization,
  generateOrgId,
  
  // License management
  getOrgLicense,
  hasValidLicense,
  getPatientCount,
  getUserCount,
};
