/**
 * TransTrack — Prevention Digest unit tests.
 * Pure-function composition layer; no DB required.
 */

'use strict';

const assert = require('assert');
const digest = require('../electron/services/preventionDigest.cjs');

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

console.log('\n=== Prevention Digest ===');

test('rejects missing args', () => {
  assert.throws(() => digest.buildDigest());
  assert.throws(() => digest.buildDigest({}));
});

test('empty roster → empty queue, zero impact, no effectiveness', () => {
  const r = digest.buildDigest({ candidateInputs: [] }, opts);
  assert.strictEqual(r.headline.activeCandidatesScreened, 0);
  assert.strictEqual(r.headline.estimatedDollarsAvoided, 0);
  assert.strictEqual(r.headline.inactivationsAvoided, 0);
  assert.strictEqual(r.actionQueue.queueSize, 0);
  assert.strictEqual(r.effectiveness, null);
});

test('headline metrics align with action queue + projection sub-reports', () => {
  const cohort = [
    { patientId: 'P1', lastEvaluationDateISO: isoDaysAgo(380),
      openBarriers: [{ riskLevel: 'high' }] },
    { patientId: 'P2', lastEvaluationDateISO: isoDaysAgo(60), openBarriers: [] },
    { patientId: 'P3', lastEvaluationDateISO: isoDaysAgo(400),
      openBarriers: [{ riskLevel: 'high' }, { riskLevel: 'moderate' }],
      labsMissingCount: 2, ahhqStatus: 'missing',
      lastContactISO: isoDaysAgo(120) },
  ];
  const r = digest.buildDigest({ candidateInputs: cohort }, opts);
  assert.strictEqual(r.headline.activeCandidatesScreened, 3);
  assert.deepStrictEqual(
    r.headline.riskDistribution,
    r.projection.distribution,
  );
  assert.strictEqual(
    r.headline.expectedInactivationsBaseline,
    r.projection.expectedInactivationsWithin90Days.baseline,
  );
});

test('passes provided effectiveness through unchanged', () => {
  const fakeEff = {
    windowDays: 90,
    perInterventionType: [{ interventionType: 'resolveAllBarriers', recorded: 1, measured: 1 }],
    totals: { recorded: 1, measured: 1, weightedAvgScoreDelta: 22.5 },
  };
  const r = digest.buildDigest(
    { candidateInputs: [], effectiveness: fakeEff },
    opts,
  );
  assert.strictEqual(r.effectiveness, fakeEff);
});

test('digest carries version metadata for re-explainability', () => {
  const r = digest.buildDigest({ candidateInputs: [] }, opts);
  assert.ok(r.digestVersion);
  assert.ok(r.modelVersion);
  assert.ok(r.queueVersion);
  assert.ok(r.generatedAtISO);
  assert.ok(typeof r.disclaimer === 'string');
});

console.log(`\nResults: ${PASS} passed, ${FAIL} failed.`);
if (FAIL > 0) {
  for (const f of failures) console.error(`\n${f.name}:\n${f.error.stack || f.error.message}`);
  process.exit(1);
}
