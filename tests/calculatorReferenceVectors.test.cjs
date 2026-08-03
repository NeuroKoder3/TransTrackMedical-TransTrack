/**
 * C-3 / H-10 — clinical calculator verification against authoritative sources.
 *
 * Finding C-3 recorded that the existing calculator tests "recompute the
 * expected result by restating the same arithmetic the implementation uses",
 * which detects refactoring regressions but proves nothing about correctness.
 *
 * The vectors below are different in kind. Each expected value is derived from
 * the equation AS PUBLISHED BY OPTN — transcribed from the policy text quoted
 * in the header of each block — and evaluated independently of the module under
 * test. Where a published worked example exists it is used verbatim. The
 * arithmetic is written out longhand so a reviewer can check it against the
 * policy document without reading the implementation.
 *
 * Controlled sources: see docs/compliance/CLINICAL_SOURCES.md.
 *   SRC-OPTN-P9D  OPTN Policy 9.1.D  MELD / MELD-Na / MELD 3.0
 *   SRC-OPTN-P9E  OPTN Policy 9.1.E  PELD / PELD-Cr
 *   SRC-OPTN-P8   OPTN Policy 8.5.A  KDRI / KDPI
 *   SRC-OPTN-P8B  OPTN Policy 8.5.B  EPTS
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const calc = require('../electron/services/calculators/index.cjs');
const referenceData = require('../electron/services/calculators/referenceData.cjs');

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

const ln = Math.log;

console.log('Calculator reference vectors (C-3, H-10)');

// ---------------------------------------------------------------------------
// MELD (OPTN Policy 9.1.D, pre-MELD-3.0 equation, retained for MELD-Na)
//
//   MELD(i) = 0.957 x ln(creatinine) + 0.378 x ln(bilirubin)
//           + 1.120 x ln(INR) + 0.643
//   "Laboratory values less than 1.0 will be set to 1.0."
//   Creatinine > 4.0, or >= 2 dialysis treatments / 24h CVVHD in the prior
//   7 days, is set to 4.0.
//   "rounded to the tenth decimal place and then multiplied by 10"
//   Minimum 6, maximum 40.
// ---------------------------------------------------------------------------

test('MELD: all labs at the 1.0 floor gives the policy minimum of 6', () => {
  // Every ln term is ln(1) = 0, so raw = 0.643; 0.643 x 10 = 6.43 -> 6.
  // The policy floor of 6 also applies. Both routes agree.
  const r = calc.calculateMELD({ creatinine_mg_dl: 0.4, bilirubin_mg_dl: 0.2, inr: 0.9 });
  assert.strictEqual(r.score, 6);
});

test('MELD: OPTN equation evaluated longhand for a mid-range candidate', () => {
  // creatinine 1.9, bilirubin 4.2, INR 1.6 — no clamping applies.
  //   0.957*ln(1.9) = 0.957 * 0.6418539  = 0.6142540
  //   0.378*ln(4.2) = 0.378 * 1.4350845  = 0.5424619
  //   1.120*ln(1.6) = 1.120 * 0.4700036  = 0.5264040
  //   + 0.643
  //   raw = 2.3261199 ; x10 = 23.261 -> 23
  const expected = Math.round(
    (0.957 * ln(1.9) + 0.378 * ln(4.2) + 1.120 * ln(1.6) + 0.643) * 10
  );
  assert.strictEqual(expected, 23, 'longhand check of the published equation');
  const r = calc.calculateMELD({ creatinine_mg_dl: 1.9, bilirubin_mg_dl: 4.2, inr: 1.6 });
  assert.strictEqual(r.score, 23);
});

test('MELD: creatinine above 4.0 is capped at 4.0 per policy', () => {
  const capped = calc.calculateMELD({ creatinine_mg_dl: 4.0, bilirubin_mg_dl: 2.0, inr: 1.5 });
  const over = calc.calculateMELD({ creatinine_mg_dl: 9.9, bilirubin_mg_dl: 2.0, inr: 1.5 });
  assert.strictEqual(over.score, capped.score);
});

test('MELD: dialysis twice in the prior week forces creatinine to 4.0', () => {
  const dialysed = calc.calculateMELD({
    creatinine_mg_dl: 0.8, bilirubin_mg_dl: 2.0, inr: 1.5, dialysis_twice_in_week: true,
  });
  const atCap = calc.calculateMELD({ creatinine_mg_dl: 4.0, bilirubin_mg_dl: 2.0, inr: 1.5 });
  assert.strictEqual(dialysed.score, atCap.score);
});

test('MELD: score is bounded to the policy range 6..40', () => {
  const extreme = calc.calculateMELD({ creatinine_mg_dl: 4.0, bilirubin_mg_dl: 99, inr: 19 });
  assert.strictEqual(extreme.score, 40);
});

// ---------------------------------------------------------------------------
// MELD-Na (OPTN Policy 9.1.D)
//   MELD-Na = MELD + 1.32 x (137 - Na) - [0.033 x MELD x (137 - Na)]
//   Applied only when MELD > 11. Sodium bounded to [125, 137].
// ---------------------------------------------------------------------------

test('MELD-Na: sodium adjustment is not applied at or below MELD 11', () => {
  const base = calc.calculateMELD({ creatinine_mg_dl: 1.0, bilirubin_mg_dl: 1.0, inr: 1.0 });
  assert.ok(base.score <= 11, 'precondition: base MELD must be <= 11');
  const r = calc.calculateMELDNa({
    creatinine_mg_dl: 1.0, bilirubin_mg_dl: 1.0, inr: 1.0, sodium_meq_l: 125,
  });
  assert.strictEqual(r.score, base.score);
});

test('MELD-Na: published adjustment evaluated longhand at Na 128', () => {
  const base = calc.calculateMELD({ creatinine_mg_dl: 1.9, bilirubin_mg_dl: 4.2, inr: 1.6 });
  assert.strictEqual(base.score, 23);
  //   23 + 1.32*(137-128) - 0.033*23*(137-128)
  // = 23 + 11.88 - 6.831 = 28.049 -> 28
  const expected = Math.round(base.score + 1.32 * (137 - 128) - 0.033 * base.score * (137 - 128));
  assert.strictEqual(expected, 28);
  const r = calc.calculateMELDNa({
    creatinine_mg_dl: 1.9, bilirubin_mg_dl: 4.2, inr: 1.6, sodium_meq_l: 128,
  });
  assert.strictEqual(r.score, 28);
});

test('MELD-Na: sodium is bounded to [125, 137]', () => {
  const low = calc.calculateMELDNa({ creatinine_mg_dl: 1.9, bilirubin_mg_dl: 4.2, inr: 1.6, sodium_meq_l: 125 });
  const lower = calc.calculateMELDNa({ creatinine_mg_dl: 1.9, bilirubin_mg_dl: 4.2, inr: 1.6, sodium_meq_l: 110 });
  assert.strictEqual(lower.score, low.score);

  const high = calc.calculateMELDNa({ creatinine_mg_dl: 1.9, bilirubin_mg_dl: 4.2, inr: 1.6, sodium_meq_l: 137 });
  const higher = calc.calculateMELDNa({ creatinine_mg_dl: 1.9, bilirubin_mg_dl: 4.2, inr: 1.6, sodium_meq_l: 150 });
  assert.strictEqual(higher.score, high.score);
});

// ---------------------------------------------------------------------------
// MELD 3.0 (OPTN Policy 9.1.D, policy notice 06/27/2022, in effect 2023-07-13)
//
//   MELD 3.0 = 1.33 (if female)
//            + 4.56 x ln(bilirubin)
//            + 0.82 x (137 - sodium)
//            - 0.24 x (137 - sodium) x ln(bilirubin)
//            + 9.09 x ln(INR)
//            + 11.14 x ln(creatinine)
//            + 1.85 x (3.5 - albumin)
//            - 1.83 x (3.5 - albumin) x ln(creatinine)
//            + 6
//   Adolescent (12-17) variant: intercept 7.33, no sex term.
//   bilirubin/INR/creatinine floored at 1.0; creatinine capped at 3.0 (and set
//   to 3.0 on dialysis); sodium bounded [125,137]; albumin bounded [1.5,3.5];
//   minimum 6, maximum 40, rounded to the nearest whole number.
// ---------------------------------------------------------------------------

function meld3Longhand({ bili, na, inr, cr, alb, female, intercept }) {
  return Math.round(
    1.33 * (female ? 1 : 0) +
    4.56 * ln(bili) +
    0.82 * (137 - na) -
    0.24 * (137 - na) * ln(bili) +
    9.09 * ln(inr) +
    11.14 * ln(cr) +
    1.85 * (3.5 - alb) -
    1.83 * (3.5 - alb) * ln(cr) +
    intercept
  );
}

test('MELD 3.0: adult male evaluated longhand against the published equation', () => {
  const args = { bilirubin_mg_dl: 3.0, sodium_meq_l: 130, inr: 1.8, creatinine_mg_dl: 1.5, albumin_g_dl: 2.8 };
  const expected = meld3Longhand({ bili: 3.0, na: 130, inr: 1.8, cr: 1.5, alb: 2.8, female: false, intercept: 6 });
  const r = calc.calculateMELD3({ ...args, sex: 'male', age_years: 55 });
  assert.strictEqual(r.score, expected);
  assert.strictEqual(r.variant, 'age-18-plus');
});

test('MELD 3.0: the female term adds exactly the published 1.33 before rounding', () => {
  const args = { bilirubin_mg_dl: 3.0, sodium_meq_l: 130, inr: 1.8, creatinine_mg_dl: 1.5, albumin_g_dl: 2.8 };
  const expectedF = meld3Longhand({ bili: 3.0, na: 130, inr: 1.8, cr: 1.5, alb: 2.8, female: true, intercept: 6 });
  const r = calc.calculateMELD3({ ...args, sex: 'female', age_years: 55 });
  assert.strictEqual(r.score, expectedF);
});

test('MELD 3.0: adolescents 12-17 use intercept 7.33 and no sex term', () => {
  // This vector fails against the pre-remediation implementation, which applied
  // the adult intercept of 6 and the female term to every candidate >= 12.
  const args = { bilirubin_mg_dl: 3.0, sodium_meq_l: 130, inr: 1.8, creatinine_mg_dl: 1.5, albumin_g_dl: 2.8 };
  const expected = meld3Longhand({ bili: 3.0, na: 130, inr: 1.8, cr: 1.5, alb: 2.8, female: false, intercept: 7.33 });

  const male = calc.calculateMELD3({ ...args, sex: 'male', age_years: 14 });
  const female = calc.calculateMELD3({ ...args, sex: 'female', age_years: 14 });
  assert.strictEqual(male.score, expected);
  assert.strictEqual(female.score, expected, 'no sex term applies to the 12-17 equation');
  assert.strictEqual(male.variant, 'age-12-17');
});

test('MELD 3.0: creatinine cap is 3.0, not the 4.0 used by MELD-Na', () => {
  const base = { bilirubin_mg_dl: 3.0, sodium_meq_l: 130, inr: 1.8, albumin_g_dl: 2.8, sex: 'male', age_years: 50 };
  const atCap = calc.calculateMELD3({ ...base, creatinine_mg_dl: 3.0 });
  const over = calc.calculateMELD3({ ...base, creatinine_mg_dl: 4.0 });
  assert.strictEqual(over.score, atCap.score);
});

test('MELD 3.0: dialysis sets creatinine to 3.0', () => {
  const base = { bilirubin_mg_dl: 3.0, sodium_meq_l: 130, inr: 1.8, albumin_g_dl: 2.8, sex: 'male', age_years: 50 };
  const dialysed = calc.calculateMELD3({ ...base, creatinine_mg_dl: 0.7, dialysis_twice_in_week: true });
  const atCap = calc.calculateMELD3({ ...base, creatinine_mg_dl: 3.0 });
  assert.strictEqual(dialysed.score, atCap.score);
});

test('MELD 3.0: albumin is bounded to [1.5, 3.5]', () => {
  const base = { bilirubin_mg_dl: 3.0, sodium_meq_l: 130, inr: 1.8, creatinine_mg_dl: 1.5, sex: 'male', age_years: 50 };
  assert.strictEqual(
    calc.calculateMELD3({ ...base, albumin_g_dl: 0.5 }).score,
    calc.calculateMELD3({ ...base, albumin_g_dl: 1.5 }).score
  );
  assert.strictEqual(
    calc.calculateMELD3({ ...base, albumin_g_dl: 5.0 }).score,
    calc.calculateMELD3({ ...base, albumin_g_dl: 3.5 }).score
  );
});

test('MELD 3.0: refuses to guess the equation when age is unknown', () => {
  const r = calc.calculateMELD3({
    bilirubin_mg_dl: 3.0, sodium_meq_l: 130, inr: 1.8, creatinine_mg_dl: 1.5,
    albumin_g_dl: 2.8, sex: 'male',
  });
  assert.strictEqual(r.score, null);
  assert.ok(r.missing.includes('age_years'));
});

test('MELD 3.0: is not applicable under 12', () => {
  const r = calc.calculateMELD3({
    bilirubin_mg_dl: 3.0, sodium_meq_l: 130, inr: 1.8, creatinine_mg_dl: 1.5,
    albumin_g_dl: 2.8, sex: 'male', age_years: 8,
  });
  assert.strictEqual(r.score, null);
  assert.strictEqual(r.reason, 'MELD3_NOT_APPLICABLE');
});

test('MELD 3.0: every result names the controlled source revision', () => {
  const r = calc.calculateMELD3({
    bilirubin_mg_dl: 3.0, sodium_meq_l: 130, inr: 1.8, creatinine_mg_dl: 1.5,
    albumin_g_dl: 2.8, sex: 'male', age_years: 50,
  });
  assert.strictEqual(r.source.sourceId, 'SRC-OPTN-P9D');
  assert.ok(r.source.sourceRevision.includes('2023-07-13'));
});

// ---------------------------------------------------------------------------
// PELD (OPTN Policy 9.1.E)
//
// OPTN replaced PELD with PELD-Cr on 2023-07-13. The per-term coefficients live
// only in Table 9-1, which is not shipped. The calculator must therefore refuse
// to score rather than serve the superseded equation under the PELD label.
// ---------------------------------------------------------------------------

test('PELD: fails closed while the controlled Table 9-1 is not installed', () => {
  const r = calc.calculatePELD({
    bilirubin_mg_dl: 3.0, inr: 1.5, albumin_g_dl: 2.5,
    creatinine_mg_dl: 0.5, age_years: 4, growth_failure: false,
  });
  assert.strictEqual(r.score, null, 'PELD must not return a score from unverified coefficients');
  assert.strictEqual(r.reason, 'REFERENCE_DATA_UNAVAILABLE');
  assert.ok(/Table 9-1/.test(r.message), 'the reason must name the missing controlled source');
});

test('PELD: still validates inputs and applicability before reporting the data gap', () => {
  const tooOld = calc.calculatePELD({
    bilirubin_mg_dl: 3.0, inr: 1.5, albumin_g_dl: 2.5, age_years: 15, growth_failure: false,
  });
  assert.strictEqual(tooOld.reason, 'PELD_NOT_APPLICABLE');
});

test('PELD: the superseded equation is reachable only under an explicit legacy name', () => {
  const legacy = calc.calculatePELDLegacy2016({
    bilirubin_mg_dl: 3.0, inr: 1.5, albumin_g_dl: 2.5, age_years: 4, growth_failure: false,
  });
  //   4.80*ln(3.0)  = 4.80 * 1.0986123 =  5.2733390
  //   18.57*ln(1.5) = 18.57 * 0.4054651 =  7.5294676
  //  -6.87*ln(2.5)  = -6.87 * 0.9162907 = -6.2949167
  //   sum = 6.5078899 -> 7
  const expected = Math.round(4.80 * ln(3.0) + 18.57 * ln(1.5) - 6.87 * ln(2.5));
  assert.strictEqual(legacy.score, expected);
  assert.strictEqual(legacy.superseded, true);
  assert.strictEqual(legacy.formula, 'PELD-LEGACY-2016');
});

test('PELD: the legacy albumin floor of 1.0 matches OPTN Policy 9.1.E', () => {
  // "Albumin, bilirubin, and INR values less than 1.0 will be set to 1.0 when
  //  calculating a candidate's PELD score." The validation report flagged this
  //  floor for reconciliation; the controlled source confirms it is correct.
  const atFloor = calc.calculatePELDLegacy2016({
    bilirubin_mg_dl: 2.0, inr: 1.2, albumin_g_dl: 1.0, age_years: 3, growth_failure: false,
  });
  const belowFloor = calc.calculatePELDLegacy2016({
    bilirubin_mg_dl: 2.0, inr: 1.2, albumin_g_dl: 0.4, age_years: 3, growth_failure: false,
  });
  assert.strictEqual(belowFloor.score, atFloor.score);
});

// ---------------------------------------------------------------------------
// KDRI / KDPI (OPTN Policy 8.5.A; Rao PS et al. Transplantation 2009;88:231-236)
//
//   xB = 0.0128*(age-40) - 0.0194*(age-18 if age<18) + 0.0107*(age-50 if age>50)
//      - 0.0464*((height-170)/10) - 0.0199*((weight-80)/5 if weight<80)
//      + 0.179*black + 0.126*hypertension + 0.130*diabetes
//      + 0.0881*(COD==CVA) + 0.220*(cr-1.0 up to 1.5) - 0.209*(cr-1.5 above 1.5)
//      + 0.133*HCV + 0.133*DCD
//   KDRI_Rao = exp(xB)
// ---------------------------------------------------------------------------

const REFERENCE_DONOR = {
  age_years: 40, height_cm: 170, weight_kg: 80, african_american: false,
  hypertension: false, diabetes: false, cause_of_death: 'OTHER',
  creatinine_mg_dl: 1.0, hcv_positive: false, dcd: false,
};

test('KDRI: the Rao reference donor has xB = 0, so KDRI_Rao = exp(0) = 1.000', () => {
  // Every term in the published model is defined as a deviation from this
  // donor, so the reference donor is a genuine published fixed point.
  const r = calc.calculateKDPI(REFERENCE_DONOR);
  assert.strictEqual(r.kdri_rao, 1.0);
});

test('KDRI: each published coefficient is reproduced in isolation', () => {
  const cases = [
    ['african_american', { african_american: true }, 0.179],
    ['hypertension', { hypertension: true }, 0.126],
    ['diabetes', { diabetes: true }, 0.130],
    ['cause of death CVA', { cause_of_death: 'CVA' }, 0.0881],
    ['HCV positive', { hcv_positive: true }, 0.133],
    ['DCD', { dcd: true }, 0.133],
  ];
  for (const [label, override, coefficient] of cases) {
    const r = calc.calculateKDPI({ ...REFERENCE_DONOR, ...override });
    const expected = Number(Math.exp(coefficient).toFixed(3));
    assert.strictEqual(r.kdri_rao, expected, `${label}: expected exp(${coefficient})`);
  }
});

test('KDRI: the age, height, weight and creatinine splines match the published form', () => {
  const age60 = calc.calculateKDPI({ ...REFERENCE_DONOR, age_years: 60 });
  assert.strictEqual(
    age60.kdri_rao,
    Number(Math.exp(0.0128 * (60 - 40) + 0.0107 * (60 - 50)).toFixed(3))
  );

  const age10 = calc.calculateKDPI({ ...REFERENCE_DONOR, age_years: 10 });
  assert.strictEqual(
    age10.kdri_rao,
    Number(Math.exp(0.0128 * (10 - 40) - 0.0194 * (10 - 18)).toFixed(3))
  );

  const tall = calc.calculateKDPI({ ...REFERENCE_DONOR, height_cm: 190 });
  assert.strictEqual(tall.kdri_rao, Number(Math.exp(-0.0464 * ((190 - 170) / 10)).toFixed(3)));

  const light = calc.calculateKDPI({ ...REFERENCE_DONOR, weight_kg: 60 });
  assert.strictEqual(light.kdri_rao, Number(Math.exp(-0.0199 * ((60 - 80) / 5)).toFixed(3)));

  const crLow = calc.calculateKDPI({ ...REFERENCE_DONOR, creatinine_mg_dl: 1.4 });
  assert.strictEqual(crLow.kdri_rao, Number(Math.exp(0.220 * (1.4 - 1.0)).toFixed(3)));

  const crHigh = calc.calculateKDPI({ ...REFERENCE_DONOR, creatinine_mg_dl: 2.5 });
  assert.strictEqual(
    crHigh.kdri_rao,
    Number(Math.exp(0.220 * 0.5 - 0.209 * (2.5 - 1.5)).toFixed(3))
  );
});

test('KDPI: rejects a zero donor age instead of extrapolating the age spline (L-11)', () => {
  const r = calc.calculateKDPI({ ...REFERENCE_DONOR, age_years: 0 });
  assert.strictEqual(r.kdpi, null);
  assert.strictEqual(r.reason, 'INVALID_INPUTS');
  assert.ok(r.invalid.includes('age_years'));
});

test('KDPI: every result names the reference table revision it used (H-10)', () => {
  const r = calc.calculateKDPI(REFERENCE_DONOR);
  assert.strictEqual(r.source.sourceId, 'SRC-OPTN-P8');
  assert.ok(r.source.sourceRevision, 'the source revision must be reported to the caller');
  assert.strictEqual(r.source.approximation, true, 'the percentile map is an approximation and must say so');
});

// ---------------------------------------------------------------------------
// EPTS (OPTN Policy 8.5.B; Rao PS et al. Transplantation 2009)
// ---------------------------------------------------------------------------

test('EPTS: a 25-year-old non-diabetic pre-emptive first transplant scores the published 0.130', () => {
  // age term 0 (age-25 = 0), no diabetes, no prior transplant,
  // ln(0+1) = 0, pre-emptive indicator = 1 -> xB = 0.130
  const r = calc.calculateEPTS({
    age_years: 25, diabetes: false, prior_solid_organ_transplant: false, years_on_dialysis: 0,
  });
  assert.strictEqual(r.raw, 0.13);
});

test('EPTS: published coefficients reproduced longhand for a complex candidate', () => {
  const age = 55, yod = 4;
  //   0.047*(55-25)            =  1.410
  //  -0.015*1*(55-25)          = -0.450
  //   0.398*1                  =  0.398
  //  -0.237*1*1                = -0.237
  //   0.315*ln(5)              =  0.50699
  //  -0.099*1*ln(5)            = -0.15934
  //   pre-emptive term = 0 (yod != 0)
  //   1.262*1                  =  1.262
  const expected =
    0.047 * (age - 25) - 0.015 * (age - 25) +
    0.398 - 0.237 +
    0.315 * ln(yod + 1) - 0.099 * ln(yod + 1) +
    1.262;
  const r = calc.calculateEPTS({
    age_years: age, diabetes: true, prior_solid_organ_transplant: true, years_on_dialysis: yod,
  });
  assert.strictEqual(r.raw, Number(expected.toFixed(3)));
});

test('EPTS: every result names the reference table revision it used (H-10)', () => {
  const r = calc.calculateEPTS({
    age_years: 40, diabetes: false, prior_solid_organ_transplant: false, years_on_dialysis: 2,
  });
  assert.strictEqual(r.source.sourceId, 'SRC-OPTN-P8B');
  assert.strictEqual(r.source.approximation, true);
});

// ---------------------------------------------------------------------------
// TTLI — the former "LAS"
// ---------------------------------------------------------------------------

test('TTLI: is not presented as a published instrument', () => {
  const r = calc.calculateTTLI({
    diagnosis_group: 'D', age_years: 60, bmi: 25, functional_status: 'some_assistance',
    six_minute_walk_ft: 800, continuous_o2_l_min: 3, pco2_mmHg: 45,
    on_mechanical_ventilation: false, creatinine_mg_dl: 1.0, bilirubin_mg_dl: 0.8,
  });
  assert.strictEqual(r.formula, 'TTLI');
  assert.strictEqual(r.isPublishedInstrument, false);
  assert.strictEqual(r.source.externallyValidated, false);
  assert.ok(/NOT the OPTN Lung Allocation Score/.test(r.disclaimer));
});

test('TTLI: no calculator advertises itself as producing an OPTN LAS', () => {
  assert.ok(!calc.ALL_FORMULAS.includes('LAS'), 'ALL_FORMULAS must not advertise LAS');
  assert.ok(calc.ALL_FORMULAS.includes('TTLI'));
});

// ---------------------------------------------------------------------------
// Reference-data governance (H-10)
// ---------------------------------------------------------------------------

test('every shipped reference table carries complete provenance', () => {
  const dir = referenceData.REFERENCE_DIR;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 3, 'expected reference tables to be present');
  for (const f of files) {
    const t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const key of ['tableId', 'sourceId', 'sourceTitle', 'sourceRevision', 'effectiveDate', 'reviewBy', 'status']) {
      assert.ok(t[key] !== undefined, `${f} is missing provenance field ${key}`);
    }
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(t.reviewBy), `${f} reviewBy must be an ISO date`);
  }
});

test('no active reference table is past its review date', () => {
  // This is the control that makes H-10 loud instead of silent: when an OPTN
  // table passes its annual review date the build fails until someone
  // re-checks it against the publisher and moves the date forward.
  const overdue = referenceData
    .statusReport()
    .filter((t) => t.available && t.stale);
  assert.strictEqual(
    overdue.length,
    0,
    'reference tables past review: ' +
      overdue.map((t) => `${t.tableId} (revision ${t.sourceRevision}, ${t.daysOverdue}d overdue)`).join(', ')
  );
});

test('a missing reference table produces no score rather than a substituted one', () => {
  const r = referenceData.loadTable('does-not-exist');
  assert.strictEqual(r.available, false);
  assert.strictEqual(r.reason, 'REFERENCE_DATA_UNAVAILABLE');
});

test('a stale table is reported as stale rather than silently used', () => {
  const future = new Date('2999-01-01T00:00:00Z');
  const report = referenceData.statusReport({ now: future });
  const active = report.filter((t) => t.available);
  assert.ok(active.length > 0);
  assert.ok(active.every((t) => t.stale && t.daysOverdue > 0));
});

console.log(`\n${passed} assertions passed`);
if (process.exitCode) {
  console.error('Calculator reference vector suite FAILED');
} else {
  console.log('Calculator reference vector suite PASSED');
}
