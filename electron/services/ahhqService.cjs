/**
 * TransTrack - Adult Health History Questionnaire (aHHQ) Service
 * 
 * PURPOSE: Track operational status of aHHQ documentation for patients.
 * 
 * IMPORTANT DISCLAIMER:
 * This service is strictly NON-CLINICAL, NON-ALLOCATIVE, and designed for
 * OPERATIONAL DOCUMENTATION purposes only.
 * 
 * It answers:
 * - Is the aHHQ present?
 * - Is it complete?
 * - Is it current?
 * - Is it approaching expiration?
 * - Is follow-up required?
 * 
 * It does NOT:
 * - Store medical narratives
 * - Perform clinical interpretation
 * - Make eligibility decisions
 * - Replace OPTN/UNOS systems
 * 
 * All changes are audited for compliance with FDA 21 CFR Part 11.
 */

const { getDatabase } = require('../database/init.cjs');
const { v4: uuidv4 } = require('uuid');

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * aHHQ Status values
 */
const AHHQ_STATUS = {
  COMPLETE: 'complete',
  INCOMPLETE: 'incomplete',
  PENDING_UPDATE: 'pending_update',
  EXPIRED: 'expired',
};

/**
 * Identified issues that can flag an aHHQ
 * These are operational documentation issues, NOT clinical findings
 */
const AHHQ_ISSUES = {
  MISSING_SECTIONS: {
    value: 'MISSING_SECTIONS',
    label: 'Missing sections',
    description: 'One or more required sections are incomplete',
  },
  OUTDATED_INFORMATION: {
    value: 'OUTDATED_INFORMATION',
    label: 'Outdated information',
    description: 'Information needs to be reviewed and updated',
  },
  FOLLOW_UP_REQUIRED: {
    value: 'FOLLOW_UP_REQUIRED',
    label: 'Follow-up required',
    description: 'Additional documentation or follow-up is needed',
  },
  DOCUMENTATION_PENDING: {
    value: 'DOCUMENTATION_PENDING',
    label: 'Documentation pending',
    description: 'Supporting documentation has been requested',
  },
  SIGNATURE_REQUIRED: {
    value: 'SIGNATURE_REQUIRED',
    label: 'Signature required',
    description: 'Patient or provider signature is needed',
  },
  VERIFICATION_NEEDED: {
    value: 'VERIFICATION_NEEDED',
    label: 'Verification needed',
    description: 'Information requires verification',
  },
};

/**
 * Owning roles for aHHQ management
 */
const AHHQ_OWNING_ROLES = {
  COORDINATOR: { value: 'coordinator', label: 'Transplant Coordinator' },
  SOCIAL_WORK: { value: 'social_work', label: 'Social Work' },
  CLINICAL: { value: 'clinical', label: 'Clinical Staff' },
  OTHER: { value: 'other', label: 'Other' },
};

/**
 * Default validity period in days
 */
const DEFAULT_VALIDITY_DAYS = 365;

/**
 * Warning threshold - days before expiration to trigger warning
 */
const EXPIRATION_WARNING_DAYS = 30;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Calculate expiration date from completion date
 */
function calculateExpirationDate(completedDate, validityDays = DEFAULT_VALIDITY_DAYS) {
  const date = new Date(completedDate);
  date.setDate(date.getDate() + validityDays);
  return date.toISOString();
}

/**
 * Check if aHHQ is expiring soon
 */
function isExpiringSoon(expirationDate, warningDays = EXPIRATION_WARNING_DAYS) {
  if (!expirationDate) return false;
  
  const expiry = new Date(expirationDate);
  const now = new Date();
  const daysUntilExpiry = Math.floor((expiry - now) / (1000 * 60 * 60 * 24));
  
  return daysUntilExpiry > 0 && daysUntilExpiry <= warningDays;
}

/**
 * Check if aHHQ is expired
 */
function isExpired(expirationDate) {
  if (!expirationDate) return false;
  
  const expiry = new Date(expirationDate);
  const now = new Date();
  
  return now > expiry;
}

/**
 * Get days until expiration
 */
function getDaysUntilExpiration(expirationDate) {
  if (!expirationDate) return null;
  
  const expiry = new Date(expirationDate);
  const now = new Date();
  const days = Math.floor((expiry - now) / (1000 * 60 * 60 * 24));
  
  return days;
}

/**
 * Parse identified issues from JSON string
 */
function parseIssues(issuesJson) {
  if (!issuesJson) return [];
  try {
    return JSON.parse(issuesJson);
  } catch {
    return [];
  }
}

