/**
 * TransTrack — Inactivation Alert Rules Engine unit tests.
 *
 * Pure-function rules; no DB required. Run with:
 *   node tests/inactivationAlertRules.test.cjs
 */

'use strict';

const assert = require('assert');
const rules = require('../electron/services/inactivationAlertRules.cjs');
const engine = require('../electron/services/inactivationRiskEngine.cjs');

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

function assess(inputs) {
  return engine.assessInactivationRisk(inputs, opts);
}

// ---------------------------------------------------------------------------

console.log('\n=== Alert Rules — input validation ===');

test('evaluateRules: rejects missing args', () => {
  assert.throws(() => rules.evaluateRules());
  assert.throws(() => rules.evaluateRules({}));
  assert.throws(() => rules.evaluateRules({ inputs: { patientId: 'P' } }));
});

test('evaluateRules: clean patient → no alerts', () => {
  const inputs = {
    patientId: 'P_clean',
    lastEvaluationDateISO: isoDaysAgo(30),
    openBarriers: [],
    ahhqStatus: 'current',
    lastContactISO: isoDaysAgo(7),
    labsMissingCount: 0, labsExpiredCount: 0,
  };
  const a = assess(inputs);
  const alerts = rules.evaluateRules({ inputs, assessment: a }, opts);
  assert.strictEqual(alerts.length, 0);
});

console.log('\n=== Per-rule firings ===');

test('PATIENT_ENTERED_CRITICAL: fires when level crosses to critical', () => {
  const inputs = {
    patientId: 'P_crit',
    lastEvaluationDateISO: isoDaysAgo(380),
    openBarriers: [{ riskLevel: 'high' }, { riskLevel: 'high' }],
    labsMissingCount: 3, ahhqStatus: 'missing',
    lastContactISO: isoDaysAgo(120), statusChangesLast90Days: 4,
    coordinatorPanelSize: 200,
  };
  const a = assess(inputs);
  assert.strictEqual(a.riskLevel, 'critical');
  const alerts = rules.evaluateRules(
    { inputs, assessment: a, previousAssessment: { riskLevel: 'high', score: 60 } },
    opts,
  );
  const found = alerts.find((x) => x.ruleId === 'PATIENT_ENTERED_CRITICAL');
  assert.ok(found);
  assert.strictEqual(found.severity, rules.SEVERITY.CRITICAL);
});

test('PATIENT_ENTERED_CRITICAL: does NOT fire if previously critical', () => {
  const inputs = {
    patientId: 'P_still_crit',
    lastEvaluationDateISO: isoDaysAgo(380),
    openBarriers: [{ riskLevel: 'high' }, { riskLevel: 'high' }],
    labsMissingCount: 3, ahhqStatus: 'missing',
    lastContactISO: isoDaysAgo(120), statusChangesLast90Days: 4,
    coordinatorPanelSize: 200,
  };
  const a = assess(inputs);
  const alerts = rules.evaluateRules(
    { inputs, assessment: a, previousAssessment: { riskLevel: 'critical', score: 90 } },
    opts,
  );
  assert.strictEqual(
    alerts.filter((x) => x.ruleId === 'PATIENT_ENTERED_CRITICAL').length,
    0,
  );
});

test('EVAL_EXPIRING_SOON: fires inside 30-day window', () => {
  const inputs = {
    patientId: 'P_exp_soon',
    lastEvaluationDateISO: isoDaysAgo(345), // 20 days remaining of 365
  };
  const a = assess(inputs);
  const alerts = rules.evaluateRules({ inputs, assessment: a }, opts);
  const found = alerts.find((x) => x.ruleId === 'EVAL_EXPIRING_SOON');
  assert.ok(found);
});

test('EVAL_EXPIRED: fires when past validity', () => {
  const inputs = {
    patientId: 'P_exp',
    lastEvaluationDateISO: isoDaysAgo(380),
  };
  const a = assess(inputs);
  const alerts = rules.evaluateRules({ inputs, assessment: a }, opts);
  const found = alerts.find((x) => x.ruleId === 'EVAL_EXPIRED');
  assert.ok(found);
  assert.strictEqual(found.severity, rules.SEVERITY.CRITICAL);
});

