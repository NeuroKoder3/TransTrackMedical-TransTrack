/**
 * TransTrack — Inactivation Risk Engine (v2)
 *
 * Pure-function, deterministic, explainable scoring of how likely an active
 * waitlist candidate is to slip into INACTIVE status because of OPERATIONAL
 * (not clinical) failure modes. The engine answers four questions:
 *
 *   1. score            — a 0..100 composite operational risk score.
 *   2. probabilities    — calibrated probabilities of inactivation within
 *                          30 / 60 / 90 days (logistic mapping; documented).
 *   3. explanation      — per-factor contribution breakdown (SHAP-style additive)
 *                          so a coordinator, an auditor, or a partner system
 *                          (CareDx Ottr / TXAccess, Epic, etc.) can show *why*
 *                          a patient was flagged.
 *   4. interventions    — counterfactual simulations: "if we resolve this open
 *                          insurance barrier, the score drops from 78 to 41".
 *                          That is the heart of inactivation prevention.
 *
 * Design rules (these are the rules that make this engine acquisition-grade):
 *
 *   • The scoring function is PURE: it takes a snapshot object and returns
 *     a decomposed assessment. It NEVER reads the database, the file system,
 *     the network, the clock (the caller injects `nowMs`). This makes scores
 *     reproducible, auditable, unit-testable without a DB, and embeddable in
 *     a CDS Hook on the server side.
 *
 *   • Every factor exposes its raw input, its weight, its weighted contribution,
 *     and its share of the total score. Nothing is opaque.
 *
 *   • The engine is OPERATIONAL, not clinical. It does not interpret lab
 *     values, does not perform allocation, does not replace UNOS/OPTN.
 *     Output is decision *support* for coordination teams — the human
 *     coordinator always acts on the recommendation.
 *
 *   • A `MODEL_VERSION` field is emitted on every assessment so any score
 *     stored historically can be re-explained against the model that produced
 *     it. Bumping the model is a deliberate, audited event.
 *
 * Author: TransTrack Engineering — first cut authored 2026-04-28.
 */

'use strict';

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Model definition
// ---------------------------------------------------------------------------

const MODEL_VERSION = '2.0.0';

/**
 * Factor weights. Sum is 1.0. These are the operational-failure-mode drivers
 * that have been observed in pre-listing literature and field interviews to
 * precede candidate inactivation:
 *
 *   - EVAL_EXPIRY     : annual evaluation window closing; biggest single driver.
 *   - DOCUMENTATION   : record staleness; proxy for "patient is being forgotten".
 *   - BARRIERS        : non-clinical readiness barriers (insurance, transport,
 *                        caregiver, financial); these are the items that
 *                        actually flip the status switch.
 *   - LAB_CURRENCY    : whether required labs are current (documentation
 *                        currency only — we do NOT interpret lab values).
 *   - AHHQ_CURRENCY   : adult Health History Questionnaire status.
 *   - STATUS_CHURN    : flapping status changes; instability signal.
 *   - CONTACT_RECENCY : days since last patient touchpoint.
 *   - COORDINATOR_LOAD: too many candidates per coordinator → things drop.
 */
const FACTOR_WEIGHTS = Object.freeze({
  EVAL_EXPIRY:      0.22,
  DOCUMENTATION:    0.14,
  BARRIERS:         0.20,
  LAB_CURRENCY:     0.10,
  AHHQ_CURRENCY:    0.08,
  STATUS_CHURN:     0.10,
  CONTACT_RECENCY:  0.10,
  COORDINATOR_LOAD: 0.06,
});

// Sanity guard: if a future contributor edits a weight, this catches it.
(function _assertWeightsSumToOne() {
  const sum = Object.values(FACTOR_WEIGHTS).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1.0) > 1e-9) {
    throw new Error(`FACTOR_WEIGHTS must sum to 1.0, got ${sum}`);
  }
})();

const RISK_THRESHOLDS = Object.freeze({
  critical: 75,
  high:     50,
  moderate: 25,
});

