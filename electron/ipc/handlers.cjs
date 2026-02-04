/**
 * TransTrack - IPC Handlers
 * 
 * Handles all communication between renderer and main process.
 * Implements secure data access with full audit logging.
 * 
 * Security Features:
 * - SQL injection prevention via parameterized queries and column whitelisting
 * - Session expiration validation
 * - Account lockout after failed login attempts
 * - Password strength requirements
 * - Audit logging for all operations
 */

const { ipcMain, dialog } = require('electron');
const { 
  getDatabase, 
  isEncryptionEnabled, 
  verifyDatabaseIntegrity, 
  getEncryptionStatus,
  getDefaultOrganization,
  getOrgLicense,
  getPatientCount,
  getUserCount 
} = require('../database/init.cjs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const licenseManager = require('../license/manager.cjs');
const featureGate = require('../license/featureGate.cjs');
const { FEATURES, LICENSE_TIER, LICENSE_FEATURES, hasFeature, checkDataLimit } = require('../license/tiers.cjs');
const riskEngine = require('../services/riskEngine.cjs');
const accessControl = require('../services/accessControl.cjs');
const disasterRecovery = require('../services/disasterRecovery.cjs');
const complianceView = require('../services/complianceView.cjs');
const offlineReconciliation = require('../services/offlineReconciliation.cjs');
const readinessBarriers = require('../services/readinessBarriers.cjs');
const ahhqService = require('../services/ahhqService.cjs');
const labsService = require('../services/labsService.cjs');

// =============================================================================
// SESSION STORE (Includes org_id for hard org isolation)
// =============================================================================
// CRITICAL: Session stores org_id. All downstream operations REQUIRE org_id.
// Never accept org_id from the client. Always use session.org_id.

let currentSession = null;
let currentUser = null;
let sessionExpiry = null;

/**
 * Get current org_id from session
 * FAILS CLOSED if org_id is missing - never returns null/undefined
 * @returns {string} The organization ID
 * @throws {Error} If no org_id in session
 */
function getSessionOrgId() {
  if (!currentUser || !currentUser.org_id) {
    throw new Error('Organization context required. Please log in again.');
  }
  return currentUser.org_id;
}

/**
 * Get current user's license tier
 * @returns {string} The license tier
 */
function getSessionTier() {
  if (!currentUser || !currentUser.license_tier) {
    return LICENSE_TIER.EVALUATION;
  }
  return currentUser.license_tier;
}

/**
 * Check if current session has a specific feature enabled
 * @param {string} featureName - The feature to check
 * @returns {boolean}
 */
function sessionHasFeature(featureName) {
  const tier = getSessionTier();
  return hasFeature(tier, featureName);
}

/**
 * Require a feature, throw if not enabled
 * @param {string} featureName - The feature to require
 * @throws {Error} If feature not enabled
 */
function requireFeature(featureName) {
  if (!sessionHasFeature(featureName)) {
    const tier = getSessionTier();
    throw new Error(`Feature '${featureName}' is not available in your ${tier} tier. Please upgrade to access this feature.`);
  }
}

// Login security constants
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours (reduced from 24 for security)

// Allowed columns for ORDER BY to prevent SQL injection
// Note: org_id is NOT included as it should never be used for sorting (it's always filtered, not sorted)
const ALLOWED_ORDER_COLUMNS = {
  patients: ['id', 'patient_id', 'first_name', 'last_name', 'blood_type', 'organ_needed', 'medical_urgency', 'waitlist_status', 'priority_score', 'date_of_birth', 'email', 'phone', 'created_at', 'updated_at'],
  donor_organs: ['id', 'donor_id', 'organ_type', 'blood_type', 'organ_status', 'status', 'patient_id', 'created_at', 'updated_at'],
  matches: ['id', 'donor_organ_id', 'patient_id', 'patient_name', 'compatibility_score', 'match_status', 'priority_rank', 'created_at', 'updated_at'],
  notifications: ['id', 'recipient_email', 'title', 'notification_type', 'is_read', 'priority_level', 'related_patient_id', 'created_at'],
  notification_rules: ['id', 'rule_name', 'trigger_event', 'priority_level', 'is_active', 'created_at', 'updated_at'],
  priority_weights: ['id', 'name', 'is_active', 'created_at', 'updated_at'],
  ehr_integrations: ['id', 'name', 'type', 'is_active', 'last_sync_date', 'base_url', 'sync_frequency_minutes', 'created_at', 'updated_at'],
  ehr_imports: ['id', 'integration_id', 'import_type', 'status', 'created_at', 'completed_date'],
  ehr_sync_logs: ['id', 'integration_id', 'sync_type', 'direction', 'status', 'created_at', 'completed_date'],
  ehr_validation_rules: ['id', 'field_name', 'rule_type', 'is_active', 'created_at', 'updated_at'],
  audit_logs: ['id', 'action', 'entity_type', 'entity_id', 'patient_name', 'user_id', 'user_email', 'user_role', 'created_at'],
  users: ['id', 'email', 'full_name', 'role', 'is_active', 'created_at', 'updated_at', 'last_login'],
  readiness_barriers: ['id', 'patient_id', 'barrier_type', 'status', 'risk_level', 'owning_role', 'created_at', 'updated_at'],
  adult_health_history_questionnaires: ['id', 'patient_id', 'status', 'expiration_date', 'owning_role', 'created_at', 'updated_at'],
  organizations: ['id', 'name', 'type', 'status', 'created_at', 'updated_at'],
  licenses: ['id', 'tier', 'activated_at', 'license_expires_at', 'created_at', 'updated_at'],
  settings: ['id', 'key', 'value', 'updated_at'],
  lab_results: ['id', 'patient_id', 'test_code', 'test_name', 'collected_at', 'resulted_at', 'source', 'created_at', 'updated_at'],
  required_lab_types: ['id', 'test_code', 'test_name', 'organ_type', 'max_age_days', 'is_active', 'created_at', 'updated_at'],
};

// Password strength requirements
const PASSWORD_REQUIREMENTS = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: true,
};

/**
 * Validate password strength
 * @param {string} password - The password to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validatePasswordStrength(password) {
  const errors = [];
  
  if (!password || password.length < PASSWORD_REQUIREMENTS.minLength) {
    errors.push(`Password must be at least ${PASSWORD_REQUIREMENTS.minLength} characters`);
  }
  if (PASSWORD_REQUIREMENTS.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (PASSWORD_REQUIREMENTS.requireLowercase && !/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (PASSWORD_REQUIREMENTS.requireNumber && !/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  if (PASSWORD_REQUIREMENTS.requireSpecial && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character (!@#$%^&*...)');
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Check if account is locked due to failed login attempts
 * Uses database for persistence across application restarts
 * @param {string} email - The email to check
 * @returns {{ locked: boolean, remainingTime: number }}
 */
function checkAccountLockout(email) {
  const db = getDatabase();
  const normalizedEmail = email.toLowerCase().trim();
  
  const attempt = db.prepare(`
    SELECT * FROM login_attempts WHERE email = ?
  `).get(normalizedEmail);
  
  if (!attempt) return { locked: false, remainingTime: 0 };
  
  if (attempt.locked_until) {
    const lockedUntil = new Date(attempt.locked_until).getTime();
    const now = Date.now();
    
    if (now < lockedUntil) {
      return { 
        locked: true, 
        remainingTime: Math.ceil((lockedUntil - now) / 1000 / 60) // minutes
      };
    }
    
    // Lockout has expired - clear it
    db.prepare(`
      UPDATE login_attempts SET attempt_count = 0, locked_until = NULL, updated_at = datetime('now')
      WHERE email = ?
    `).run(normalizedEmail);
    return { locked: false, remainingTime: 0 };
  }
  
  return { locked: false, remainingTime: 0 };
}

/**
 * Record a failed login attempt (persisted in database)
 * @param {string} email - The email that failed to login
 * @param {string} ipAddress - IP address of the attempt (optional)
 */
function recordFailedLogin(email, ipAddress = null) {
  const db = getDatabase();
  const normalizedEmail = email.toLowerCase().trim();
  const now = new Date().toISOString();
  
  const existing = db.prepare('SELECT * FROM login_attempts WHERE email = ?').get(normalizedEmail);
  
  if (existing) {
    const newCount = existing.attempt_count + 1;
    let lockedUntil = null;
    
    if (newCount >= MAX_LOGIN_ATTEMPTS) {
      lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString();
    }
    
    db.prepare(`
      UPDATE login_attempts SET 
        attempt_count = ?, 
        last_attempt_at = ?, 
        locked_until = ?,
        ip_address = COALESCE(?, ip_address),
        updated_at = ?
      WHERE email = ?
    `).run(newCount, now, lockedUntil, ipAddress, now, normalizedEmail);
  } else {
    const id = uuidv4();
    db.prepare(`
      INSERT INTO login_attempts (id, email, attempt_count, last_attempt_at, ip_address, created_at, updated_at)
      VALUES (?, ?, 1, ?, ?, ?, ?)
    `).run(id, normalizedEmail, now, ipAddress, now, now);
  }
}