test('EVAL_EXPIRING_SOON: does NOT fire with fresh eval', () => {
  const inputs = { patientId: 'P_fresh', lastEvaluationDateISO: isoDaysAgo(30) };
  const a = assess(inputs);
  const alerts = rules.evaluateRules({ inputs, assessment: a }, opts);
  assert.strictEqual(
    alerts.filter((x) => x.ruleId === 'EVAL_EXPIRING_SOON').length,
    0,
  );
});

test('HIGH_BARRIER_OPENED: fires on at least one high-risk barrier', () => {
  const inputs = {
    patientId: 'P_bar',
    lastEvaluationDateISO: isoDaysAgo(30),
    openBarriers: [{ riskLevel: 'high' }, { riskLevel: 'low' }],
  };
  const a = assess(inputs);
  const alerts = rules.evaluateRules({ inputs, assessment: a }, opts);
  const found = alerts.find((x) => x.ruleId === 'HIGH_BARRIER_OPENED');
  assert.ok(found);
});

test('HIGH_BARRIER_OPENED: does NOT fire when only low/moderate barriers', () => {
  const inputs = {
    patientId: 'P_lowbar',
    lastEvaluationDateISO: isoDaysAgo(30),
    openBarriers: [{ riskLevel: 'low' }, { riskLevel: 'moderate' }],
  };
  const a = assess(inputs);
  const alerts = rules.evaluateRules({ inputs, assessment: a }, opts);
  assert.strictEqual(
    alerts.filter((x) => x.ruleId === 'HIGH_BARRIER_OPENED').length,
    0,
  );
});

test('SCORE_JUMPED: fires on +10pt jump', () => {
  const inputs = {
    patientId: 'P_jump',
    lastEvaluationDateISO: isoDaysAgo(380),
    openBarriers: [{ riskLevel: 'high' }],
  };
  const a = assess(inputs);
  const alerts = rules.evaluateRules(
    { inputs, assessment: a, previousAssessment: { score: a.score - 15, riskLevel: 'moderate' } },
    opts,
  );
  const found = alerts.find((x) => x.ruleId === 'SCORE_JUMPED');
  assert.ok(found);
});

test('SCORE_JUMPED: does NOT fire on small drift', () => {
  const inputs = {
    patientId: 'P_drift',
    lastEvaluationDateISO: isoDaysAgo(380),
    openBarriers: [{ riskLevel: 'high' }],
  };
  const a = assess(inputs);
  const alerts = rules.evaluateRules(
    { inputs, assessment: a, previousAssessment: { score: a.score - 2, riskLevel: 'high' } },
    opts,
  );
  assert.strictEqual(
    alerts.filter((x) => x.ruleId === 'SCORE_JUMPED').length,
    0,
  );
});

test('CONTACT_LAPSED: fires past 60-day default', () => {
  const inputs = {
    patientId: 'P_quiet',
    lastEvaluationDateISO: isoDaysAgo(30),
    lastContactISO: isoDaysAgo(80),
  };
  const a = assess(inputs);
  const alerts = rules.evaluateRules({ inputs, assessment: a }, opts);
  const found = alerts.find((x) => x.ruleId === 'CONTACT_LAPSED');
  assert.ok(found);
});

test('CONTACT_LAPSED: respects custom threshold', () => {
  const inputs = {
    patientId: 'P_quiet',
    lastEvaluationDateISO: isoDaysAgo(30),
    lastContactISO: isoDaysAgo(40),
  };
  const a = assess(inputs);
  const alerts = rules.evaluateRules(
    { inputs, assessment: a },
    { ...opts, thresholds: { contactLapsedDays: 30 } },
  );
  const found = alerts.find((x) => x.ruleId === 'CONTACT_LAPSED');
  assert.ok(found);
});

