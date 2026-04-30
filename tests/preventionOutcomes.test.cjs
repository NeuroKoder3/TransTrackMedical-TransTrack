/**
 * TransTrack — Prevention Outcomes service unit tests.
 *
 * Uses an in-memory SQLite (better-sqlite3-multiple-ciphers) instance so the
 * test does not depend on the encrypted-disk path.
 *
 * Run with:
 *   npm rebuild better-sqlite3-multiple-ciphers && node tests/preventionOutcomes.test.cjs
 */

'use strict';

const assert = require('assert');
const Database = require('better-sqlite3-multiple-ciphers');
const outcomes = require('../electron/services/preventionOutcomes.cjs');

let PASS = 0, FAIL = 0;
const failures = [];
function test(name, fn) {
  try { fn(); PASS++; console.log(`  PASS  ${name}`); }
  catch (e) {
    FAIL++; failures.push({ name, error: e });
    console.log(`  FAIL  ${name}\n        ${e.message}`);
  }
}

function setupDB() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE prevention_interventions (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      intervention_type TEXT NOT NULL,
      target_factor TEXT,
      score_before REAL,
      risk_level_before TEXT,
      probability_90_before REAL,
      score_after REAL,
      risk_level_after TEXT,
      probability_90_after REAL,
      measured_score_delta REAL,
      measured_at TEXT,
      model_version TEXT,
      inputs_fingerprint_before TEXT,
      inputs_fingerprint_after TEXT,
      notes TEXT,
      performed_by TEXT,
      performed_role TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  return db;
}

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const PT_1 = 'patient-1';
const PT_2 = 'patient-2';

const sampleAssessmentBefore = {
  modelVersion: '2.0.0',
  score: 78.4,
  riskLevel: 'high',
  probabilities: { within30Days: 0.55, within60Days: 0.72, within90Days: 0.84 },
  inputsFingerprint: 'fp-before-1',
};

const sampleAssessmentAfter = {
  modelVersion: '2.0.0',
  score: 41.2,
  riskLevel: 'moderate',
  probabilities: { within30Days: 0.22, within60Days: 0.38, within90Days: 0.51 },
  inputsFingerprint: 'fp-after-1',
};

console.log('\n=== Prevention Outcomes — input validation ===');

test('recordIntervention: rejects missing args', () => {
  const db = setupDB();
  assert.throws(() => outcomes.recordIntervention());
  assert.throws(() => outcomes.recordIntervention(db));
  assert.throws(() => outcomes.recordIntervention(db, {}));
  assert.throws(() => outcomes.recordIntervention(db, { orgId: ORG_A }));
  assert.throws(() => outcomes.recordIntervention(db, { orgId: ORG_A, patientId: PT_1 }));
});

test('recordIntervention: rejects unknown intervention type', () => {
  const db = setupDB();
  assert.throws(() =>
    outcomes.recordIntervention(db, {
      orgId: ORG_A,
      patientId: PT_1,
      interventionType: 'unknownAction',
    })
  );
});

test('recordIntervention: returns id', () => {
  const db = setupDB();
  const r = outcomes.recordIntervention(db, {
    orgId: ORG_A,
    patientId: PT_1,
    interventionType: 'resolveAllBarriers',
    targetFactor: 'BARRIERS',
    assessmentBefore: sampleAssessmentBefore,
    notes: 'test',
    performedBy: 'coord@hospital.org',
    performedRole: 'coordinator',
  });
  assert.ok(r.id && typeof r.id === 'string');
});

console.log('\n=== Prevention Outcomes — record + retrieve ===');

test('inserted row carries before-snapshot, model version, fingerprint', () => {
  const db = setupDB();
  const { id } = outcomes.recordIntervention(db, {
    orgId: ORG_A,
    patientId: PT_1,
    interventionType: 'refreshEvaluation',
    targetFactor: 'EVAL_EXPIRY',
    assessmentBefore: sampleAssessmentBefore,
    performedBy: 'c@h.org',
    performedRole: 'coordinator',
  });
  const row = db.prepare(`SELECT * FROM prevention_interventions WHERE id = ?`).get(id);
  assert.strictEqual(row.org_id, ORG_A);
  assert.strictEqual(row.patient_id, PT_1);
  assert.strictEqual(row.intervention_type, 'refreshEvaluation');
  assert.strictEqual(row.target_factor, 'EVAL_EXPIRY');
  assert.strictEqual(row.score_before, sampleAssessmentBefore.score);
  assert.strictEqual(row.risk_level_before, 'high');
  assert.strictEqual(row.probability_90_before, 0.84);
  assert.strictEqual(row.model_version, '2.0.0');
  assert.strictEqual(row.inputs_fingerprint_before, 'fp-before-1');
  assert.strictEqual(row.score_after, null);
  assert.strictEqual(row.measured_at, null);
});

test('getInterventionsForPatient: returns rows newest first', () => {
  const db = setupDB();
  outcomes.recordIntervention(db, { orgId: ORG_A, patientId: PT_1, interventionType: 'recordContact' });
  outcomes.recordIntervention(db, { orgId: ORG_A, patientId: PT_1, interventionType: 'refreshAHHQ' });
  const rows = outcomes.getInterventionsForPatient(db, ORG_A, PT_1);
  assert.strictEqual(rows.length, 2);
});

test('cross-org leakage prevention: org A cannot see org B rows', () => {
  const db = setupDB();
  outcomes.recordIntervention(db, { orgId: ORG_A, patientId: PT_1, interventionType: 'recordContact' });
  outcomes.recordIntervention(db, { orgId: ORG_B, patientId: PT_2, interventionType: 'refreshAHHQ' });
  const aRows = outcomes.getInterventionsForPatient(db, ORG_A, PT_1);
  const aRowsForB = outcomes.getInterventionsForPatient(db, ORG_A, PT_2);
  assert.strictEqual(aRows.length, 1);
  assert.strictEqual(aRowsForB.length, 0);
});