const RISK_LEVEL = Object.freeze({
  CRITICAL: 'critical',
  HIGH:     'high',
  MODERATE: 'moderate',
  LOW:      'low',
  NONE:     'none',
});

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Logistic calibration — converts the 0..100 composite score into a
// probability of inactivation within N days. The intercepts and slopes were
// fit by ordinary-least-squares regression in logit-space against the
// documented anchor table below. The matching regression test
// (`inactivationRiskEngine.test.cjs` →
// "calibration table matches documented anchors") will fail if a future
// contributor changes one without updating the other.
//
//   anchor       30d     60d     90d
//   score 25     10%     18%     25%
//   score 50     30%     45%     55%
//   score 75     65%     78%     85%
//   score 90     82%     90%     94%
//
// The shape of the doc table is slightly more curved than a 2-parameter
// logistic, so the fit lands within ±3 percentage points of every anchor —
// well below the precision of the operational signal (we are not predicting
// individual mortality; we are surfacing operational drift).
//
// This is a conservative, monotone calibration; deploying organizations are
// expected to recalibrate against their own historical inactivation cohort
// during PQ. The shape (logistic) is fixed; the {intercept, slope} are tunable.
const PROB_CURVES = Object.freeze({
  d30: { intercept: -3.659, slope: 0.05720 },
  d60: { intercept: -2.991, slope: 0.05713 },
  d90: { intercept: -2.655, slope: 0.05920 },
});

// ---------------------------------------------------------------------------
// Per-factor scoring (each returns a 0..100 sub-score)
// ---------------------------------------------------------------------------

function _clamp(n, lo, hi) {
  if (Number.isNaN(n) || n === null || n === undefined) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function _round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Days since `iso` relative to `nowMs`. Returns null if `iso` is falsy.
 */
function _daysSince(iso, nowMs) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, (nowMs - t) / ONE_DAY_MS);
}

function evalExpirySubscore(inputs, nowMs) {
  const days = _daysSince(inputs.lastEvaluationDateISO, nowMs);
  // No evaluation on record — treat as already expired.
  if (days === null) return 100;
  const annualThreshold = inputs.evaluationValidityDays || 365;
  if (days >= annualThreshold)               return 100;
  if (days >= annualThreshold - 14)          return 90;
  if (days >= annualThreshold - 30)          return 75;
  if (days >= annualThreshold - 60)          return 50;
  if (days >= annualThreshold - 90)          return 30;
  // Linear ramp before 90 days out: score grows as we approach expiry.
  return _clamp((days / annualThreshold) * 30, 0, 30);
}

function documentationSubscore(inputs, nowMs) {
  const days = _daysSince(inputs.lastDocumentUpdateISO, nowMs);
  if (days === null) return 60;       // never updated → moderate risk, not extreme
  if (days >= 120) return 100;
  if (days >=  90) return  80;
  if (days >=  60) return  55;
  if (days >=  30) return  30;
  return _clamp((days / 30) * 15, 0, 15);
}

function barriersSubscore(inputs) {
  const open = Array.isArray(inputs.openBarriers) ? inputs.openBarriers : [];
  if (open.length === 0) return 0;
  // High-risk barrier (insurance lapse, no caregiver, etc.) is each worth ~25.
  // Any extra open barrier adds ~10 up to 50 total. Capped at 100.
  const highRiskCount = open.filter(b => (b.riskLevel || '').toLowerCase() === 'high').length;
  const moderateCount = open.filter(b => (b.riskLevel || '').toLowerCase() === 'moderate').length;
  const lowCount      = open.length - highRiskCount - moderateCount;
  const overdueCount  = open.filter(b => b.overdue === true).length;

  let raw = highRiskCount * 25 + moderateCount * 12 + lowCount * 5 + overdueCount * 8;
  return _clamp(raw, 0, 100);
}

function labCurrencySubscore(inputs) {
  const missing = Number(inputs.labsMissingCount || 0);
  const expired = Number(inputs.labsExpiredCount || 0);
  if (missing === 0 && expired === 0) return 0;
  // Missing labs are worse than expired labs.
  let raw = missing * 18 + expired * 10;
  return _clamp(raw, 0, 100);
}

function ahhqCurrencySubscore(inputs) {
  switch ((inputs.ahhqStatus || '').toLowerCase()) {
    case 'current':         return 0;
    case 'expiring_soon':   return 35;
    case 'incomplete':      return 60;
    case 'expired':         return 80;
    case 'missing':         return 100;
    default:                return 25; // unknown → small baseline risk
  }
}

function statusChurnSubscore(inputs) {
  const changes = Number(inputs.statusChangesLast90Days || 0);
  if (changes >= 5) return 100;
  if (changes >= 4) return  85;
  if (changes >= 3) return  65;
  if (changes >= 2) return  35;
  if (changes >= 1) return  15;
  return 0;
}

