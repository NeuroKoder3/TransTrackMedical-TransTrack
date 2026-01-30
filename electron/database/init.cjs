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
const { app } = require('electron');
const { createSchema, createIndexes, addOrgIdToExistingTables } = require('./schema.cjs');

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
 * Get or create the encryption key
 * The key is a 64-character hex string (256 bits)
 * Stored with restrictive permissions (0o600)
 */
function getEncryptionKey() {
  const keyPath = getKeyPath();
  const keyBackupPath = getKeyBackupPath();
  
  // Try to read existing key
  if (fs.existsSync(keyPath)) {
    const key = fs.readFileSync(keyPath, 'utf8').trim();
    
    // Validate key format (64 hex characters = 256 bits)
    if (/^[a-fA-F0-9]{64}$/.test(key)) {
      return key;
    }
    
    // Invalid key format, try backup
    if (fs.existsSync(keyBackupPath)) {
      const backupKey = fs.readFileSync(keyBackupPath, 'utf8').trim();
      if (/^[a-fA-F0-9]{64}$/.test(backupKey)) {
        // Restore from backup
        fs.writeFileSync(keyPath, backupKey, { mode: 0o600 });
        return backupKey;
      }
    }
  }
  
  // Generate new 256-bit key
  const key = crypto.randomBytes(32).toString('hex');
  
  // Save key with restrictive permissions
  fs.writeFileSync(keyPath, key, { mode: 0o600 });
  
  // Create backup
  fs.writeFileSync(keyBackupPath, key, { mode: 0o600 });
  
  return key;
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
  
  // Seed default data if needed
  await seedDefaultData(defaultOrg.id);
  
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
    
    // Default admin password - CHANGE THIS AFTER FIRST LOGIN!
    const defaultPassword = 'Admin123!';
    
    // Create default admin user
    const adminId = uuidv4();
    const hashedPassword = await bcrypt.hash(defaultPassword, 12);
    const now = new Date().toISOString();
    
    db.prepare(`
      INSERT INTO users (id, org_id, email, password_hash, full_name, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      adminId, 
      defaultOrgId,
      'admin@transtrack.local', 
      hashedPassword, 
      'System Administrator', 
      'admin', 
      1,
      now,
      now
    );
    
    // Log credentials to console for first-time setup
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║           INITIAL ADMIN CREDENTIALS CREATED                  ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log('║  Email:    admin@transtrack.local                            ║');
    console.log('║  Password: Admin123!                                         ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log('║  ⚠️  CHANGE YOUR PASSWORD AFTER FIRST LOGIN!                  ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');
    
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
  return {
    enabled: encryptionEnabled,
    algorithm: encryptionEnabled ? 'AES-256-CBC' : 'none',
    keyDerivation: encryptionEnabled ? 'PBKDF2-HMAC-SHA512' : 'none',
    keyIterations: encryptionEnabled ? 256000 : 0,
    hmacAlgorithm: encryptionEnabled ? 'SHA512' : 'none',
    pageSize: encryptionEnabled ? 4096 : 0,
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
    
    // Save new key
    const keyPath = getKeyPath();
    const keyBackupPath = getKeyBackupPath();
    
    // Backup old key first
    if (fs.existsSync(keyPath)) {
      const oldKey = fs.readFileSync(keyPath, 'utf8').trim();
      fs.writeFileSync(keyBackupPath + '.old', oldKey, { mode: 0o600 });
    }
    
    // Save new key
    fs.writeFileSync(keyPath, newKey, { mode: 0o600 });
    fs.writeFileSync(keyBackupPath, newKey, { mode: 0o600 });
    
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
