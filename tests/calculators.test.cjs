/**
 * TransTrack — Transplant calculator unit tests.
 *
 * Run with: node tests/calculators.test.cjs
 *
 * No DB, no electron — pure-function tests.
 */

'use strict';

const assert = require('assert');
const {
  calculateMELD, calculateMELDNa, calculateMELD3, calculatePELD,
  calculateLAS, calculateKDPI, calculateEPTS,
} = require('../electron/services/calculators/index.cjs');

let PASS = 0;
let FAIL = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    PASS++;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    FAIL++;
    failures.push({ name, error: e });
    console.log(`  FAIL  ${name}`);
    console.log(`        ${e.message}`);
  }
}

function approxEqual(actual, expected, tolerance = 1) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `expected ${expected} ± ${tolerance}, got ${actual}`);
}

console.log('\n=== MELD ===');

test('MELD: returns null and missing fields when inputs missing', () => {
  const r = calculateMELD({});
  assert.strictEqual(r.score, null);
  assert.strictEqual(r.reason, 'INSUFFICIENT_DATA');
  assert.deepStrictEqual(r.missing.sort(), ['bilirubin_mg_dl', 'creatinine_mg_dl', 'inr']);
});

test('MELD: typical mid-range case', () => {
  // Cr 1.5, Bili 4.0, INR 1.8
  // 0.957*ln(1.5)+0.378*ln(4)+1.120*ln(1.8)+0.643 = 0.957*0.4055+0.378*1.3863+1.120*0.5878+0.643
  //   = 0.388 + 0.524 + 0.658 + 0.643 = 2.213; *10 = 22.13 → 22
  const r = calculateMELD({ creatinine_mg_dl: 1.5, bilirubin_mg_dl: 4.0, inr: 1.8 });
  approxEqual(r.score, 22, 1);
  assert.strictEqual(r.formula, 'MELD');
});

test('MELD: floors values <1.0 to 1.0', () => {
  // All clamped to 1.0 → ln(1)*all = 0 + 0.643 = 0.643 → score = 6.43 → 6 (clamped to floor 6)
  const r = calculateMELD({ creatinine_mg_dl: 0.5, bilirubin_mg_dl: 0.5, inr: 0.9 });
  assert.strictEqual(r.score, 6);
});

test('MELD: caps creatinine at 4.0', () => {
  const high = calculateMELD({ creatinine_mg_dl: 10, bilirubin_mg_dl: 1, inr: 1 });
  const cap  = calculateMELD({ creatinine_mg_dl: 4,  bilirubin_mg_dl: 1, inr: 1 });
  assert.strictEqual(high.score, cap.score);
});

test('MELD: dialysis 2x/week sets creatinine to 4.0', () => {
  const dialysis = calculateMELD({ creatinine_mg_dl: 2.0, bilirubin_mg_dl: 1, inr: 1, dialysis_twice_in_week: true });
  const ref = calculateMELD({ creatinine_mg_dl: 4.0, bilirubin_mg_dl: 1, inr: 1 });
  assert.strictEqual(dialysis.score, ref.score);
});

test('MELD: caps at 40', () => {
  const r = calculateMELD({ creatinine_mg_dl: 4.0, bilirubin_mg_dl: 100, inr: 100 });
  assert.strictEqual(r.score, 40);
});

console.log('\n=== MELD-Na ===');

test('MELD-Na: equals MELD when MELD ≤ 11', () => {
  const inputs = { creatinine_mg_dl: 1, bilirubin_mg_dl: 1, inr: 1, sodium_meq_l: 130 };
  const meld = calculateMELD(inputs);
  const meldNa = calculateMELDNa(inputs);
  assert.strictEqual(meldNa.score, meld.score);
});

test('MELD-Na: increases score for hyponatremia when MELD > 11', () => {
  // MELD ~22 with Na = 130
  const baseInputs = { creatinine_mg_dl: 1.5, bilirubin_mg_dl: 4.0, inr: 1.8 };
  const meld = calculateMELD(baseInputs);
  const meldNa = calculateMELDNa({ ...baseInputs, sodium_meq_l: 130 });
  assert.ok(meldNa.score > meld.score, `expected MELD-Na (${meldNa.score}) > MELD (${meld.score}) for hyponatremia`);
});

