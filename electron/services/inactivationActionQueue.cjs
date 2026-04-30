/**
 * TransTrack — Inactivation Prevention Action Queue
 *
 * Pure-function service that turns the per-patient assessments produced by
 * `inactivationRiskEngine` into a coordinator-ready, prioritised ACTION QUEUE
 * for the entire active waitlist.
 *
 * The action queue answers the only question that matters at the start of
 * a coordinator's day:
 *
 *   "Which 10 patients should I touch RIGHT NOW to prevent the most
 *    inactivations this quarter, and exactly what should I do for each?"
 *
 * Design rules:
 *
 *   • Pure function. Takes a list of input snapshots, returns a ranked queue.
 *     No DB, no clock (caller injects nowMs), no I/O. Embeddable in a CDS Hook.
 *
 *   • Every queue entry carries the full risk decomposition AND a single
 *     concrete recommended action with its expected score reduction. We do
 *     not show coordinators a leaderboard of risk scores — we show them
 *     a leaderboard of *interventions*.
 *
 *   • Urgency boost: a patient whose evaluation expires in 30 days carries
 *     more queue priority than the same composite score with a fresh
 *     evaluation, because the intervention window is shorter.
 *
 *   • Coordinator-load balancing: if a single coordinator owns >40% of
 *     the queue, the report flags coordinator overload as a separate finding.
 *
 *   • The queue is deterministic: same inputs + same nowMs → identical queue.
 *     This is what makes the report defensible in an audit / compliance review.
 */

'use strict';

const engine = require('./inactivationRiskEngine.cjs');

const QUEUE_VERSION = '1.0.0';
const DEFAULT_QUEUE_SIZE = 25;
const URGENCY_WINDOW_DAYS = 60;
const COORDINATOR_OVERLOAD_FRACTION = 0.40;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Build a prioritised inactivation-prevention action queue.
 *
 * @param {Array<Object>} candidateInputs Risk-engine input snapshots, one per
 *   active waitlist candidate. Each must include `patientId`. May optionally
 *   include `assignedCoordinatorId`, `patientName`, `mrn`, `organNeeded`,
 *   `daysOnWaitlist` for richer queue rendering.
 * @param {Object} [opts]
 * @param {number} [opts.nowMs]    Defaults to Date.now(); injected for tests.
 * @param {number} [opts.size]     Max number of queue entries to return.
 * @param {Array<string>} [opts.includeRiskLevels] e.g. ['critical','high'];
 *   defaults to all non-'none' levels.
 * @returns {Object} action queue report
 */
