/**
 * TransTrack — Inactivation Prevention Action Queue unit tests.
 *
 * Pure-function service; no DB required. Run with:
 *   node tests/inactivationActionQueue.test.cjs
 */

'use strict';

const assert = require('assert');
const queue = require('../electron/services/inactivationActionQueue.cjs');
const engine = require('../electron/services/inactivationRiskEngine.cjs');

// Fixed clock — deterministic.
const FIXED_NOW_MS = Date.parse('2026-04-29T00:00:00.000Z');
const opts = { nowMs: FIXED_NOW_MS };

function isoDaysAgo(days) {
  return new Date(FIXED_NOW_MS - days * 24 * 60 * 60 * 1000).toISOString();
}

let PASS = 0, FAIL = 0;
const failures = [];
function test(name, fn) {
  try { fn(); PASS++; console.log(`  PASS  ${name}`); }
  catch (e) {
    FAIL++; failures.push({ name, error: e });
    console.log(`  FAIL  ${name}\n        ${e.message}`);
  }
}

// ---------------------------------------------------------------------------

console.log('\n=== Inactivation Action Queue — invariants ===');

test('QUEUE_VERSION is a non-empty semver-ish string', () => {
  assert.ok(typeof queue.QUEUE_VERSION === 'string');
  assert.ok(/^\d+\.\d+\.\d+/.test(queue.QUEUE_VERSION));
});

test('buildActionQueue: rejects non-array input', () => {
  assert.throws(() => queue.buildActionQueue(null));
  assert.throws(() => queue.buildActionQueue({}));
});

test('buildActionQueue: empty roster → empty queue, distribution all zero', () => {
  const r = queue.buildActionQueue([], opts);
  assert.strictEqual(r.candidatesScreened, 0);
  assert.strictEqual(r.queueSize, 0);
  assert.deepStrictEqual(Object.values(r.distribution).reduce((a, b) => a + b, 0), 0);
  assert.strictEqual(r.aggregateExpectedImpact.projectedInactivationsAvoidedWithin90Days, 0);
});

test('buildActionQueue: skips inputs without patientId', () => {
  const r = queue.buildActionQueue(
    [{ lastEvaluationDateISO: isoDaysAgo(400) }, { patientId: 'P1' }],
    opts,
  );
  assert.strictEqual(r.queueSize, 1);
  assert.strictEqual(r.queue[0].patientId, 'P1');
});

console.log('\n=== Action queue ranking ===');

test('queue is sorted by queuePriority descending', () => {
  const cohort = [
    { patientId: 'P_low',     lastEvaluationDateISO: isoDaysAgo(20)  },
    { patientId: 'P_extreme', lastEvaluationDateISO: isoDaysAgo(380),
      openBarriers: [{ riskLevel: 'high' }, { riskLevel: 'high' }],
      labsMissingCount: 3, ahhqStatus: 'missing',
      lastContactISO: isoDaysAgo(150), statusChangesLast90Days: 4,
      coordinatorPanelSize: 200 },
    { patientId: 'P_mid',     lastEvaluationDateISO: isoDaysAgo(200),
      openBarriers: [{ riskLevel: 'moderate' }] },
  ];
  const r = queue.buildActionQueue(cohort, opts);
  for (let i = 1; i < r.queue.length; i++) {
    assert.ok(
      r.queue[i - 1].queuePriority >= r.queue[i].queuePriority,
      `queue not monotonic at position ${i}`,
    );
  }
  assert.strictEqual(r.queue[0].patientId, 'P_extreme');
});

test('default queue size cap is honoured (DEFAULT_QUEUE_SIZE)', () => {
  const cohort = Array.from({ length: 60 }, (_, i) => ({
    patientId: `P${i}`,
    lastEvaluationDateISO: isoDaysAgo(300 + i),
    openBarriers: [{ riskLevel: 'high' }],
  }));
  const r = queue.buildActionQueue(cohort, opts);
  assert.strictEqual(r.queueSize, queue.DEFAULT_QUEUE_SIZE);
  assert.strictEqual(r.candidatesScreened, 60);
});

test('size opt overrides default queue size cap', () => {
  const cohort = Array.from({ length: 10 }, (_, i) => ({
    patientId: `P${i}`,
    lastEvaluationDateISO: isoDaysAgo(380),
    openBarriers: [{ riskLevel: 'high' }],
  }));
  const r = queue.buildActionQueue(cohort, { ...opts, size: 5 });
  assert.strictEqual(r.queueSize, 5);
});

