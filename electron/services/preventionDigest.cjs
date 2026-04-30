/**
 * TransTrack — Inactivation Prevention Digest
 *
 * Single roll-up snapshot for the manager / quarterly-review dashboard.
 * Combines four already-tested upstream services into one report so a
 * transplant administrator (or an acquirer's diligence team) can answer
 * the only three questions that matter:
 *
 *   1. Where is the center sitting RIGHT NOW on inactivation risk?
 *   2. What would happen if the team executed the recommended
 *      interventions on the action queue?
 *   3. Of the interventions we already executed, how well did they work?
 *
 * Pure composition layer — no DB I/O of its own. The DB-backed builder is
 * separated and trivially mockable.
 */

'use strict';

const engine = require('./inactivationRiskEngine.cjs');
const queueSvc = require('./inactivationActionQueue.cjs');
const outcomes = require('./preventionOutcomes.cjs');

const DIGEST_VERSION = '1.0.0';

/**
 * Build the manager digest from in-memory data.
 *
 * @param {Object} args
 * @param {Array<Object>} args.candidateInputs  full active-waitlist roster
 *                                              of risk-engine input snapshots
 * @param {Object} [args.effectiveness]         output of
 *                                              outcomes.getInterventionEffectiveness;
 *                                              optional — pass null when
 *                                              no interventions have been
 *                                              recorded yet.
 * @param {Object} [opts]
 * @param {number} [opts.nowMs]
 * @param {number} [opts.actionQueueSize]
 * @param {number} [opts.costPerInactivationUSD]
 * @param {number} [opts.interventionCapPerCandidate]
 */
function buildDigest(args, opts = {}) {
  if (!args)                          throw new Error('buildDigest: args is required');
  if (!Array.isArray(args.candidateInputs)) {
    throw new Error('buildDigest: args.candidateInputs must be an array');
  }
  const nowMs = opts.nowMs || Date.now();

  const actionQueue = queueSvc.buildActionQueue(args.candidateInputs, {
    nowMs,
    size: opts.actionQueueSize,
  });

  const projection = engine.projectCenterImpact(args.candidateInputs, {
    nowMs,
    costPerInactivationUSD: opts.costPerInactivationUSD,
    interventionCapPerCandidate: opts.interventionCapPerCandidate,
  });

  // Headline metrics — what a transplant administrator wants on slide 1.
  const headline = {
    activeCandidatesScreened: args.candidateInputs.length,
    riskDistribution: projection.distribution,
    expectedInactivationsBaseline:
      projection.expectedInactivationsWithin90Days.baseline,
    expectedInactivationsAfterRecommendedActions:
      projection.expectedInactivationsWithin90Days.postIntervention,
    inactivationsAvoided:
      projection.expectedInactivationsWithin90Days.avoided,
    estimatedDollarsAvoided: projection.estimatedDollarsAvoided,
    coordinatorOverloads: actionQueue.coordinatorOverloads,
  };

  return {
    digestVersion: DIGEST_VERSION,
    modelVersion: engine.MODEL_VERSION,
    queueVersion: queueSvc.QUEUE_VERSION,
    generatedAtISO: new Date(nowMs).toISOString(),
    headline,
    actionQueue,
    projection,
    effectiveness: args.effectiveness || null,
    disclaimer:
      'Operational coordination signal. Not a clinical recommendation. ' +
      'Probabilities use the engine\'s default logistic calibration and ' +
      'should be re-fit against the deploying center\'s historical cohort ' +
      'during PQ. Center-level inactivation prevention should be confirmed ' +
      'against the center\'s registry data during periodic review.',
  };
}

/**
 * DB-backed builder for the live application. Resolves all inputs from the
 * encrypted SQLite database and from the prevention_interventions table.
 *
 * @param {string} orgId
 * @param {Object} [opts] forwarded to buildDigest. Also accepts `db` and
 *                        `getDatabase` for test injection.
 */
function buildDigestFromDatabase(orgId, opts = {}) {
  if (!orgId) throw new Error('buildDigestFromDatabase: orgId is required');
  const getDb = opts.getDatabase || (() => require('../database/init.cjs').getDatabase());
  const db = opts.db || getDb();

  const patients = db
    .prepare(
      `SELECT id, patient_id as mrn,
              first_name || ' ' || last_name as patient_name,
              organ_needed,
              assigned_coordinator_id,
              created_at,
              updated_at
         FROM patients
        WHERE org_id = ? AND waitlist_status = 'active'`,
    )
    .all(orgId);

  const candidateInputs = patients.map((p) => {
    const built = engine.buildInputsFromDatabase(orgId, p.id, { db });
    return {
      ...built,
      patientName: p.patient_name || null,
      mrn: p.mrn || null,
      organNeeded: p.organ_needed || null,
      assignedCoordinatorId: p.assigned_coordinator_id || null,
    };
  });

  let effectiveness = null;
  try {
    effectiveness = outcomes.getInterventionEffectiveness(db, orgId, {
      windowDays: opts.effectivenessWindowDays || 90,
      nowMs: opts.nowMs,
    });
  } catch (_) {
    // prevention_interventions table may not exist on very old deployments
    effectiveness = null;
  }

  return buildDigest({ candidateInputs, effectiveness }, opts);
}

module.exports = {
  DIGEST_VERSION,
  buildDigest,
  buildDigestFromDatabase,
};