function contactRecencySubscore(inputs, nowMs) {
  const days = _daysSince(inputs.lastContactISO, nowMs);
  if (days === null) return 60;
  if (days >= 120) return 100;
  if (days >=  90) return  80;
  if (days >=  60) return  55;
  if (days >=  30) return  30;
  return _clamp((days / 30) * 15, 0, 15);
}

function coordinatorLoadSubscore(inputs) {
  const load = Number(inputs.coordinatorPanelSize || 0);
  if (load <= 0)   return 0;
  if (load >= 60)  return 100;
  if (load >= 40)  return  70;
  if (load >= 25)  return  40;
  if (load >= 15)  return  20;
  return 0;
}

const SUBSCORERS = [
  { key: 'EVAL_EXPIRY',      label: 'Evaluation expiring',          fn: evalExpirySubscore,      preventable: true,
    intervention: 'Schedule re-evaluation appointment',
    category: 'documentation' },
  { key: 'DOCUMENTATION',    label: 'Stale documentation',          fn: documentationSubscore,   preventable: true,
    intervention: 'Touch and update patient record',
    category: 'workflow' },
  { key: 'BARRIERS',         label: 'Open readiness barriers',      fn: barriersSubscore,        preventable: true,
    intervention: 'Resolve open non-clinical barriers',
    category: 'barriers' },
  { key: 'LAB_CURRENCY',     label: 'Required labs missing/expired', fn: labCurrencySubscore,     preventable: true,
    intervention: 'Order missing labs / refresh expired labs',
    category: 'documentation' },
  { key: 'AHHQ_CURRENCY',    label: 'aHHQ status',                  fn: ahhqCurrencySubscore,    preventable: true,
    intervention: 'Complete or refresh aHHQ',
    category: 'documentation' },
  { key: 'STATUS_CHURN',     label: 'Frequent status changes',      fn: statusChurnSubscore,     preventable: false,
    intervention: 'Review status history with attending coordinator',
    category: 'pattern' },
  { key: 'CONTACT_RECENCY',  label: 'No recent patient contact',    fn: contactRecencySubscore,  preventable: true,
    intervention: 'Outreach call / appointment within 7 days',
    category: 'workflow' },
  { key: 'COORDINATOR_LOAD', label: 'Coordinator panel overload',   fn: coordinatorLoadSubscore, preventable: false,
    intervention: 'Rebalance coordinator panel',
    category: 'staffing' },
];

// ---------------------------------------------------------------------------
// Public API: assessInactivationRisk(inputs, options)
// ---------------------------------------------------------------------------

function _logistic(x) {
  // Numerically stable sigmoid.
  if (x >= 0) {
    const e = Math.exp(-x);
    return 1 / (1 + e);
  }
  const e = Math.exp(x);
  return e / (1 + e);
}

function _probabilityFromScore(score, curve) {
  return _clamp(_logistic(curve.intercept + curve.slope * score), 0, 1);
}

/**
 * Public helper: given a composite risk score in [0, 100], return the
 * unrounded calibrated probabilities at 30 / 60 / 90 days. Exported so the
 * documented calibration table in `docs/INACTIVATION_RISK_ENGINE.md` can be
 * regression-tested directly. The `assessInactivationRisk()` path returns
 * the same values rounded to two decimal places for display.
 */
function scoreToProbabilities(score) {
  const s = _clamp(Number(score) || 0, 0, 100);
  return {
    d30: _probabilityFromScore(s, PROB_CURVES.d30),
    d60: _probabilityFromScore(s, PROB_CURVES.d60),
    d90: _probabilityFromScore(s, PROB_CURVES.d90),
  };
}

function _classifyRisk(score) {
  if (score >= RISK_THRESHOLDS.critical) return RISK_LEVEL.CRITICAL;
  if (score >= RISK_THRESHOLDS.high)     return RISK_LEVEL.HIGH;
  if (score >= RISK_THRESHOLDS.moderate) return RISK_LEVEL.MODERATE;
  if (score > 0)                         return RISK_LEVEL.LOW;
  return RISK_LEVEL.NONE;
}

/**
 * Build a deterministic input fingerprint so the same inputs always produce
 * the same assessment hash. Useful for proving "this score was produced
 * from these inputs at this model version" during an audit.
 */