/**
 * Stringify identified issues to JSON
 */
function stringifyIssues(issues) {
  if (!issues || !Array.isArray(issues)) return null;
  if (issues.length === 0) return null;
  return JSON.stringify(issues);
}

// =============================================================================
// CRUD OPERATIONS
// =============================================================================

/**
 * Create a new aHHQ record for a patient
 */
function createAHHQ(data, userId) {
  const db = getDatabase();
  const id = uuidv4();
  
  // Calculate expiration date if completing
  let expirationDate = data.expiration_date || null;
  if (data.status === AHHQ_STATUS.COMPLETE && data.last_completed_date && !expirationDate) {
    expirationDate = calculateExpirationDate(
      data.last_completed_date,
      data.validity_period_days || DEFAULT_VALIDITY_DAYS
    );
  }
  
  const stmt = db.prepare(`
    INSERT INTO adult_health_history_questionnaires (
      id, patient_id, status, last_completed_date, expiration_date,
      validity_period_days, identified_issues, owning_role, notes,
      created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `);
  
  stmt.run(
    id,
    data.patient_id,
    data.status || AHHQ_STATUS.INCOMPLETE,
    data.last_completed_date || null,
    expirationDate,
    data.validity_period_days || DEFAULT_VALIDITY_DAYS,
    stringifyIssues(data.identified_issues),
    data.owning_role || 'coordinator',
    data.notes || null,
    userId
  );
  
  return getAHHQById(id);
}

/**
 * Get aHHQ by ID
 */
