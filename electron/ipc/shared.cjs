// Shared IPC state, session management, and entity helpers

const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('../database/init.cjs');
const { checkRateLimit } = require('./rateLimiter.cjs');

// Session store (bound to WebContents for session-riding prevention)

let currentSession = null;
let currentUser = null;
let sessionExpiry = null;
let boundWebContentsId = null;
let lastActivityTime = null;

// Per-request context set by the IPC middleware so that validateSession()
// can enforce WebContents binding without every handler passing it manually.
let _requestSenderId = null;

function setRequestContext(senderWebContentsId) {
  _requestSenderId = senderWebContentsId ?? null;
}

function clearRequestContext() {
  _requestSenderId = null;
}

const securityPolicy = require('../config/securityPolicy.cjs');
const IDLE_TIMEOUT_MS = securityPolicy.IDLE_TIMEOUT_MS;

function getSessionState() {
  return { currentSession, currentUser, sessionExpiry };
}

function setSessionState(session, user, expiry, webContentsId) {
  currentSession = session;
  currentUser = user;
  sessionExpiry = expiry;
  boundWebContentsId = webContentsId || null;
  lastActivityTime = Date.now();
}

function clearSession() {
  currentSession = null;
  currentUser = null;
  sessionExpiry = null;
  boundWebContentsId = null;
  lastActivityTime = null;
}

function touchSession() {
  if (currentSession) lastActivityTime = Date.now();
}

function getSessionOrgId() {
  if (!currentUser || !currentUser.org_id) {
    throw new Error('Organization context required. Please log in again.');
  }
  return currentUser.org_id;
}

/**
 * H-6: session entitlement must consult the license manager, not constants.
 * Fail closed when the manager cannot be loaded.
 */
function getSessionTier() {
  try {
    return require('../license/manager.cjs').getCurrentTier();
  } catch {
    return require('../license/tiers.cjs').LICENSE_TIER.EVALUATION;
  }
}

function sessionHasFeature(featureName) {
  if (!featureName) return false;
  try {
    return !!require('../license/manager.cjs').checkFeature(featureName).enabled;
  } catch {
    return false;
  }
}

function requireFeature(featureName) {
  if (!sessionHasFeature(featureName)) {
    const tier = getSessionTier();
    throw new Error(
      `Feature '${featureName}' is not available in your ${tier} tier. Please upgrade to access this feature.`
    );
  }
  return true;
}

function validateSession(senderWebContentsId) {
  if (!currentSession || !currentUser || !sessionExpiry) {
    return false;
  }
  if (Date.now() > sessionExpiry) {
    clearSession();
    return false;
  }
  if (lastActivityTime && (Date.now() - lastActivityTime) > IDLE_TIMEOUT_MS) {
    clearSession();
    return false;
  }
  if (!currentUser.org_id) {
    clearSession();
    return false;
  }
  const effectiveSenderId = senderWebContentsId ?? _requestSenderId;
  if (boundWebContentsId && effectiveSenderId && effectiveSenderId !== boundWebContentsId) {
    return false;
  }
  // Validate session still exists in DB — fail closed on any error.
  try {
    const db = getDatabase();
    const dbSession = db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(currentSession, currentUser.id);
    if (!dbSession) {
      clearSession();
      return false;
    }

    // Verify the user account is still active (soft-fail if column absent).
    try {
      const userRow = db.prepare('SELECT is_active FROM users WHERE id = ?').get(currentUser.id);
      if (userRow && userRow.is_active === 0) {
        clearSession();
        return false;
      }
    } catch { /* is_active column may not exist in older schemas */ }
  } catch {
    clearSession();
    return false;
  }
  touchSession();
  return true;
}

// --- session restrictions ---

const UNRESTRICTED_CHANNELS = new Set([
  'auth:changePassword',
  'auth:logout',
  'auth:me',
  'auth:isAuthenticated',
  'auth:status',
  'auth:getCurrentUser',
  'mfa:status',
  'mfa:beginEnrollment',
  'mfa:confirmEnrollment',
  'mfa:verifyChallenge',
  'mfa:regenerateBackupCodes',
]);