function buildActionQueue(candidateInputs, opts = {}) {
  const nowMs = opts.nowMs || Date.now();
  const size = Number.isFinite(opts.size) ? opts.size : DEFAULT_QUEUE_SIZE;
  const allowedLevels = new Set(
    opts.includeRiskLevels || ['critical', 'high', 'moderate', 'low']
  );

  if (!Array.isArray(candidateInputs)) {
    throw new Error('buildActionQueue: candidateInputs must be an array');
  }

  const entries = [];
  const coordinatorLoad = new Map();
  const distribution = { critical: 0, high: 0, moderate: 0, low: 0, none: 0 };

  for (const inputs of candidateInputs) {
    if (!inputs || !inputs.patientId) continue;
    const assessment = engine.assessInactivationRisk(inputs, { nowMs });
    distribution[assessment.riskLevel] =
      (distribution[assessment.riskLevel] || 0) + 1;

    if (!allowedLevels.has(assessment.riskLevel)) continue;

    const coordinatorId = inputs.assignedCoordinatorId || null;
    if (coordinatorId) {
      coordinatorLoad.set(
        coordinatorId,
        (coordinatorLoad.get(coordinatorId) || 0) + 1
      );
    }

    const topIntervention = (assessment.interventions || [])[0] || null;
    const urgencyDays = _daysUntilEvalExpiry(inputs, nowMs);
    const urgencyMultiplier = _urgencyMultiplier(urgencyDays);
    const queuePriority = _round1(assessment.score * urgencyMultiplier);

    let recommendedAction = null;
    if (topIntervention && topIntervention.scoreReduction > 0) {
      const probAfter = engine.scoreToProbabilities(topIntervention.scoreIfResolved);
      const probReduction =
        assessment.probabilities.within90Days - probAfter.d90;
      recommendedAction = {
        factor: topIntervention.factor,
        actionType: _factorToActionType(topIntervention.factor),
        actionDescription:
          topIntervention.action ||
          _describeAction({ intervention: _factorToActionType(topIntervention.factor) }),
        expectedScoreAfterAction: topIntervention.scoreIfResolved,
        expectedScoreReduction: topIntervention.scoreReduction,
        expectedNewRiskLevel: topIntervention.newRiskLevel,
        expectedProbabilityReduction: _round3(Math.max(0, probReduction)),
      };
    }

    entries.push({
      patientId: inputs.patientId,
      patientName: inputs.patientName || null,
      mrn: inputs.mrn || null,
      organNeeded: inputs.organNeeded || null,
      assignedCoordinatorId: coordinatorId,
      daysOnWaitlist: inputs.daysOnWaitlist || null,
      score: assessment.score,
      riskLevel: assessment.riskLevel,
      probabilityWithin30Days: assessment.probabilities.within30Days,
      probabilityWithin60Days: assessment.probabilities.within60Days,
      probabilityWithin90Days: assessment.probabilities.within90Days,
      daysUntilEvaluationExpiry: urgencyDays,
      urgencyMultiplier: urgencyMultiplier,
      queuePriority: queuePriority,
      recommendedAction: recommendedAction,
      topThreeFactors: (assessment.factorContributions || [])
        .slice(0, 3)
        .map((f) => ({
          factor: f.factor,
          weightedContribution: f.weightedContribution,
          shareOfScore: f.shareOfScore,
          rawSubscore: f.rawSubscore,
        })),
      modelVersion: assessment.modelVersion,
      inputsFingerprint: assessment.inputsFingerprint,
    });
  }

  entries.sort((a, b) => b.queuePriority - a.queuePriority);
  const queue = entries.slice(0, size);

  // Coordinator-overload finding
  const totalAssigned = Array.from(coordinatorLoad.values()).reduce(
    (a, b) => a + b,
    0,
  );
  const coordinatorOverloads = [];
  for (const [coordId, count] of coordinatorLoad.entries()) {
    if (totalAssigned === 0) break;
    const fraction = count / totalAssigned;
    if (fraction >= COORDINATOR_OVERLOAD_FRACTION) {
      coordinatorOverloads.push({
        coordinatorId: coordId,
        atRiskCount: count,
        atRiskFraction: _round3(fraction),
      });
    }
  }

  // Aggregate expected impact: if every recommended action in the queue is
  // executed, what's the projected reduction in 90-day inactivations?
  let projectedProbabilityReduction = 0;
  for (const e of queue) {
    if (e.recommendedAction) {
      projectedProbabilityReduction +=
        e.recommendedAction.expectedProbabilityReduction;
    }
  }

  return {
    queueVersion: QUEUE_VERSION,
    modelVersion: engine.MODEL_VERSION,
    generatedAtISO: new Date(nowMs).toISOString(),
    candidatesScreened: candidateInputs.length,
    queueSize: queue.length,
    distribution,
    queue,
    coordinatorOverloads,
    aggregateExpectedImpact: {
      projectedProbabilityReductionWithin90Days: _round3(
        projectedProbabilityReduction,
      ),
      // Probability units sum to fractional inactivations avoided. Round to
      // 1 decimal because we're talking patients, not basis points.
      projectedInactivationsAvoidedWithin90Days: _round1(
        projectedProbabilityReduction,
      ),
    },
    disclaimer:
      'Operational coordination signal. Not a clinical recommendation. ' +
      'Allocation decisions are made by OPTN/UNet, not by TransTrack. ' +
      'Probabilities use the engine\'s default logistic calibration and ' +
      'should be re-fit against the deploying center\'s historical cohort ' +
      'during PQ before being used for budgeting decisions.',
  };
}

/**
 * Get the top-N intervention recommendations for a single patient, ordered by
 * largest score reduction. Useful when a coordinator is on a single patient
 * page and wants to see the full action menu.
 *
 * @param {Object} assessment Output of `engine.assessInactivationRisk`.
 * @param {number} [n=3]
 * @returns {Array<Object>}
 */
function getTopInterventions(assessment, n = 3) {
  if (!assessment || !Array.isArray(assessment.interventions)) return [];
  return assessment.interventions
    .filter((iv) => iv.scoreReduction > 0)
    .slice(0, n)
    .map((iv) => {
      const probAfter = engine.scoreToProbabilities(iv.scoreIfResolved);
      return {
        factor: iv.factor,
        actionType: _factorToActionType(iv.factor),
        actionDescription:
          iv.action ||
          _describeAction({ intervention: _factorToActionType(iv.factor) }),
        expectedScoreAfter: iv.scoreIfResolved,
        expectedScoreReduction: iv.scoreReduction,
        expectedNewRiskLevel: iv.newRiskLevel,
        expectedProbabilityAfter90Days: _round3(probAfter.d90),
      };
    });
}