function getAHHQById(id) {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT a.*, p.first_name || ' ' || p.last_name as patient_name
    FROM adult_health_history_questionnaires a
    LEFT JOIN patients p ON a.patient_id = p.id
    WHERE a.id = ?
  `).get(id);
  
  if (row) {
    row.identified_issues = parseIssues(row.identified_issues);
    row.is_expiring_soon = isExpiringSoon(row.expiration_date);
    row.is_expired = isExpired(row.expiration_date);
    row.days_until_expiration = getDaysUntilExpiration(row.expiration_date);
  }
  
  return row;
}

/**
 * Get aHHQ for a patient
 */
function getAHHQByPatientId(patientId) {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT * FROM adult_health_history_questionnaires
    WHERE patient_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(patientId);
  
  if (row) {
    row.identified_issues = parseIssues(row.identified_issues);
    row.is_expiring_soon = isExpiringSoon(row.expiration_date);
    row.is_expired = isExpired(row.expiration_date);
    row.days_until_expiration = getDaysUntilExpiration(row.expiration_date);
  }
  
  return row;
}

/**
 * Get all aHHQs with filters
 */
function getAllAHHQs(filters = {}) {
  const db = getDatabase();
  
  let query = `
    SELECT a.*, p.first_name || ' ' || p.last_name as patient_name
    FROM adult_health_history_questionnaires a
    LEFT JOIN patients p ON a.patient_id = p.id
    WHERE 1=1
  `;
  const params = [];
  
  if (filters.status) {
    query += ` AND a.status = ?`;
    params.push(filters.status);
  }
  
  if (filters.owning_role) {
    query += ` AND a.owning_role = ?`;
    params.push(filters.owning_role);
  }
  
  query += ` ORDER BY a.expiration_date ASC, a.created_at DESC`;
  
  if (filters.limit) {
    query += ` LIMIT ?`;
    params.push(filters.limit);
  }
  
  const rows = db.prepare(query).all(...params);
  
  return rows.map(row => ({
    ...row,
    identified_issues: parseIssues(row.identified_issues),
    is_expiring_soon: isExpiringSoon(row.expiration_date),
    is_expired: isExpired(row.expiration_date),
    days_until_expiration: getDaysUntilExpiration(row.expiration_date),
  }));
}

/**
 * Get aHHQs expiring within specified days
 */
function getExpiringAHHQs(days = EXPIRATION_WARNING_DAYS) {
  const db = getDatabase();
  const now = new Date().toISOString();
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + days);
  const futureDateStr = futureDate.toISOString();
  
  const rows = db.prepare(`
    SELECT a.*, p.first_name || ' ' || p.last_name as patient_name
    FROM adult_health_history_questionnaires a
    LEFT JOIN patients p ON a.patient_id = p.id
    WHERE a.status = 'complete'
    AND a.expiration_date IS NOT NULL
    AND a.expiration_date > ?
    AND a.expiration_date <= ?
    ORDER BY a.expiration_date ASC
  `).all(now, futureDateStr);
  
  return rows.map(row => ({
    ...row,
    identified_issues: parseIssues(row.identified_issues),
    is_expiring_soon: true,
    is_expired: false,
    days_until_expiration: getDaysUntilExpiration(row.expiration_date),
  }));
}

/**
 * Get expired aHHQs
 */
function getExpiredAHHQs() {
  const db = getDatabase();
  const now = new Date().toISOString();
  
  const rows = db.prepare(`
    SELECT a.*, p.first_name || ' ' || p.last_name as patient_name
    FROM adult_health_history_questionnaires a
    LEFT JOIN patients p ON a.patient_id = p.id
    WHERE (a.status = 'expired' OR (a.expiration_date IS NOT NULL AND a.expiration_date < ?))
    ORDER BY a.expiration_date ASC
  `).all(now);
  
  return rows.map(row => ({
    ...row,
    identified_issues: parseIssues(row.identified_issues),
    is_expiring_soon: false,
    is_expired: true,
    days_until_expiration: getDaysUntilExpiration(row.expiration_date),
  }));
}

/**
 * Get incomplete aHHQs
 */
function getIncompleteAHHQs() {
  const db = getDatabase();
  
  const rows = db.prepare(`
    SELECT a.*, p.first_name || ' ' || p.last_name as patient_name
    FROM adult_health_history_questionnaires a
    LEFT JOIN patients p ON a.patient_id = p.id
    WHERE a.status IN ('incomplete', 'pending_update')
    ORDER BY a.created_at DESC
  `).all();
  
  return rows.map(row => ({
    ...row,
    identified_issues: parseIssues(row.identified_issues),
    is_expiring_soon: isExpiringSoon(row.expiration_date),
    is_expired: isExpired(row.expiration_date),
    days_until_expiration: getDaysUntilExpiration(row.expiration_date),
  }));
}

/**
 * Update aHHQ record
 */
function updateAHHQ(id, data, userId) {
  const db = getDatabase();
  const existing = getAHHQById(id);
  
  if (!existing) {
    throw new Error('aHHQ record not found');
  }
  
  // Calculate new expiration date if completing
  let expirationDate = data.expiration_date !== undefined ? data.expiration_date : existing.expiration_date;
  if (data.status === AHHQ_STATUS.COMPLETE && data.last_completed_date) {
    expirationDate = calculateExpirationDate(
      data.last_completed_date,
      data.validity_period_days || existing.validity_period_days || DEFAULT_VALIDITY_DAYS
    );
  }
  
  const stmt = db.prepare(`
    UPDATE adult_health_history_questionnaires
    SET status = ?,
        last_completed_date = ?,
        expiration_date = ?,
        validity_period_days = ?,
        identified_issues = ?,
        owning_role = ?,
        notes = ?,
        updated_at = datetime('now'),
        updated_by = ?
    WHERE id = ?
  `);
  
  stmt.run(
    data.status !== undefined ? data.status : existing.status,
    data.last_completed_date !== undefined ? data.last_completed_date : existing.last_completed_date,
    expirationDate,
    data.validity_period_days !== undefined ? data.validity_period_days : existing.validity_period_days,
    data.identified_issues !== undefined ? stringifyIssues(data.identified_issues) : stringifyIssues(existing.identified_issues),
    data.owning_role !== undefined ? data.owning_role : existing.owning_role,
    data.notes !== undefined ? data.notes : existing.notes,
    userId,
    id
  );
  
  return getAHHQById(id);
}

/**
 * Mark aHHQ as complete
 */
function markAHHQComplete(id, completedDate, userId) {
  const now = completedDate || new Date().toISOString();
  
  return updateAHHQ(id, {
    status: AHHQ_STATUS.COMPLETE,
    last_completed_date: now,
    identified_issues: [], // Clear issues on completion
  }, userId);
}

/**
 * Mark aHHQ as requiring follow-up
 */
function markAHHQFollowUpRequired(id, issues, userId) {
  return updateAHHQ(id, {
    status: AHHQ_STATUS.PENDING_UPDATE,
    identified_issues: issues || [AHHQ_ISSUES.FOLLOW_UP_REQUIRED.value],
  }, userId);
}

/**
 * Delete aHHQ record
 */
function deleteAHHQ(id) {
  const db = getDatabase();
  db.prepare('DELETE FROM adult_health_history_questionnaires WHERE id = ?').run(id);
  return { success: true };
}

// =============================================================================
// PATIENT SUMMARY
// =============================================================================

/**
 * Get aHHQ summary for a patient
 */
function getPatientAHHQSummary(patientId) {
  const ahhq = getAHHQByPatientId(patientId);
  
  if (!ahhq) {
    return {
      exists: false,
      status: null,
      riskLevel: 'high', // No aHHQ is a documentation gap
      riskDescription: 'No aHHQ on file',
      needsAttention: true,
      ahhq: null,
    };
  }
  
  let riskLevel = 'low';
  let riskDescription = 'aHHQ is complete and current';
  let needsAttention = false;
  
  if (ahhq.is_expired || ahhq.status === AHHQ_STATUS.EXPIRED) {
    riskLevel = 'high';
    riskDescription = 'aHHQ has expired - update needed';
    needsAttention = true;
  } else if (ahhq.is_expiring_soon) {
    riskLevel = 'medium';
    riskDescription = `aHHQ expiring in ${ahhq.days_until_expiration} days`;
    needsAttention = true;
  } else if (ahhq.status === AHHQ_STATUS.INCOMPLETE) {
    riskLevel = 'high';
    riskDescription = 'aHHQ is incomplete';
    needsAttention = true;
  } else if (ahhq.status === AHHQ_STATUS.PENDING_UPDATE) {
    riskLevel = 'medium';
    riskDescription = 'aHHQ pending update';
    needsAttention = true;
  }
  
  return {
    exists: true,
    status: ahhq.status,
    riskLevel,
    riskDescription,
    needsAttention,
    daysUntilExpiration: ahhq.days_until_expiration,
    ahhq,
  };
}

// =============================================================================
// DASHBOARD METRICS
// =============================================================================

/**
 * Get aHHQ dashboard metrics for risk dashboard
 */
function getAHHQDashboard() {
  const db = getDatabase();
  const now = new Date().toISOString();
  const warningDate = new Date();
  warningDate.setDate(warningDate.getDate() + EXPIRATION_WARNING_DAYS);
  const warningDateStr = warningDate.toISOString();
  
  // Get total active patients
  const totalPatients = db.prepare(`
    SELECT COUNT(*) as count FROM patients WHERE waitlist_status = 'active'
  `).get().count;
  
  // Get patients with aHHQ
  const patientsWithAHHQ = db.prepare(`
    SELECT COUNT(DISTINCT patient_id) as count FROM adult_health_history_questionnaires
  `).get().count;
  
  // Get complete aHHQs
  const completeCount = db.prepare(`
    SELECT COUNT(*) as count FROM adult_health_history_questionnaires
    WHERE status = 'complete' AND (expiration_date IS NULL OR expiration_date > ?)
  `).get(now).count;
  
  // Get incomplete aHHQs
  const incompleteCount = db.prepare(`
    SELECT COUNT(*) as count FROM adult_health_history_questionnaires
    WHERE status IN ('incomplete', 'pending_update')
  `).get().count;
  
  // Get expiring soon
  const expiringCount = db.prepare(`
    SELECT COUNT(*) as count FROM adult_health_history_questionnaires
    WHERE status = 'complete'
    AND expiration_date IS NOT NULL
    AND expiration_date > ?
    AND expiration_date <= ?
  `).get(now, warningDateStr).count;
  
  // Get expired
  const expiredCount = db.prepare(`
    SELECT COUNT(*) as count FROM adult_health_history_questionnaires
    WHERE status = 'expired' OR (expiration_date IS NOT NULL AND expiration_date < ?)
  `).get(now).count;
  
  // Get by status
  const byStatus = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM adult_health_history_questionnaires
    GROUP BY status
  `).all().reduce((acc, row) => {
    acc[row.status] = row.count;
    return acc;
  }, {});
  
  // Get by owning role
  const byOwningRole = db.prepare(`
    SELECT owning_role, COUNT(*) as count
    FROM adult_health_history_questionnaires
    GROUP BY owning_role
  `).all().reduce((acc, row) => {
    acc[row.owning_role] = row.count;
    return acc;
  }, {});
  
  // Patients needing attention (missing, incomplete, expiring, or expired)
  const patientsNeedingAttention = db.prepare(`
    SELECT COUNT(*) as count FROM (
      SELECT p.id FROM patients p
      LEFT JOIN adult_health_history_questionnaires a ON p.id = a.patient_id
      WHERE p.waitlist_status = 'active'
      AND (
        a.id IS NULL
        OR a.status IN ('incomplete', 'pending_update', 'expired')
        OR (a.expiration_date IS NOT NULL AND a.expiration_date < ?)
        OR (a.expiration_date IS NOT NULL AND a.expiration_date <= ?)
      )
      GROUP BY p.id
    )
  `).get(now, warningDateStr).count;
  
  return {
    totalPatients,
    patientsWithAHHQ,
    patientsWithoutAHHQ: totalPatients - patientsWithAHHQ,
    completeCount,
    incompleteCount,
    expiringCount,
    expiredCount,
    byStatus,
    byOwningRole,
    patientsNeedingAttention,
    patientsNeedingAttentionPercentage: totalPatients > 0 
      ? ((patientsNeedingAttention / totalPatients) * 100).toFixed(1)
      : '0.0',
    warningThresholdDays: EXPIRATION_WARNING_DAYS,
  };
}