function sessionAllows(action) {
  if (!currentUser || !currentUser.session_restrictions || currentUser.session_restrictions.length === 0) {
    return true;
  }
  return UNRESTRICTED_CHANNELS.has(action);
}

function assertSessionUnrestricted() {
  if (currentUser && currentUser.session_restrictions && currentUser.session_restrictions.length > 0) {
    throw new Error('Complete account security requirements before continuing');
  }
}

/** Remove a completed gate from the in-memory session (password_change / mfa_enroll). */
function clearSessionRestriction(restriction) {
  if (!currentUser || !Array.isArray(currentUser.session_restrictions)) return;
  currentUser.session_restrictions = currentUser.session_restrictions.filter((r) => r !== restriction);
  if (currentUser.session_restrictions.length === 0) {
    delete currentUser.session_restrictions;
  }
  if (restriction === 'password_change') {
    currentUser.must_change_password = false;
  }
  if (restriction === 'mfa_enroll') {
    currentUser.mfa_enrolled = true;
    currentUser.mfa_required = true;
  }
}

// --- authorisation ---

/**
 * Validate the session and enforce one permission, returning the caller.
 *
 * A large number of handlers checked only `validateSession()`, which answers
 * "is someone logged in" and nothing else — so a `viewer` reached lab results,
 * organ offers, living-donor records, post-transplant follow-up and the audit
 * trail exactly as a coordinator did. Roles were being enforced in the renderer
 * only, and the renderer is not a trust boundary.
 *
 * Kept here rather than in each handler so the failure mode is uniform: the
 * message never says whether the record exists, and the permission set is the
 * one in services/accessControl.cjs rather than a role name compared inline.
 *
 * @param {string} permission  a value from accessControl.PERMISSIONS
 * @param {string} [activity]  what the caller was attempting, for the message
 * @returns {object} the current user
 */
function requirePermission(permission, activity) {
  if (!validateSession()) throw new Error('Session expired. Please log in again.');

  const { hasPermission } = require('../services/accessControl.cjs');
  if (!hasPermission(currentUser?.role, permission)) {
    throw new Error(
      `Permission denied: ${activity || 'this operation'} requires the "${permission}" permission`
    );
  }
  return currentUser;
}

/**
 * Validate the session and require the administrator role.
 *
 * Used where the operation is not expressible as a single data permission —
 * backup inventory, restore, updates — and where the intent is "operators only"
 * rather than "anyone holding this capability".
 */
function requireAdmin(activity) {
  if (!validateSession()) throw new Error('Session expired. Please log in again.');
  if (currentUser?.role !== 'admin') {
    throw new Error(`Administrator access required for ${activity || 'this operation'}`);
  }
  return currentUser;
}

// --- handler wrapper ---

function wrapHandler(handlerFn, opts) {
  const allowRestricted = opts?.allowRestricted || false;
  return async (event, ...args) => {
    const senderId = event?.sender?.id;

    if (!validateSession(senderId)) {
      throw new Error('Session expired. Please log in again.');
    }

    if (!allowRestricted) {
      assertSessionUnrestricted();
    }

    const userId = currentUser?.id || 'anon';
    const channel = event?.sender?._events?.['ipc-message']?.[0]?.name || 'unknown';
    const rateResult = checkRateLimit(userId, channel);
    if (!rateResult.allowed) {
      throw new Error(rateResult.error);
    }

    return handlerFn(event, ...args);
  };
}

// Security constants

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const SESSION_DURATION_MS = securityPolicy.SESSION_ABSOLUTE_MS;

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

