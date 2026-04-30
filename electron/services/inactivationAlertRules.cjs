/**
 * TransTrack — Inactivation Alert Rules Engine
 *
 * Pure-function rules evaluator that takes a fresh per-patient assessment
 * (and optionally the previous one) and produces a list of structured
 * alerts that the host system should surface to a coordinator IMMEDIATELY.
 *
 * The built-in rule catalog targets the operational failure modes that
 * actually cause inactivation:
 *
 *   1. PATIENT_ENTERED_CRITICAL  — risk level just crossed into 'critical'.
 *   2. EVAL_EXPIRING_SOON        — annual evaluation expires within 30 days.
 *   3. EVAL_EXPIRED              — evaluation already past validity window.
 *   4. HIGH_BARRIER_OPENED       — at least one open barrier with high risk.
 *   5. SCORE_JUMPED              — score increased ≥10 points since the
 *                                  previous assessment.
 *   6. CONTACT_LAPSED            — no patient contact in ≥60 days.
 *   7. AHHQ_EXPIRED              — Adult Health History Questionnaire is
 *                                  missing or expired.
 *
 * Design rules:
 *
 *   • Pure: takes structured input, returns structured output. No DB, no
 *     clock (caller injects nowMs), no side effects. The host wraps this
 *     and delivers the alerts (in-app banner, notifications row, email,
 *     SIEM forwarder, etc.).
 *
 *   • Severity is set by the rule itself, NOT by the score. A score of 60
 *     with EVAL_EXPIRED is more urgent than a score of 80 with a fresh eval.
 *
 *   • Every alert carries `ruleId`, `severity`, `title`, `body`, `factor`
 *     (when applicable), and `recommendedAction` so the UI never needs
 *     business logic to render.
 *
 *   • Stable shape: the alert object shape does not change across rule
 *     additions, so partner systems (CDS Hooks, SIEM consumers) don't
 *     break when we extend the catalog.
 */

'use strict';

const ENGINE_VERSION = '1.0.0';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const SEVERITY = Object.freeze({
  CRITICAL: 'critical',
  HIGH:     'high',
  MODERATE: 'moderate',
  INFO:     'info',
});

const DEFAULT_THRESHOLDS = Object.freeze({
  evalExpiringSoonDays:  30,
  contactLapsedDays:     60,
  scoreJumpDelta:        10,
});

/**
 * Evaluate the rule catalog against a single patient.
 *
 * @param {Object} args
 * @param {Object} args.inputs           Risk-engine input snapshot (used for
 *                                        eval/contact/AHHQ/barriers checks).
 * @param {Object} args.assessment       Output of `engine.assessInactivationRisk`.
 * @param {Object} [args.previousAssessment]
 *                                        Output of the previous assessment for
 *                                        the same patient (for SCORE_JUMPED
 *                                        and PATIENT_ENTERED_CRITICAL).
 * @param {Object} [opts]
 * @param {number} [opts.nowMs]          Defaults to Date.now().
 * @param {Object} [opts.thresholds]     Override defaults (per-org config).
 * @returns {Array<Object>} alerts (possibly empty)
 */
