/**
 * TransTrack - Predictive Inactivation Scoring Service
 * 
 * Computes a multi-factor inactivation risk score for each active patient.
 * Factors are weighted and combined into a 0-100 risk score.
 * 
 * All calculations are deterministic and run locally on the encrypted
 * SQLite database. No external AI/ML services or cloud calls.
 * 
 * NON-CLINICAL: These predictions are operational risk indicators
 * and do NOT affect allocation decisions or replace clinical judgment.
 */

const { getDatabase } = require('../database/init.cjs');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('./logger.cjs');

function requireOrgId(orgId) {
  if (!orgId) throw new Error('Organization context required');
}

const FACTOR_WEIGHTS = {
  EVAL_EXPIRY: 0.30,
  DOCUMENTATION: 0.20,
  BARRIERS: 0.20,
  STATUS_CHURN: 0.15,
  CONTACT_RECENCY: 0.15,
};

const RISK_THRESHOLDS = {
  critical: 75,
  high: 50,
  moderate: 25,
};

function classifyRisk(score) {
  if (score >= RISK_THRESHOLDS.critical) return 'critical';
  if (score >= RISK_THRESHOLDS.high) return 'high';
  if (score >= RISK_THRESHOLDS.moderate) return 'moderate';
  return 'low';
}

function computeEvalExpiryFactor(patient) {
  if (!patient.last_evaluation_date) return 100;
  const evalDate = new Date(patient.last_evaluation_date);
  const now = new Date();
  const daysSinceEval = (now - evalDate) / (1000 * 60 * 60 * 24);
  const yearThreshold = 365;
  if (daysSinceEval > yearThreshold) return 100;
  if (daysSinceEval > yearThreshold - 30) return 80;
  if (daysSinceEval > yearThreshold - 60) return 50;
  if (daysSinceEval > yearThreshold - 90) return 30;
  return Math.max(0, Math.min(100, (daysSinceEval / yearThreshold) * 60));
}

function computeDocumentationFactor(patient) {
  if (!patient.updated_at) return 80;
  const lastUpdate = new Date(patient.updated_at);
  const now = new Date();
  const daysSinceUpdate = (now - lastUpdate) / (1000 * 60 * 60 * 24);
  if (daysSinceUpdate > 90) return 100;
  if (daysSinceUpdate > 60) return 70;
  if (daysSinceUpdate > 30) return 40;
  return Math.max(0, (daysSinceUpdate / 90) * 30);
}

function computeBarrierFactor(orgId, patientId) {
  const db = getDatabase();
  const barriers = db.prepare(
    `SELECT COUNT(*) as total,
            SUM(CASE WHEN risk_level = 'high' THEN 1 ELSE 0 END) as high_count
     FROM readiness_barriers 
     WHERE org_id = ? AND patient_id = ? AND status != 'resolved'`
  ).get(orgId, patientId);

  if (!barriers || barriers.total === 0) return 0;
  const highWeight = (barriers.high_count || 0) * 25;
  const totalWeight = Math.min(barriers.total * 15, 50);
  return Math.min(100, highWeight + totalWeight);
}

function computeStatusChurnFactor(orgId, patientId) {
  const db = getDatabase();
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const statusChanges = db.prepare(
    `SELECT COUNT(*) as count FROM audit_logs 
     WHERE org_id = ? AND entity_type = 'Patient' AND entity_id = ?
     AND action = 'update' AND details LIKE '%status%'
     AND created_at > ?`
  ).get(orgId, patientId, ninetyDaysAgo);

  const changes = statusChanges?.count || 0;
  if (changes >= 4) return 100;
  if (changes >= 3) return 70;
  if (changes >= 2) return 40;
  if (changes >= 1) return 20;
  return 0;
}

function computeContactRecencyFactor(patient) {
  const lastContact = patient.updated_at || patient.created_at;
  if (!lastContact) return 60;
  const daysSince = (new Date() - new Date(lastContact)) / (1000 * 60 * 60 * 24);
  if (daysSince > 90) return 100;
  if (daysSince > 60) return 60;
  if (daysSince > 30) return 30;
  return Math.max(0, (daysSince / 90) * 20);
}