const ALLOWED_WRITE_COLUMNS = {
  patients: [
    'patient_id', 'first_name', 'last_name', 'date_of_birth', 'blood_type',
    'organ_needed', 'medical_urgency', 'waitlist_status', 'date_added_to_waitlist',
    'priority_score', 'priority_score_breakdown', 'hla_typing', 'pra_percentage',
    'cpra_percentage', 'meld_score', 'las_score', 'functional_status', 'prognosis_rating',
    'last_evaluation_date', 'comorbidity_score', 'previous_transplants', 'compliance_score',
    'weight_kg', 'height_cm', 'phone', 'email', 'contact_phone', 'contact_email',
    'address', 'emergency_contact_name', 'emergency_contact_phone', 'diagnosis',
    'comorbidities', 'medications', 'donor_preferences', 'psychological_clearance',
    'support_system_rating', 'document_urls', 'notes',
  ],
  donor_organs: [
    'donor_id', 'organ_type', 'blood_type', 'hla_typing', 'donor_age',
    'donor_weight_kg', 'donor_height_cm', 'cause_of_death', 'cold_ischemia_time_hours',
    'organ_condition', 'organ_quality', 'organ_status', 'status', 'recovery_date',
    'procurement_date', 'recovery_hospital', 'location', 'expiration_date', 'notes',
  ],
  matches: [
    'donor_organ_id', 'patient_id', 'patient_name', 'compatibility_score',
    'blood_type_compatible', 'abo_compatible', 'hla_match_score', 'hla_a_match',
    'hla_b_match', 'hla_dr_match', 'hla_dq_match', 'size_compatible', 'match_status',
    'priority_rank', 'virtual_crossmatch_result', 'physical_crossmatch_result',
    'predicted_graft_survival', 'notes',
  ],
  notifications: [
    'recipient_email', 'title', 'message', 'notification_type', 'is_read',
    'related_patient_id', 'related_patient_name', 'priority_level', 'action_url',
    'metadata', 'read_date',
  ],
  notification_rules: [
    'rule_name', 'description', 'trigger_event', 'conditions',
    'notification_template', 'priority_level', 'is_active',
  ],
  priority_weights: [
    'name', 'description', 'medical_urgency_weight', 'time_on_waitlist_weight',
    'organ_specific_score_weight', 'evaluation_recency_weight', 'blood_type_rarity_weight',
    'evaluation_decay_rate', 'is_active',
  ],
  ehr_integrations: [
    // Canonical columns (schema.cjs)
    'name', 'type', 'base_url', 'api_key_encrypted', 'is_active',
    'last_sync_date', 'sync_frequency_minutes',
    // Extended columns (migrations.cjs) used by the Integrations UI
    'integration_name', 'ehr_system_type', 'endpoint_url', 'auth_type',
    'enable_bidirectional_sync', 'sync_fields_to_ehr',
    'auto_create_patients', 'auto_update_existing', 'sync_frequency',
    'total_imports', 'total_exports', 'last_export_date',
  ],
  ehr_imports: [
    'integration_id', 'import_type', 'status', 'records_imported',
    'records_failed', 'error_details', 'import_data', 'completed_date',
  ],
  ehr_sync_logs: [
    'integration_id', 'sync_type', 'direction', 'status',
    'records_processed', 'records_failed', 'error_details', 'completed_date',
  ],
  ehr_validation_rules: [
    'field_name', 'rule_type', 'rule_value', 'error_message', 'is_active',
  ],
  readiness_barriers: [
    'patient_id', 'barrier_type', 'status', 'risk_level', 'owning_role',
    'identified_date', 'target_resolution_date', 'resolved_date', 'notes',
  ],
  adult_health_history_questionnaires: [
    'patient_id', 'status', 'last_completed_date', 'expiration_date',
    'validity_period_days', 'identified_issues', 'owning_role', 'notes',
  ],
};

function filterToAllowedColumns(tableName, data) {
  const allowed = ALLOWED_WRITE_COLUMNS[tableName];
  if (!allowed) return data;
  const filtered = {};
  for (const key of Object.keys(data)) {
    if (allowed.includes(key)) {
      filtered[key] = data[key];
    }
  }
  return filtered;
}

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

// --- password validation ---

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

// Login attempt tracking

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

// --- order-by validation ---

function isValidOrderColumn(tableName, column) {
  const allowedColumns = ALLOWED_ORDER_COLUMNS[tableName];
  if (!allowedColumns) return false;
  return allowedColumns.includes(column);
}

// Entity helpers

/**
 * Rehydrate the columns listed in `jsonFields` from their stored text form.
 *
 * Constraint: these columns are TEXT and are not guaranteed to hold JSON. Rows
 * predate the convention, arrive from imports, or were written by an older
 * build, so a value that does not parse is normal input rather than an error —
 * it is returned as the original string and the caller sees the raw text. The
 * parse is therefore attempted, not asserted; JSON.parse cannot execute its
 * input, so a malformed value costs nothing beyond the rejected parse.
 */