function evaluateRules(args, opts = {}) {
  if (!args)             throw new Error('evaluateRules: args is required');
  if (!args.inputs)      throw new Error('evaluateRules: args.inputs is required');
  if (!args.assessment)  throw new Error('evaluateRules: args.assessment is required');

  const nowMs = opts.nowMs || Date.now();
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(opts.thresholds || {}) };
  const alerts = [];
  const a = args.assessment;
  const prev = args.previousAssessment || null;
  const inputs = args.inputs;

  // Rule 1 — PATIENT_ENTERED_CRITICAL
  if (a.riskLevel === 'critical' && (!prev || prev.riskLevel !== 'critical')) {
    alerts.push(_alert({
      ruleId: 'PATIENT_ENTERED_CRITICAL',
      severity: SEVERITY.CRITICAL,
      title: 'Patient just entered CRITICAL inactivation risk',
      body: `Composite operational risk score is ${a.score}. Top contributing factors: ${
        (a.factorContributions || []).slice(0, 3).map((f) => f.factor).join(', ')
      }.`,
      patientId: inputs.patientId,
      factor: (a.factorContributions || [])[0]?.factor || null,
      recommendedAction: (a.interventions || [])[0]?.action ||
        'Open patient and review top operational drivers immediately.',
      assessment: a,
    }));
  }

  // Rules 2 & 3 — eval expiring / expired
  const daysUntilEval = _daysUntilEvalExpiry(inputs, nowMs);
  if (daysUntilEval !== null) {
    if (daysUntilEval <= 0) {
      alerts.push(_alert({
        ruleId: 'EVAL_EXPIRED',
        severity: SEVERITY.CRITICAL,
        title: 'Annual evaluation has lapsed',
        body: `Last evaluation was ${Math.abs(daysUntilEval)} day(s) past its validity window.`,
        patientId: inputs.patientId,
        factor: 'EVAL_EXPIRY',
        recommendedAction: 'Schedule re-evaluation appointment immediately.',
        assessment: a,
      }));
    } else if (daysUntilEval <= thresholds.evalExpiringSoonDays) {
      alerts.push(_alert({
        ruleId: 'EVAL_EXPIRING_SOON',
        severity: SEVERITY.HIGH,
        title: 'Annual evaluation expires soon',
        body: `Evaluation is valid for another ${daysUntilEval} day(s).`,
        patientId: inputs.patientId,
        factor: 'EVAL_EXPIRY',
        recommendedAction: 'Schedule re-evaluation appointment within 2 weeks.',
        assessment: a,
      }));
    }
  }

  // Rule 4 — HIGH_BARRIER_OPENED
  const highBarriers = Array.isArray(inputs.openBarriers)
    ? inputs.openBarriers.filter((b) => (b.riskLevel || '').toLowerCase() === 'high')
    : [];
  if (highBarriers.length > 0) {
    alerts.push(_alert({
      ruleId: 'HIGH_BARRIER_OPENED',
      severity: SEVERITY.HIGH,
      title: `${highBarriers.length} high-risk barrier(s) currently open`,
      body: 'High-risk readiness barrier present (insurance, transport, caregiver, financial). These are leading inactivation drivers.',
      patientId: inputs.patientId,
      factor: 'BARRIERS',
      recommendedAction: 'Engage social work / financial counsellor and close at least one barrier this week.',
      assessment: a,
    }));
  }

  // Rule 5 — SCORE_JUMPED
  if (prev && typeof prev.score === 'number') {
    const delta = a.score - prev.score;
    if (delta >= thresholds.scoreJumpDelta) {
      alerts.push(_alert({
        ruleId: 'SCORE_JUMPED',
        severity: SEVERITY.HIGH,
        title: `Risk score jumped +${_round1(delta)} points`,
        body: `Previous score was ${prev.score}; current score is ${a.score}. Investigate what changed.`,
        patientId: inputs.patientId,
        factor: (a.factorContributions || [])[0]?.factor || null,
        recommendedAction: 'Review recent updates: barriers opened, labs lapsed, status changes, contact recency.',
        assessment: a,
      }));
    }
  }

  // Rule 6 — CONTACT_LAPSED
  const daysSinceContact = _daysSince(inputs.lastContactISO, nowMs);
  if (daysSinceContact !== null && daysSinceContact >= thresholds.contactLapsedDays) {
    alerts.push(_alert({
      ruleId: 'CONTACT_LAPSED',
      severity: SEVERITY.MODERATE,
      title: `No patient contact in ${daysSinceContact} day(s)`,
      body: 'Long contact gaps are an early operational signal of disengagement that precedes inactivation.',
      patientId: inputs.patientId,
      factor: 'CONTACT_RECENCY',
      recommendedAction: 'Outreach call, secure message, telehealth, or in-person visit within 7 days.',
      assessment: a,
    }));
  }

  // Rule 7 — AHHQ_EXPIRED / MISSING
  const ahhq = (inputs.ahhqStatus || '').toLowerCase();
  if (ahhq === 'expired' || ahhq === 'missing') {
    alerts.push(_alert({
      ruleId: 'AHHQ_EXPIRED',
      severity: SEVERITY.MODERATE,
      title: ahhq === 'missing'
        ? 'Adult Health History Questionnaire missing'
        : 'Adult Health History Questionnaire expired',
      body: 'aHHQ currency is required for waitlist documentation completeness.',
      patientId: inputs.patientId,
      factor: 'AHHQ_CURRENCY',
      recommendedAction: 'Reach the patient to complete or refresh the aHHQ.',
      assessment: a,
    }));
  }

  return alerts;
}

