/**
 * C-4 regression suite — clinical validation is enforced at every persistence
 * trust boundary, not only in the renderer form.
 *
 * Before remediation electron/functions/validators.cjs was dead code: a
 * repository-wide search found no consumer. These tests assert both that the
 * rules are correct and that the persistence paths actually call them.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const v = require('../electron/functions/validators.cjs');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}\n        ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('Clinical validation (C-4)');

// ---------------------------------------------------------------------------
// Range rules
// ---------------------------------------------------------------------------

test('MELD outside 6..40 is rejected', () => {
  assert.strictEqual(v.validateMELDScore(250).valid, false);
  assert.strictEqual(v.validateMELDScore(5).valid, false);
  assert.strictEqual(v.validateMELDScore(-1).valid, false);
  assert.strictEqual(v.validateMELDScore(6).valid, true);
  assert.strictEqual(v.validateMELDScore(40).valid, true);
});

test('LAS outside 0..100 is rejected', () => {
  assert.strictEqual(v.validateLASScore(-5).valid, false);
  assert.strictEqual(v.validateLASScore(101).valid, false);
  assert.strictEqual(v.validateLASScore(0).valid, true);
});

test('non-finite and non-numeric scores are rejected', () => {
  assert.strictEqual(v.validateMELDScore(NaN).valid, false);
  assert.strictEqual(v.validateMELDScore(Infinity).valid, false);
  assert.strictEqual(v.validateMELDScore('not-a-number').valid, false);
});

test('null and empty scores are accepted as "not recorded"', () => {
  assert.strictEqual(v.validateMELDScore(null).valid, true);
  assert.strictEqual(v.validateMELDScore('').valid, true);
});

test('blood type, urgency and organ domains are enforced', () => {
  assert.strictEqual(v.validateBloodType('A+').valid, true);
  assert.strictEqual(v.validateBloodType('Z+').valid, false);
  assert.strictEqual(v.validateUrgencyLevel('critical').valid, true);
  assert.strictEqual(v.validateUrgencyLevel('extremely-urgent').valid, false);
  assert.strictEqual(v.validateOrganType('kidney').valid, true);
  assert.strictEqual(v.validateOrganType('spleen').valid, false);
});

test('future and impossible birth dates are rejected', () => {
  const now = new Date('2026-08-02T00:00:00Z');
  assert.strictEqual(v.validateDate('2030-01-01', 'date_of_birth', { notFuture: true, now }).valid, false);
  assert.strictEqual(v.validateDate('1850-01-01', 'date_of_birth', { notAncient: true, now }).valid, false);
  assert.strictEqual(v.validateDate('1980-01-01', 'date_of_birth', { notFuture: true, notAncient: true, now }).valid, true);
  assert.strictEqual(v.validateDate('not-a-date', 'date_of_birth').valid, false);
});

// ---------------------------------------------------------------------------
// Unit-of-measure defence (C-3 companion)
// ---------------------------------------------------------------------------

test('a creatinine recorded in umol/L is rejected, not silently scored', () => {
  // 88 µmol/L is a normal creatinine; as mg/dL it is physically impossible.
  const r = v.validateLabValue(88, 'creatinine_mg_dl');
  assert.strictEqual(r.valid, false);
  assert.ok(/unit of measure/i.test(r.error), 'error should name the unit problem');
  assert.strictEqual(v.validateLabValue(1.1, 'creatinine_mg_dl').valid, true);
});

test('lab unit strings are checked against the canonical unit', () => {
  assert.strictEqual(v.validateLabUnit('creatinine', 'mg/dL').valid, true);
  assert.strictEqual(v.validateLabUnit('creatinine', 'umol/L').valid, false);
  assert.strictEqual(v.validateLabUnit('sodium', 'mmol/L').valid, true);
  assert.strictEqual(v.validateLabUnit('albumin', 'g/L').valid, false);
});

// ---------------------------------------------------------------------------
// Entity dispatcher
// ---------------------------------------------------------------------------

test('validateEntity collects every failing field', () => {
  const r = v.validateEntity('Patient', {
    meld_score: 250,
    las_score: -5,
    blood_type: 'Z+',
  });
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.errors.length, 3);
});

test('validateEntity tolerates partial updates', () => {
  assert.strictEqual(v.validateEntity('Patient', { first_name: 'Ada' }).valid, true);
});

test('assertValidEntity throws a typed error carrying every message', () => {
  assert.throws(
    () => v.assertValidEntity('Patient', { meld_score: 99 }, 'unit test'),
    (err) =>
      err.code === 'CLINICAL_VALIDATION_FAILED' &&
      Array.isArray(err.validationErrors) &&
      /unit test/.test(err.message)
  );
  assert.doesNotThrow(() => v.assertValidEntity('Patient', { meld_score: 20 }));
});

test('donor KDPI percentile is bounded', () => {
  assert.strictEqual(v.validateEntity('DonorOrgan', { kdpi_score: 140 }).valid, false);
  assert.strictEqual(v.validateEntity('DonorOrgan', { kdpi_score: 85 }).valid, true);
});

// ---------------------------------------------------------------------------
// Wiring: the boundaries must actually call the validator.
// A pure unit test of the rules would still have passed while the module was
// dead code, so these assertions target the call sites named in finding C-4.
// ---------------------------------------------------------------------------

function sourceOf(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

const BOUNDARIES = [
  ['electron/ipc/handlers/entities.cjs', 2, 'Electron entity create/update'],
  ['electron/services/hl7Ingest.cjs', 2, 'HL7 v2 ingestion'],
  ['electron/functions/index.cjs', 2, 'FHIR import and webhook'],
  ['server/src/services/patientService.js', 2, 'server REST create/update'],
];

for (const [file, minCalls, label] of BOUNDARIES) {
  test(`${label} invokes assertValidEntity (${file})`, () => {
    const src = sourceOf(file);
    assert.ok(
      /assertValidEntity/.test(src),
      `${file} does not reference assertValidEntity — the validator is dead code again`
    );
    const calls = (src.match(/assertValidEntity\(/g) || []).length;
    // One occurrence is the import; require at least minCalls total.
    assert.ok(
      calls >= minCalls,
      `${file} has ${calls} assertValidEntity call(s), expected at least ${minCalls}`
    );
  });
}

test('no persistence path is left unvalidated in the validator registry', () => {
  // Every entity the IPC layer can write and that carries clinical fields must
  // have a rule table, otherwise validateEntity silently passes it through.
  for (const entity of ['Patient', 'DonorOrgan', 'LivingDonor']) {
    assert.ok(v.ENTITY_RULES[entity], `no clinical rule table for ${entity}`);
  }
});

console.log(`\n${passed} assertions passed`);
if (process.exitCode) {
  console.error('Clinical validation suite FAILED');
} else {
  console.log('Clinical validation suite PASSED');
}