/**
 * Clear failed login attempts after successful login (persisted in database)
 * @param {string} email - The email to clear
 */
function clearFailedLogins(email) {
  const db = getDatabase();
  const normalizedEmail = email.toLowerCase().trim();
  
  db.prepare('DELETE FROM login_attempts WHERE email = ?').run(normalizedEmail);
}

/**
 * Validate session is still active and not expired
 * Also validates that org_id is present in session
 * @returns {boolean}
 */
function validateSession() {
  if (!currentSession || !currentUser || !sessionExpiry) {
    return false;
  }
  
  if (Date.now() > sessionExpiry) {
    // Session expired - clear it
    currentSession = null;
    currentUser = null;
    sessionExpiry = null;
    return false;
  }
  
  // Validate org_id is present (fail closed)
  if (!currentUser.org_id) {
    currentSession = null;
    currentUser = null;
    sessionExpiry = null;
    return false;
  }
  
  return true;
}

/**
 * Validate ORDER BY column against whitelist to prevent SQL injection
 * @param {string} tableName - The table name
 * @param {string} column - The column name to validate
 * @returns {boolean}
 */
function isValidOrderColumn(tableName, column) {
  const allowedColumns = ALLOWED_ORDER_COLUMNS[tableName];
  if (!allowedColumns) return false;
  return allowedColumns.includes(column);
}

// Entity name to table name mapping
const entityTableMap = {
  Patient: 'patients',
  DonorOrgan: 'donor_organs',
  Match: 'matches',
  Notification: 'notifications',
  NotificationRule: 'notification_rules',
  PriorityWeights: 'priority_weights',
  EHRIntegration: 'ehr_integrations',
  EHRImport: 'ehr_imports',
  EHRSyncLog: 'ehr_sync_logs',
  EHRValidationRule: 'ehr_validation_rules',
  AuditLog: 'audit_logs',
  User: 'users',
  ReadinessBarrier: 'readiness_barriers',
  AdultHealthHistoryQuestionnaire: 'adult_health_history_questionnaires'
};

// Fields that store JSON data
const jsonFields = ['priority_score_breakdown', 'conditions', 'notification_template', 'metadata', 'import_data', 'error_details', 'document_urls', 'identified_issues'];