function parseJsonFields(row) {
  if (!row) return row;
  const parsed = { ...row };
  for (const field of jsonFields) {
    if (parsed[field] && typeof parsed[field] === 'string') {
      try { parsed[field] = JSON.parse(parsed[field]); } catch { /* not JSON — keep the stored text */ }
    }
  }
  return parsed;
}

/**
 * @deprecated Use getEntityByIdAndOrg — this function is retained only for
 * backward-compatibility during migration.  In production it throws to
 * enforce org-scoped access.
 */
function getEntityById(/* tableName, id */) {
  throw new Error(
    'getEntityById is deprecated and disabled for security. Use getEntityByIdAndOrg with an explicit org_id.'
  );
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

// --- audit logging with hash chain ---

/**
 * Write one audit record.
 *
 * FAIL-CLOSED: this throws when the record cannot be written with its full
 * hash-chain fields, and callers must let that propagate so the operation being
 * audited fails too. It previously degraded twice — retrying without the HMAC,
 * then inserting a row with no hash at all, then swallowing everything — which
 * meant a failing audit trail was indistinguishable from a working one and the
 * PHI operation completed regardless. An operation that cannot be evidenced
 * must not happen.
 *
 * The chaining, sequencing and column handling live in services/auditChain.cjs
 * so that this writer and the direct writers in database/init.cjs and
 * services/encryptionKeyManagement.cjs cannot drift apart.
 */
function logAudit(action, entityType, entityId, patientName, details, userEmail, userRole, requestId) {
  const { appendAuditRecord } = require('../services/auditChain.cjs');

  const written = appendAuditRecord({
    org_id: currentUser?.org_id || 'SYSTEM',
    action,
    entity_type: entityType || null,
    entity_id: entityId || null,
    patient_name: patientName || null,
    details: details || null,
    user_id: currentUser?.id || null,
    user_email: userEmail || null,
    user_role: userRole || null,
    request_id: requestId || null,
  }, { db: getDatabase() });

  // Forwarding is best-effort by design: the record is already durable in the
  // local trail, and an unreachable collector must not undo a completed
  // clinical operation.
  try {
    const siem = require('../services/siemForwarder.cjs');
    siem.forwardAuditRow({
      id: written.id, org_id: written.orgId, action,
      entity_type: entityType, entity_id: entityId,
      patient_name: patientName, details, user_email: userEmail, user_role: userRole,
      prev_hash: written.prevHash, record_hash: written.recordHash,
      request_id: requestId || null, created_at: written.createdAt,
    });
  } catch { /* ignore */ }

  return written;
}

/**
 * Verify the integrity of the audit log hash chain for an org.
 * Returns { ok: true } or { ok: false, brokenAt: <row id> }.
 *
 * Delegates to services/auditChain.cjs so the desktop has exactly one chain
 * verification implementation. Retained here for the existing callers that
 * import it from shared.
 */
function verifyAuditChain(orgId) {
  const { verifyAuditChain: verify } = require('../services/auditChain.cjs');
  return verify(orgId || currentUser?.org_id || 'SYSTEM');
}

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
  touchSession,
  requirePermission,
  requireAdmin,
  SESSION_DURATION_MS,
  IDLE_TIMEOUT_MS,
  wrapHandler,

  // Session restrictions
  sessionAllows,
  assertSessionUnrestricted,
  clearSessionRestriction,

  // Request context (WebContents binding)
  setRequestContext,
  clearRequestContext,

  // Security
  validatePasswordStrength,
  checkAccountLockout,
  recordFailedLogin,
  clearFailedLogins,

  // Constants
  ALLOWED_ORDER_COLUMNS,
  ALLOWED_WRITE_COLUMNS,
  entityTableMap,
  jsonFields,
  MAX_LOGIN_ATTEMPTS,
  LOCKOUT_DURATION_MS,

  // Entity helpers
  isValidOrderColumn,
  filterToAllowedColumns,
  parseJsonFields,
  getEntityById,
  getEntityByIdAndOrg,
  listEntitiesByOrg,
  sanitizeForSQLite,

  // Audit
  logAudit,
  verifyAuditChain,
};
