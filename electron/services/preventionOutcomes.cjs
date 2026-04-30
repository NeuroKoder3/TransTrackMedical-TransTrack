/**
 * TransTrack — Prevention Outcomes Service
 *
 * Records every concrete inactivation-prevention intervention a coordinator
 * takes on an at-risk patient, captures the engine score at the moment of
 * the action, and (when the patient is re-assessed later) records the
 * measured score change.
 *
 * This is the table that converts TransTrack from "we predict inactivations"
 * to "we *prevent* inactivations and we have the data to prove it." It is
 * the artefact a transplant administrator brings to the quarterly review
 * and the artefact an acquirer asks for in week one of diligence.
 *
 * Design rules:
 *
 *   • All writes are org-scoped. Cross-org reads are impossible by query
 *     construction.
 *
 *   • Every recorded intervention captures the engine model version and
 *     the inputs fingerprint that produced the score, so the row stays
 *     re-explainable forever even if the model is later retrained.
 *
 *   • Effectiveness reporting is purely a read on this table — no model
 *     re-execution, no clock-dependent math. That makes the report
 *     trivially auditable.
 *
 *   • Logging side-effects (audit trail, structured logger) are the
 *     caller's responsibility (the IPC handler), so this service stays
 *     pure-data and easy to test.
 */

'use strict';

const { v4: uuidv4 } = require('uuid');

const VALID_INTERVENTION_TYPES = Object.freeze([
  'resolveAllBarriers',
  'resolveBarrier',
  'refreshEvaluation',
  'refreshDocument',
  'refreshLabs',
  'refreshAHHQ',
  'recordContact',
  'other',
]);

/**
 * Record a coordinator intervention against an at-risk patient.
 *
 * @param {Object} db better-sqlite3 connection (already-opened, encrypted).
 * @param {Object} args
 * @param {string} args.orgId
 * @param {string} args.patientId
 * @param {string} args.interventionType  one of VALID_INTERVENTION_TYPES
 * @param {string} [args.targetFactor]    risk-engine factor key, e.g. 'BARRIERS'
 * @param {Object} [args.assessmentBefore] full engine assessment snapshot
 * @param {string} [args.notes]
 * @param {string} [args.performedBy]      user email
 * @param {string} [args.performedRole]    user role
 * @returns {{ id: string }}
 */
function recordIntervention(db, args) {
  if (!db) throw new Error('recordIntervention: db is required');
  if (!args)            throw new Error('recordIntervention: args is required');
  if (!args.orgId)      throw new Error('recordIntervention: orgId is required');
  if (!args.patientId)  throw new Error('recordIntervention: patientId is required');
  if (!args.interventionType) {
    throw new Error('recordIntervention: interventionType is required');
  }
  if (!VALID_INTERVENTION_TYPES.includes(args.interventionType)) {
    throw new Error(
      `recordIntervention: interventionType must be one of ${VALID_INTERVENTION_TYPES.join(', ')}`
    );
  }

  const id = uuidv4();
  const before = args.assessmentBefore || null;
  db.prepare(`
    INSERT INTO prevention_interventions (
      id, org_id, patient_id, intervention_type, target_factor,
      score_before, risk_level_before, probability_90_before,
      model_version, inputs_fingerprint_before,
      notes, performed_by, performed_role
    ) VALUES (
      @id, @orgId, @patientId, @interventionType, @targetFactor,
      @scoreBefore, @riskLevelBefore, @prob90Before,
      @modelVersion, @fingerprintBefore,
      @notes, @performedBy, @performedRole
    )
  `).run({
    id,
    orgId: args.orgId,
    patientId: args.patientId,
    interventionType: args.interventionType,
    targetFactor: args.targetFactor || null,
    scoreBefore: before?.score ?? null,
    riskLevelBefore: before?.riskLevel ?? null,
    prob90Before: before?.probabilities?.within90Days ?? null,
    modelVersion: before?.modelVersion ?? null,
    fingerprintBefore: before?.inputsFingerprint ?? null,
    notes: args.notes || null,
    performedBy: args.performedBy || null,
    performedRole: args.performedRole || null,
  });
  return { id };
}

/**
 * Record the measured "after" assessment against a previously-recorded
 * intervention. This is what makes the outcomes table truth-bearing — we
 * compare scores at two distinct points in time.
 *
 * @param {Object} db
 * @param {Object} args
 * @param {string} args.orgId
 * @param {string} args.interventionId
 * @param {Object} args.assessmentAfter   full engine assessment snapshot
 * @returns {{ updated: boolean, measured_score_delta: number|null }}
 */