test('includeRiskLevels filter excludes lower levels', () => {
  const cohort = [
    { patientId: 'P_low',     lastEvaluationDateISO: isoDaysAgo(20)  },
    { patientId: 'P_high',    lastEvaluationDateISO: isoDaysAgo(380),
      openBarriers: [{ riskLevel: 'high' }, { riskLevel: 'high' }],
      labsMissingCount: 3, ahhqStatus: 'missing' },
  ];
  const r = queue.buildActionQueue(cohort, {
    ...opts, includeRiskLevels: ['critical', 'high'],
  });
  for (const e of r.queue) {
    assert.ok(['critical', 'high'].includes(e.riskLevel));
  }
});

console.log('\n=== Recommended action quality ===');

test('every queue entry carries a recommended action when interventions exist', () => {
  const cohort = [{
    patientId: 'P_action',
    lastEvaluationDateISO: isoDaysAgo(380),
    openBarriers: [{ riskLevel: 'high' }],
  }];
  const r = queue.buildActionQueue(cohort, opts);
  const e = r.queue[0];
  assert.ok(e.recommendedAction);
  assert.ok(typeof e.recommendedAction.actionDescription === 'string');
  assert.ok(e.recommendedAction.expectedScoreReduction > 0);
  assert.ok(e.recommendedAction.expectedScoreAfterAction <= e.score);
});

test('topThreeFactors are present and ordered by weighted contribution', () => {
  const cohort = [{
    patientId: 'P_decomp',
    lastEvaluationDateISO: isoDaysAgo(380),
    openBarriers: [{ riskLevel: 'high' }, { riskLevel: 'moderate' }],
    labsMissingCount: 2, ahhqStatus: 'missing',
    lastContactISO: isoDaysAgo(120),
  }];
  const r = queue.buildActionQueue(cohort, opts);
  const factors = r.queue[0].topThreeFactors;
  assert.ok(factors.length <= 3);
  for (let i = 1; i < factors.length; i++) {
    assert.ok(factors[i - 1].weightedContribution >= factors[i].weightedContribution);
  }
});

console.log('\n=== Urgency multiplier ===');

test('eval expiring within window boosts queue priority over fresh-eval same-score patient', () => {
  // Two patients with identical risk drivers EXCEPT eval recency.
  const expiring = {
    patientId: 'P_expiring',
    lastEvaluationDateISO: isoDaysAgo(345),  // 20 days until 365-day expiry
    openBarriers: [{ riskLevel: 'high' }],
    labsMissingCount: 1, ahhqStatus: 'missing',
  };
  const fresh = {
    patientId: 'P_fresh',
    lastEvaluationDateISO: isoDaysAgo(60),
    openBarriers: [{ riskLevel: 'high' }],
    labsMissingCount: 1, ahhqStatus: 'missing',
  };
  const r = queue.buildActionQueue([expiring, fresh], opts);
  const exp = r.queue.find((e) => e.patientId === 'P_expiring');
  const fr  = r.queue.find((e) => e.patientId === 'P_fresh');
  assert.ok(exp.urgencyMultiplier >= fr.urgencyMultiplier);
  assert.ok(exp.queuePriority >= fr.queuePriority);
});

test('expired evaluation produces 1.5x urgency multiplier', () => {
  const expired = {
    patientId: 'P_expired',
    lastEvaluationDateISO: isoDaysAgo(400),
    openBarriers: [{ riskLevel: 'high' }],
  };
  const r = queue.buildActionQueue([expired], opts);
  assert.strictEqual(r.queue[0].urgencyMultiplier, 1.5);
});

test('fresh evaluation produces 1.0x urgency multiplier', () => {
  const fresh = {
    patientId: 'P_fresh',
    lastEvaluationDateISO: isoDaysAgo(30),
    openBarriers: [{ riskLevel: 'high' }],
  };
  const r = queue.buildActionQueue([fresh], opts);
  assert.strictEqual(r.queue[0].urgencyMultiplier, 1.0);
});

console.log('\n=== Coordinator overload detection ===');