/**
 * Map a risk-engine factor key to the canonical intervention action type
 * accepted by `engine.simulateIntervention({ type })`. Returned values:
 *   'resolveAllBarriers' | 'refreshEvaluation' | 'refreshDocument' |
 *   'refreshLabs'        | 'refreshAHHQ'      | 'recordContact'    | null
 */
function _factorToActionType(factor) {
  switch (factor) {
    case 'BARRIERS':         return 'resolveAllBarriers';
    case 'EVAL_EXPIRY':      return 'refreshEvaluation';
    case 'DOCUMENTATION':    return 'refreshDocument';
    case 'LAB_CURRENCY':     return 'refreshLabs';
    case 'AHHQ_CURRENCY':    return 'refreshAHHQ';
    case 'CONTACT_RECENCY':  return 'recordContact';
    default:                 return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _daysUntilEvalExpiry(inputs, nowMs) {
  const lastEval = inputs.lastEvaluationDateISO
    ? Date.parse(inputs.lastEvaluationDateISO)
    : null;
  if (!Number.isFinite(lastEval)) return null;
  const validityDays = inputs.evaluationValidityDays || 365;
  const expiryMs = lastEval + validityDays * ONE_DAY_MS;
  const days = Math.round((expiryMs - nowMs) / ONE_DAY_MS);
  return days;
}

function _urgencyMultiplier(daysUntilExpiry) {
  // Fresh eval: no boost (1.0). Within URGENCY_WINDOW_DAYS: scales linearly
  // up to 1.5x. Already expired: 1.5x flat (already-expired is also captured
  // by the EVAL_EXPIRY subscore inside the engine, so we don't double-count
  // beyond the multiplier ceiling).
  if (daysUntilExpiry === null || daysUntilExpiry === undefined) return 1.0;
  if (daysUntilExpiry <= 0) return 1.5;
  if (daysUntilExpiry >= URGENCY_WINDOW_DAYS) return 1.0;
  const within = (URGENCY_WINDOW_DAYS - daysUntilExpiry) / URGENCY_WINDOW_DAYS;
  return _round3(1.0 + within * 0.5);
}

function _describeAction(intervention) {
  switch (intervention.intervention) {
    case 'resolveAllBarriers':
      return 'Close all open readiness barriers (insurance, transport, caregiver, financial). Engage social work / financial counsellor as needed.';
    case 'refreshEvaluation':
      return 'Schedule and complete annual transplant evaluation refresh.';
    case 'refreshDocument':
      return 'Update patient record: confirm demographics, contact, insurance, and care team.';
    case 'refreshLabs':
      return 'Order or chase missing/expired required labs. Confirm receipt and document collection date.';
    case 'refreshAHHQ':
      return 'Reach patient to complete or refresh the Adult Health History Questionnaire.';
    case 'recordContact':
      return 'Make a documented contact attempt (phone, secure message, telehealth, or in-person visit).';
    default:
      return 'Review patient record and document next operational step.';
  }
}

function _round1(n) {
  return Math.round(n * 10) / 10;
}

function _round3(n) {
  return Math.round(n * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Optional DB-backed builder. Pure-function path above stays I/O-free.
// ---------------------------------------------------------------------------

/**
 * Pull every active waitlist patient for the given org, build risk inputs,
 * and emit an action queue. Intended for the IPC handler; tests should call
 * `buildActionQueue` directly with synthetic snapshots.
 *
 * @param {string} orgId
 * @param {Object} [opts] forwarded to `buildActionQueue`. Also accepts
 *   `db` and `getDatabase` for test injection.
 */
function buildActionQueueFromDatabase(orgId, opts = {}) {
  if (!orgId) throw new Error('orgId is required');
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

  const nowMs = opts.nowMs || Date.now();
  const inputs = patients.map((p) => {
    const built = engine.buildInputsFromDatabase(orgId, p.id, { db });
    const created = p.created_at ? Date.parse(p.created_at) : null;
    const daysOnWaitlist = Number.isFinite(created)
      ? Math.max(0, Math.round((nowMs - created) / ONE_DAY_MS))
      : null;
    return {
      ...built,
      patientName: p.patient_name || null,
      mrn: p.mrn || null,
      organNeeded: p.organ_needed || null,
      assignedCoordinatorId: p.assigned_coordinator_id || null,
      daysOnWaitlist,
    };
  });

  return buildActionQueue(inputs, opts);
}

module.exports = {
  QUEUE_VERSION,
  DEFAULT_QUEUE_SIZE,
  URGENCY_WINDOW_DAYS,
  COORDINATOR_OVERLOAD_FRACTION,
  buildActionQueue,
  getTopInterventions,
  buildActionQueueFromDatabase,
};
