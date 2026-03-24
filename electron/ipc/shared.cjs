/**
 * TransTrack - Shared IPC State & Utilities
 *
 * Centralizes session management, security constants, audit logging,
 * and entity helper functions used by all IPC handler modules.
 */

const { v4: uuidv4 } = require('uuid');
const {
  getDatabase,
  isEncryptionEnabled,
  verifyDatabaseIntegrity,
  getEncryptionStatus,
  getDefaultOrganization,
  getOrgLicense,
  getPatientCount,
  getUserCount,
} = require('../database/init.cjs');
const { LICENSE_TIER, LICENSE_FEATURES, hasFeature, checkDataLimit } = require('../license/tiers.cjs');

// =============================================================================
// SESSION STORE
// =============================================================================

let currentSession = null;
let currentUser = null;
let sessionExpiry = null;

function getSessionState() {
  return { currentSession, currentUser, sessionExpiry };
}

function setSessionState(session, user, expiry) {
  currentSession = session;
  currentUser = user;
  sessionExpiry = expiry;
}

function clearSession() {
  currentSession = null;
  currentUser = null;
  sessionExpiry = null;
}

function getSessionOrgId() {
  if (!currentUser || !currentUser.org_id) {
    throw new Error('Organization context required. Please log in again.');
  }
  return currentUser.org_id;
}

function getSessionTier() {
  if (!currentUser || !currentUser.license_tier) {
    return LICENSE_TIER.EVALUATION;
  }
  return currentUser.license_tier;
}

function sessionHasFeature(featureName) {
  return hasFeature(getSessionTier(), featureName);
}

function requireFeature(featureName) {
  if (!sessionHasFeature(featureName)) {
    const tier = getSessionTier();
    throw new Error(
      `Feature '${featureName}' is not available in your ${tier} tier. Please upgrade to access this feature.`
    );
  }
}

function validateSession() {
  if (!currentSession || !currentUser || !sessionExpiry) {
    return false;
  }
  if (Date.now() > sessionExpiry) {
    clearSession();
    return false;
  }
  if (!currentUser.org_id) {
    clearSession();
    return false;
  }
  return true;
}

// =============================================================================
// SECURITY CONSTANTS
// =============================================================================

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

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
  AdultHealthHistoryQuestionnaire: 'adult_health_history_questionnaires',
};

const jsonFields = [
  'priority_score_breakdown', 'conditions', 'notification_template',
  'metadata', 'import_data', 'error_details', 'document_urls', 'identified_issues',
];

const PASSWORD_REQUIREMENTS = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: true,
};

// =============================================================================
// PASSWORD VALIDATION
// =============================================================================

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

// =============================================================================
// LOGIN ATTEMPT TRACKING
// =============================================================================

function checkAccountLockout(email) {
  const db = getDatabase();
  const normalizedEmail = email.toLowerCase().trim();
  const attempt = db.prepare('SELECT * FROM login_attempts WHERE email = ?').get(normalizedEmail);
  if (!attempt) return { locked: false, remainingTime: 0 };

  if (attempt.locked_until) {
    const lockedUntil = new Date(attempt.locked_until).getTime();
    const now = Date.now();
    if (now < lockedUntil) {
      return { locked: true, remainingTime: Math.ceil((lockedUntil - now) / 1000 / 60) };
    }
    db.prepare(
      "UPDATE login_attempts SET attempt_count = 0, locked_until = NULL, updated_at = datetime('now') WHERE email = ?"
    ).run(normalizedEmail);
  }
  return { locked: false, remainingTime: 0 };
}

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
    db.prepare(
      'UPDATE login_attempts SET attempt_count = ?, last_attempt_at = ?, locked_until = ?, ip_address = COALESCE(?, ip_address), updated_at = ? WHERE email = ?'
    ).run(newCount, now, lockedUntil, ipAddress, now, normalizedEmail);
  } else {
    db.prepare(
      'INSERT INTO login_attempts (id, email, attempt_count, last_attempt_at, ip_address, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?)'
    ).run(uuidv4(), normalizedEmail, now, ipAddress, now, now);
  }
}

function clearFailedLogins(email) {
  const db = getDatabase();
  db.prepare('DELETE FROM login_attempts WHERE email = ?').run(email.toLowerCase().trim());
}

// =============================================================================
// ORDER BY VALIDATION
// =============================================================================

function isValidOrderColumn(tableName, column) {
  const allowedColumns = ALLOWED_ORDER_COLUMNS[tableName];
  if (!allowedColumns) return false;
  return allowedColumns.includes(column);
}