test('coordinator with >40% of queue is flagged as overloaded', () => {
  // 5 candidates, 3 share one coordinator
  const cohort = [
    { patientId: 'P1', lastEvaluationDateISO: isoDaysAgo(380),
      openBarriers: [{ riskLevel: 'high' }], assignedCoordinatorId: 'C1' },
    { patientId: 'P2', lastEvaluationDateISO: isoDaysAgo(380),
      openBarriers: [{ riskLevel: 'high' }], assignedCoordinatorId: 'C1' },
    { patientId: 'P3', lastEvaluationDateISO: isoDaysAgo(380),
      openBarriers: [{ riskLevel: 'high' }], assignedCoordinatorId: 'C1' },
    { patientId: 'P4', lastEvaluationDateISO: isoDaysAgo(380),
      openBarriers: [{ riskLevel: 'high' }], assignedCoordinatorId: 'C2' },
    { patientId: 'P5', lastEvaluationDateISO: isoDaysAgo(380),
      openBarriers: [{ riskLevel: 'high' }], assignedCoordinatorId: 'C3' },
  ];
  const r = queue.buildActionQueue(cohort, opts);
  const overloaded = r.coordinatorOverloads.find((o) => o.coordinatorId === 'C1');
  assert.ok(overloaded, 'C1 should be flagged');
  assert.strictEqual(overloaded.atRiskCount, 3);
  assert.ok(overloaded.atRiskFraction >= 0.40);
});

test('balanced coordinator load → no overload findings', () => {
  const cohort = [
    { patientId: 'P1', lastEvaluationDateISO: isoDaysAgo(380),
      openBarriers: [{ riskLevel: 'high' }], assignedCoordinatorId: 'C1' },
    { patientId: 'P2', lastEvaluationDateISO: isoDaysAgo(380),
      openBarriers: [{ riskLevel: 'high' }], assignedCoordinatorId: 'C2' },
    { patientId: 'P3', lastEvaluationDateISO: isoDaysAgo(380),
      openBarriers: [{ riskLevel: 'high' }], assignedCoordinatorId: 'C3' },
  ];
  const r = queue.buildActionQueue(cohort, opts);
  assert.strictEqual(r.coordinatorOverloads.length, 0);
});

console.log('\n=== Aggregate expected impact ===');

test('aggregate impact ≥ 0 for any roster', () => {
  const cohort = Array.from({ length: 10 }, (_, i) => ({
    patientId: `P${i}`,
    lastEvaluationDateISO: isoDaysAgo(50 + i * 50),
    openBarriers: i % 2 === 0 ? [{ riskLevel: 'high' }] : [],
  }));
  const r = queue.buildActionQueue(cohort, opts);
  assert.ok(
    r.aggregateExpectedImpact.projectedInactivationsAvoidedWithin90Days >= 0,
  );
});

test('determinism: same inputs + same nowMs → identical fingerprints', () => {
  const cohort = [{
    patientId: 'P_det',
    lastEvaluationDateISO: isoDaysAgo(380),
    openBarriers: [{ riskLevel: 'high' }],
    labsMissingCount: 1, ahhqStatus: 'missing',
  }];
  const a = queue.buildActionQueue(cohort, opts);
  const b = queue.buildActionQueue(cohort, opts);
  assert.strictEqual(a.queue[0].inputsFingerprint, b.queue[0].inputsFingerprint);
  assert.strictEqual(a.queue[0].queuePriority, b.queue[0].queuePriority);
});

console.log('\n=== getTopInterventions ===');

test('getTopInterventions returns up to N entries', () => {
  const a = engine.assessInactivationRisk({
    lastEvaluationDateISO: isoDaysAgo(380),
    openBarriers: [{ riskLevel: 'high' }, { riskLevel: 'moderate' }],
    labsMissingCount: 2, ahhqStatus: 'missing',
    lastContactISO: isoDaysAgo(120),
  }, opts);
  const top = queue.getTopInterventions(a, 3);
  assert.ok(top.length <= 3);
  assert.ok(top.length > 0);
  for (const iv of top) {
    assert.ok(iv.expectedScoreReduction > 0);
    assert.ok(typeof iv.actionDescription === 'string');
  }
});

test('getTopInterventions: invalid input returns []', () => {
  assert.deepStrictEqual(queue.getTopInterventions(null), []);
  assert.deepStrictEqual(queue.getTopInterventions({}), []);
});

console.log('\n=== Disclaimer present ===');

test('action queue carries operational/non-clinical disclaimer', () => {
  const r = queue.buildActionQueue([], opts);
  assert.ok(typeof r.disclaimer === 'string');
  assert.ok(/operational/i.test(r.disclaimer));
  assert.ok(/OPTN/.test(r.disclaimer));
});

// ---------------------------------------------------------------------------

console.log(`\nResults: ${PASS} passed, ${FAIL} failed.`);
if (FAIL > 0) {
  for (const f of failures) console.error(`\n${f.name}:\n${f.error.stack || f.error.message}`);
  process.exit(1);
}
