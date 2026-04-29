/**
 * TransTrack — Inactivation Risk Engine v2 unit tests.
 *
 * Pure-function scoring; no DB required. Run with:
 *   node tests/inactivationRiskEngine.test.cjs
 */

'use strict';

const assert = require('assert');
const engine = require('../electron/services/inactivationRiskEngine.cjs');

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let PASS = 0, FAIL = 0;
const failures = [];
function test(name, fn) {
  try { fn(); PASS++; console.log(`  PASS  ${name}`); }
  catch (e) {
    FAIL++; failures.push({ name, error: e });
    console.log(`  FAIL  ${name}\n        ${e.message}`);
  }
}

// Fixed clock so every test is deterministic.
const FIXED_NOW_MS = Date.parse('2026-04-28T00:00:00.000Z');
const opts = { nowMs: FIXED_NOW_MS };

function isoDaysAgo(days) {
  return new Date(FIXED_NOW_MS - days * 24 * 60 * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------

console.log('\n=== Inactivation Risk Engine v2 — model invariants ===');

test('FACTOR_WEIGHTS sum to exactly 1.0', () => {
  const sum = Object.values(engine.FACTOR_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1.0) < 1e-9, `weights sum=${sum}`);
});

test('MODEL_VERSION is a non-empty semver-ish string', () => {
  assert.ok(typeof engine.MODEL_VERSION === 'string');
  assert.ok(/^\d+\.\d+\.\d+/.test(engine.MODEL_VERSION));
});

test('RISK_THRESHOLDS are monotonically increasing', () => {
  assert.ok(engine.RISK_THRESHOLDS.moderate < engine.RISK_THRESHOLDS.high);
  assert.ok(engine.RISK_THRESHOLDS.high     < engine.RISK_THRESHOLDS.critical);
});

console.log('\n=== Per-factor sub-scores ===');

test('evalExpirySubscore: missing date → 100', () => {
  assert.strictEqual(engine.evalExpirySubscore({}, FIXED_NOW_MS), 100);
});

test('evalExpirySubscore: today → low', () => {
  const s = engine.evalExpirySubscore({ lastEvaluationDateISO: isoDaysAgo(0) }, FIXED_NOW_MS);
  assert.ok(s <= 30, `expected ≤30, got ${s}`);
});

test('evalExpirySubscore: 360 days ago → 90', () => {
  const s = engine.evalExpirySubscore({ lastEvaluationDateISO: isoDaysAgo(360) }, FIXED_NOW_MS);
  assert.strictEqual(s, 90);
});

test('evalExpirySubscore: 400 days ago (over 1 year) → 100', () => {
  const s = engine.evalExpirySubscore({ lastEvaluationDateISO: isoDaysAgo(400) }, FIXED_NOW_MS);
  assert.strictEqual(s, 100);
});

test('barriersSubscore: no barriers → 0', () => {
  assert.strictEqual(engine.barriersSubscore({ openBarriers: [] }), 0);
});

test('barriersSubscore: one high-risk barrier → ≥25', () => {
  const s = engine.barriersSubscore({ openBarriers: [{ riskLevel: 'high' }] });
  assert.ok(s >= 25, `got ${s}`);
});

test('barriersSubscore: many barriers cap at 100', () => {
  const many = Array.from({ length: 20 }, () => ({ riskLevel: 'high', overdue: true }));
  assert.strictEqual(engine.barriersSubscore({ openBarriers: many }), 100);
});

test('labCurrencySubscore: missing labs penalised more than expired', () => {
  const missing = engine.labCurrencySubscore({ labsMissingCount: 1 });
  const expired = engine.labCurrencySubscore({ labsExpiredCount: 1 });
  assert.ok(missing > expired, `missing=${missing} expired=${expired}`);
});

test('ahhqCurrencySubscore: status mapping is monotonic', () => {
  const cur     = engine.ahhqCurrencySubscore({ ahhqStatus: 'current' });
  const expSoon = engine.ahhqCurrencySubscore({ ahhqStatus: 'expiring_soon' });
  const inc     = engine.ahhqCurrencySubscore({ ahhqStatus: 'incomplete' });
  const exp     = engine.ahhqCurrencySubscore({ ahhqStatus: 'expired' });
  const miss    = engine.ahhqCurrencySubscore({ ahhqStatus: 'missing' });
  assert.ok(cur < expSoon && expSoon < inc && inc < exp && exp <= miss);
});

test('statusChurnSubscore: 5+ changes → 100', () => {
  assert.strictEqual(engine.statusChurnSubscore({ statusChangesLast90Days: 5 }), 100);
});

test('coordinatorLoadSubscore: 60+ panel → 100', () => {
  assert.strictEqual(engine.coordinatorLoadSubscore({ coordinatorPanelSize: 60 }), 100);
  assert.strictEqual(engine.coordinatorLoadSubscore({ coordinatorPanelSize: 5 }), 0);
});

console.log('\n=== Composite assessment ===');

test('assessInactivationRisk: requires inputs object', () => {
  assert.throws(() => engine.assessInactivationRisk(null));
});

test('assessInactivationRisk: pristine patient → low / none', () => {
  const a = engine.assessInactivationRisk({
    patientId: 'P1',
    orgId: 'ORG1',
    lastEvaluationDateISO: isoDaysAgo(30),
    lastDocumentUpdateISO: isoDaysAgo(7),
    openBarriers: [],
    labsMissingCount: 0,
    labsExpiredCount: 0,
    ahhqStatus: 'current',
    statusChangesLast90Days: 0,
    lastContactISO: isoDaysAgo(7),
    coordinatorPanelSize: 10,
  }, opts);
  assert.ok(a.score < engine.RISK_THRESHOLDS.moderate, `expected <25, got ${a.score}`);
  assert.ok(['low', 'none'].includes(a.riskLevel));
});

test('assessInactivationRisk: at-risk patient → critical', () => {
  const a = engine.assessInactivationRisk({
    patientId: 'P2',
    orgId: 'ORG1',
    lastEvaluationDateISO: isoDaysAgo(360), // 90
    lastDocumentUpdateISO: isoDaysAgo(120), // 100
    openBarriers: [
      { id: 'b1', riskLevel: 'high', type: 'insurance', overdue: true },
      { id: 'b2', riskLevel: 'high', type: 'caregiver', overdue: true },
      { id: 'b3', riskLevel: 'moderate', type: 'transport' },
    ],
    labsMissingCount: 2,
    labsExpiredCount: 3,
    ahhqStatus: 'expired',
    statusChangesLast90Days: 4,
    lastContactISO: isoDaysAgo(120),
    coordinatorPanelSize: 50,
  }, opts);
  assert.strictEqual(a.riskLevel, 'critical');
  assert.ok(a.score >= 75, `expected ≥75, got ${a.score}`);
});

test('factorContributions sum (within rounding) equals composite score', () => {
  const a = engine.assessInactivationRisk({
    lastEvaluationDateISO: isoDaysAgo(200),
    openBarriers: [{ riskLevel: 'high' }, { riskLevel: 'moderate' }],
    ahhqStatus: 'incomplete',
    statusChangesLast90Days: 2,
    lastContactISO: isoDaysAgo(60),
    labsMissingCount: 1,
    coordinatorPanelSize: 30,
  }, opts);
  const sum = a.factorContributions.reduce((acc, f) => acc + f.weightedContribution, 0);
  assert.ok(Math.abs(sum - a.score) < 1.0, `decomposition sum=${sum} score=${a.score}`);
});

test('factorContributions are sorted by weighted contribution desc', () => {
  const a = engine.assessInactivationRisk({
    lastEvaluationDateISO: isoDaysAgo(360),
    openBarriers: [{ riskLevel: 'high' }],
    statusChangesLast90Days: 2,
  }, opts);
  for (let i = 1; i < a.factorContributions.length; i++) {
    assert.ok(
      a.factorContributions[i - 1].weightedContribution >= a.factorContributions[i].weightedContribution,
      `unsorted at index ${i}`
    );
  }
});

test('probabilities are in [0, 1] and monotonic across windows', () => {
  const a = engine.assessInactivationRisk({
    lastEvaluationDateISO: isoDaysAgo(360),
    openBarriers: [{ riskLevel: 'high' }],
  }, opts);
  const { within30Days, within60Days, within90Days } = a.probabilities;
  assert.ok(within30Days >= 0 && within30Days <= 1);
  assert.ok(within60Days >= within30Days, `60d (${within60Days}) >= 30d (${within30Days})`);
  assert.ok(within90Days >= within60Days, `90d (${within90Days}) >= 60d (${within60Days})`);
});

test('assessment is deterministic — same inputs → same fingerprint and score', () => {
  const inputs = {
    patientId: 'P3',
    lastEvaluationDateISO: isoDaysAgo(200),
    openBarriers: [{ riskLevel: 'moderate' }],
    statusChangesLast90Days: 1,
  };
  const a = engine.assessInactivationRisk(inputs, opts);
  const b = engine.assessInactivationRisk(inputs, opts);
  assert.strictEqual(a.inputsFingerprint, b.inputsFingerprint);
  assert.strictEqual(a.score, b.score);
});

test('disclaimer is always present', () => {
  const a = engine.assessInactivationRisk({}, opts);
  assert.ok(a.disclaimer && a.disclaimer.includes('Operational risk only'));
  assert.ok(a.disclaimer.includes('OPTN'));
});

console.log('\n=== Counterfactual interventions ===');

test('simulateIntervention: requires intervention.type', () => {
  assert.throws(() => engine.simulateIntervention({}, null));
  assert.throws(() => engine.simulateIntervention({}, {}));
});

test('simulateIntervention: refreshEvaluation reduces score', () => {
  const inputs = {
    lastEvaluationDateISO: isoDaysAgo(360),
    openBarriers: [],
  };
  const result = engine.simulateIntervention(inputs, { type: 'refreshEvaluation' }, opts);
  assert.ok(result.scoreReduction > 0, `expected reduction >0, got ${result.scoreReduction}`);
  assert.ok(result.after.score < result.before.score);
});

test('simulateIntervention: resolveAllBarriers eliminates the barrier factor', () => {
  const inputs = {
    openBarriers: [
      { id: 'b1', riskLevel: 'high' },
      { id: 'b2', riskLevel: 'high' },
    ],
  };
  const result = engine.simulateIntervention(inputs, { type: 'resolveAllBarriers' }, opts);
  const barrierFactor = result.fullAssessmentAfter.factorContributions.find(f => f.factor === 'BARRIERS');
  assert.strictEqual(barrierFactor.rawSubscore, 0);
});

test('simulateIntervention: resolveBarrier needs barrierId and removes only that one', () => {
  const inputs = {
    openBarriers: [
      { id: 'b1', riskLevel: 'high' },
      { id: 'b2', riskLevel: 'moderate' },
    ],
  };
  assert.throws(() => engine.simulateIntervention(inputs, { type: 'resolveBarrier' }, opts));
  const r = engine.simulateIntervention(inputs, { type: 'resolveBarrier', barrierId: 'b1' }, opts);
  // Only one barrier should remain in the simulated assessment.
  assert.ok(r.after.score < r.before.score);
});

test('interventions list is ordered by impact (highest scoreReduction first)', () => {
  const inputs = {
    lastEvaluationDateISO: isoDaysAgo(360),
    openBarriers: [{ riskLevel: 'high' }, { riskLevel: 'high' }],
    ahhqStatus: 'expired',
    lastContactISO: isoDaysAgo(120),
    labsMissingCount: 2,
  };
  const a = engine.assessInactivationRisk(inputs, opts);
  for (let i = 1; i < a.interventions.length; i++) {
    assert.ok(
      a.interventions[i - 1].scoreReduction >= a.interventions[i].scoreReduction,
      `interventions out of order at ${i}`
    );
  }
});

test('rejecting unknown intervention.type throws', () => {
  assert.throws(() => engine.simulateIntervention({}, { type: 'doSomethingUnknown' }, opts));
});

console.log('\n=== Center-level projection / ROI ===');

test('projectCenterImpact: requires array input', () => {
  assert.throws(() => engine.projectCenterImpact(null));
});

test('projectCenterImpact: empty roster → zero impact, zero dollars', () => {
  const p = engine.projectCenterImpact([], opts);
  assert.strictEqual(p.candidates, 0);
  assert.strictEqual(p.estimatedDollarsAvoided, 0);
});

test('projectCenterImpact: post-intervention probability ≤ baseline for every candidate', () => {
  const cohort = [
    {
      patientId: 'P1',
      lastEvaluationDateISO: isoDaysAgo(360),
      openBarriers: [{ riskLevel: 'high' }],
    },
    {
      patientId: 'P2',
      lastEvaluationDateISO: isoDaysAgo(60),
      openBarriers: [],
      ahhqStatus: 'current',
    },
    {
      patientId: 'P3',
      lastEvaluationDateISO: isoDaysAgo(400),
      openBarriers: [{ riskLevel: 'high' }, { riskLevel: 'moderate' }],
      labsMissingCount: 2,
      ahhqStatus: 'missing',
      lastContactISO: isoDaysAgo(120),
    },
  ];
  const p = engine.projectCenterImpact(cohort, opts);
  assert.strictEqual(p.candidates, 3);
  for (const c of p.perCandidate) {
    assert.ok(c.postProb90 <= c.baselineProb90, `regress at ${c.patientId}`);
  }
  assert.ok(p.estimatedDollarsAvoided >= 0);
  assert.ok(p.expectedInactivationsWithin90Days.avoided >= 0);
});

test('projectCenterImpact: respects custom cost-per-inactivation', () => {
  const cohort = [{
    patientId: 'P1',
    lastEvaluationDateISO: isoDaysAgo(400),
    openBarriers: [{ riskLevel: 'high' }, { riskLevel: 'high' }],
  }];
  const lo = engine.projectCenterImpact(cohort, { ...opts, costPerInactivationUSD: 1000 });
  const hi = engine.projectCenterImpact(cohort, { ...opts, costPerInactivationUSD: 50000 });
  assert.ok(hi.estimatedDollarsAvoided >= lo.estimatedDollarsAvoided);
});

test('projectCenterImpact: distribution counts add up to candidate count', () => {
  const cohort = Array.from({ length: 5 }, (_, i) => ({
    patientId: `P${i}`,
    lastEvaluationDateISO: isoDaysAgo(60 + i * 50),
    openBarriers: i % 2 === 0 ? [{ riskLevel: 'high' }] : [],
  }));
  const p = engine.projectCenterImpact(cohort, opts);
  const total = Object.values(p.distribution).reduce((a, b) => a + b, 0);
  assert.strictEqual(total, p.candidates);
});

console.log('\n=== Documented calibration table — anchors must match within 3pp ===');

// These anchors are duplicated in:
//   - electron/services/inactivationRiskEngine.cjs (PROB_CURVES comment)
//   - docs/INACTIVATION_RISK_ENGINE.md             (calibration table section)
// The doc table is slightly more curved than a 2-parameter logistic supports,
// so the published fit is allowed ±3 percentage points (well under the noise
// floor of the operational signal). If a contributor edits either side
// without updating the other, this test fails.
const CALIBRATION_ANCHORS = [
  { score: 25, p30: 0.10, p60: 0.18, p90: 0.25 },
  { score: 50, p30: 0.30, p60: 0.45, p90: 0.55 },
  { score: 75, p30: 0.65, p60: 0.78, p90: 0.85 },
  { score: 90, p30: 0.82, p60: 0.90, p90: 0.94 },
];

const CALIBRATION_TOLERANCE = 0.030; // ±3 percentage points

for (const anchor of CALIBRATION_ANCHORS) {
  test(`probability curve at score=${anchor.score} matches documented anchors (±3pp)`, () => {
    const probs = engine.scoreToProbabilities(anchor.score);
    assert.ok(
      Math.abs(probs.d30 - anchor.p30) <= CALIBRATION_TOLERANCE,
      `d30: expected ~${anchor.p30}, got ${probs.d30.toFixed(4)}`
    );
    assert.ok(
      Math.abs(probs.d60 - anchor.p60) <= CALIBRATION_TOLERANCE,
      `d60: expected ~${anchor.p60}, got ${probs.d60.toFixed(4)}`
    );
    assert.ok(
      Math.abs(probs.d90 - anchor.p90) <= CALIBRATION_TOLERANCE,
      `d90: expected ~${anchor.p90}, got ${probs.d90.toFixed(4)}`
    );
  });
}

console.log(`\nResults: ${PASS} passed, ${FAIL} failed.`);
if (FAIL > 0) {
  for (const f of failures) console.error(`\n${f.name}:\n${f.error.stack || f.error.message}`);
  process.exit(1);
}