test('MELD-Na: clamps Na to [125, 137]', () => {
  const inputs = { creatinine_mg_dl: 1.5, bilirubin_mg_dl: 4.0, inr: 1.8 };
  const a = calculateMELDNa({ ...inputs, sodium_meq_l: 100 });
  const b = calculateMELDNa({ ...inputs, sodium_meq_l: 125 });
  const c = calculateMELDNa({ ...inputs, sodium_meq_l: 145 });
  const d = calculateMELDNa({ ...inputs, sodium_meq_l: 137 });
  assert.strictEqual(a.score, b.score);
  assert.strictEqual(c.score, d.score);
});

test('MELD-Na: insufficient data when sodium missing', () => {
  const r = calculateMELDNa({ creatinine_mg_dl: 1, bilirubin_mg_dl: 1, inr: 1 });
  assert.strictEqual(r.score, null);
  assert.deepStrictEqual(r.missing, ['sodium_meq_l']);
});

console.log('\n=== MELD 3.0 ===');

test('MELD 3.0: requires sex and albumin', () => {
  const r = calculateMELD3({ creatinine_mg_dl: 1, bilirubin_mg_dl: 1, inr: 1, sodium_meq_l: 137 });
  assert.strictEqual(r.score, null);
  assert.ok(r.missing.includes('sex'));
  assert.ok(r.missing.includes('albumin_g_dl'));
});

test('MELD 3.0: female bonus increases score vs male, all else equal', () => {
  const inputs = { creatinine_mg_dl: 1.5, bilirubin_mg_dl: 4.0, inr: 1.8, sodium_meq_l: 130, albumin_g_dl: 2.5 };
  const m = calculateMELD3({ ...inputs, sex: 'male' });
  const f = calculateMELD3({ ...inputs, sex: 'female' });
  assert.ok(f.score >= m.score, `expected female (${f.score}) >= male (${m.score})`);
});

test('MELD 3.0: caps at 40', () => {
  const r = calculateMELD3({ creatinine_mg_dl: 4, bilirubin_mg_dl: 100, inr: 100, sodium_meq_l: 125, albumin_g_dl: 1.5, sex: 'female' });
  assert.strictEqual(r.score, 40);
});

console.log('\n=== PELD ===');

test('PELD: rejects when age >= 12', () => {
  const r = calculatePELD({ bilirubin_mg_dl: 5, inr: 2, albumin_g_dl: 2, age_years: 14, growth_failure: false });
  assert.strictEqual(r.score, null);
  assert.strictEqual(r.reason, 'PELD_NOT_APPLICABLE');
});

test('PELD: gives age bonus for <1 year', () => {
  const inputs = { bilirubin_mg_dl: 5, inr: 2, albumin_g_dl: 2, growth_failure: false };
  const infant = calculatePELD({ ...inputs, age_years: 0.5 });
  const older = calculatePELD({ ...inputs, age_years: 5 });
  assert.ok(infant.score > older.score);
});

test('PELD: gives growth-failure bonus', () => {
  const inputs = { bilirubin_mg_dl: 5, inr: 2, albumin_g_dl: 2, age_years: 5 };
  const without = calculatePELD({ ...inputs, growth_failure: false });
  const withGF = calculatePELD({ ...inputs, growth_failure: true });
  assert.ok(withGF.score > without.score);
});

console.log('\n=== LAS ===');

test('LAS: insufficient data returns null', () => {
  const r = calculateLAS({});
  assert.strictEqual(r.score, null);
  assert.strictEqual(r.reason, 'INSUFFICIENT_DATA');
});

test('LAS: mech ventilation strongly increases score', () => {
  const base = {
    diagnosis_group: 'D', age_years: 60, bmi: 22, functional_status: 'some_assistance',
    six_minute_walk_ft: 600, continuous_o2_l_min: 4, pco2_mmHg: 55,
    creatinine_mg_dl: 1.0, bilirubin_mg_dl: 0.5,
  };
  const off = calculateLAS({ ...base, on_mechanical_ventilation: false });
  const on  = calculateLAS({ ...base, on_mechanical_ventilation: true });
  assert.ok(on.score > off.score, `expected vent (${on.score}) > non-vent (${off.score})`);
});

