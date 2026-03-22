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
// AUDIT LOGGING
// =============================================================================

function logAudit(action, entityType, entityId, patientName, details, userEmail, userRole, requestId) {
function logAudit(action, entityType, entityId, patientName, details, userEmail, userRole) {
  const db = getDatabase();
  const id = uuidv4();
  const orgId = currentUser?.org_id || 'SYSTEM';
  const now = new Date().toISOString();

  // Use request_id column if it exists, otherwise fall back to basic insert
  try {
    db.prepare(
      'INSERT INTO audit_logs (id, org_id, action, entity_type, entity_id, patient_name, details, user_email, user_role, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, orgId, action, entityType, entityId, patientName, details, userEmail, userRole, requestId || null, now);
  } catch {
    db.prepare(
      'INSERT INTO audit_logs (id, org_id, action, entity_type, entity_id, patient_name, details, user_email, user_role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, orgId, action, entityType, entityId, patientName, details, userEmail, userRole, now);
  }
  db.prepare(
    'INSERT INTO audit_logs (id, org_id, action, entity_type, entity_id, patient_name, details, user_email, user_role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, orgId, action, entityType, entityId, patientName, details, userEmail, userRole, now);
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

  // Entity helpers
  isValidOrderColumn,
  parseJsonFields,
  getEntityById,
  getEntityByIdAndOrg,
  listEntitiesByOrg,
  sanitizeForSQLite,

  // Audit
  logAudit,
};