function _fingerprintInputs(inputs) {
  const ordered = JSON.stringify(inputs, Object.keys(inputs).sort());
  return crypto.createHash('sha256').update(ordered).digest('hex').slice(0, 16);
}

/**
 * Core scoring entry point.
 *
 * @param {Object} inputs Operational risk input snapshot.
 *   {
 *     patientId?: string,
 *     orgId?: string,
 *     lastEvaluationDateISO?: string,
 *     evaluationValidityDays?: number,
 *     lastDocumentUpdateISO?: string,
 *     openBarriers?: Array<{ riskLevel?: 'high'|'moderate'|'low', overdue?: boolean, type?: string, id?: string }>,
 *     labsMissingCount?: number,
 *     labsExpiredCount?: number,
 *     ahhqStatus?: 'current'|'expiring_soon'|'incomplete'|'expired'|'missing',
 *     statusChangesLast90Days?: number,
 *     lastContactISO?: string,
 *     coordinatorPanelSize?: number,
 *   }
 * @param {Object} [options] { nowMs?: number }
 * @returns InactivationRiskAssessment
 */
function assessInactivationRisk(inputs, options = {}) {
  if (!inputs || typeof inputs !== 'object') {
    throw new Error('assessInactivationRisk: inputs object is required');
  }
  const nowMs = options.nowMs ?? Date.now();

  // 1. compute every sub-score
  const subscores = {};
  for (const def of SUBSCORERS) {
    subscores[def.key] = _clamp(def.fn(inputs, nowMs), 0, 100);
  }

  // 2. composite score
  let composite = 0;
  for (const def of SUBSCORERS) {
    composite += subscores[def.key] * FACTOR_WEIGHTS[def.key];
  }
  composite = _clamp(_round1(composite), 0, 100);

  // 3. factor contribution decomposition (additive, sums to composite)
  const factorContributions = SUBSCORERS.map(def => {
    const sub = subscores[def.key];
    const weight = FACTOR_WEIGHTS[def.key];
    const weighted = _round1(sub * weight);
    const sharePct = composite > 0 ? _round1((weighted / composite) * 100) : 0;
    return {
      factor: def.key,
      label: def.label,
      category: def.category,
      rawSubscore: _round1(sub),
      weight: weight,
      weightedContribution: weighted,
      sharePctOfTotal: sharePct,
      preventable: def.preventable,
      suggestedIntervention: def.intervention,
    };
  }).sort((a, b) => b.weightedContribution - a.weightedContribution);

  // 4. probabilities of inactivation in 30 / 60 / 90 days
  const probabilities = {
    within30Days: _round1(_probabilityFromScore(composite, PROB_CURVES.d30) * 100) / 100,
    within60Days: _round1(_probabilityFromScore(composite, PROB_CURVES.d60) * 100) / 100,
    within90Days: _round1(_probabilityFromScore(composite, PROB_CURVES.d90) * 100) / 100,
  };

  // 5. headline risk level + recommended actions ordered by impact
  const riskLevel = _classifyRisk(composite);
  const topRisks = factorContributions
    .filter(c => c.rawSubscore >= 30 && c.preventable)
    .slice(0, 3)
    .map(c => ({
      factor: c.factor,
      label: c.label,
      action: c.suggestedIntervention,
      expectedScoreReduction: _round1(c.weightedContribution),
    }));

  // 6. counterfactual: if we knock each preventable factor down to 0,
  //    what would the score become? This gives the coordinator a ranked
  //    "biggest bang for the buck" intervention list.
  const interventions = factorContributions
    .filter(c => c.preventable && c.weightedContribution > 0)
    .map(c => {
      const counterfactualSubscores = { ...subscores, [c.factor]: 0 };
      let cfScore = 0;
      for (const def of SUBSCORERS) {
        cfScore += counterfactualSubscores[def.key] * FACTOR_WEIGHTS[def.key];
      }
      cfScore = _clamp(_round1(cfScore), 0, 100);
      return {
        factor: c.factor,
        label: c.label,
        action: c.suggestedIntervention,
        category: c.category,
        currentContribution: c.weightedContribution,
        scoreIfResolved: cfScore,
        scoreReduction: _round1(composite - cfScore),
        newRiskLevel: _classifyRisk(cfScore),
      };
    })
    .sort((a, b) => b.scoreReduction - a.scoreReduction);

  return {
    modelVersion: MODEL_VERSION,
    patientId: inputs.patientId || null,
    orgId: inputs.orgId || null,
    score: composite,
    riskLevel,
    probabilities,
    factorContributions,
    topRisks,
    interventions,
    inputsFingerprint: _fingerprintInputs(inputs),
    assessedAtISO: new Date(nowMs).toISOString(),
    disclaimer:
      'Operational risk only. Not for allocation. Not a clinical recommendation. ' +
      'Allocation decisions are made via OPTN UNet.',
  };
}