test('LAS: invalid diagnosis group rejected', () => {
  const r = calculateLAS({
    diagnosis_group: 'Z', age_years: 60, bmi: 22, functional_status: 'no_assistance',
    six_minute_walk_ft: 1000, continuous_o2_l_min: 0, pco2_mmHg: 40,
    on_mechanical_ventilation: false, creatinine_mg_dl: 1, bilirubin_mg_dl: 1,
  });
  assert.strictEqual(r.score, null);
  assert.strictEqual(r.reason, 'INVALID_DIAGNOSIS_GROUP');
});

test('LAS: score bounded to [0, 100]', () => {
  const r = calculateLAS({
    diagnosis_group: 'D', age_years: 70, bmi: 18, functional_status: 'total_assistance',
    six_minute_walk_ft: 0, continuous_o2_l_min: 10, pco2_mmHg: 80, pap_systolic_mmHg: 80,
    on_mechanical_ventilation: true, diabetes: true, creatinine_mg_dl: 3, bilirubin_mg_dl: 3,
  });
  assert.ok(r.score >= 0 && r.score <= 100);
});

console.log('\n=== KDPI ===');

test('KDPI: insufficient data returns null', () => {
  const r = calculateKDPI({});
  assert.strictEqual(r.kdpi, null);
});

test('KDPI: ideal young donor produces low percentile', () => {
  const r = calculateKDPI({
    age_years: 25, height_cm: 175, weight_kg: 75,
    african_american: false, hypertension: false, diabetes: false,
    cause_of_death: 'TRAUMA', creatinine_mg_dl: 0.9,
    hcv_positive: false, dcd: false,
  });
  assert.ok(r.kdpi <= 30, `expected low KDPI for ideal donor, got ${r.kdpi}`);
});

test('KDPI: marginal donor produces high percentile', () => {
  const r = calculateKDPI({
    age_years: 65, height_cm: 165, weight_kg: 95,
    african_american: true, hypertension: true, diabetes: true,
    cause_of_death: 'CVA', creatinine_mg_dl: 2.5,
    hcv_positive: true, dcd: true,
  });
  assert.ok(r.kdpi >= 70, `expected high KDPI for marginal donor, got ${r.kdpi}`);
});

test('KDPI: percentile bounded to [0, 100]', () => {
  const r = calculateKDPI({
    age_years: 80, height_cm: 150, weight_kg: 100,
    african_american: true, hypertension: true, diabetes: true,
    cause_of_death: 'CVA', creatinine_mg_dl: 5.0,
    hcv_positive: true, dcd: true,
  });
  assert.ok(r.kdpi >= 0 && r.kdpi <= 100);
});

console.log('\n=== EPTS ===');

test('EPTS: insufficient data returns null', () => {
  const r = calculateEPTS({});
  assert.strictEqual(r.epts_pct, null);
});

test('EPTS: young pre-emptive non-diabetic non-prior produces best (low) percentile', () => {
  const r = calculateEPTS({ age_years: 30, diabetes: false, prior_solid_organ_transplant: false, years_on_dialysis: 0 });
  assert.ok(r.epts_pct <= 25, `expected low percentile for ideal candidate, got ${r.epts_pct}`);
});

test('EPTS: older diabetic with long dialysis and prior transplant produces high percentile', () => {
  const r = calculateEPTS({ age_years: 65, diabetes: true, prior_solid_organ_transplant: true, years_on_dialysis: 10 });
  assert.ok(r.epts_pct >= 70, `expected high percentile for high-risk candidate, got ${r.epts_pct}`);
});

test('EPTS: percentile bounded to [0, 100]', () => {
  const r = calculateEPTS({ age_years: 80, diabetes: true, prior_solid_organ_transplant: true, years_on_dialysis: 20 });
  assert.ok(r.epts_pct >= 0 && r.epts_pct <= 100);
});

console.log(`\n=== Summary: ${PASS} passed, ${FAIL} failed ===`);
if (FAIL > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ${f.name}: ${f.error.message}`);
  process.exit(1);
}