/**
 * Get patients with aHHQ issues for risk drill-down
 */
function getPatientsWithAHHQIssues(limit = 10) {
  const db = getDatabase();
  const now = new Date().toISOString();
  const warningDate = new Date();
  warningDate.setDate(warningDate.getDate() + EXPIRATION_WARNING_DAYS);
  const warningDateStr = warningDate.toISOString();
  
  const rows = db.prepare(`
    SELECT 
      p.id as patient_id,
      p.first_name || ' ' || p.last_name as patient_name,
      a.id as ahhq_id,
      a.status,
      a.expiration_date,
      a.identified_issues,
      a.owning_role,
      CASE
        WHEN a.id IS NULL THEN 'missing'
        WHEN a.status = 'expired' OR (a.expiration_date IS NOT NULL AND a.expiration_date < ?) THEN 'expired'
        WHEN a.expiration_date IS NOT NULL AND a.expiration_date <= ? THEN 'expiring'
        WHEN a.status IN ('incomplete', 'pending_update') THEN 'incomplete'
        ELSE 'ok'
      END as issue_type
    FROM patients p
    LEFT JOIN adult_health_history_questionnaires a ON p.id = a.patient_id
    WHERE p.waitlist_status = 'active'
    AND (
      a.id IS NULL
      OR a.status IN ('incomplete', 'pending_update', 'expired')
      OR (a.expiration_date IS NOT NULL AND a.expiration_date < ?)
      OR (a.expiration_date IS NOT NULL AND a.expiration_date <= ?)
    )
    ORDER BY 
      CASE issue_type
        WHEN 'expired' THEN 1
        WHEN 'missing' THEN 2
        WHEN 'incomplete' THEN 3
        WHEN 'expiring' THEN 4
        ELSE 5
      END,
      a.expiration_date ASC
    LIMIT ?
  `).all(now, warningDateStr, now, warningDateStr, limit);
  
  return rows.map(row => ({
    ...row,
    identified_issues: parseIssues(row.identified_issues),
    days_until_expiration: row.expiration_date ? getDaysUntilExpiration(row.expiration_date) : null,
  }));
}