function setupIPCHandlers() {
  const db = getDatabase();
  
  // ===== APP INFO =====
  ipcMain.handle('app:getInfo', () => ({
    name: 'TransTrack',
    version: '1.0.0',
    compliance: ['HIPAA', 'FDA 21 CFR Part 11', 'AATB'],
    encryptionEnabled: isEncryptionEnabled()
  }));
  
  ipcMain.handle('app:getVersion', () => '1.0.0');
  
  // ===== DATABASE ENCRYPTION STATUS (HIPAA Compliance) =====
  ipcMain.handle('encryption:getStatus', async () => {
    return getEncryptionStatus();
  });
  
  ipcMain.handle('encryption:verifyIntegrity', async () => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    if (currentUser.role !== 'admin') throw new Error('Admin access required');
    
    const result = verifyDatabaseIntegrity();
    
    // Log the verification
    logAudit('encryption_verify', 'System', null, null, 
      `Database integrity check: ${result.valid ? 'PASSED' : 'FAILED'}`, 
      currentUser.email, currentUser.role);
    
    return result;
  });
  
  ipcMain.handle('encryption:isEnabled', async () => {
    return isEncryptionEnabled();
  });
  
  // ===== ORGANIZATION MANAGEMENT =====
  
  ipcMain.handle('organization:getCurrent', async () => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    
    const orgId = getSessionOrgId();
    const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(orgId);
    
    if (!org) {
      throw new Error('Organization not found');
    }
    
    // Get license info
    const license = getOrgLicense(orgId);
    
    // Get counts for limits display
    const patientCount = getPatientCount(orgId);
    const userCount = getUserCount(orgId);
    
    return {
      ...org,
      license: license ? {
        tier: license.tier,
        maxPatients: license.max_patients,
        maxUsers: license.max_users,
        expiresAt: license.license_expires_at,
        maintenanceExpiresAt: license.maintenance_expires_at,
      } : null,
      usage: {
        patients: patientCount,
        users: userCount,
      },
    };
  });
  
  ipcMain.handle('organization:update', async (event, updates) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    if (currentUser.role !== 'admin') throw new Error('Admin access required');
    
    const orgId = getSessionOrgId();
    const now = new Date().toISOString();
    
    // Only allow updating certain fields
    const allowedFields = ['name', 'address', 'phone', 'email', 'settings'];
    const safeUpdates = {};
    
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        safeUpdates[field] = updates[field];
      }
    }
    
    if (Object.keys(safeUpdates).length === 0) {
      throw new Error('No valid fields to update');
    }
    
    // Handle settings as JSON
    if (safeUpdates.settings && typeof safeUpdates.settings === 'object') {
      safeUpdates.settings = JSON.stringify(safeUpdates.settings);
    }
    
    const setClause = Object.keys(safeUpdates).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(safeUpdates), now, orgId];
    
    db.prepare(`UPDATE organizations SET ${setClause}, updated_at = ? WHERE id = ?`).run(...values);
    
    logAudit('update', 'Organization', orgId, null, 'Organization settings updated', currentUser.email, currentUser.role);
    
    return { success: true };
  });
  
  // ===== LICENSE MANAGEMENT =====
  
  ipcMain.handle('license:getInfo', async () => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    
    const orgId = getSessionOrgId();
    const license = getOrgLicense(orgId);
    const tier = license?.tier || LICENSE_TIER.EVALUATION;
    const features = LICENSE_FEATURES[tier] || LICENSE_FEATURES[LICENSE_TIER.EVALUATION];
    
    return {
      tier: tier,
      features: features,
      license: license,
      usage: {
        patients: getPatientCount(orgId),
        users: getUserCount(orgId),
      },
      limits: {
        maxPatients: features.maxPatients,
        maxUsers: features.maxUsers,
      },
    };
  });
  
  ipcMain.handle('license:activate', async (event, licenseKey, customerInfo) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    if (currentUser.role !== 'admin') throw new Error('Admin access required');
    
    const orgId = getSessionOrgId();
    
    // Check build type - evaluation builds cannot activate licenses
    const { isEvaluationBuild } = require('../license/tiers.cjs');
    if (isEvaluationBuild()) {
      throw new Error('Cannot activate license on Evaluation build. Please download the Enterprise version.');
    }
    
    // Activate using license manager
    const result = await licenseManager.activateLicense(licenseKey, {
      ...customerInfo,
      orgId: orgId,
    });
    
    if (result.success) {
      // Update license in database
      const now = new Date().toISOString();
      const existingLicense = getOrgLicense(orgId);
      
      if (existingLicense) {
        db.prepare(`
          UPDATE licenses SET 
            license_key = ?, tier = ?, activated_at = ?, maintenance_expires_at = ?,
            customer_name = ?, customer_email = ?, updated_at = ?
          WHERE org_id = ?
        `).run(
          licenseKey, result.tier, now, result.maintenanceExpiry,
          customerInfo?.name || '', customerInfo?.email || '', now, orgId
        );
      } else {
        db.prepare(`
          INSERT INTO licenses (id, org_id, license_key, tier, activated_at, maintenance_expires_at, customer_name, customer_email, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          uuidv4(), orgId, licenseKey, result.tier, now, result.maintenanceExpiry,
          customerInfo?.name || '', customerInfo?.email || '', now, now
        );
      }
      
      logAudit('license_activated', 'License', orgId, null, `License activated: ${result.tier}`, currentUser.email, currentUser.role);
    }
    
    return result;
  });
  
  ipcMain.handle('license:checkFeature', async (event, featureName) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    
    return {
      enabled: sessionHasFeature(featureName),
      tier: getSessionTier(),
    };
  });
  
  // ===== SETTINGS (Org-Scoped) =====
  
  ipcMain.handle('settings:get', async (event, key) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    
    const orgId = getSessionOrgId();
    const setting = db.prepare('SELECT value FROM settings WHERE org_id = ? AND key = ?').get(orgId, key);
    
    if (!setting) return null;
    
    try {
      return JSON.parse(setting.value);
    } catch {
      return setting.value;
    }
  });
  
  ipcMain.handle('settings:set', async (event, key, value) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    if (currentUser.role !== 'admin') throw new Error('Admin access required');
    
    const orgId = getSessionOrgId();
    const now = new Date().toISOString();
    const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
    
    // Upsert the setting
    const existing = db.prepare('SELECT id FROM settings WHERE org_id = ? AND key = ?').get(orgId, key);
    
    if (existing) {
      db.prepare('UPDATE settings SET value = ?, updated_at = ? WHERE id = ?').run(valueStr, now, existing.id);
    } else {
      db.prepare('INSERT INTO settings (id, org_id, key, value, updated_at) VALUES (?, ?, ?, ?, ?)').run(
        uuidv4(), orgId, key, valueStr, now
      );
    }
    
    logAudit('settings_update', 'Settings', key, null, `Setting '${key}' updated`, currentUser.email, currentUser.role);
    
    return { success: true };
  });
  
  ipcMain.handle('settings:getAll', async () => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    
    const orgId = getSessionOrgId();
    const settings = db.prepare('SELECT key, value FROM settings WHERE org_id = ?').all(orgId);
    
    const result = {};
    for (const setting of settings) {
      try {
        result[setting.key] = JSON.parse(setting.value);
      } catch {
        result[setting.key] = setting.value;
      }
    }
    
    return result;
  });
  
  // ===== AUTHENTICATION =====
  ipcMain.handle('auth:login', async (event, { email, password }) => {
    try {
      // Check for account lockout
      const lockoutStatus = checkAccountLockout(email);
      if (lockoutStatus.locked) {
        logAudit('login_blocked', 'User', null, null, `Login blocked: account locked for ${lockoutStatus.remainingTime} more minutes`, email, null);
        throw new Error(`Account temporarily locked due to too many failed attempts. Try again in ${lockoutStatus.remainingTime} minutes.`);
      }
      
      // Find user by email (email is unique per org, but we allow login with just email)
      const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email);
      
      if (!user) {
        recordFailedLogin(email);
        logAudit('login_failed', 'User', null, null, 'Login failed: user not found', email, null);
        throw new Error('Invalid credentials');
      }
      
      const isValid = await bcrypt.compare(password, user.password_hash);
      if (!isValid) {
        recordFailedLogin(email);
        logAudit('login_failed', 'User', null, null, 'Login failed: invalid password', email, null);
        throw new Error('Invalid credentials');
      }
      
      // CRITICAL: Get user's organization
      if (!user.org_id) {
        // Legacy user without org - assign to default organization
        const defaultOrg = getDefaultOrganization();
        if (defaultOrg) {
          db.prepare('UPDATE users SET org_id = ? WHERE id = ?').run(defaultOrg.id, user.id);
          user.org_id = defaultOrg.id;
        } else {
          throw new Error('No organization configured. Please contact administrator.');
        }
      }
      
      // Get organization info
      const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(user.org_id);
      if (!org || org.status !== 'ACTIVE') {
        throw new Error('Your organization is not active. Please contact administrator.');
      }
      
      // Get organization's license
      const license = getOrgLicense(user.org_id);
      const licenseTier = license?.tier || LICENSE_TIER.EVALUATION;
      
      // Clear failed login attempts on successful login
      clearFailedLogins(email);
      
      // Create session with org_id
      const sessionId = uuidv4();
      const expiresAtDate = new Date(Date.now() + SESSION_DURATION_MS);
      const expiresAt = expiresAtDate.toISOString();
      
      db.prepare(`
        INSERT INTO sessions (id, user_id, org_id, expires_at)
        VALUES (?, ?, ?, ?)
      `).run(sessionId, user.id, user.org_id, expiresAt);
      
      // Update last login
      db.prepare("UPDATE users SET last_login = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(user.id);
      
      // Store current session with expiry and org_id
      // CRITICAL: Session stores org_id - all downstream operations use this
      currentSession = sessionId;
      sessionExpiry = expiresAtDate.getTime();
      currentUser = {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        org_id: user.org_id,           // REQUIRED for org isolation
        org_name: org.name,             // For display
        license_tier: licenseTier,      // For feature gating
      };
      
      // Log login (without sensitive details)
      logAudit('login', 'User', user.id, null, 'User logged in successfully', user.email, user.role);
      
      return { success: true, user: currentUser };
    } catch (error) {
      // Don't expose internal error details to client
      const safeMessage = error.message.includes('locked') || 
                          error.message === 'Invalid credentials' ||
                          error.message.includes('organization')
        ? error.message 
        : 'Authentication failed';
      throw new Error(safeMessage);
    }
  });
  
  ipcMain.handle('auth:logout', async () => {
    if (currentSession) {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(currentSession);
      logAudit('logout', 'User', currentUser?.id, null, 'User logged out', currentUser?.email, currentUser?.role);
    }
    currentSession = null;
    currentUser = null;
    return { success: true };
  });
  
  ipcMain.handle('auth:me', async () => {
    if (!validateSession()) {
      currentSession = null;
      currentUser = null;
      sessionExpiry = null;
      throw new Error('Session expired. Please log in again.');
    }
    return currentUser;
  });
  
  ipcMain.handle('auth:isAuthenticated', async () => {
    return validateSession();
  });
  
  ipcMain.handle('auth:register', async (event, userData) => {
    // Get or create default organization for first-time setup
    let defaultOrg = getDefaultOrganization();
    
    // Check if registration is allowed
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
    
    // Only allow registration if no users exist (first-time setup) or if called by admin
    if (userCount.count > 0 && (!currentUser || currentUser.role !== 'admin')) {
      throw new Error('Registration not allowed. Please contact administrator.');
    }
    
    // If this is first user, they must create an organization first
    if (!defaultOrg) {
      // Create default organization for this installation
      const { createDefaultOrganization } = require('../database/init.cjs');
      defaultOrg = createDefaultOrganization();
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(userData.email)) {
      throw new Error('Invalid email format');
    }
    
    // Validate password strength
    const passwordValidation = validatePasswordStrength(userData.password);
    if (!passwordValidation.valid) {
      throw new Error(`Password requirements not met: ${passwordValidation.errors.join(', ')}`);
    }
    
    // Validate full name
    if (!userData.full_name || userData.full_name.trim().length < 2) {
      throw new Error('Full name must be at least 2 characters');
    }
    
    const hashedPassword = await bcrypt.hash(userData.password, 12);
    const userId = uuidv4();
    const now = new Date().toISOString();
    
    // CRITICAL: Always associate user with an organization
    const orgId = currentUser?.org_id || defaultOrg.id;
    
    db.prepare(`
      INSERT INTO users (id, org_id, email, password_hash, full_name, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, orgId, userData.email, hashedPassword, userData.full_name.trim(), userData.role || 'admin', 1, now, now);
    
    logAudit('create', 'User', userId, null, 'User registered', userData.email, userData.role || 'admin');
    
    return { success: true, id: userId };
  });
  
  ipcMain.handle('auth:changePassword', async (event, { currentPassword, newPassword }) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    
    // Validate new password strength
    const passwordValidation = validatePasswordStrength(newPassword);
    if (!passwordValidation.valid) {
      throw new Error(`Password requirements not met: ${passwordValidation.errors.join(', ')}`);
    }
    
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(currentUser.id);
    const isValid = await bcrypt.compare(currentPassword, user.password_hash);
    
    if (!isValid) {
      throw new Error('Current password is incorrect');
    }
    
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
      .run(hashedPassword, currentUser.id);
    
    logAudit('update', 'User', currentUser.id, null, 'Password changed', currentUser.email, currentUser.role);
    
    return { success: true };
  });
  
  ipcMain.handle('auth:createUser', async (event, userData) => {
    if (!validateSession() || currentUser.role !== 'admin') {
      throw new Error('Unauthorized: Admin access required');
    }
    
    const orgId = getSessionOrgId(); // CRITICAL: Use session org_id, never from client
    
    // Check user limit for this organization
    const userCount = getUserCount(orgId);
    const tier = getSessionTier();
    const limitCheck = checkDataLimit(tier, 'maxUsers', userCount);
    if (!limitCheck.allowed) {
      throw new Error(`User limit reached (${limitCheck.limit}). Please upgrade your license to add more users.`);
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(userData.email)) {
      throw new Error('Invalid email format');
    }
    
    // Check email uniqueness within organization (not global)
    const existingUser = db.prepare(`
      SELECT id FROM users WHERE org_id = ? AND email = ?
    `).get(orgId, userData.email);
    
    if (existingUser) {
      throw new Error('A user with this email already exists in your organization.');
    }
    
    // Validate password strength
    const passwordValidation = validatePasswordStrength(userData.password);
    if (!passwordValidation.valid) {
      throw new Error(`Password requirements not met: ${passwordValidation.errors.join(', ')}`);
    }
    
    const hashedPassword = await bcrypt.hash(userData.password, 12);
    const userId = uuidv4();
    const now = new Date().toISOString();
    
    db.prepare(`
      INSERT INTO users (id, org_id, email, password_hash, full_name, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, orgId, userData.email, hashedPassword, userData.full_name, userData.role || 'user', 1, now, now);
    
    logAudit('create', 'User', userId, null, 'User created', currentUser.email, currentUser.role);
    
    return { success: true, id: userId };
  });
  
  ipcMain.handle('auth:listUsers', async () => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    
    const orgId = getSessionOrgId(); // CRITICAL: Only return users from current org
    
    const users = db.prepare(`
      SELECT id, email, full_name, role, is_active, created_at, last_login
      FROM users
      WHERE org_id = ?
      ORDER BY created_at DESC
    `).all(orgId);
    
    return users;
  });
  
  ipcMain.handle('auth:updateUser', async (event, id, userData) => {
    if (!validateSession() || (currentUser.role !== 'admin' && currentUser.id !== id)) {
      throw new Error('Unauthorized');
    }
    
    const updates = [];
    const values = [];
    
    if (userData.full_name !== undefined) {
      updates.push('full_name = ?');
      values.push(userData.full_name);
    }
    if (userData.role !== undefined && currentUser.role === 'admin') {
      // Validate role value
      const validRoles = ['admin', 'coordinator', 'physician', 'user', 'viewer', 'regulator'];
      if (!validRoles.includes(userData.role)) {
        throw new Error('Invalid role specified');
      }
      updates.push('role = ?');
      values.push(userData.role);
    }
    if (userData.is_active !== undefined && currentUser.role === 'admin') {
      updates.push('is_active = ?');
      values.push(userData.is_active ? 1 : 0);
      
      // If deactivating user, invalidate their sessions
      if (!userData.is_active) {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
        logAudit('session_invalidated', 'User', id, null, 'User sessions invalidated due to account deactivation', currentUser.email, currentUser.role);
      }
    }
    
    if (updates.length > 0) {
      updates.push("updated_at = datetime('now')");
      values.push(id);
      
      db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      logAudit('update', 'User', id, null, 'User updated', currentUser.email, currentUser.role);
    }
    
    return { success: true };
  });
  
  ipcMain.handle('auth:deleteUser', async (event, id) => {
    if (!validateSession() || currentUser.role !== 'admin') {
      throw new Error('Unauthorized: Admin access required');
    }
    
    if (id === currentUser.id) {
      throw new Error('Cannot delete your own account');
    }
    
    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(id);
    
    // Delete user's sessions first
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    
    // Delete the user
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    
    logAudit('delete', 'User', id, null, 'User deleted', currentUser.email, currentUser.role);
    
    return { success: true };
  });
  
  // ===== ENTITY OPERATIONS =====
  // CRITICAL: All entity operations enforce org isolation using session.org_id
  // Never accept org_id from client data - always use getSessionOrgId()
  
  ipcMain.handle('entity:create', async (event, entityName, data) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    
    const tableName = entityTableMap[entityName];
    if (!tableName) throw new Error(`Unknown entity: ${entityName}`);
    
    // CRITICAL: Get org_id from session, never from client
    const orgId = getSessionOrgId();
    const tier = getSessionTier();
    
    // Prevent creation of audit logs via generic handler (HIPAA compliance)
    // Audit logs should only be created internally via logAudit function
    if (entityName === 'AuditLog') {
      throw new Error('Audit logs cannot be created directly');
    }
    
    // Check license limits for patients and donors (org-scoped)
    try {
      if (entityName === 'Patient') {
        const currentCount = getPatientCount(orgId);
        const limitCheck = checkDataLimit(tier, 'maxPatients', currentCount);
        if (!limitCheck.allowed) {
          throw new Error(`Patient limit reached (${limitCheck.limit}). Please upgrade your license to add more patients.`);
        }
      }
      
      if (entityName === 'DonorOrgan') {
        const currentCount = db.prepare('SELECT COUNT(*) as count FROM donor_organs WHERE org_id = ?').get(orgId).count;
        const limitCheck = checkDataLimit(tier, 'maxDonors', currentCount);
        if (!limitCheck.allowed) {
          throw new Error(`Donor limit reached (${limitCheck.limit}). Please upgrade your license to add more donors.`);
        }
      }
      
      // Check write access (not in read-only mode)
      if (featureGate.isReadOnlyMode()) {
        throw new Error('Application is in read-only mode. Please activate or renew your license to make changes.');
      }
    } catch (licenseError) {
      // SECURITY: Fail closed on license errors
      // Only fail-open with explicit dev flag
      const failOpen = process.env.NODE_ENV === 'development' && process.env.LICENSE_FAIL_OPEN === 'true';
      
      if (!failOpen) {
        // Log and re-throw all license errors in production
        console.error('License check error:', licenseError.message);
        throw licenseError;
      }
      
      // In dev mode with fail-open flag, only block on explicit limits
      console.warn('License check warning (dev mode):', licenseError.message);
      if (licenseError.message.includes('limit reached') || 
          licenseError.message.includes('read-only mode')) {
        throw licenseError;
      }
    }
    
    // Generate ID if not provided
    const id = data.id || uuidv4();
    
    // CRITICAL: Add org_id to entity data (enforces org isolation)
    // Remove any client-provided org_id to prevent cross-org data injection
    delete data.org_id;
    const entityData = { ...data, id, org_id: orgId, created_by: currentUser.email };
    
    // Sanitize all values for SQLite compatibility
    // SQLite only accepts: numbers, strings, bigints, buffers, and null
    for (const field of Object.keys(entityData)) {
      const value = entityData[field];
      
      // Convert undefined to null
      if (value === undefined) {
        entityData[field] = null;
        continue;
      }
      
      // Convert booleans to integers (SQLite doesn't support booleans)
      if (typeof value === 'boolean') {
        entityData[field] = value ? 1 : 0;
        continue;
      }
      
      // Convert arrays and objects to JSON strings
      if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
        entityData[field] = JSON.stringify(value);
        continue;
      }
      
      // Keep numbers, strings, bigints, buffers, and null as-is
    }
    
    // Build insert statement
    const fields = Object.keys(entityData);
    const placeholders = fields.map(() => '?').join(', ');
    const values = fields.map(f => entityData[f]);
    
    try {
      db.prepare(`INSERT INTO ${tableName} (${fields.join(', ')}) VALUES (${placeholders})`).run(...values);
    } catch (dbError) {
      // Provide user-friendly error messages for common database errors
      if (dbError.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        if (entityName === 'Patient' && entityData.patient_id) {
          throw new Error(`A patient with ID "${entityData.patient_id}" already exists. Please use a unique Patient ID.`);
        } else if (entityName === 'DonorOrgan' && entityData.donor_id) {
          throw new Error(`A donor with ID "${entityData.donor_id}" already exists. Please use a unique Donor ID.`);
        } else {
          throw new Error(`A ${entityName} with this identifier already exists.`);
        }
      }
      throw dbError;
    }
    
    // Get patient name for audit log
    let patientName = null;
    if (entityName === 'Patient') {
      patientName = `${data.first_name} ${data.last_name}`;
    } else if (data.patient_name) {
      patientName = data.patient_name;
    }
    
    logAudit('create', entityName, id, patientName, `${entityName} created`, currentUser.email, currentUser.role);
    
    // Return created entity
    return getEntityById(tableName, id);
  });
  
  ipcMain.handle('entity:get', async (event, entityName, id) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    
    const tableName = entityTableMap[entityName];
    if (!tableName) throw new Error(`Unknown entity: ${entityName}`);
    
    // CRITICAL: Get entity only if it belongs to current org
    const orgId = getSessionOrgId();
    return getEntityByIdAndOrg(tableName, id, orgId);
  });
  
  ipcMain.handle('entity:update', async (event, entityName, id, data) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    
    const tableName = entityTableMap[entityName];
    if (!tableName) throw new Error(`Unknown entity: ${entityName}`);
    
    // CRITICAL: Enforce org isolation
    const orgId = getSessionOrgId();
    
    // Prevent modification of audit logs (HIPAA compliance)
    if (entityName === 'AuditLog') {
      throw new Error('Audit logs cannot be modified');
    }
    
    // CRITICAL: Verify entity belongs to user's organization before update
    const existingEntity = getEntityByIdAndOrg(tableName, id, orgId);
    if (!existingEntity) {
      throw new Error(`${entityName} not found or access denied`);
    }
    
    const now = new Date().toISOString();
    const entityData = { ...data, updated_by: currentUser.email, updated_at: now };
    
    // Remove fields that should not be updated
    delete entityData.id;
    delete entityData.org_id; // CRITICAL: Never allow org_id change
    delete entityData.created_at;
    delete entityData.created_date;
    delete entityData.created_by;
    
    // Sanitize all values for SQLite compatibility
    // SQLite only accepts: numbers, strings, bigints, buffers, and null
    for (const field of Object.keys(entityData)) {
      const value = entityData[field];
      
      // Convert undefined to null
      if (value === undefined) {
        entityData[field] = null;
        continue;
      }
      
      // Convert booleans to integers (SQLite doesn't support booleans)
      if (typeof value === 'boolean') {
        entityData[field] = value ? 1 : 0;
        continue;
      }
      
      // Convert arrays and objects to JSON strings
      if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
        entityData[field] = JSON.stringify(value);
        continue;
      }
      
      // Keep numbers, strings, bigints, buffers, and null as-is
    }
    
    // Build update statement with org_id check
    const updates = Object.keys(entityData).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(entityData), id, orgId];
    
    // CRITICAL: WHERE clause includes org_id to prevent cross-org updates
    db.prepare(`UPDATE ${tableName} SET ${updates} WHERE id = ? AND org_id = ?`).run(...values);
    
    // Get updated entity
    const entity = getEntityByIdAndOrg(tableName, id, orgId);
    let patientName = null;
    if (entityName === 'Patient') {
      patientName = `${entity.first_name} ${entity.last_name}`;
    } else if (entity.patient_name) {
      patientName = entity.patient_name;
    }
    
    logAudit('update', entityName, id, patientName, `${entityName} updated`, currentUser.email, currentUser.role);
    
    return entity;
  });
  
  ipcMain.handle('entity:delete', async (event, entityName, id) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    
    const tableName = entityTableMap[entityName];
    if (!tableName) throw new Error(`Unknown entity: ${entityName}`);
    
    // CRITICAL: Enforce org isolation
    const orgId = getSessionOrgId();
    
    // Prevent deletion of audit logs (HIPAA compliance)
    if (entityName === 'AuditLog') {
      throw new Error('Audit logs cannot be deleted');
    }
    
    // CRITICAL: Verify entity belongs to user's organization before delete
    const entity = getEntityByIdAndOrg(tableName, id, orgId);
    if (!entity) {
      throw new Error(`${entityName} not found or access denied`);
    }
    
    let patientName = null;
    if (entityName === 'Patient' && entity) {
      patientName = `${entity.first_name} ${entity.last_name}`;
    } else if (entity?.patient_name) {
      patientName = entity.patient_name;
    }
    
    // CRITICAL: DELETE includes org_id check to prevent cross-org deletes
    db.prepare(`DELETE FROM ${tableName} WHERE id = ? AND org_id = ?`).run(id, orgId);
    
    logAudit('delete', entityName, id, patientName, `${entityName} deleted`, currentUser.email, currentUser.role);
    
    return { success: true };
  });
  
  ipcMain.handle('entity:list', async (event, entityName, orderBy, limit) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    
    const tableName = entityTableMap[entityName];
    if (!tableName) throw new Error(`Unknown entity: ${entityName}`);
    
    // CRITICAL: Enforce org isolation - only return data from user's organization
    const orgId = getSessionOrgId();
    
    return listEntitiesByOrg(tableName, orgId, orderBy, limit);
  });
  
  ipcMain.handle('entity:filter', async (event, entityName, filters, orderBy, limit) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    
    const tableName = entityTableMap[entityName];
    if (!tableName) throw new Error(`Unknown entity: ${entityName}`);
    
    // CRITICAL: Enforce org isolation - filter must include org_id
    const orgId = getSessionOrgId();
    
    // Get allowed columns for this table to validate filter keys
    const allowedColumns = ALLOWED_ORDER_COLUMNS[tableName] || [];
    
    // CRITICAL: Always filter by org_id first
    let query = `SELECT * FROM ${tableName} WHERE org_id = ?`;
    const values = [orgId];
    
    // Build additional WHERE conditions with column validation
    if (filters && typeof filters === 'object') {
      // Remove any client-provided org_id to prevent cross-org access
      delete filters.org_id;
      
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined && value !== null) {
          // Validate filter column name to prevent SQL injection
          if (!allowedColumns.includes(key) && !['id', 'created_at', 'updated_at'].includes(key)) {
            throw new Error(`Invalid filter field: ${key}`);
          }
          query += ` AND ${key} = ?`;
          values.push(value);
        }
      }
    }
    
    // Handle ordering with SQL injection prevention
    if (orderBy) {
      const desc = orderBy.startsWith('-');
      const field = desc ? orderBy.substring(1) : orderBy;
      
      // Validate column name against whitelist
      if (!isValidOrderColumn(tableName, field)) {
        throw new Error(`Invalid sort field: ${field}`);
      }
      
      query += ` ORDER BY ${field} ${desc ? 'DESC' : 'ASC'}`;
    } else {
      query += ' ORDER BY created_at DESC';
    }
    
    // Handle limit with bounds validation
    if (limit) {
      const parsedLimit = parseInt(limit, 10);
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 10000) {
        throw new Error('Invalid limit value. Must be between 1 and 10000.');
      }
      query += ` LIMIT ${parsedLimit}`;
    }
    
    const rows = db.prepare(query).all(...values);
    return rows.map(row => parseJsonFields(row));
  });
  
  // ===== FUNCTIONS (Business Logic) =====
  ipcMain.handle('function:invoke', async (event, functionName, params) => {
    if (!currentUser) throw new Error('Not authenticated');
    
    const functions = require('../functions/index.cjs');
    
    if (!functions[functionName]) {
      throw new Error(`Unknown function: ${functionName}`);
    }
    
    const result = await functions[functionName](params, { db, currentUser, logAudit });
    return result;
  });
  
  // NOTE: Settings handlers are defined in the ORG-SCOPED SETTINGS section above.
  // Do NOT add duplicate handlers here - they would bypass org isolation.
  
  // ===== OPERATIONAL RISK INTELLIGENCE =====
  ipcMain.handle('risk:getDashboard', async () => {
    return await riskEngine.getRiskDashboard();
  });
  
  ipcMain.handle('risk:getFullReport', async () => {
    return await riskEngine.generateOperationalRiskReport();
  });
  
  ipcMain.handle('risk:assessPatient', async (event, patientId) => {
    const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);
    if (!patient) throw new Error('Patient not found');
    return riskEngine.assessPatientOperationalRisk(patient);
  });
  
  // ===== READINESS BARRIERS (Non-Clinical Operational Tracking) =====
  // NOTE: This feature is strictly NON-CLINICAL, NON-ALLOCATIVE, and designed for
  // operational workflow visibility only. It does NOT perform allocation decisions,
  // listing authority functions, or replace UNOS/OPTN systems.
  
  ipcMain.handle('barrier:getTypes', async () => {
    return readinessBarriers.BARRIER_TYPES;
  });
  
  ipcMain.handle('barrier:getStatuses', async () => {
    return readinessBarriers.BARRIER_STATUS;
  });
  
  ipcMain.handle('barrier:getRiskLevels', async () => {
    return readinessBarriers.BARRIER_RISK_LEVEL;
  });
  
  ipcMain.handle('barrier:getOwningRoles', async () => {
    return readinessBarriers.OWNING_ROLES;
  });
  
  ipcMain.handle('barrier:create', async (event, data) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = getSessionOrgId();
    
    // Validate required fields
    if (!data.patient_id) throw new Error('Patient ID is required');
    if (!data.barrier_type) throw new Error('Barrier type is required');
    if (!data.owning_role) throw new Error('Owning role is required');
    
    // Validate notes length (max 255 chars, non-clinical only)
    if (data.notes && data.notes.length > 255) {
      throw new Error('Notes must be 255 characters or less');
    }
    
    const barrier = readinessBarriers.createBarrier(data, currentUser.id, orgId);
    
    // Get patient name for audit (org-scoped)
    const patient = db.prepare('SELECT first_name, last_name FROM patients WHERE id = ? AND org_id = ?').get(data.patient_id, orgId);
    const patientName = patient ? `${patient.first_name} ${patient.last_name}` : null;
    
    logAudit(
      'create', 'ReadinessBarrier', barrier.id, patientName,
      JSON.stringify({ patient_id: data.patient_id, barrier_type: data.barrier_type, status: barrier.status, risk_level: barrier.risk_level }),
      currentUser.email, currentUser.role
    );
    
    return barrier;
  });
  
  ipcMain.handle('barrier:update', async (event, id, data) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = getSessionOrgId();
    
    const existing = readinessBarriers.getBarrierById(id, orgId);
    if (!existing) throw new Error('Barrier not found or access denied');
    
    // Validate notes length
    if (data.notes && data.notes.length > 255) {
      throw new Error('Notes must be 255 characters or less');
    }
    
    const barrier = readinessBarriers.updateBarrier(id, data, currentUser.id, orgId);
    
    // Get patient name for audit
    const patient = db.prepare('SELECT first_name, last_name FROM patients WHERE id = ? AND org_id = ?').get(existing.patient_id, orgId);
    const patientName = patient ? `${patient.first_name} ${patient.last_name}` : null;
    
    const changes = {};
    if (data.status && data.status !== existing.status) changes.status = { from: existing.status, to: data.status };
    if (data.risk_level && data.risk_level !== existing.risk_level) changes.risk_level = { from: existing.risk_level, to: data.risk_level };
    
    logAudit('update', 'ReadinessBarrier', id, patientName, JSON.stringify({ patient_id: existing.patient_id, changes }), currentUser.email, currentUser.role);
    
    return barrier;
  });
  
  ipcMain.handle('barrier:resolve', async (event, id) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = getSessionOrgId();
    
    const existing = readinessBarriers.getBarrierById(id, orgId);
    if (!existing) throw new Error('Barrier not found or access denied');
    
    const barrier = readinessBarriers.updateBarrier(id, { status: 'resolved' }, currentUser.id, orgId);
    
    const patient = db.prepare('SELECT first_name, last_name FROM patients WHERE id = ? AND org_id = ?').get(existing.patient_id, orgId);
    const patientName = patient ? `${patient.first_name} ${patient.last_name}` : null;
    
    logAudit('resolve', 'ReadinessBarrier', id, patientName, JSON.stringify({ patient_id: existing.patient_id, barrier_type: existing.barrier_type }), currentUser.email, currentUser.role);
    
    return barrier;
  });
  
  ipcMain.handle('barrier:delete', async (event, id) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = getSessionOrgId();
    
    if (currentUser.role !== 'admin') {
      throw new Error('Only administrators can delete barriers. Consider resolving the barrier instead.');
    }
    
    const existing = readinessBarriers.getBarrierById(id, orgId);
    if (!existing) throw new Error('Barrier not found or access denied');
    
    const patient = db.prepare('SELECT first_name, last_name FROM patients WHERE id = ? AND org_id = ?').get(existing.patient_id, orgId);
    const patientName = patient ? `${patient.first_name} ${patient.last_name}` : null;
    
    readinessBarriers.deleteBarrier(id, orgId);
    
    logAudit('delete', 'ReadinessBarrier', id, patientName, JSON.stringify({ patient_id: existing.patient_id, barrier_type: existing.barrier_type }), currentUser.email, currentUser.role);
    
    return { success: true };
  });
  
  ipcMain.handle('barrier:getByPatient', async (event, patientId, includeResolved = false) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    return readinessBarriers.getBarriersByPatientId(patientId, getSessionOrgId(), includeResolved);
  });
  
  ipcMain.handle('barrier:getPatientSummary', async (event, patientId) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    return readinessBarriers.getPatientBarrierSummary(patientId, getSessionOrgId());
  });
  
  ipcMain.handle('barrier:getAllOpen', async () => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    return readinessBarriers.getAllOpenBarriers(getSessionOrgId());
  });
  
  ipcMain.handle('barrier:getDashboard', async () => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    return readinessBarriers.getBarriersDashboard(getSessionOrgId());
  });
  
  ipcMain.handle('barrier:getAuditHistory', async (event, patientId, startDate, endDate) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    return readinessBarriers.getBarrierAuditHistory(getSessionOrgId(), patientId, startDate, endDate);
  });
  
  // ===== ADULT HEALTH HISTORY QUESTIONNAIRE (aHHQ) =====
  // NOTE: This feature is strictly NON-CLINICAL, NON-ALLOCATIVE, and designed for
  // OPERATIONAL DOCUMENTATION purposes only. All operations are org-scoped.
  
  ipcMain.handle('ahhq:getStatuses', async () => ahhqService.AHHQ_STATUS);
  ipcMain.handle('ahhq:getIssues', async () => ahhqService.AHHQ_ISSUES);
  ipcMain.handle('ahhq:getOwningRoles', async () => ahhqService.AHHQ_OWNING_ROLES);
  
  ipcMain.handle('ahhq:create', async (event, data) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = getSessionOrgId();
    
    if (data.notes && data.notes.length > 255) throw new Error('Notes must be 255 characters or less');
    
    const result = ahhqService.createAHHQ(data, currentUser.id, orgId);
    logAudit('create', 'AdultHealthHistoryQuestionnaire', result.id, null,
      JSON.stringify({ patient_id: data.patient_id, status: data.status }),
      currentUser.email, currentUser.role);
    return result;
  });
  
  ipcMain.handle('ahhq:getById', async (event, id) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    return ahhqService.getAHHQById(id, getSessionOrgId());
  });
  
  ipcMain.handle('ahhq:getByPatient', async (event, patientId) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    return ahhqService.getAHHQByPatientId(patientId, getSessionOrgId());
  });
  
  ipcMain.handle('ahhq:getPatientSummary', async (event, patientId) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    return ahhqService.getPatientAHHQSummary(patientId, getSessionOrgId());
  });
  
  ipcMain.handle('ahhq:getAll', async (event, filters) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    return ahhqService.getAllAHHQs(getSessionOrgId(), filters);
  });
  
  ipcMain.handle('ahhq:getExpiring', async (event, days) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    return ahhqService.getExpiringAHHQs(getSessionOrgId(), days);
  });
  
  ipcMain.handle('ahhq:getExpired', async () => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    return ahhqService.getExpiredAHHQs(getSessionOrgId());
  });
  
  ipcMain.handle('ahhq:getIncomplete', async () => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    return ahhqService.getIncompleteAHHQs(getSessionOrgId());
  });
  
  ipcMain.handle('ahhq:update', async (event, id, data) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = getSessionOrgId();
    
    if (data.notes && data.notes.length > 255) throw new Error('Notes must be 255 characters or less');
    
    const existing = ahhqService.getAHHQById(id, orgId);
    if (!existing) throw new Error('aHHQ not found or access denied');
    
    const result = ahhqService.updateAHHQ(id, data, currentUser.id, orgId);
    
    const changes = {};
    if (data.status !== undefined && data.status !== existing.status) changes.status = { from: existing.status, to: data.status };
    
    logAudit('update', 'AdultHealthHistoryQuestionnaire', id, null,
      JSON.stringify({ patient_id: existing.patient_id, changes }),
      currentUser.email, currentUser.role);
    return result;
  });
  
  ipcMain.handle('ahhq:markComplete', async (event, id, completedDate) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = getSessionOrgId();
    
    const existing = ahhqService.getAHHQById(id, orgId);
    if (!existing) throw new Error('aHHQ not found or access denied');
    
    const result = ahhqService.markAHHQComplete(id, completedDate, currentUser.id, orgId);
    logAudit('complete', 'AdultHealthHistoryQuestionnaire', id, null,
      JSON.stringify({ patient_id: existing.patient_id, completed_date: completedDate || new Date().toISOString() }),
      currentUser.email, currentUser.role);
    return result;
  });
  
  ipcMain.handle('ahhq:markFollowUpRequired', async (event, id, issues) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = getSessionOrgId();
    
    const existing = ahhqService.getAHHQById(id, orgId);
    if (!existing) throw new Error('aHHQ not found or access denied');
    
    const result = ahhqService.markAHHQFollowUpRequired(id, issues, currentUser.id, orgId);
    logAudit('follow_up_required', 'AdultHealthHistoryQuestionnaire', id, null,
      JSON.stringify({ patient_id: existing.patient_id, issues }),
      currentUser.email, currentUser.role);
    return result;
  });
  
  ipcMain.handle('ahhq:delete', async (event, id) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    if (currentUser.role !== 'admin') throw new Error('Admin access required');
    const orgId = getSessionOrgId();
    
    const existing = ahhqService.getAHHQById(id, orgId);
    if (!existing) throw new Error('aHHQ not found or access denied');
    
    logAudit('delete', 'AdultHealthHistoryQuestionnaire', id, null,
      JSON.stringify({ patient_id: existing.patient_id }),
      currentUser.email, currentUser.role);
    return ahhqService.deleteAHHQ(id, orgId);
  });
  
  ipcMain.handle('ahhq:getDashboard', async () => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    return ahhqService.getAHHQDashboard(getSessionOrgId());
  });
  
  ipcMain.handle('ahhq:getPatientsWithIssues', async (event, limit) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    return ahhqService.getPatientsWithAHHQIssues(getSessionOrgId(), limit);
  });
  
  ipcMain.handle('ahhq:getAuditHistory', async (event, patientId, startDate, endDate) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    return ahhqService.getAHHQAuditHistory(getSessionOrgId(), patientId, startDate, endDate);
  });
  
  // =========================================================================
  // LAB RESULTS (Operational Documentation Only - Non-Clinical)
  // =========================================================================
  // NOTE: This feature is strictly NON-CLINICAL and NON-ALLOCATIVE.
  // Lab results are stored for DOCUMENTATION COMPLETENESS purposes only.
  // The system does NOT interpret lab values, provide clinical recommendations,
  // or make allocation decisions. Values are stored as strings.
  
  // Get common lab codes reference
  ipcMain.handle('labs:getCodes', async () => labsService.COMMON_LAB_CODES);
  ipcMain.handle('labs:getSources', async () => labsService.LAB_SOURCES);
  
  // Create a new lab result
  ipcMain.handle('labs:create', async (event, data) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = getSessionOrgId();
    return labsService.createLabResult(
      data,
      orgId,
      currentUser.id,
      currentUser.email
    );
  });
  
  // Get lab result by ID
  ipcMain.handle('labs:get', async (event, id) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    return labsService.getLabResultById(id, getSessionOrgId());
  });
  
  // Get all lab results for a patient
  ipcMain.handle('labs:getByPatient', async (event, patientId, options) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    return labsService.getLabResultsByPatient(patientId, getSessionOrgId(), options);
  });
  
  // Get latest lab for each test type for a patient
  ipcMain.handle('labs:getLatestByPatient', async (event, patientId) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    return labsService.getLatestLabsByPatient(patientId, getSessionOrgId());
  });
  
  // Update a lab result
  ipcMain.handle('labs:update', async (event, id, data) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = getSessionOrgId();
    return labsService.updateLabResult(
      id,
      data,
      orgId,
      currentUser.id,
      currentUser.email
    );
  });
  
  // Delete a lab result
  ipcMain.handle('labs:delete', async (event, id) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    if (currentUser.role !== 'admin' && currentUser.role !== 'coordinator') {
      throw new Error('Coordinator or admin access required to delete lab results');
    }
    return labsService.deleteLabResult(id, getSessionOrgId(), currentUser.email);
  });
  
  // Get patient lab status (operational readiness signals only)
  ipcMain.handle('labs:getPatientStatus', async (event, patientId) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    return labsService.getPatientLabStatus(patientId, getSessionOrgId());
  });
  
  // Get labs dashboard metrics
  ipcMain.handle('labs:getDashboard', async () => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    return labsService.getLabsDashboard(getSessionOrgId());
  });
  
  // Get required lab types for configuration
  ipcMain.handle('labs:getRequiredTypes', async (event, organType) => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    return labsService.getRequiredLabTypes(getSessionOrgId(), organType);
  });
  
  // ===== ACCESS CONTROL WITH JUSTIFICATION =====
  ipcMain.handle('access:validateRequest', async (event, permission, justification) => {
    if (!currentUser) throw new Error('Not authenticated');
    return accessControl.validateAccessRequest(currentUser.role, permission, justification);
  });
  
  ipcMain.handle('access:logJustifiedAccess', async (event, permission, entityType, entityId, justification) => {
    if (!currentUser) throw new Error('Not authenticated');
    return accessControl.logAccessWithJustification(
      db, currentUser.id, currentUser.email, currentUser.role,
      permission, entityType, entityId, justification
    );
  });
  
  ipcMain.handle('access:getRoles', async () => {
    return accessControl.getAllRoles();
  });
  
  ipcMain.handle('access:getJustificationReasons', async () => {
    return accessControl.JUSTIFICATION_REASONS;
  });
  
  // ===== DISASTER RECOVERY =====
  ipcMain.handle('recovery:createBackup', async (event, options) => {
    if (!currentUser) throw new Error('Not authenticated');
    return await disasterRecovery.createBackup({
      ...options,
      createdBy: currentUser.email,
    });
  });
  
  ipcMain.handle('recovery:listBackups', async () => {
    return disasterRecovery.listBackups();
  });
  
  ipcMain.handle('recovery:verifyBackup', async (event, backupId) => {
    return disasterRecovery.verifyBackup(backupId);
  });
  
  ipcMain.handle('recovery:restoreBackup', async (event, backupId) => {
    if (!currentUser || currentUser.role !== 'admin') {
      throw new Error('Admin access required for restore');
    }
    return await disasterRecovery.restoreFromBackup(backupId, {
      restoredBy: currentUser.email,
    });
  });
  
  ipcMain.handle('recovery:getStatus', async () => {
    return disasterRecovery.getRecoveryStatus();
  });
  
  // ===== COMPLIANCE VIEW (READ-ONLY FOR REGULATORS) =====
  ipcMain.handle('compliance:getSummary', async () => {
    if (!currentUser) throw new Error('Not authenticated');
    complianceView.logRegulatorAccess(db, currentUser.id, currentUser.email, 'view_summary', 'Viewed compliance summary');
    return complianceView.getComplianceSummary();
  });
  
  ipcMain.handle('compliance:getAuditTrail', async (event, options) => {
    if (!currentUser) throw new Error('Not authenticated');
    complianceView.logRegulatorAccess(db, currentUser.id, currentUser.email, 'view_audit', 'Viewed audit trail');
    return complianceView.getAuditTrailForCompliance(options);
  });
  
  ipcMain.handle('compliance:getDataCompleteness', async () => {
    if (!currentUser) throw new Error('Not authenticated');
    return complianceView.getDataCompletenessReport();
  });
  
  ipcMain.handle('compliance:getValidationReport', async () => {
    if (!currentUser) throw new Error('Not authenticated');
    complianceView.logRegulatorAccess(db, currentUser.id, currentUser.email, 'view_validation', 'Viewed validation report');
    return complianceView.generateValidationReport();
  });
  
  ipcMain.handle('compliance:getAccessLogs', async (event, options) => {
    if (!currentUser) throw new Error('Not authenticated');
    return complianceView.getAccessLogReport(options);
  });
  
  // ===== OFFLINE RECONCILIATION =====
  ipcMain.handle('reconciliation:getStatus', async () => {
    return offlineReconciliation.getReconciliationStatus();
  });
  
  ipcMain.handle('reconciliation:getPendingChanges', async () => {
    return offlineReconciliation.getPendingChanges();
  });
  
  ipcMain.handle('reconciliation:reconcile', async (event, strategy) => {
    if (!currentUser || currentUser.role !== 'admin') {
      throw new Error('Admin access required');
    }
    return await offlineReconciliation.reconcilePendingChanges(strategy);
  });
  
  ipcMain.handle('reconciliation:setMode', async (event, mode) => {
    if (!currentUser || currentUser.role !== 'admin') {
      throw new Error('Admin access required');
    }
    return offlineReconciliation.setOperationMode(mode);
  });
  
  ipcMain.handle('reconciliation:getMode', async () => {
    return offlineReconciliation.getOperationMode();
  });
  
  // ===== LICENSE MANAGEMENT (Additional Handlers) =====
  // Note: license:getInfo, license:activate, license:checkFeature are defined earlier
  
  // Renew maintenance
  ipcMain.handle('license:renewMaintenance', async (event, renewalKey, years) => {
    if (!currentUser) throw new Error('Not authenticated');
    if (currentUser.role !== 'admin') throw new Error('Admin access required');
    
    const result = await licenseManager.renewMaintenance(renewalKey, years);
    
    logAudit('maintenance_renewed', 'License', null, null, 
      `Maintenance renewed for ${years} year(s)`, currentUser.email, currentUser.role);
    
    return result;
  });
  
  // Check if license is valid
  ipcMain.handle('license:isValid', async () => {
    return licenseManager.isLicenseValid();
  });
  
  // Get current license tier
  ipcMain.handle('license:getTier', async () => {
    return licenseManager.getCurrentTier();
  });
  
  // Get tier limits
  ipcMain.handle('license:getLimits', async () => {
    const tier = licenseManager.getCurrentTier();
    return licenseManager.getTierLimits(tier);
  });
  
  // Check limit
  ipcMain.handle('license:checkLimit', async (event, limitType, currentCount) => {
    return featureGate.canWithinLimit(limitType, currentCount);
  });
  
  // Get application state
  ipcMain.handle('license:getAppState', async () => {
    return featureGate.checkApplicationState();
  });
  
  // Get payment options
  ipcMain.handle('license:getPaymentOptions', async () => {
    return licenseManager.getAllPaymentOptions();
  });
  
  // Get payment info for specific tier
  ipcMain.handle('license:getPaymentInfo', async (event, tier) => {
    return licenseManager.getPaymentInfo(tier);
  });
  
  // Get organization info
  ipcMain.handle('license:getOrganization', async () => {
    return licenseManager.getOrganizationInfo();
  });
  
  // Update organization info
  ipcMain.handle('license:updateOrganization', async (event, updates) => {
    if (!currentUser) throw new Error('Not authenticated');
    if (currentUser.role !== 'admin') throw new Error('Admin access required');
    
    return licenseManager.updateOrganizationInfo(updates);
  });
  
  // Get maintenance status
  ipcMain.handle('license:getMaintenanceStatus', async () => {
    return licenseManager.getMaintenanceStatus();
  });
  
  // Get license audit history
  ipcMain.handle('license:getAuditHistory', async (event, limit) => {
    if (!currentUser) throw new Error('Not authenticated');
    return licenseManager.getLicenseAuditHistory(limit);
  });
  
  // Check if evaluation build
  ipcMain.handle('license:isEvaluationBuild', async () => {
    return licenseManager.isEvaluationBuild();
  });
  
  // Get evaluation status
  ipcMain.handle('license:getEvaluationStatus', async () => {
    return {
      isEvaluation: licenseManager.isEvaluationMode(),
      daysRemaining: licenseManager.getEvaluationDaysRemaining(),
      expired: licenseManager.isEvaluationExpired(),
      inGracePeriod: licenseManager.isInEvaluationGracePeriod(),
    };
  });
  
  // Get all features and their status
  ipcMain.handle('license:getAllFeatures', async () => {
    const tier = licenseManager.getCurrentTier();
    const allFeatures = Object.values(FEATURES);
    
    return allFeatures.map(feature => ({
      feature,
      ...featureGate.canAccessFeature(feature),
    }));
  });
  
  // Check full access (combined checks)
  ipcMain.handle('license:checkFullAccess', async (event, options) => {
    return featureGate.checkFullAccess(options);
  });
  
  // ===== FILE OPERATIONS =====
  ipcMain.handle('file:exportCSV', async (event, data, filename) => {
    // Check feature access for data export
    const exportCheck = featureGate.canAccessFeature(FEATURES.DATA_EXPORT);
    if (!exportCheck.allowed) {
      throw new Error('Data export is not available in your current license tier. Please upgrade to export data.');
    }
    
    const { dialog } = require('electron');
    const fs = require('fs');
    
    const { filePath } = await dialog.showSaveDialog({
      title: 'Export CSV',
      defaultPath: filename,
      filters: [{ name: 'CSV Files', extensions: ['csv'] }]
    });
    
    if (filePath) {
      // Convert data to CSV
      if (data.length === 0) {
        fs.writeFileSync(filePath, '');
      } else {
        const headers = Object.keys(data[0]).join(',');
        const rows = data.map(row => 
          Object.values(row).map(v => 
            typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v
          ).join(',')
        );
        fs.writeFileSync(filePath, [headers, ...rows].join('\n'));
      }
      
      logAudit('export', 'System', null, null, `CSV exported: ${filename}`, currentUser.email, currentUser.role);
      return { success: true, path: filePath };
    }
    
    return { success: false };
  });
  
  ipcMain.handle('file:backupDatabase', async (event, targetPath) => {
    const { backupDatabase } = require('../database/init.cjs');
    await backupDatabase(targetPath);
    return { success: true };
  });
  
  // =========================================================================
  // TRANSPLANT CLOCK (Operational Activity Rhythm)
  // =========================================================================
  // The Transplant Clock provides real-time operational awareness for transplant
  // coordination teams. It acts as a visual heartbeat of the program.
  // 100% computed locally from the encrypted SQLite database.
  // No cloud, API, or AI inference required.
  
  const transplantClock = require('../services/transplantClock.cjs');
  
  ipcMain.handle('clock:getData', async () => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = getSessionOrgId();
    return transplantClock.getTransplantClockData(orgId);
  });
  
  ipcMain.handle('clock:getTimeSinceLastUpdate', async () => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = getSessionOrgId();
    return transplantClock.getTimeSinceLastUpdate(orgId);
  });
  
  ipcMain.handle('clock:getAverageResolutionTime', async () => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = getSessionOrgId();
    return transplantClock.getAverageResolutionTime(orgId);
  });
  
  ipcMain.handle('clock:getNextExpiration', async () => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = getSessionOrgId();
    return transplantClock.getNextExpiration(orgId);
  });
  
  ipcMain.handle('clock:getTaskCounts', async () => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = getSessionOrgId();
    return transplantClock.getTaskCounts(orgId);
  });
  
  ipcMain.handle('clock:getCoordinatorLoad', async () => {
    if (!validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = getSessionOrgId();
    return transplantClock.getCoordinatorLoad(orgId);
  });
  
  // =========================================================================
  // HELPER FUNCTIONS
  // =========================================================================
  
  /**
   * Get entity by ID (legacy - no org check)
   * @deprecated Use getEntityByIdAndOrg for org-isolated queries
   */
  function getEntityById(tableName, id) {
    const row = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(id);
    return row ? parseJsonFields(row) : null;
  }
  
  /**
   * Get entity by ID with org isolation
   * CRITICAL: This ensures users can only access data from their organization
   * @param {string} tableName - The table name
   * @param {string} id - The entity ID
   * @param {string} orgId - The organization ID
   * @returns {Object|null} The entity or null if not found/not in org
   */
  function getEntityByIdAndOrg(tableName, id, orgId) {
    if (!orgId) {
      throw new Error('Organization context required for data access');
    }
    const row = db.prepare(`SELECT * FROM ${tableName} WHERE id = ? AND org_id = ?`).get(id, orgId);
    return row ? parseJsonFields(row) : null;
  }
  
  /**
   * List entities with org isolation
   * @param {string} tableName - The table name
   * @param {string} orgId - The organization ID
   * @param {string} orderBy - Column to order by (with optional - prefix for DESC)
   * @param {number} limit - Max rows to return
   * @returns {Array} List of entities
   */
  function listEntitiesByOrg(tableName, orgId, orderBy, limit) {
    if (!orgId) {
      throw new Error('Organization context required for data access');
    }
    
    let query = `SELECT * FROM ${tableName} WHERE org_id = ?`;
    
    // Handle ordering with SQL injection prevention
    if (orderBy) {
      const desc = orderBy.startsWith('-');
      const field = desc ? orderBy.substring(1) : orderBy;
      
      // Validate column name against whitelist
      if (!isValidOrderColumn(tableName, field)) {
        throw new Error(`Invalid sort field: ${field}`);
      }
      
      query += ` ORDER BY ${field} ${desc ? 'DESC' : 'ASC'}`;
    } else {
      // Use created_at (new schema) or created_date (old schema)
      query += ' ORDER BY created_at DESC';
    }
    
    // Handle limit with bounds validation
    if (limit) {
      const parsedLimit = parseInt(limit, 10);
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 10000) {
        throw new Error('Invalid limit value. Must be between 1 and 10000.');
      }
      query += ` LIMIT ${parsedLimit}`;
    }
    
    const rows = db.prepare(query).all(orgId);
    return rows.map(row => parseJsonFields(row));
  }
  
  function parseJsonFields(row) {
    if (!row) return row;
    const parsed = { ...row };
    for (const field of jsonFields) {
      if (parsed[field] && typeof parsed[field] === 'string') {
        try {
          parsed[field] = JSON.parse(parsed[field]);
        } catch (e) {
          // Keep as string if parsing fails
        }
      }
    }
    return parsed;
  }
  
  /**
   * Log audit event with org isolation
   * All audit logs are scoped to the current organization
   */
  function logAudit(action, entityType, entityId, patientName, details, userEmail, userRole) {
    const id = uuidv4();
    // Get org_id from session if available, otherwise use 'SYSTEM'
    const orgId = currentUser?.org_id || 'SYSTEM';
    const now = new Date().toISOString();
    
    db.prepare(`
      INSERT INTO audit_logs (id, org_id, action, entity_type, entity_id, patient_name, details, user_email, user_role, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, orgId, action, entityType, entityId, patientName, details, userEmail, userRole, now);
  }
}

module.exports = { setupIPCHandlers };