// =============================================================================
// ENTITY HELPERS
// =============================================================================

function parseJsonFields(row) {
  if (!row) return row;
  const parsed = { ...row };
  for (const field of jsonFields) {
    if (parsed[field] && typeof parsed[field] === 'string') {
      try { parsed[field] = JSON.parse(parsed[field]); } catch (_) { /* keep string */ }
    }
  }
  return parsed;
}

/** @deprecated Use getEntityByIdAndOrg */
function getEntityById(tableName, id) {
  const db = getDatabase();
  const row = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(id);
  return row ? parseJsonFields(row) : null;
}

function getEntityByIdAndOrg(tableName, id, orgId) {
  if (!orgId) throw new Error('Organization context required for data access');
  const db = getDatabase();
  const row = db.prepare(`SELECT * FROM ${tableName} WHERE id = ? AND org_id = ?`).get(id, orgId);
  return row ? parseJsonFields(row) : null;
}

function listEntitiesByOrg(tableName, orgId, orderBy, limit) {
  if (!orgId) throw new Error('Organization context required for data access');
  const db = getDatabase();
  let query = `SELECT * FROM ${tableName} WHERE org_id = ?`;

  if (orderBy) {
    const desc = orderBy.startsWith('-');
    const field = desc ? orderBy.substring(1) : orderBy;
    if (!isValidOrderColumn(tableName, field)) throw new Error(`Invalid sort field: ${field}`);
    query += ` ORDER BY ${field} ${desc ? 'DESC' : 'ASC'}`;
  } else {
    query += ' ORDER BY created_at DESC';
  }

  if (limit) {
    const parsedLimit = parseInt(limit, 10);
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 10000) {
      throw new Error('Invalid limit value. Must be between 1 and 10000.');
    }
    query += ` LIMIT ${parsedLimit}`;
  }

  const rows = db.prepare(query).all(orgId);
  return rows.map(parseJsonFields);
}

function sanitizeForSQLite(entityData) {
  for (const field of Object.keys(entityData)) {
    const value = entityData[field];
    if (value === undefined) { entityData[field] = null; continue; }
    if (typeof value === 'boolean') { entityData[field] = value ? 1 : 0; continue; }
    if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
      entityData[field] = JSON.stringify(value);
    }
  }
  return entityData;
}

// =============================================================================
// CONCURRENCY CONTROL (Optimistic + Pessimistic Locking)
// =============================================================================

const ROW_LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5-minute lock timeout

/**
 * Optimistic concurrency check: update only if version matches.
 * Returns the number of rows updated (0 = conflict detected).
 */
function updateWithVersionCheck(tableName, id, orgId, data, expectedVersion) {
  const db = getDatabase();
  if (!expectedVersion && expectedVersion !== 0) {
    throw new Error('Version number required for concurrent update safety');
  }

  const entityData = sanitizeForSQLite({ ...data, version: expectedVersion + 1, updated_at: new Date().toISOString() });
  delete entityData.id;
  delete entityData.org_id;
  delete entityData.created_at;
  delete entityData.created_by;

  const updates = Object.keys(entityData).map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(entityData), id, orgId, expectedVersion];

  const result = db.prepare(
    `UPDATE ${tableName} SET ${updates} WHERE id = ? AND org_id = ? AND version = ?`
  ).run(...values);

  if (result.changes === 0) {
    const current = db.prepare(`SELECT version FROM ${tableName} WHERE id = ? AND org_id = ?`).get(id, orgId);
    if (!current) {
      throw new Error('Record not found or access denied');
    }
    throw new Error(
      `Conflict detected: record was modified by another user (expected version ${expectedVersion}, current version ${current.version}). Please refresh and try again.`
    );
  }

  return result.changes;
}

/**
 * Acquire a pessimistic row lock (for critical operations like match acceptance).
 * Returns true if lock acquired, throws if already locked by another user.
 */