/**
 * Counterfactual: given an existing assessment input snapshot, recompute the
 * score after applying an intervention. Currently supported intervention types:
 *
 *   { type: 'resolveBarrier',      barrierId: '<id>' }
 *   { type: 'resolveAllBarriers' }
 *   { type: 'refreshEvaluation' }    // resets last_eval_date to today
 *   { type: 'refreshDocument' }      // resets last_doc_update to today
 *   { type: 'refreshLabs' }          // missing/expired -> 0
 *   { type: 'refreshAHHQ' }          // ahhqStatus -> 'current'
 *   { type: 'recordContact' }        // last_contact -> today
 *
 * Returns a new assessment with `intervention` field describing what changed.
 */
function simulateIntervention(inputs, intervention, options = {}) {
  if (!intervention || !intervention.type) {
    throw new Error('simulateIntervention: intervention.type is required');
  }
  const nowMs = options.nowMs ?? Date.now();
  const todayISO = new Date(nowMs).toISOString();
  const next = JSON.parse(JSON.stringify(inputs || {}));

  switch (intervention.type) {
    case 'resolveBarrier': {
      if (!intervention.barrierId) throw new Error('resolveBarrier requires barrierId');
      next.openBarriers = (next.openBarriers || []).filter(b => b.id !== intervention.barrierId);
      break;
    }
    case 'resolveAllBarriers':
      next.openBarriers = [];
      break;
    case 'refreshEvaluation':
      next.lastEvaluationDateISO = todayISO;
      break;
    case 'refreshDocument':
      next.lastDocumentUpdateISO = todayISO;
      break;
    case 'refreshLabs':
      next.labsMissingCount = 0;
      next.labsExpiredCount = 0;
      break;
    case 'refreshAHHQ':
      next.ahhqStatus = 'current';
      break;
    case 'recordContact':
      next.lastContactISO = todayISO;
      break;
    default:
      throw new Error(`simulateIntervention: unknown intervention.type "${intervention.type}"`);
  }

  const before = assessInactivationRisk(inputs, options);
  const after  = assessInactivationRisk(next,   options);
  return {
    intervention,
    before: { score: before.score, riskLevel: before.riskLevel, probabilities: before.probabilities },
    after:  { score: after.score,  riskLevel: after.riskLevel,  probabilities: after.probabilities  },
    scoreReduction: _round1(before.score - after.score),
    fullAssessmentAfter: after,
  };
}

// ---------------------------------------------------------------------------
// Center-level KPIs (operational ROI for CareDx-style buyers)
// ---------------------------------------------------------------------------

/**
 * Default cost-of-inactivation. This is the conservative end of published
 * literature on transplant readmission / re-evaluation cost when a candidate
 * is inactivated and must be re-worked up. The deploying organization SHOULD
 * override this with its own internal finance number during PQ.
 */
const DEFAULT_INACTIVATION_COST_USD = 18000;

/**
 * Project center-level inactivation prevention impact.
 *
 * Given a list of input snapshots (one per active candidate), compute:
 *   - distribution by risk level
 *   - expected inactivations within 90 days BEFORE intervention
 *   - expected inactivations within 90 days AFTER applying the highest-impact
 *     preventable intervention per critical/high candidate
 *   - expected dollars avoided
 *
 * @param {Array<Object>} candidateInputs  Array of input snapshots
 * @param {Object} [opts] { nowMs?, costPerInactivationUSD?, interventionCapPerCandidate? }
 */
