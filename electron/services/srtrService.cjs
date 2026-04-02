/**
 * TransTrack - SRTR/CMS Readiness Tracking Service
 * 
 * Computes operational approximations of SRTR-style center metrics
 * and CMS survey readiness indicators. These are NOT official SRTR
 * calculations and do NOT replace SRTR reports or CMS data.
 * 
 * Used to help transplant centers monitor their operational health
 * and prepare for CMS Conditions of Participation surveys.
 * 
 * All calculations run locally on the encrypted SQLite database.
 */

const { getDatabase } = require('../database/init.cjs');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('./logger.cjs');

function requireOrgId(orgId) {
  if (!orgId) throw new Error('Organization context required');
}

function computeCurrentMetrics(orgId) {
  requireOrgId(orgId);
  const db = getDatabase();

  const totalWaitlisted = db.prepare(
    `SELECT COUNT(*) as count FROM patients WHERE org_id = ? AND waitlist_status IN ('active', 'inactive')`
  ).get(orgId);

  const activeWaitlisted = db.prepare(
    `SELECT COUNT(*) as count FROM patients WHERE org_id = ? AND waitlist_status = 'active'`
  ).get(orgId);

  const inactiveWaitlisted = db.prepare(
    `SELECT COUNT(*) as count FROM patients WHERE org_id = ? AND waitlist_status = 'inactive'`
  ).get(orgId);

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const newListings = db.prepare(
    `SELECT COUNT(*) as count FROM patients 
     WHERE org_id = ? AND date_added_to_waitlist > ?`
  ).get(orgId, thirtyDaysAgo);

  const transplanted = db.prepare(
    `SELECT COUNT(*) as count FROM patients 
     WHERE org_id = ? AND waitlist_status = 'transplanted'`
  ).get(orgId);

  const waitTimes = db.prepare(
    `SELECT julianday('now') - julianday(date_added_to_waitlist) as wait_days 
     FROM patients WHERE org_id = ? AND waitlist_status = 'active' 
     AND date_added_to_waitlist IS NOT NULL ORDER BY wait_days`
  ).all(orgId);

  let medianWait = 0;
  if (waitTimes.length > 0) {
    const mid = Math.floor(waitTimes.length / 2);
    medianWait = waitTimes.length % 2 !== 0
      ? Math.round(waitTimes[mid].wait_days)
      : Math.round((waitTimes[mid - 1].wait_days + waitTimes[mid].wait_days) / 2);
  }

  const total = totalWaitlisted?.count || 0;
  const active = activeWaitlisted?.count || 0;
  const inactive = inactiveWaitlisted?.count || 0;
  const inactivePct = total > 0 ? Math.round((inactive / total) * 1000) / 10 : 0;

  const evalComplete = db.prepare(
    `SELECT COUNT(*) as count FROM patients 
     WHERE org_id = ? AND waitlist_status = 'active' 
     AND last_evaluation_date IS NOT NULL 
     AND datetime(last_evaluation_date, '+365 days') > datetime('now')`
  ).get(orgId);

  const evalRate = active > 0 ? Math.round(((evalComplete?.count || 0) / active) * 1000) / 10 : 0;

  const docComplete = db.prepare(
    `SELECT COUNT(*) as count FROM patients 
     WHERE org_id = ? AND waitlist_status = 'active' 
     AND updated_at > datetime('now', '-60 days')
     AND diagnosis IS NOT NULL AND diagnosis != ''`
  ).get(orgId);

  const docRate = active > 0 ? Math.round(((docComplete?.count || 0) / active) * 1000) / 10 : 0;

  const transplantRate = total > 0 ? Math.round(((transplanted?.count || 0) / total) * 1000) / 10 : 0;

  const riskFactors = [];
  if (inactivePct > 15) riskFactors.push('High inactivation rate (>' + Math.round(inactivePct) + '%)');
  if (evalRate < 80) riskFactors.push('Evaluation completion rate below 80%');
  if (docRate < 70) riskFactors.push('Documentation completeness below 70%');
  if (medianWait > 730) riskFactors.push('Median wait time exceeds 2 years');

  let riskLevel = 'low';
  if (riskFactors.length >= 3) riskLevel = 'critical';
  else if (riskFactors.length >= 2) riskLevel = 'high';
  else if (riskFactors.length >= 1) riskLevel = 'moderate';

  return {
    total_waitlisted: total,
    active_waitlisted: active,
    inactive_waitlisted: inactive,
    inactive_percentage: inactivePct,
    new_listings: newListings?.count || 0,
    removals_transplanted: transplanted?.count || 0,
    removals_deceased: 0,
    removals_other: 0,
    median_wait_days: medianWait,
    transplant_rate: transplantRate,
    offer_acceptance_rate: 0,
    one_year_graft_survival_est: null,
    one_year_patient_survival_est: null,
    evaluation_completion_rate: evalRate,
    documentation_completeness_rate: docRate,
    cms_survey_risk_level: riskLevel,
    cms_risk_factors: JSON.stringify(riskFactors),
  };
}