function acquireRowLock(tableName, id, orgId, userId) {
  const db = getDatabase();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ROW_LOCK_TIMEOUT_MS).toISOString();

  // Check existing lock
  const row = db.prepare(
    `SELECT locked_by, locked_at, lock_expires_at FROM ${tableName} WHERE id = ? AND org_id = ?`
  ).get(id, orgId);

  if (!row) {
    throw new Error('Record not found or access denied');
  }

  if (row.locked_by && row.locked_by !== userId) {
    const lockExpires = new Date(row.lock_expires_at);
    if (lockExpires > new Date()) {
      throw new Error(
        `Record is currently being edited by another user. Lock expires at ${row.lock_expires_at}. Please try again later.`
      );
    }
    // Lock expired, we can acquire
  }

  const result = db.prepare(
    `UPDATE ${tableName} SET locked_by = ?, locked_at = ?, lock_expires_at = ? WHERE id = ? AND org_id = ? AND (locked_by IS NULL OR locked_by = ? OR lock_expires_at < ?)`
  ).run(userId, now, expiresAt, id, orgId, userId, now);

  if (result.changes === 0) {
    throw new Error('Failed to acquire lock. Record may be locked by another user.');
  }

  return true;
}

/**
 * Release a pessimistic row lock.
 */
function releaseRowLock(tableName, id, orgId, userId) {
  const db = getDatabase();
  db.prepare(
    `UPDATE ${tableName} SET locked_by = NULL, locked_at = NULL, lock_expires_at = NULL WHERE id = ? AND org_id = ? AND locked_by = ?`
  ).run(id, orgId, userId);
  return true;
}

/**
 * Release all expired locks (cleanup, called periodically).
 */
function releaseExpiredLocks() {
  const db = getDatabase();
  const now = new Date().toISOString();
  const lockableTables = ['patients', 'donor_organs', 'matches'];
  let released = 0;
  for (const table of lockableTables) {
    try {
      const result = db.prepare(
        `UPDATE ${table} SET locked_by = NULL, locked_at = NULL, lock_expires_at = NULL WHERE lock_expires_at IS NOT NULL AND lock_expires_at < ?`
      ).run(now);
      released += result.changes;
    } catch (e) {
      // Table may not have lock columns yet
    }
  }
  return released;
}

// =============================================================================
// STANDARDIZED ERROR HANDLING
// =============================================================================

/**
 * Standardized error response structure for all IPC handlers.
 * All errors returned to the renderer should use this format.
 */
const ERROR_CODES = {
  // Authentication & Authorization
  AUTH_REQUIRED: { code: 'AUTH_REQUIRED', status: 401, message: 'Authentication required. Please log in.' },
  SESSION_EXPIRED: { code: 'SESSION_EXPIRED', status: 401, message: 'Session expired. Please log in again.' },
  UNAUTHORIZED: { code: 'UNAUTHORIZED', status: 403, message: 'You do not have permission to perform this action.' },
  ADMIN_REQUIRED: { code: 'ADMIN_REQUIRED', status: 403, message: 'Administrator access required.' },
  ACCOUNT_LOCKED: { code: 'ACCOUNT_LOCKED', status: 423, message: 'Account temporarily locked due to too many failed attempts.' },
  INVALID_CREDENTIALS: { code: 'INVALID_CREDENTIALS', status: 401, message: 'Invalid email or password.' },

  // Data Validation
  VALIDATION_ERROR: { code: 'VALIDATION_ERROR', status: 400, message: 'Input validation failed.' },
  DUPLICATE_ENTRY: { code: 'DUPLICATE_ENTRY', status: 409, message: 'A record with this identifier already exists.' },
  NOT_FOUND: { code: 'NOT_FOUND', status: 404, message: 'The requested record was not found.' },
  IMMUTABLE_RECORD: { code: 'IMMUTABLE_RECORD', status: 403, message: 'This record cannot be modified or deleted.' },

  // Concurrency
  CONFLICT: { code: 'CONFLICT', status: 409, message: 'This record was modified by another user. Please refresh and try again.' },
  RECORD_LOCKED: { code: 'RECORD_LOCKED', status: 423, message: 'This record is currently being edited by another user.' },

  // License
  LICENSE_LIMIT: { code: 'LICENSE_LIMIT', status: 403, message: 'License limit reached. Please upgrade to continue.' },
  FEATURE_UNAVAILABLE: { code: 'FEATURE_UNAVAILABLE', status: 403, message: 'This feature is not available in your current license tier.' },
  READ_ONLY_MODE: { code: 'READ_ONLY_MODE', status: 403, message: 'Application is in read-only mode. Please activate or renew your license.' },

  // System
  DATABASE_ERROR: { code: 'DATABASE_ERROR', status: 500, message: 'A database error occurred. Please try again.' },
  INTERNAL_ERROR: { code: 'INTERNAL_ERROR', status: 500, message: 'An internal error occurred. Please try again or contact support.' },
  BACKUP_FAILED: { code: 'BACKUP_FAILED', status: 500, message: 'Backup operation failed.' },
  ORG_REQUIRED: { code: 'ORG_REQUIRED', status: 400, message: 'Organization context required. Please log in again.' },
};