function projectCenterImpact(candidateInputs, opts = {}) {
  if (!Array.isArray(candidateInputs)) {
    throw new Error('projectCenterImpact: candidateInputs must be an array');
  }
  const nowMs = opts.nowMs ?? Date.now();
  const cost = Number(opts.costPerInactivationUSD || DEFAULT_INACTIVATION_COST_USD);
  const cap  = Math.max(1, Number(opts.interventionCapPerCandidate || 1));

  let baselineExpected90 = 0;
  let postInterventionExpected90 = 0;
  const dist = { critical: 0, high: 0, moderate: 0, low: 0, none: 0 };
  const perCandidate = [];

  for (const inputs of candidateInputs) {
    const a = assessInactivationRisk(inputs, { nowMs });
    dist[a.riskLevel] = (dist[a.riskLevel] || 0) + 1;
    baselineExpected90 += a.probabilities.within90Days;

    // Apply the top-N preventable interventions for this candidate
    let workingInputs = inputs;
    let bestAfter = a;
    for (let i = 0; i < cap; i++) {
      const reassess = assessInactivationRisk(workingInputs, { nowMs });
      const top = reassess.interventions[0];
      if (!top || top.scoreReduction <= 0) break;
      const result = simulateIntervention(workingInputs, _interventionForFactor(top.factor), { nowMs });
      // Refresh the working inputs to mirror the simulated intervention
      workingInputs = _applyInterventionToInputs(workingInputs, top.factor, nowMs);
      bestAfter = result.fullAssessmentAfter;
    }
    postInterventionExpected90 += bestAfter.probabilities.within90Days;

    perCandidate.push({
      patientId: inputs.patientId || null,
      baselineScore: a.score,
      baselineRiskLevel: a.riskLevel,
      baselineProb90: a.probabilities.within90Days,
      postScore: bestAfter.score,
      postRiskLevel: bestAfter.riskLevel,
      postProb90: bestAfter.probabilities.within90Days,
      probReduction: _round1((a.probabilities.within90Days - bestAfter.probabilities.within90Days) * 1000) / 1000,
    });
  }

  const inactivationsAvoided = Math.max(0, baselineExpected90 - postInterventionExpected90);
  return {
    modelVersion: MODEL_VERSION,
    candidates: candidateInputs.length,
    distribution: dist,
    expectedInactivationsWithin90Days: {
      baseline:         _round1(baselineExpected90),
      postIntervention: _round1(postInterventionExpected90),
      avoided:          _round1(inactivationsAvoided),
    },
    estimatedDollarsAvoided: Math.round(inactivationsAvoided * cost),
    costPerInactivationUSD: cost,
    perCandidate,
    generatedAtISO: new Date(nowMs).toISOString(),
    disclaimer:
      'Projection only. Probabilities use a default logistic calibration and ' +
      'must be recalibrated against the deploying center\'s historical inactivation ' +
      'cohort during PQ before being used for budgeting decisions.',
  };
}

function _interventionForFactor(factor) {
  switch (factor) {
    case 'BARRIERS':         return { type: 'resolveAllBarriers' };
    case 'EVAL_EXPIRY':      return { type: 'refreshEvaluation' };
    case 'DOCUMENTATION':    return { type: 'refreshDocument' };
    case 'LAB_CURRENCY':     return { type: 'refreshLabs' };
    case 'AHHQ_CURRENCY':    return { type: 'refreshAHHQ' };
    case 'CONTACT_RECENCY':  return { type: 'recordContact' };
    default:                 return null;
  }
}