function predictPatient(orgId, patient) {
  const evalFactor = computeEvalExpiryFactor(patient);
  const docFactor = computeDocumentationFactor(patient);
  const barrierFactor = computeBarrierFactor(orgId, patient.id);
  const churnFactor = computeStatusChurnFactor(orgId, patient.id);
  const contactFactor = computeContactRecencyFactor(patient);

  const rawScore =
    evalFactor * FACTOR_WEIGHTS.EVAL_EXPIRY +
    docFactor * FACTOR_WEIGHTS.DOCUMENTATION +
    barrierFactor * FACTOR_WEIGHTS.BARRIERS +
    churnFactor * FACTOR_WEIGHTS.STATUS_CHURN +
    contactFactor * FACTOR_WEIGHTS.CONTACT_RECENCY;

  const score = Math.round(Math.min(100, Math.max(0, rawScore)) * 10) / 10;
  const riskLevel = classifyRisk(score);

  const factors = [];
  if (evalFactor >= 50) factors.push('Evaluation expiring or expired');
  if (docFactor >= 50) factors.push('Documentation stale');
  if (barrierFactor >= 30) factors.push('Unresolved readiness barriers');
  if (churnFactor >= 40) factors.push('Frequent status changes');
  if (contactFactor >= 50) factors.push('No recent contact/updates');

  let predictedDays = null;
  if (score >= 75) predictedDays = 30;
  else if (score >= 50) predictedDays = 60;
  else if (score >= 25) predictedDays = 90;

  const recommendations = [];
  if (evalFactor >= 50) recommendations.push('Schedule evaluation renewal immediately');
  if (docFactor >= 50) recommendations.push('Update patient documentation');
  if (barrierFactor >= 30) recommendations.push('Resolve outstanding readiness barriers');
  if (churnFactor >= 40) recommendations.push('Review status change history for patterns');
  if (contactFactor >= 50) recommendations.push('Initiate patient contact');

  return {
    risk_score: score,
    risk_level: riskLevel,
    predicted_inactivation_within_days: predictedDays,
    contributing_factors: JSON.stringify(factors),
    eval_expiry_factor: Math.round(evalFactor * 10) / 10,
    documentation_factor: Math.round(docFactor * 10) / 10,
    barrier_factor: Math.round(barrierFactor * 10) / 10,
    status_churn_factor: Math.round(churnFactor * 10) / 10,
    contact_recency_factor: Math.round(contactFactor * 10) / 10,
    recommendation: recommendations.join('; ') || 'No action needed',
  };
}

function runPredictions(orgId) {
  requireOrgId(orgId);
  const db = getDatabase();

  const patients = db.prepare(
    `SELECT * FROM patients WHERE org_id = ? AND waitlist_status = 'active'`
  ).all(orgId);

  db.prepare(
    `UPDATE inactivation_predictions SET is_current = 0 WHERE org_id = ? AND is_current = 1`
  ).run(orgId);

  const insertStmt = db.prepare(`
    INSERT INTO inactivation_predictions 
    (id, org_id, patient_id, risk_score, risk_level, predicted_inactivation_within_days,
     contributing_factors, eval_expiry_factor, documentation_factor, barrier_factor,
     status_churn_factor, contact_recency_factor, recommendation, is_current)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  const insertAll = db.transaction(() => {
    for (const patient of patients) {
      const prediction = predictPatient(orgId, patient);
      insertStmt.run(
        uuidv4(), orgId, patient.id,
        prediction.risk_score, prediction.risk_level,
        prediction.predicted_inactivation_within_days,
        prediction.contributing_factors,
        prediction.eval_expiry_factor, prediction.documentation_factor,
        prediction.barrier_factor, prediction.status_churn_factor,
        prediction.contact_recency_factor, prediction.recommendation
      );
    }
  });

  insertAll();
  logger.info('Inactivation predictions computed', { orgId, patientCount: patients.length });
  return { patientsScored: patients.length };
}

function getCurrentPredictions(orgId) {
  requireOrgId(orgId);
  const db = getDatabase();
  return db.prepare(`
    SELECT p.*, pt.first_name, pt.last_name, pt.patient_id as mrn, pt.organ_needed,
           pt.waitlist_status, pt.priority_score
    FROM inactivation_predictions p
    JOIN patients pt ON p.patient_id = pt.id AND pt.org_id = p.org_id
    WHERE p.org_id = ? AND p.is_current = 1
    ORDER BY p.risk_score DESC
  `).all(orgId);
}

function getPatientPredictionHistory(orgId, patientId, limit = 10) {
  requireOrgId(orgId);
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM inactivation_predictions 
    WHERE org_id = ? AND patient_id = ? 
    ORDER BY prediction_date DESC LIMIT ?
  `).all(orgId, patientId, limit);
}