console.log('\n=== Prevention Outcomes — measured-after path ===');

test('recordOutcome: updates row and computes measured score delta', () => {
  const db = setupDB();
  const { id } = outcomes.recordIntervention(db, {
    orgId: ORG_A,
    patientId: PT_1,
    interventionType: 'resolveAllBarriers',
    assessmentBefore: sampleAssessmentBefore,
  });
  const r = outcomes.recordOutcome(db, {
    orgId: ORG_A,
    interventionId: id,
    assessmentAfter: sampleAssessmentAfter,
  });
  assert.strictEqual(r.updated, true);
  // score_before 78.4 - score_after 41.2 = 37.2
  assert.strictEqual(r.measured_score_delta, 37.2);

  const row = db.prepare('SELECT * FROM prevention_interventions WHERE id = ?').get(id);
  assert.strictEqual(row.score_after, 41.2);
  assert.strictEqual(row.risk_level_after, 'moderate');
  assert.strictEqual(row.probability_90_after, 0.51);
  assert.strictEqual(row.measured_score_delta, 37.2);
  assert.ok(row.measured_at);
  assert.strictEqual(row.inputs_fingerprint_after, 'fp-after-1');
});

test('recordOutcome: rejects cross-org access', () => {
  const db = setupDB();
  const { id } = outcomes.recordIntervention(db, {
    orgId: ORG_A, patientId: PT_1,
    interventionType: 'refreshEvaluation',
    assessmentBefore: sampleAssessmentBefore,
  });
  const r = outcomes.recordOutcome(db, {
    orgId: ORG_B,
    interventionId: id,
    assessmentAfter: sampleAssessmentAfter,
  });
  assert.strictEqual(r.updated, false);
  assert.strictEqual(r.measured_score_delta, null);
});

console.log('\n=== Prevention Outcomes — center effectiveness rollup ===');

test('getInterventionEffectiveness: empty org → zero totals', () => {
  const db = setupDB();
  const rep = outcomes.getInterventionEffectiveness(db, ORG_A);
  assert.deepStrictEqual(rep.perInterventionType, []);
  assert.strictEqual(rep.totals.recorded, 0);
  assert.strictEqual(rep.totals.measured, 0);
});

test('getInterventionEffectiveness: aggregates by intervention type', () => {
  const db = setupDB();

  // Two resolveAllBarriers interventions, both measured.
  for (const after of [
    { ...sampleAssessmentAfter, score: 41.2, probabilities: { within30Days: 0.22, within60Days: 0.38, within90Days: 0.51 } },
    { ...sampleAssessmentAfter, score: 50.0, probabilities: { within30Days: 0.30, within60Days: 0.45, within90Days: 0.55 } },
  ]) {
    const { id } = outcomes.recordIntervention(db, {
      orgId: ORG_A, patientId: PT_1,
      interventionType: 'resolveAllBarriers',
      assessmentBefore: sampleAssessmentBefore,
    });
    outcomes.recordOutcome(db, { orgId: ORG_A, interventionId: id, assessmentAfter: after });
  }
  // One refreshEvaluation, recorded but not measured.
  outcomes.recordIntervention(db, {
    orgId: ORG_A, patientId: PT_2,
    interventionType: 'refreshEvaluation',
    assessmentBefore: sampleAssessmentBefore,
  });

  const rep = outcomes.getInterventionEffectiveness(db, ORG_A);
  const byType = Object.fromEntries(rep.perInterventionType.map((r) => [r.interventionType, r]));

  assert.strictEqual(byType.resolveAllBarriers.recorded, 2);
  assert.strictEqual(byType.resolveAllBarriers.measured, 2);
  // (37.2 + 28.4) / 2 = 32.8
  assert.strictEqual(byType.resolveAllBarriers.averageScoreDelta, 32.8);

  assert.strictEqual(byType.refreshEvaluation.recorded, 1);
  assert.strictEqual(byType.refreshEvaluation.measured, 0);
  assert.strictEqual(byType.refreshEvaluation.averageScoreDelta, null);

  assert.strictEqual(rep.totals.recorded, 3);
  assert.strictEqual(rep.totals.measured, 2);
  // weighted across only the measured rows
  assert.strictEqual(rep.totals.weightedAvgScoreDelta, 32.8);
});

test('getInterventionEffectiveness: respects windowDays', () => {
  const db = setupDB();
  // Insert a row with an old created_at
  outcomes.recordIntervention(db, {
    orgId: ORG_A, patientId: PT_1, interventionType: 'recordContact',
  });
  db.prepare(`UPDATE prevention_interventions SET created_at = ? WHERE org_id = ?`)
    .run('2020-01-01T00:00:00.000Z', ORG_A);

  const rep = outcomes.getInterventionEffectiveness(db, ORG_A, { windowDays: 30 });
  assert.strictEqual(rep.totals.recorded, 0);

  const repFar = outcomes.getInterventionEffectiveness(db, ORG_A, { windowDays: 365 * 20 });
  assert.strictEqual(repFar.totals.recorded, 1);
});

test('report carries operational disclaimer', () => {
  const db = setupDB();
  const rep = outcomes.getInterventionEffectiveness(db, ORG_A);
  assert.ok(typeof rep.disclaimer === 'string');
  assert.ok(/causality/i.test(rep.disclaimer));
});

console.log(`\nResults: ${PASS} passed, ${FAIL} failed.`);
if (FAIL > 0) {
  for (const f of failures) console.error(`\n${f.name}:\n${f.error.stack || f.error.message}`);
  process.exit(1);
}