/**
 * Create a standardized error with code, message, and optional details.
 */
function createStandardError(errorCode, details = null, userMessage = null) {
  const errorDef = ERROR_CODES[errorCode] || ERROR_CODES.INTERNAL_ERROR;
  const err = new Error(userMessage || errorDef.message);
  err.code = errorDef.code;
  err.status = errorDef.status;
  err.details = details;
  err.timestamp = new Date().toISOString();
  return err;
}

/**
 * Wrap an IPC handler with standardized error handling and session validation.
 */
function wrapHandler(handlerFn, options = {}) {
  const { requireAuth = true, requireAdmin = false, requireRole = null } = options;

  return async (...args) => {
    try {
      if (requireAuth) {
        if (!validateSession()) {
          throw createStandardError('SESSION_EXPIRED');
        }
        const { currentUser } = getSessionState();
        if (requireAdmin && currentUser.role !== 'admin') {
          throw createStandardError('ADMIN_REQUIRED');
        }
        if (requireRole && !requireRole.includes(currentUser.role)) {
          throw createStandardError('UNAUTHORIZED', { requiredRole: requireRole, actualRole: currentUser.role });
        }
      }
      return await handlerFn(...args);
    } catch (error) {
      // If it's already a standard error, re-throw
      if (error.code && ERROR_CODES[error.code]) {
        throw error;
      }
      // Map known SQLite errors
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw createStandardError('DUPLICATE_ENTRY', { originalError: error.message });
      }
      if (error.message?.includes('Conflict detected')) {
        throw createStandardError('CONFLICT', { originalError: error.message }, error.message);
      }
      if (error.message?.includes('currently being edited')) {
        throw createStandardError('RECORD_LOCKED', { originalError: error.message }, error.message);
      }
      // Re-throw with original message for known application errors
      throw error;
    }
  };
}

// =============================================================================
// INPUT VALIDATION UTILITIES
// =============================================================================