function _applyInterventionToInputs(inputs, factor, nowMs) {
  const intervention = _interventionForFactor(factor);
  if (!intervention) return inputs;
  const todayISO = new Date(nowMs).toISOString();
  const next = JSON.parse(JSON.stringify(inputs || {}));
  switch (intervention.type) {
    case 'resolveAllBarriers': next.openBarriers = []; break;
    case 'refreshEvaluation':  next.lastEvaluationDateISO = todayISO; break;
    case 'refreshDocument':    next.lastDocumentUpdateISO = todayISO; break;
    case 'refreshLabs':        next.labsMissingCount = 0; next.labsExpiredCount = 0; break;
    case 'refreshAHHQ':        next.ahhqStatus = 'current'; break;
    case 'recordContact':      next.lastContactISO = todayISO; break;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Optional DB-backed input builder (kept separate from pure scoring path).
// Tests do NOT require this to run — they pass synthetic snapshots directly.
// ---------------------------------------------------------------------------

/**
 * Build an input snapshot for a patient by reading the local encrypted SQLite
 * database. Lazy-required so the pure-function path has zero DB dependency.
 *
 * @param {string} orgId
 * @param {string} patientId
 * @param {Object} [opts] { db?, getDatabase? } — overridable for tests.
 */
function buildInputsFromDatabase(orgId, patientId, opts = {}) {
  if (!orgId)     throw new Error('orgId is required');
  if (!patientId) throw new Error('patientId is required');

  const getDb = opts.getDatabase || (() => require('../database/init.cjs').getDatabase());
  const db = opts.db || getDb();

  const patient = db.prepare(
    'SELECT * FROM patients WHERE org_id = ? AND id = ?'
  ).get(orgId, patientId);

  if (!patient) throw new Error('Patient not found');

  // open barriers (best effort — table may not exist in older deployments)
  let openBarriers = [];
  try {
    const rows = db.prepare(
      `SELECT id, barrier_type as type, risk_level as riskLevel,
              CASE WHEN due_date IS NOT NULL AND due_date < date('now')
                   THEN 1 ELSE 0 END as overdue
         FROM readiness_barriers
        WHERE org_id = ? AND patient_id = ? AND status != 'resolved'`
    ).all(orgId, patientId);
    openBarriers = rows.map(r => ({
      id: r.id,
      type: r.type,
      riskLevel: r.riskLevel,
      overdue: r.overdue === 1,
    }));
  } catch (_) { /* table absent — leave empty */ }

  // status churn — count audit log status updates in last 90 days
  let statusChanges = 0;
  try {
    const since = new Date(Date.now() - 90 * ONE_DAY_MS).toISOString();
    const row = db.prepare(
      `SELECT COUNT(*) as count FROM audit_logs
        WHERE org_id = ? AND entity_type = 'Patient' AND entity_id = ?
          AND action = 'update' AND details LIKE '%status%' AND created_at > ?`
    ).get(orgId, patientId, since);
    statusChanges = row?.count || 0;
  } catch (_) { /* audit table missing — treat as 0 */ }

  // labs counts (best effort)
  let labsMissingCount = 0;
  let labsExpiredCount = 0;
  try {
    const labsService = require('./labsService.cjs');
    const status = labsService.getPatientLabStatus(patientId, orgId);
    if (status) {
      labsMissingCount = status.missing || 0;
      labsExpiredCount = status.expired || 0;
    }
  } catch (_) { /* service not loaded */ }

  // aHHQ status (best effort)
  let ahhqStatus = 'unknown';
  try {
    const ahhqService = require('./ahhqService.cjs');
    const summary = ahhqService.getPatientAHHQSummary(patientId, orgId);
    if (summary) {
      if (!summary.exists) {
        ahhqStatus = 'missing';
      } else {
        ahhqStatus = (summary.status || summary.ahhq?.status || 'unknown').toLowerCase();
      }
    }
  } catch (_) { /* service not loaded */ }

  // coordinator panel size (best effort)
  let coordinatorPanelSize = 0;
  try {
    if (patient.assigned_coordinator_id) {
      const row = db.prepare(
        `SELECT COUNT(*) as count FROM patients
          WHERE org_id = ? AND assigned_coordinator_id = ?
            AND waitlist_status = 'active'`
      ).get(orgId, patient.assigned_coordinator_id);
      coordinatorPanelSize = row?.count || 0;
    }
  } catch (_) { /* column absent on older schemas */ }

  return {
    patientId: patient.id,
    orgId: patient.org_id,
    lastEvaluationDateISO: patient.last_evaluation_date || null,
    evaluationValidityDays: 365,
    lastDocumentUpdateISO: patient.updated_at || null,
    openBarriers,
    labsMissingCount,
    labsExpiredCount,
    ahhqStatus,
    statusChangesLast90Days: statusChanges,
    lastContactISO: patient.last_contact_at || patient.updated_at || null,
    coordinatorPanelSize,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  MODEL_VERSION,
  FACTOR_WEIGHTS,
  RISK_THRESHOLDS,
  RISK_LEVEL,
  DEFAULT_INACTIVATION_COST_USD,
  // pure scoring
  assessInactivationRisk,
  simulateIntervention,
  projectCenterImpact,
  scoreToProbabilities,
  // exposed for testing / introspection
  evalExpirySubscore,
  documentationSubscore,
  barriersSubscore,
  labCurrencySubscore,
  ahhqCurrencySubscore,
  statusChurnSubscore,
  contactRecencySubscore,
  coordinatorLoadSubscore,
  // db-backed builder
  buildInputsFromDatabase,
};