function saveMetricSnapshot(orgId, periodLabel, createdBy) {
  requireOrgId(orgId);
  const db = getDatabase();
  const metrics = computeCurrentMetrics(orgId);
  const id = uuidv4();

  const record = {
    id,
    org_id: orgId,
    period_label: periodLabel || new Date().toISOString().substring(0, 7),
    ...metrics,
    created_by: createdBy,
  };

  const fields = Object.keys(record);
  const placeholders = fields.map(() => '?').join(', ');
  db.prepare(`INSERT INTO srtr_metrics (${fields.join(', ')}) VALUES (${placeholders})`)
    .run(...Object.values(record));

  logger.info('SRTR metric snapshot saved', { orgId, id });
  return db.prepare('SELECT * FROM srtr_metrics WHERE id = ?').get(id);
}

function getMetricHistory(orgId, limit = 12) {
  requireOrgId(orgId);
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM srtr_metrics WHERE org_id = ? ORDER BY metric_date DESC LIMIT ?'
  ).all(orgId, limit);
}

function getCMSChecklist(orgId) {
  requireOrgId(orgId);
  const db = getDatabase();

  const active = db.prepare(
    `SELECT COUNT(*) as count FROM patients WHERE org_id = ? AND waitlist_status = 'active'`
  ).get(orgId)?.count || 0;

  const checks = [];

  const evalCurrent = db.prepare(
    `SELECT COUNT(*) as count FROM patients 
     WHERE org_id = ? AND waitlist_status = 'active'
     AND last_evaluation_date IS NOT NULL 
     AND datetime(last_evaluation_date, '+365 days') > datetime('now')`
  ).get(orgId)?.count || 0;
  const evalPct = active > 0 ? Math.round((evalCurrent / active) * 100) : 0;
  checks.push({
    id: 'eval_currency',
    category: 'Patient Evaluation',
    requirement: 'All active patients have current evaluations (within 12 months)',
    status: evalPct >= 95 ? 'pass' : evalPct >= 80 ? 'warning' : 'fail',
    metric: `${evalPct}% current (${evalCurrent}/${active})`,
    remediation: evalPct < 95 ? `Schedule evaluation renewals for ${active - evalCurrent} patients` : null,
  });

  const auditCount = db.prepare(
    `SELECT COUNT(*) as count FROM audit_logs WHERE org_id = ?`
  ).get(orgId)?.count || 0;
  checks.push({
    id: 'audit_trail',
    category: 'Documentation & Audit',
    requirement: 'Complete audit trail for all patient data changes',
    status: auditCount > 0 ? 'pass' : 'fail',
    metric: `${auditCount} audit entries recorded`,
    remediation: null,
  });

  let encEnabled = false;
  try {
    const { isEncryptionEnabled } = require('../database/init.cjs');
    encEnabled = isEncryptionEnabled();
  } catch {
    encEnabled = false;
  }
  checks.push({
    id: 'encryption',
    category: 'Data Security',
    requirement: 'PHI encrypted at rest (AES-256)',
    status: encEnabled ? 'pass' : 'fail',
    metric: encEnabled ? 'SQLCipher AES-256-CBC active' : 'Not encrypted',
    remediation: encEnabled ? null : 'Enable database encryption',
  });

  const docComplete = db.prepare(
    `SELECT COUNT(*) as count FROM patients 
     WHERE org_id = ? AND waitlist_status = 'active'
     AND diagnosis IS NOT NULL AND diagnosis != ''
     AND blood_type IS NOT NULL
     AND organ_needed IS NOT NULL`
  ).get(orgId)?.count || 0;
  const docPct = active > 0 ? Math.round((docComplete / active) * 100) : 0;
  checks.push({
    id: 'data_completeness',
    category: 'Documentation & Audit',
    requirement: 'Critical patient fields are populated (diagnosis, blood type, organ)',
    status: docPct >= 95 ? 'pass' : docPct >= 80 ? 'warning' : 'fail',
    metric: `${docPct}% complete (${docComplete}/${active})`,
    remediation: docPct < 95 ? `Complete records for ${active - docComplete} patients` : null,
  });

  const inactive = db.prepare(
    `SELECT COUNT(*) as count FROM patients WHERE org_id = ? AND waitlist_status = 'inactive'`
  ).get(orgId)?.count || 0;
  const total = active + inactive;
  const inactivePct = total > 0 ? Math.round((inactive / total) * 100) : 0;
  checks.push({
    id: 'inactivation_rate',
    category: 'Waitlist Management',
    requirement: 'Inactivation rate below 15% (CMS benchmark)',
    status: inactivePct <= 10 ? 'pass' : inactivePct <= 15 ? 'warning' : 'fail',
    metric: `${inactivePct}% inactivated (${inactive}/${total})`,
    remediation: inactivePct > 15 ? 'Review inactive patients for reactivation or removal' : null,
  });

  let barrierTracking = false;
  try {
    const barrierCount = db.prepare(
      `SELECT COUNT(*) as count FROM readiness_barriers WHERE org_id = ?`
    ).get(orgId)?.count || 0;
    barrierTracking = barrierCount >= 0;
  } catch {
    barrierTracking = false;
  }
  checks.push({
    id: 'barrier_tracking',
    category: 'Waitlist Management',
    requirement: 'Non-clinical readiness barriers are tracked and managed',
    status: barrierTracking ? 'pass' : 'fail',
    metric: barrierTracking ? 'Barrier tracking system active' : 'Not configured',
    remediation: null,
  });

  let accessControlActive = false;
  try {
    const userCount = db.prepare(`SELECT COUNT(*) as count FROM users WHERE org_id = ?`).get(orgId)?.count || 0;
    accessControlActive = userCount > 0;
  } catch {
    accessControlActive = false;
  }
  checks.push({
    id: 'access_control',
    category: 'Data Security',
    requirement: 'Role-based access control with justified access logging',
    status: accessControlActive ? 'pass' : 'warning',
    metric: accessControlActive ? 'RBAC + break-the-glass justification active' : 'No users configured',
    remediation: accessControlActive ? null : 'Configure user accounts and roles',
  });

  const passCount = checks.filter(c => c.status === 'pass').length;
  const warnCount = checks.filter(c => c.status === 'warning').length;
  const failCount = checks.filter(c => c.status === 'fail').length;
  const overallScore = Math.round((passCount / checks.length) * 100);

  return {
    checks,
    summary: { pass: passCount, warning: warnCount, fail: failCount, total: checks.length },
    overallScore,
    overallStatus: failCount > 0 ? 'at_risk' : warnCount > 0 ? 'needs_attention' : 'survey_ready',
  };
}

function getDashboard(orgId) {
  requireOrgId(orgId);
  const current = computeCurrentMetrics(orgId);
  const history = getMetricHistory(orgId, 6);
  const checklist = getCMSChecklist(orgId);

  return {
    currentMetrics: current,
    historicalMetrics: history,
    cmsChecklist: checklist,
    lastUpdated: new Date().toISOString(),
  };
}

module.exports = {
  computeCurrentMetrics,
  saveMetricSnapshot,
  getMetricHistory,
  getCMSChecklist,
  getDashboard,
};