test('AHHQ_EXPIRED: fires when missing or expired', () => {
  for (const status of ['missing', 'expired']) {
    const inputs = {
      patientId: `P_ahhq_${status}`,
      lastEvaluationDateISO: isoDaysAgo(30),
      ahhqStatus: status,
    };
    const a = assess(inputs);
    const alerts = rules.evaluateRules({ inputs, assessment: a }, opts);
    assert.ok(alerts.find((x) => x.ruleId === 'AHHQ_EXPIRED'),
      `expected AHHQ_EXPIRED for status=${status}`);
  }
});

console.log('\n=== Alert envelope shape ===');

test('every alert carries the standard envelope fields', () => {
  const inputs = {
    patientId: 'P_env',
    lastEvaluationDateISO: isoDaysAgo(380),
    openBarriers: [{ riskLevel: 'high' }],
    ahhqStatus: 'expired',
    lastContactISO: isoDaysAgo(120),
  };
  const a = assess(inputs);
  const alerts = rules.evaluateRules({ inputs, assessment: a }, opts);
  assert.ok(alerts.length > 0);
  for (const alert of alerts) {
    assert.ok(typeof alert.ruleId === 'string');
    assert.ok(typeof alert.severity === 'string');
    assert.ok(typeof alert.title === 'string');
    assert.ok(typeof alert.body === 'string');
    assert.ok(typeof alert.recommendedAction === 'string');
    assert.strictEqual(alert.patientId, 'P_env');
    assert.strictEqual(alert.modelVersion, a.modelVersion);
    assert.strictEqual(alert.inputsFingerprint, a.inputsFingerprint);
  }
});

console.log('\n=== Batch evaluator ===');

test('evaluateRulesBatch: aggregates by rule and severity', () => {
  const buildItem = (patientId, opts2 = {}) => {
    const inputs = {
      patientId,
      lastEvaluationDateISO: isoDaysAgo(opts2.evalDaysAgo || 30),
      openBarriers: opts2.barriers || [],
      ahhqStatus: opts2.ahhq || 'current',
      lastContactISO: isoDaysAgo(opts2.contactDaysAgo || 7),
    };
    return { inputs, assessment: assess(inputs) };
  };
  const batch = [
    buildItem('P1', { evalDaysAgo: 380 }),                  // EVAL_EXPIRED
    buildItem('P2', { barriers: [{ riskLevel: 'high' }] }), // HIGH_BARRIER_OPENED
    buildItem('P3', { ahhq: 'missing' }),                   // AHHQ_EXPIRED
    buildItem('P4'),                                        // clean
  ];
  const r = rules.evaluateRulesBatch(batch, opts);
  assert.ok(r.totalAlerts >= 3);
  assert.ok(r.alertsByRule.EVAL_EXPIRED >= 1);
  assert.ok(r.alertsByRule.HIGH_BARRIER_OPENED >= 1);
  assert.ok(r.alertsByRule.AHHQ_EXPIRED >= 1);
  assert.ok(r.alertsBySeverity[rules.SEVERITY.CRITICAL] >= 1);
});

test('evaluateRulesBatch: rejects non-array input', () => {
  assert.throws(() => rules.evaluateRulesBatch(null));
});

console.log('\n=== Catalog ===');

test('getRuleCatalog returns the seven supported rules', () => {
  const cat = rules.getRuleCatalog();
  const ids = cat.map((c) => c.id);
  for (const expected of [
    'PATIENT_ENTERED_CRITICAL', 'EVAL_EXPIRED', 'EVAL_EXPIRING_SOON',
    'HIGH_BARRIER_OPENED', 'SCORE_JUMPED', 'CONTACT_LAPSED', 'AHHQ_EXPIRED',
  ]) {
    assert.ok(ids.includes(expected), `catalog missing ${expected}`);
  }
});

console.log(`\nResults: ${PASS} passed, ${FAIL} failed.`);
if (FAIL > 0) {
  for (const f of failures) console.error(`\n${f.name}:\n${f.error.stack || f.error.message}`);
  process.exit(1);
}