/**
 * Convenience: evaluate the rule catalog across an entire roster, returning
 * { totalAlerts, alertsByRule, alertsBySeverity, alerts }.
 *
 * @param {Array<Object>} batch  array of { inputs, assessment, previousAssessment? }
 * @param {Object} [opts]        forwarded to evaluateRules
 */
function evaluateRulesBatch(batch, opts = {}) {
  if (!Array.isArray(batch)) {
    throw new Error('evaluateRulesBatch: batch must be an array');
  }
  const alerts = [];
  for (const item of batch) {
    if (!item || !item.inputs || !item.assessment) continue;
    const a = evaluateRules(item, opts);
    for (const alert of a) alerts.push(alert);
  }
  const byRule = {}, bySev = {};
  for (const alert of alerts) {
    byRule[alert.ruleId] = (byRule[alert.ruleId] || 0) + 1;
    bySev[alert.severity] = (bySev[alert.severity] || 0) + 1;
  }
  return {
    engineVersion: ENGINE_VERSION,
    totalAlerts: alerts.length,
    alertsByRule: byRule,
    alertsBySeverity: bySev,
    alerts,
    generatedAtISO: new Date(opts.nowMs || Date.now()).toISOString(),
  };
}

/**
 * Get the catalog of supported rules (for admin/configuration UIs).
 */
function getRuleCatalog() {
  return [
    { id: 'PATIENT_ENTERED_CRITICAL', defaultSeverity: SEVERITY.CRITICAL,
      description: 'Risk level just crossed into "critical".' },
    { id: 'EVAL_EXPIRED',             defaultSeverity: SEVERITY.CRITICAL,
      description: 'Annual evaluation past validity window.' },
    { id: 'EVAL_EXPIRING_SOON',       defaultSeverity: SEVERITY.HIGH,
      description: 'Annual evaluation within configurable warning window.' },
    { id: 'HIGH_BARRIER_OPENED',      defaultSeverity: SEVERITY.HIGH,
      description: 'At least one open readiness barrier with high risk.' },
    { id: 'SCORE_JUMPED',             defaultSeverity: SEVERITY.HIGH,
      description: 'Risk score jumped at least N points since previous assessment.' },
    { id: 'CONTACT_LAPSED',           defaultSeverity: SEVERITY.MODERATE,
      description: 'No patient contact in at least N days.' },
    { id: 'AHHQ_EXPIRED',             defaultSeverity: SEVERITY.MODERATE,
      description: 'Adult Health History Questionnaire is missing or expired.' },
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _alert(parts) {
  return {
    ruleId:            parts.ruleId,
    severity:          parts.severity,
    title:             parts.title,
    body:              parts.body,
    patientId:         parts.patientId || null,
    factor:            parts.factor   || null,
    recommendedAction: parts.recommendedAction,
    score:             parts.assessment?.score ?? null,
    riskLevel:         parts.assessment?.riskLevel ?? null,
    modelVersion:      parts.assessment?.modelVersion ?? null,
    inputsFingerprint: parts.assessment?.inputsFingerprint ?? null,
  };
}

function _daysUntilEvalExpiry(inputs, nowMs) {
  const lastEval = inputs.lastEvaluationDateISO
    ? Date.parse(inputs.lastEvaluationDateISO)
    : null;
  if (!Number.isFinite(lastEval)) return null;
  const validityDays = inputs.evaluationValidityDays || 365;
  const expiryMs = lastEval + validityDays * ONE_DAY_MS;
  return Math.round((expiryMs - nowMs) / ONE_DAY_MS);
}

function _daysSince(iso, nowMs) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((nowMs - t) / ONE_DAY_MS));
}

function _round1(n) {
  return Math.round(n * 10) / 10;
}

module.exports = {
  ENGINE_VERSION,
  SEVERITY,
  DEFAULT_THRESHOLDS,
  evaluateRules,
  evaluateRulesBatch,
  getRuleCatalog,
};
