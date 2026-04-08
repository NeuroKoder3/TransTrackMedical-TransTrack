/**
 * TransTrack - Adult Health History Questionnaire (aHHQ) Service
 * 
 * PURPOSE: Track operational status of aHHQ documentation for patients.
 * 
 * IMPORTANT DISCLAIMER:
 * This service is strictly NON-CLINICAL, NON-ALLOCATIVE, and designed for
 * OPERATIONAL DOCUMENTATION purposes only.
 * 
 * SECURITY:
 * All functions require org_id for organization isolation.
 * Queries always include org_id filtering to prevent cross-org access.
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

// Constants

const AHHQ_STATUS = {
  COMPLETE: 'complete',
  INCOMPLETE: 'incomplete',
  PENDING_UPDATE: 'pending_update',
  EXPIRED: 'expired',
};

const AHHQ_ISSUES = {
  MISSING_SECTIONS: { value: 'MISSING_SECTIONS', label: 'Missing sections' },
  OUTDATED_INFORMATION: { value: 'OUTDATED_INFORMATION', label: 'Outdated information' },
  FOLLOW_UP_REQUIRED: { value: 'FOLLOW_UP_REQUIRED', label: 'Follow-up required' },
  DOCUMENTATION_PENDING: { value: 'DOCUMENTATION_PENDING', label: 'Documentation pending' },
  SIGNATURE_REQUIRED: { value: 'SIGNATURE_REQUIRED', label: 'Signature required' },
  VERIFICATION_NEEDED: { value: 'VERIFICATION_NEEDED', label: 'Verification needed' },
};

const AHHQ_OWNING_ROLES = {
  COORDINATOR: { value: 'coordinator', label: 'Transplant Coordinator' },
  SOCIAL_WORK: { value: 'social_work', label: 'Social Work' },
  CLINICAL: { value: 'clinical', label: 'Clinical Staff' },
  OTHER: { value: 'other', label: 'Other' },
};

const DEFAULT_VALIDITY_DAYS = 365;
const EXPIRATION_WARNING_DAYS = 30;

// --- org isolation ---

function requireOrgId(orgId) {
  if (!orgId) {
    throw new Error('Organization context required for aHHQ operations');
  }
  return orgId;
}

function verifyPatientOrg(patientId, orgId) {
  const db = getDatabase();
  const patient = db.prepare('SELECT id FROM patients WHERE id = ? AND org_id = ?').get(patientId, orgId);
  if (!patient) {
    throw new Error('Patient not found or access denied');
  }
  return true;
}

// Helpers

function calculateExpirationDate(completedDate, validityDays = DEFAULT_VALIDITY_DAYS) {
  const date = new Date(completedDate);
  date.setDate(date.getDate() + validityDays);
  return date.toISOString();
}

function isExpiringSoon(expirationDate, warningDays = EXPIRATION_WARNING_DAYS) {
  if (!expirationDate) return false;
  const expiry = new Date(expirationDate);
  const now = new Date();
  const daysUntilExpiry = Math.floor((expiry - now) / (1000 * 60 * 60 * 24));
  return daysUntilExpiry > 0 && daysUntilExpiry <= warningDays;
}

function isExpired(expirationDate) {
  if (!expirationDate) return false;
  return new Date() > new Date(expirationDate);
}

function getDaysUntilExpiration(expirationDate) {
  if (!expirationDate) return null;
  return Math.floor((new Date(expirationDate) - new Date()) / (1000 * 60 * 60 * 24));
}

function parseIssues(issuesJson) {
  if (!issuesJson) return [];
  try { return JSON.parse(issuesJson); } catch { return []; }
}

function stringifyIssues(issues) {
  if (!issues || !Array.isArray(issues) || issues.length === 0) return null;
  return JSON.stringify(issues);
}

// --- CRUD operations ---

function createAHHQ(data, userId, orgId) {
  requireOrgId(orgId);
  verifyPatientOrg(data.patient_id, orgId);
  
  const db = getDatabase();
  const id = uuidv4();
  
  let expirationDate = data.expiration_date || null;
  if (data.status === AHHQ_STATUS.COMPLETE && data.last_completed_date && !expirationDate) {
    expirationDate = calculateExpirationDate(
      data.last_completed_date,
      data.validity_period_days || DEFAULT_VALIDITY_DAYS
    );
  }
  
  const stmt = db.prepare(`
    INSERT INTO adult_health_history_questionnaires (
      id, org_id, patient_id, status, last_completed_date, expiration_date,
      validity_period_days, identified_issues, owning_role, notes,
      created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `);
  
  stmt.run(
    id, orgId, data.patient_id,
    data.status || AHHQ_STATUS.INCOMPLETE,
    data.last_completed_date || null,
    expirationDate,
    data.validity_period_days || DEFAULT_VALIDITY_DAYS,
    stringifyIssues(data.identified_issues),
    data.owning_role || 'coordinator',
    data.notes || null,
    userId
  );
  
  return getAHHQById(id, orgId);
}

function getAHHQById(id, orgId) {
  requireOrgId(orgId);
  const db = getDatabase();
  const row = db.prepare(`
    SELECT a.*, p.first_name || ' ' || p.last_name as patient_name
    FROM adult_health_history_questionnaires a
    LEFT JOIN patients p ON a.patient_id = p.id
    WHERE a.id = ? AND a.org_id = ?
  `).get(id, orgId);
  
  if (row) {
    row.identified_issues = parseIssues(row.identified_issues);
    row.is_expiring_soon = isExpiringSoon(row.expiration_date);
    row.is_expired = isExpired(row.expiration_date);
    row.days_until_expiration = getDaysUntilExpiration(row.expiration_date);
  }
  
  return row;
}

function getAHHQByPatientId(patientId, orgId) {
  requireOrgId(orgId);
  const db = getDatabase();
  const row = db.prepare(`
    SELECT * FROM adult_health_history_questionnaires
    WHERE patient_id = ? AND org_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(patientId, orgId);
  
  if (row) {
    row.identified_issues = parseIssues(row.identified_issues);
    row.is_expiring_soon = isExpiringSoon(row.expiration_date);
    row.is_expired = isExpired(row.expiration_date);
    row.days_until_expiration = getDaysUntilExpiration(row.expiration_date);
  }
  
  return row;
}

function getAllAHHQs(orgId, filters = {}) {
  requireOrgId(orgId);
  const db = getDatabase();
  
  let query = `
    SELECT a.*, p.first_name || ' ' || p.last_name as patient_name
    FROM adult_health_history_questionnaires a
    LEFT JOIN patients p ON a.patient_id = p.id
    WHERE a.org_id = ?
  `;
  const params = [orgId];
  
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

function getExpiringAHHQs(orgId, days = EXPIRATION_WARNING_DAYS) {
  requireOrgId(orgId);
  const db = getDatabase();
  const now = new Date().toISOString();
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + days);
  
  const rows = db.prepare(`
    SELECT a.*, p.first_name || ' ' || p.last_name as patient_name
    FROM adult_health_history_questionnaires a
    LEFT JOIN patients p ON a.patient_id = p.id
    WHERE a.org_id = ? AND a.status = 'complete'
    AND a.expiration_date IS NOT NULL
    AND a.expiration_date > ? AND a.expiration_date <= ?
    ORDER BY a.expiration_date ASC
  `).all(orgId, now, futureDate.toISOString());
  
  return rows.map(row => ({
    ...row,
    identified_issues: parseIssues(row.identified_issues),
    is_expiring_soon: true,
    is_expired: false,
    days_until_expiration: getDaysUntilExpiration(row.expiration_date),
  }));
}

function getExpiredAHHQs(orgId) {
  requireOrgId(orgId);
  const db = getDatabase();
  const now = new Date().toISOString();
  
  const rows = db.prepare(`
    SELECT a.*, p.first_name || ' ' || p.last_name as patient_name
    FROM adult_health_history_questionnaires a
    LEFT JOIN patients p ON a.patient_id = p.id
    WHERE a.org_id = ? AND (a.status = 'expired' OR (a.expiration_date IS NOT NULL AND a.expiration_date < ?))
    ORDER BY a.expiration_date ASC
  `).all(orgId, now);
  
  return rows.map(row => ({
    ...row,
    identified_issues: parseIssues(row.identified_issues),
    is_expiring_soon: false,
    is_expired: true,
    days_until_expiration: getDaysUntilExpiration(row.expiration_date),
  }));
}

function getIncompleteAHHQs(orgId) {
  requireOrgId(orgId);
  const db = getDatabase();
  
  const rows = db.prepare(`
    SELECT a.*, p.first_name || ' ' || p.last_name as patient_name
    FROM adult_health_history_questionnaires a
    LEFT JOIN patients p ON a.patient_id = p.id
    WHERE a.org_id = ? AND a.status IN ('incomplete', 'pending_update')
    ORDER BY a.created_at DESC
  `).all(orgId);
  
  return rows.map(row => ({
    ...row,
    identified_issues: parseIssues(row.identified_issues),
    is_expiring_soon: isExpiringSoon(row.expiration_date),
    is_expired: isExpired(row.expiration_date),
    days_until_expiration: getDaysUntilExpiration(row.expiration_date),
  }));
}

function updateAHHQ(id, data, userId, orgId) {
  requireOrgId(orgId);
  const db = getDatabase();
  const existing = getAHHQById(id, orgId);
  
  if (!existing) {
    throw new Error('aHHQ record not found or access denied');
  }
  
  let expirationDate = data.expiration_date !== undefined ? data.expiration_date : existing.expiration_date;
  if (data.status === AHHQ_STATUS.COMPLETE && data.last_completed_date) {
    expirationDate = calculateExpirationDate(
      data.last_completed_date,
      data.validity_period_days || existing.validity_period_days || DEFAULT_VALIDITY_DAYS
    );
  }
  
  const stmt = db.prepare(`
    UPDATE adult_health_history_questionnaires
    SET status = ?, last_completed_date = ?, expiration_date = ?,
        validity_period_days = ?, identified_issues = ?, owning_role = ?,
        notes = ?, updated_at = datetime('now'), updated_by = ?
    WHERE id = ? AND org_id = ?
  `);
  
  stmt.run(
    data.status !== undefined ? data.status : existing.status,
    data.last_completed_date !== undefined ? data.last_completed_date : existing.last_completed_date,
    expirationDate,
    data.validity_period_days !== undefined ? data.validity_period_days : existing.validity_period_days,
    data.identified_issues !== undefined ? stringifyIssues(data.identified_issues) : stringifyIssues(existing.identified_issues),
    data.owning_role !== undefined ? data.owning_role : existing.owning_role,
    data.notes !== undefined ? data.notes : existing.notes,
    userId, id, orgId
  );
  
  return getAHHQById(id, orgId);
}

function markAHHQComplete(id, completedDate, userId, orgId) {
  return updateAHHQ(id, {
    status: AHHQ_STATUS.COMPLETE,
    last_completed_date: completedDate || new Date().toISOString(),
    identified_issues: [],
  }, userId, orgId);
}

function markAHHQFollowUpRequired(id, issues, userId, orgId) {
  return updateAHHQ(id, {
    status: AHHQ_STATUS.PENDING_UPDATE,
    identified_issues: issues || [AHHQ_ISSUES.FOLLOW_UP_REQUIRED.value],
  }, userId, orgId);
}

function deleteAHHQ(id, orgId) {
  requireOrgId(orgId);
  const db = getDatabase();
  
  const existing = getAHHQById(id, orgId);
  if (!existing) {
    throw new Error('aHHQ record not found or access denied');
  }
  
  db.prepare('DELETE FROM adult_health_history_questionnaires WHERE id = ? AND org_id = ?').run(id, orgId);
  return { success: true };
}

// Patient summary

function getPatientAHHQSummary(patientId, orgId) {
  requireOrgId(orgId);
  const ahhq = getAHHQByPatientId(patientId, orgId);
  
  if (!ahhq) {
    return {
      exists: false, status: null, riskLevel: 'high',
      riskDescription: 'No aHHQ on file', needsAttention: true, ahhq: null,
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
  
  return { exists: true, status: ahhq.status, riskLevel, riskDescription, needsAttention, daysUntilExpiration: ahhq.days_until_expiration, ahhq };
}

// Dashboard metrics

function getAHHQDashboard(orgId) {
  requireOrgId(orgId);
  const db = getDatabase();
  const now = new Date().toISOString();
  const warningDate = new Date();
  warningDate.setDate(warningDate.getDate() + EXPIRATION_WARNING_DAYS);
  const warningDateStr = warningDate.toISOString();
  
  const totalPatients = db.prepare(`
    SELECT COUNT(*) as count FROM patients WHERE org_id = ? AND waitlist_status = 'active'
  `).get(orgId).count;
  
  const patientsWithAHHQ = db.prepare(`
    SELECT COUNT(DISTINCT patient_id) as count FROM adult_health_history_questionnaires WHERE org_id = ?
  `).get(orgId).count;
  
  const completeCount = db.prepare(`
    SELECT COUNT(*) as count FROM adult_health_history_questionnaires
    WHERE org_id = ? AND status = 'complete' AND (expiration_date IS NULL OR expiration_date > ?)
  `).get(orgId, now).count;
  
  const incompleteCount = db.prepare(`
    SELECT COUNT(*) as count FROM adult_health_history_questionnaires
    WHERE org_id = ? AND status IN ('incomplete', 'pending_update')
  `).get(orgId).count;
  
  const expiringCount = db.prepare(`
    SELECT COUNT(*) as count FROM adult_health_history_questionnaires
    WHERE org_id = ? AND status = 'complete' AND expiration_date IS NOT NULL AND expiration_date > ? AND expiration_date <= ?
  `).get(orgId, now, warningDateStr).count;
  
  const expiredCount = db.prepare(`
    SELECT COUNT(*) as count FROM adult_health_history_questionnaires
    WHERE org_id = ? AND (status = 'expired' OR (expiration_date IS NOT NULL AND expiration_date < ?))
  `).get(orgId, now).count;
  
  const byStatus = db.prepare(`
    SELECT status, COUNT(*) as count FROM adult_health_history_questionnaires WHERE org_id = ? GROUP BY status
  `).all(orgId).reduce((acc, row) => { acc[row.status] = row.count; return acc; }, {});
  
  const byOwningRole = db.prepare(`
    SELECT owning_role, COUNT(*) as count FROM adult_health_history_questionnaires WHERE org_id = ? GROUP BY owning_role
  `).all(orgId).reduce((acc, row) => { acc[row.owning_role] = row.count; return acc; }, {});
  
  const patientsNeedingAttention = db.prepare(`
    SELECT COUNT(*) as count FROM (
      SELECT p.id FROM patients p
      LEFT JOIN adult_health_history_questionnaires a ON p.id = a.patient_id AND a.org_id = ?
      WHERE p.org_id = ? AND p.waitlist_status = 'active'
      AND (a.id IS NULL OR a.status IN ('incomplete', 'pending_update', 'expired')
           OR (a.expiration_date IS NOT NULL AND a.expiration_date < ?)
           OR (a.expiration_date IS NOT NULL AND a.expiration_date <= ?))
      GROUP BY p.id
    )
  `).get(orgId, orgId, now, warningDateStr).count;
  
  return {
    totalPatients, patientsWithAHHQ, patientsWithoutAHHQ: totalPatients - patientsWithAHHQ,
    completeCount, incompleteCount, expiringCount, expiredCount,
    byStatus, byOwningRole, patientsNeedingAttention,
    patientsNeedingAttentionPercentage: totalPatients > 0 ? ((patientsNeedingAttention / totalPatients) * 100).toFixed(1) : '0.0',
    warningThresholdDays: EXPIRATION_WARNING_DAYS,
  };
}

function getPatientsWithAHHQIssues(orgId, limit = 10) {
  requireOrgId(orgId);
  const db = getDatabase();
  const now = new Date().toISOString();
  const warningDate = new Date();
  warningDate.setDate(warningDate.getDate() + EXPIRATION_WARNING_DAYS);
  const warningDateStr = warningDate.toISOString();
  
  const rows = db.prepare(`
    SELECT p.id as patient_id, p.first_name || ' ' || p.last_name as patient_name,
      a.id as ahhq_id, a.status, a.expiration_date, a.identified_issues, a.owning_role,
      CASE
        WHEN a.id IS NULL THEN 'missing'
        WHEN a.status = 'expired' OR (a.expiration_date IS NOT NULL AND a.expiration_date < ?) THEN 'expired'
        WHEN a.expiration_date IS NOT NULL AND a.expiration_date <= ? THEN 'expiring'
        WHEN a.status IN ('incomplete', 'pending_update') THEN 'incomplete'
        ELSE 'ok'
      END as issue_type
    FROM patients p
    LEFT JOIN adult_health_history_questionnaires a ON p.id = a.patient_id AND a.org_id = ?
    WHERE p.org_id = ? AND p.waitlist_status = 'active'
    AND (a.id IS NULL OR a.status IN ('incomplete', 'pending_update', 'expired')
         OR (a.expiration_date IS NOT NULL AND a.expiration_date < ?)
         OR (a.expiration_date IS NOT NULL AND a.expiration_date <= ?))
    ORDER BY CASE issue_type WHEN 'expired' THEN 1 WHEN 'missing' THEN 2 WHEN 'incomplete' THEN 3 WHEN 'expiring' THEN 4 ELSE 5 END,
             a.expiration_date ASC
    LIMIT ?
  `).all(now, warningDateStr, orgId, orgId, now, warningDateStr, limit);
  
  return rows.map(row => ({
    ...row,
    identified_issues: parseIssues(row.identified_issues),
    days_until_expiration: row.expiration_date ? getDaysUntilExpiration(row.expiration_date) : null,
  }));
}

// --- audit history ---

function getAHHQAuditHistory(orgId, patientId = null, startDate = null, endDate = null) {
  requireOrgId(orgId);
  const db = getDatabase();
  
  let query = `
    SELECT al.*, u.full_name as user_name
    FROM audit_logs al
    LEFT JOIN users u ON al.user_email = u.email AND u.org_id = ?
    WHERE al.org_id = ? AND al.entity_type = 'AdultHealthHistoryQuestionnaire'
  `;
  const params = [orgId, orgId];
  
  if (patientId) {
    query += ` AND al.details LIKE ?`;
    params.push(`%"patient_id":"${patientId}"%`);
  }
  if (startDate) {
    query += ` AND al.created_at >= ?`;
    params.push(startDate);
  }
  if (endDate) {
    query += ` AND al.created_at <= ?`;
    params.push(endDate);
  }
  
  query += ` ORDER BY al.created_at DESC LIMIT 100`;
  return db.prepare(query).all(...params);
}

module.exports = {
  AHHQ_STATUS, AHHQ_ISSUES, AHHQ_OWNING_ROLES, DEFAULT_VALIDITY_DAYS, EXPIRATION_WARNING_DAYS,
  calculateExpirationDate, isExpiringSoon, isExpired, getDaysUntilExpiration,
  createAHHQ, getAHHQById, getAHHQByPatientId, getAllAHHQs, getExpiringAHHQs, getExpiredAHHQs, getIncompleteAHHQs,
  updateAHHQ, markAHHQComplete, markAHHQFollowUpRequired, deleteAHHQ,
  getPatientAHHQSummary, getAHHQDashboard, getPatientsWithAHHQIssues, getAHHQAuditHistory,
};