function recordOutcome(db, args) {
  if (!db) throw new Error('recordOutcome: db is required');
  if (!args)                throw new Error('recordOutcome: args is required');
  if (!args.orgId)          throw new Error('recordOutcome: orgId is required');
  if (!args.interventionId) throw new Error('recordOutcome: interventionId is required');
  if (!args.assessmentAfter) {
    throw new Error('recordOutcome: assessmentAfter is required');
  }

  const existing = db.prepare(
    `SELECT score_before FROM prevention_interventions
      WHERE id = ? AND org_id = ?`
  ).get(args.interventionId, args.orgId);

  if (!existing) {
    return { updated: false, measured_score_delta: null };
  }

  const after = args.assessmentAfter;
  const delta = (existing.score_before != null && after.score != null)
    ? Math.round((existing.score_before - after.score) * 10) / 10
    : null;

  db.prepare(`
    UPDATE prevention_interventions
       SET score_after = @scoreAfter,
           risk_level_after = @riskLevelAfter,
           probability_90_after = @prob90After,
           measured_score_delta = @delta,
           measured_at = datetime('now'),
           inputs_fingerprint_after = @fingerprintAfter
     WHERE id = @id AND org_id = @orgId
  `).run({
    id: args.interventionId,
    orgId: args.orgId,
    scoreAfter: after.score ?? null,
    riskLevelAfter: after.riskLevel ?? null,
    prob90After: after?.probabilities?.within90Days ?? null,
    delta,
    fingerprintAfter: after.inputsFingerprint ?? null,
  });

  return { updated: true, measured_score_delta: delta };
}

/**
 * Return the intervention history for a single patient, newest first.
 */
function getInterventionsForPatient(db, orgId, patientId) {
  if (!db)        throw new Error('getInterventionsForPatient: db is required');
  if (!orgId)     throw new Error('getInterventionsForPatient: orgId is required');
  if (!patientId) throw new Error('getInterventionsForPatient: patientId is required');
  return db.prepare(`
    SELECT id, intervention_type, target_factor,
           score_before, risk_level_before, probability_90_before,
           score_after,  risk_level_after,  probability_90_after,
           measured_score_delta, measured_at,
           model_version, notes, performed_by, performed_role, created_at
      FROM prevention_interventions
     WHERE org_id = ? AND patient_id = ?
     ORDER BY datetime(created_at) DESC
  `).all(orgId, patientId);
}

/**
 * Center-level effectiveness: per intervention type, how many were
 * recorded, how many were measured, and what the average measured score
 * delta was. Used by the manager-dashboard / quarterly-review report.
 *
 * @param {Object} db
 * @param {string} orgId
 * @param {Object} [opts]
 * @param {number} [opts.windowDays=90]
 * @param {number} [opts.nowMs]
 */
function getInterventionEffectiveness(db, orgId, opts = {}) {
  if (!db)    throw new Error('getInterventionEffectiveness: db is required');
  if (!orgId) throw new Error('getInterventionEffectiveness: orgId is required');
  const windowDays = opts.windowDays || 90;
  const nowMs = opts.nowMs || Date.now();
  const sinceISO = new Date(nowMs - windowDays * 24 * 60 * 60 * 1000).toISOString();

  const rows = db.prepare(`
    SELECT
      intervention_type,
      COUNT(*)                                         AS recorded,
      SUM(CASE WHEN measured_at IS NOT NULL THEN 1 ELSE 0 END) AS measured,
      AVG(CASE WHEN measured_score_delta IS NOT NULL THEN measured_score_delta END) AS avg_score_delta,
      AVG(CASE WHEN probability_90_before IS NOT NULL AND probability_90_after IS NOT NULL
               THEN (probability_90_before - probability_90_after) END)             AS avg_prob90_delta
    FROM prevention_interventions
    WHERE org_id = ? AND created_at >= ?
    GROUP BY intervention_type
    ORDER BY recorded DESC
  `).all(orgId, sinceISO);

  const totals = {
    recorded: 0,
    measured: 0,
    weightedAvgScoreDelta: 0,
    weightedAvgProb90Delta: 0,
  };
  let weightSumScore = 0;
  let weightSumProb  = 0;

  const perType = rows.map((r) => {
    totals.recorded += r.recorded;
    totals.measured += r.measured || 0;
    if (r.avg_score_delta != null && r.measured > 0) {
      totals.weightedAvgScoreDelta += r.avg_score_delta * r.measured;
      weightSumScore += r.measured;
    }
    if (r.avg_prob90_delta != null && r.measured > 0) {
      totals.weightedAvgProb90Delta += r.avg_prob90_delta * r.measured;
      weightSumProb += r.measured;
    }
    return {
      interventionType: r.intervention_type,
      recorded: r.recorded,
      measured: r.measured || 0,
      averageScoreDelta:
        r.avg_score_delta != null
          ? Math.round(r.avg_score_delta * 10) / 10
          : null,
      averageProbability90Delta:
        r.avg_prob90_delta != null
          ? Math.round(r.avg_prob90_delta * 1000) / 1000
          : null,
    };
  });

  totals.weightedAvgScoreDelta =
    weightSumScore > 0
      ? Math.round((totals.weightedAvgScoreDelta / weightSumScore) * 10) / 10
      : 0;
  totals.weightedAvgProb90Delta =
    weightSumProb > 0
      ? Math.round((totals.weightedAvgProb90Delta / weightSumProb) * 1000) / 1000
      : 0;

  return {
    windowDays,
    sinceISO,
    asOfISO: new Date(nowMs).toISOString(),
    perInterventionType: perType,
    totals,
    disclaimer:
      'Measured deltas are the difference between engine scores at intervention ' +
      'time and re-assessment time. They do not by themselves prove causality. ' +
      'Center-level inactivation prevention should be confirmed against the ' +
      'center\'s registry data during periodic review.',
  };
}

module.exports = {
  VALID_INTERVENTION_TYPES,
  recordIntervention,
  recordOutcome,
  getInterventionsForPatient,
  getInterventionEffectiveness,
};