// =============================================================================
// AUDIT HISTORY
// =============================================================================

/**
 * Get aHHQ audit history
 */
function getAHHQAuditHistory(patientId = null, startDate = null, endDate = null) {
  const db = getDatabase();
  
  let query = `
    SELECT al.*, u.full_name as user_name
    FROM audit_logs al
    LEFT JOIN users u ON al.user_email = u.email
    WHERE al.entity_type = 'AdultHealthHistoryQuestionnaire'
  `;
  const params = [];
  
  if (patientId) {
    query += ` AND al.details LIKE ?`;
    params.push(`%"patient_id":"${patientId}"%`);
  }
  
  if (startDate) {
    query += ` AND al.timestamp >= ?`;
    params.push(startDate);
  }
  
  if (endDate) {
    query += ` AND al.timestamp <= ?`;
    params.push(endDate);
  }
  
  query += ` ORDER BY al.timestamp DESC LIMIT 100`;
  
  return db.prepare(query).all(...params);
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Constants
  AHHQ_STATUS,
  AHHQ_ISSUES,
  AHHQ_OWNING_ROLES,
  DEFAULT_VALIDITY_DAYS,
  EXPIRATION_WARNING_DAYS,
  
  // Helpers
  calculateExpirationDate,
  isExpiringSoon,
  isExpired,
  getDaysUntilExpiration,
  
  // CRUD
  createAHHQ,
  getAHHQById,
  getAHHQByPatientId,
  getAllAHHQs,
  getExpiringAHHQs,
  getExpiredAHHQs,
  getIncompleteAHHQs,
  updateAHHQ,
  markAHHQComplete,
  markAHHQFollowUpRequired,
  deleteAHHQ,
  
  // Summaries
  getPatientAHHQSummary,
  getAHHQDashboard,
  getPatientsWithAHHQIssues,
  
  // Audit
  getAHHQAuditHistory,
};