const PATIENT_VALIDATION_RULES = {
  first_name: { type: 'string', minLength: 1, maxLength: 100, required: true, label: 'First name' },
  last_name: { type: 'string', minLength: 1, maxLength: 100, required: true, label: 'Last name' },
  blood_type: { type: 'enum', values: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'], label: 'Blood type' },
  organ_needed: { type: 'enum', values: ['kidney', 'liver', 'heart', 'lung', 'pancreas', 'intestine', 'heart_lung', 'kidney_pancreas'], label: 'Organ needed' },
  medical_urgency: { type: 'enum', values: ['critical', 'high', 'medium', 'low'], label: 'Medical urgency' },
  waitlist_status: { type: 'enum', values: ['active', 'inactive', 'transplanted', 'removed', 'deceased', 'suspended', 'hold'], label: 'Waitlist status' },
  weight_kg: { type: 'number', min: 0.5, max: 500, label: 'Weight (kg)' },
  height_cm: { type: 'number', min: 20, max: 300, label: 'Height (cm)' },
  meld_score: { type: 'number', min: 6, max: 40, label: 'MELD score' },
  las_score: { type: 'number', min: 0, max: 100, label: 'LAS score' },
  pra_percentage: { type: 'number', min: 0, max: 100, label: 'PRA percentage' },
  cpra_percentage: { type: 'number', min: 0, max: 100, label: 'CPRA percentage' },
  comorbidity_score: { type: 'number', min: 0, max: 10, label: 'Comorbidity score' },
  compliance_score: { type: 'number', min: 0, max: 10, label: 'Compliance score' },
  previous_transplants: { type: 'number', min: 0, max: 20, label: 'Previous transplants' },
  email: { type: 'email', label: 'Email' },
  phone: { type: 'string', maxLength: 30, label: 'Phone' },
  date_of_birth: { type: 'date', label: 'Date of birth' },
  date_added_to_waitlist: { type: 'date', label: 'Date added to waitlist' },
};

const DONOR_VALIDATION_RULES = {
  organ_type: { type: 'enum', values: ['kidney', 'liver', 'heart', 'lung', 'pancreas', 'intestine', 'heart_lung', 'kidney_pancreas'], required: true, label: 'Organ type' },
  blood_type: { type: 'enum', values: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'], required: true, label: 'Blood type' },
  donor_age: { type: 'number', min: 0, max: 120, label: 'Donor age' },
  donor_weight_kg: { type: 'number', min: 0.5, max: 500, label: 'Donor weight (kg)' },
  donor_height_cm: { type: 'number', min: 20, max: 300, label: 'Donor height (cm)' },
  cold_ischemia_time_hours: { type: 'number', min: 0, max: 72, label: 'Cold ischemia time (hours)' },
};

/**
 * Validate entity data against rules.
 * Returns { valid: boolean, errors: string[] }
 */
function validateEntityData(data, rules) {
  const errors = [];
  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Invalid data: expected an object'] };
  }

  for (const [field, rule] of Object.entries(rules)) {
    const value = data[field];

    // Required check
    if (rule.required && (value === undefined || value === null || value === '')) {
      errors.push(`${rule.label || field} is required`);
      continue;
    }

    // Skip validation if value is not provided and not required
    if (value === undefined || value === null || value === '') continue;

    // Type checks
    switch (rule.type) {
      case 'string':
        if (typeof value !== 'string') {
          errors.push(`${rule.label || field} must be a string`);
        } else {
          if (rule.minLength && value.length < rule.minLength) {
            errors.push(`${rule.label || field} must be at least ${rule.minLength} characters`);
          }
          if (rule.maxLength && value.length > rule.maxLength) {
            errors.push(`${rule.label || field} must be at most ${rule.maxLength} characters`);
          }
          // Check for potential SQL injection patterns
          if (/--|[';\-]|\/\*|\*\/|xp_|exec\s|union\s+select|drop\s+table/i.test(value)) {
            errors.push(`${rule.label || field} contains invalid characters`);
          }
        }
        break;

      case 'number':
        const num = typeof value === 'string' ? parseFloat(value) : value;
        if (isNaN(num)) {
          errors.push(`${rule.label || field} must be a valid number`);
        } else {
          if (rule.min !== undefined && num < rule.min) {
            errors.push(`${rule.label || field} must be at least ${rule.min}`);
          }
          if (rule.max !== undefined && num > rule.max) {
            errors.push(`${rule.label || field} must be at most ${rule.max}`);
          }
        }
        break;

      case 'enum':
        if (!rule.values.includes(value)) {
          errors.push(`${rule.label || field} must be one of: ${rule.values.join(', ')}`);
        }
        break;

      case 'email':
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          errors.push(`${rule.label || field} must be a valid email address`);
        }
        break;

      case 'date':
        if (isNaN(Date.parse(value))) {
          errors.push(`${rule.label || field} must be a valid date`);
        }
        break;
    }
  }

  return { valid: errors.length === 0, errors };
}

// =============================================================================
// AUDIT LOGGING
// =============================================================================

function logAudit(action, entityType, entityId, patientName, details, userEmail, userRole, requestId) {
  const db = getDatabase();
  const id = uuidv4();
  const orgId = currentUser?.org_id || 'SYSTEM';
  const now = new Date().toISOString();

  try {
    db.prepare(
      'INSERT INTO audit_logs (id, org_id, action, entity_type, entity_id, patient_name, details, user_email, user_role, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, orgId, action, entityType, entityId, patientName, details, userEmail, userRole, requestId || null, now);
  } catch {
    db.prepare(
      'INSERT INTO audit_logs (id, org_id, action, entity_type, entity_id, patient_name, details, user_email, user_role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, orgId, action, entityType, entityId, patientName, details, userEmail, userRole, now);
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Session
  getSessionState,
  setSessionState,
  clearSession,
  getSessionOrgId,
  getSessionTier,
  sessionHasFeature,
  requireFeature,
  validateSession,
  SESSION_DURATION_MS,

  // Security
  validatePasswordStrength,
  checkAccountLockout,
  recordFailedLogin,
  clearFailedLogins,

  // Constants
  ALLOWED_ORDER_COLUMNS,
  entityTableMap,
  jsonFields,
  MAX_LOGIN_ATTEMPTS,
  LOCKOUT_DURATION_MS,

  // Entity helpers
  isValidOrderColumn,
  parseJsonFields,
  getEntityById,
  getEntityByIdAndOrg,
  listEntitiesByOrg,
  sanitizeForSQLite,

  // Concurrency control
  updateWithVersionCheck,
  acquireRowLock,
  releaseRowLock,
  releaseExpiredLocks,
  ROW_LOCK_TIMEOUT_MS,

  // Standardized errors
  ERROR_CODES,
  createStandardError,
  wrapHandler,

  // Input validation
  validateEntityData,
  PATIENT_VALIDATION_RULES,
  DONOR_VALIDATION_RULES,

  // Audit
  logAudit,
};