function getPredictionDashboard(orgId) {
  requireOrgId(orgId);
  const db = getDatabase();

  const summary = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN risk_level = 'critical' THEN 1 ELSE 0 END) as critical,
      SUM(CASE WHEN risk_level = 'high' THEN 1 ELSE 0 END) as high,
      SUM(CASE WHEN risk_level = 'moderate' THEN 1 ELSE 0 END) as moderate,
      SUM(CASE WHEN risk_level = 'low' THEN 1 ELSE 0 END) as low,
      AVG(risk_score) as avg_score,
      MAX(risk_score) as max_score
    FROM inactivation_predictions WHERE org_id = ? AND is_current = 1
  `).get(orgId);

  const topRisk = db.prepare(`
    SELECT p.*, pt.first_name, pt.last_name, pt.patient_id as mrn, pt.organ_needed
    FROM inactivation_predictions p
    JOIN patients pt ON p.patient_id = pt.id AND pt.org_id = p.org_id
    WHERE p.org_id = ? AND p.is_current = 1 AND p.risk_level IN ('critical', 'high')
    ORDER BY p.risk_score DESC LIMIT 10
  `).all(orgId);

  const factorAverages = db.prepare(`
    SELECT 
      AVG(eval_expiry_factor) as avg_eval,
      AVG(documentation_factor) as avg_doc,
      AVG(barrier_factor) as avg_barrier,
      AVG(status_churn_factor) as avg_churn,
      AVG(contact_recency_factor) as avg_contact
    FROM inactivation_predictions WHERE org_id = ? AND is_current = 1
  `).get(orgId);

  return {
    summary: {
      total: summary?.total || 0,
      critical: summary?.critical || 0,
      high: summary?.high || 0,
      moderate: summary?.moderate || 0,
      low: summary?.low || 0,
      avgScore: Math.round((summary?.avg_score || 0) * 10) / 10,
      maxScore: Math.round((summary?.max_score || 0) * 10) / 10,
    },
    topRiskPatients: topRisk.map(p => ({
      id: p.patient_id,
      name: `${p.first_name} ${p.last_name}`,
      mrn: p.mrn,
      organNeeded: p.organ_needed,
      riskScore: p.risk_score,
      riskLevel: p.risk_level,
      predictedDays: p.predicted_inactivation_within_days,
      factors: JSON.parse(p.contributing_factors || '[]'),
      recommendation: p.recommendation,
    })),
    factorAverages: {
      evalExpiry: Math.round((factorAverages?.avg_eval || 0) * 10) / 10,
      documentation: Math.round((factorAverages?.avg_doc || 0) * 10) / 10,
      barriers: Math.round((factorAverages?.avg_barrier || 0) * 10) / 10,
      statusChurn: Math.round((factorAverages?.avg_churn || 0) * 10) / 10,
      contactRecency: Math.round((factorAverages?.avg_contact || 0) * 10) / 10,
    },
    lastRunDate: topRisk[0]?.prediction_date || null,
  };
}

module.exports = {
  FACTOR_WEIGHTS,
  RISK_THRESHOLDS,
  predictPatient,
  runPredictions,
  getCurrentPredictions,
  getPatientPredictionHistory,
  getPredictionDashboard,
};
