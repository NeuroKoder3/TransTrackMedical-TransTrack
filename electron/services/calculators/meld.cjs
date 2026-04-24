/**
 * MELD score calculators (MELD, MELD-Na, MELD 3.0, PELD)
 *
 * These are reference implementations of published OPTN scoring formulas.
 * They are deterministic, side-effect-free, and unit-tested.
 *
 * Outputs are *reference values* for the operational workflow. They are NOT
 * official OPTN-submitted scores and shall not be used as the basis for
 * organ allocation. Allocation occurs in UNet.
 *
 * Per the deploying organization's SRS: when any required input is missing
 * the calculators return { score: null, reason: 'INSUFFICIENT_DATA', ... }
 * rather than substituting defaults.
 */

'use strict';

// MELD lab clamping per OPTN policy: floor at 1.0 mg/dL for creatinine and
// bilirubin, and at 1.0 for INR. Creatinine ceiling at 4.0 mg/dL (also when
// dialysis ≥2x in past week).
function clampMeldLab(value, { min = 1.0, max = Infinity } = {}) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function isPositiveNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/**
 * MELD (original, pre-2016).
 *
 * MELD = round(0.957 * ln(creatinine) + 0.378 * ln(bilirubin) +
 *              1.120 * ln(INR) + 0.643) * 10
 * - Lab values clamped to ≥1.0
 * - Creatinine clamped to ≤4.0; if dialysis≥2x/week, creatinine := 4.0
 * - Score capped at 40
 *
 * Citation: Kamath PS, Wiesner RH, Malinchoc M, et al. A model to predict
 * survival in patients with end-stage liver disease. Hepatology. 2001;33:464–70.
 */
function calculateMELD({ creatinine_mg_dl, bilirubin_mg_dl, inr, dialysis_twice_in_week = false }) {
  if (!isPositiveNumber(creatinine_mg_dl) || !isPositiveNumber(bilirubin_mg_dl) || !isPositiveNumber(inr)) {
    return { score: null, reason: 'INSUFFICIENT_DATA', missing: missingMeldFields({ creatinine_mg_dl, bilirubin_mg_dl, inr }) };
  }

  const cr = dialysis_twice_in_week ? 4.0 : clampMeldLab(creatinine_mg_dl, { min: 1.0, max: 4.0 });
  const bili = clampMeldLab(bilirubin_mg_dl, { min: 1.0 });
  const inrV = clampMeldLab(inr, { min: 1.0 });

  const raw = 0.957 * Math.log(cr) + 0.378 * Math.log(bili) + 1.120 * Math.log(inrV) + 0.643;
  let score = Math.round(raw * 10);
  if (score > 40) score = 40;
  if (score < 6) score = 6;

  return {
    score,
    formula: 'MELD',
    inputs: { creatinine: cr, bilirubin: bili, inr: inrV, dialysis_twice_in_week },
    citation: 'Kamath PS et al. Hepatology 2001;33:464-470.',
  };
}

function missingMeldFields({ creatinine_mg_dl, bilirubin_mg_dl, inr }) {
  const missing = [];
  if (!isPositiveNumber(creatinine_mg_dl)) missing.push('creatinine_mg_dl');
  if (!isPositiveNumber(bilirubin_mg_dl)) missing.push('bilirubin_mg_dl');
  if (!isPositiveNumber(inr)) missing.push('inr');
  return missing;
}

/**
 * MELD-Na (UNOS, 2016).
 *
 * If MELD ≤11: score = MELD.
 * Else: MELD-Na = MELD + 1.32 * (137 - Na) - [0.033 * MELD * (137 - Na)]
 *   - Na clamped to [125, 137]
 *   - Final score capped at 40
 *
 * Citation: Kim WR et al. NEJM 2008;359:1018-1026; OPTN Policy 9.
 */
function calculateMELDNa({ creatinine_mg_dl, bilirubin_mg_dl, inr, sodium_meq_l, dialysis_twice_in_week = false }) {
  const meld = calculateMELD({ creatinine_mg_dl, bilirubin_mg_dl, inr, dialysis_twice_in_week });
  if (meld.score === null) return { ...meld, formula: 'MELD-Na' };
  if (!isPositiveNumber(sodium_meq_l)) {
    return { score: null, reason: 'INSUFFICIENT_DATA', missing: ['sodium_meq_l'], formula: 'MELD-Na' };
  }
  if (meld.score <= 11) {
    return { ...meld, formula: 'MELD-Na' };
  }
  const na = Math.max(125, Math.min(137, sodium_meq_l));
  const raw = meld.score + 1.32 * (137 - na) - 0.033 * meld.score * (137 - na);
  let score = Math.round(raw);
  if (score > 40) score = 40;
  if (score < 6) score = 6;
  return {
    score,
    formula: 'MELD-Na',
    inputs: { ...meld.inputs, sodium: na, base_meld: meld.score },
    citation: 'Kim WR et al. NEJM 2008;359:1018-1026.',
  };
}

/**
 * MELD 3.0 (OPTN, effective July 2023).
 *
 * MELD 3.0 = 1.33 * (female) + 4.56 * ln(bili) + 0.82 * (137 - Na)
 *          - 0.24 * (137 - Na) * ln(bili) + 9.09 * ln(INR)
 *          + 11.14 * ln(creat) + 1.85 * (3.5 - albumin)
 *          - 1.83 * (3.5 - albumin) * ln(creat) + 6
 * - female: 1 if female, 0 otherwise
 * - bili clamped ≥1.0
 * - INR clamped ≥1.0
 * - creat clamped to [1.0, 3.0]; dialysis 2x/week → creat := 3.0
 * - Na clamped to [125, 137]
 * - albumin clamped to [1.5, 3.5]
 * - Final score capped at 40
 *
 * Citation: Kim WR et al. Gastroenterology 2021;161(6):1887-1895; OPTN Policy 9.1.D.
 */
function calculateMELD3({ creatinine_mg_dl, bilirubin_mg_dl, inr, sodium_meq_l, albumin_g_dl, sex, dialysis_twice_in_week = false }) {
  const missing = [];
  if (!isPositiveNumber(creatinine_mg_dl)) missing.push('creatinine_mg_dl');
  if (!isPositiveNumber(bilirubin_mg_dl)) missing.push('bilirubin_mg_dl');
  if (!isPositiveNumber(inr)) missing.push('inr');
  if (!isPositiveNumber(sodium_meq_l)) missing.push('sodium_meq_l');
  if (!isPositiveNumber(albumin_g_dl)) missing.push('albumin_g_dl');
  if (!sex || !['male', 'female', 'M', 'F'].includes(sex)) missing.push('sex');
  if (missing.length) return { score: null, reason: 'INSUFFICIENT_DATA', missing, formula: 'MELD-3.0' };

  const female = (sex === 'female' || sex === 'F') ? 1 : 0;
  const cr = dialysis_twice_in_week ? 3.0 : clampMeldLab(creatinine_mg_dl, { min: 1.0, max: 3.0 });
  const bili = clampMeldLab(bilirubin_mg_dl, { min: 1.0 });
  const inrV = clampMeldLab(inr, { min: 1.0 });
  const na = Math.max(125, Math.min(137, sodium_meq_l));
  const alb = Math.max(1.5, Math.min(3.5, albumin_g_dl));

  const raw =
    1.33 * female +
    4.56 * Math.log(bili) +
    0.82 * (137 - na) -
    0.24 * (137 - na) * Math.log(bili) +
    9.09 * Math.log(inrV) +
    11.14 * Math.log(cr) +
    1.85 * (3.5 - alb) -
    1.83 * (3.5 - alb) * Math.log(cr) +
    6;
  let score = Math.round(raw);
  if (score > 40) score = 40;
  if (score < 6) score = 6;
  return {
    score,
    formula: 'MELD-3.0',
    inputs: { creatinine: cr, bilirubin: bili, inr: inrV, sodium: na, albumin: alb, female, dialysis_twice_in_week },
    citation: 'Kim WR et al. Gastroenterology 2021;161:1887-1895.',
  };
}

/**
 * PELD (Pediatric End-Stage Liver Disease) — patients <12 years old.
 *
 * PELD = 4.80 * ln(bilirubin) + 18.57 * ln(INR) - 6.87 * ln(albumin)
 *      + 4.36 * (age <1 year)
 *      + 6.67 * (growth_failure: <2 SD)
 *
 * Citation: McDiarmid SV et al. Transplantation 2002;74(2):173-181;
 * OPTN Policy 9.1.E.
 */
function calculatePELD({ bilirubin_mg_dl, inr, albumin_g_dl, age_years, growth_failure }) {
  const missing = [];
  if (!isPositiveNumber(bilirubin_mg_dl)) missing.push('bilirubin_mg_dl');
  if (!isPositiveNumber(inr)) missing.push('inr');
  if (!isPositiveNumber(albumin_g_dl)) missing.push('albumin_g_dl');
  if (typeof age_years !== 'number' || !Number.isFinite(age_years) || age_years < 0) missing.push('age_years');
  if (typeof growth_failure !== 'boolean') missing.push('growth_failure');
  if (missing.length) return { score: null, reason: 'INSUFFICIENT_DATA', missing, formula: 'PELD' };
  if (age_years >= 12) {
    return { score: null, reason: 'PELD_NOT_APPLICABLE', message: 'PELD applies to patients under 12 years old; use MELD/MELD-Na/MELD-3.0 instead.', formula: 'PELD' };
  }

  const bili = clampMeldLab(bilirubin_mg_dl, { min: 1.0 });
  const inrV = clampMeldLab(inr, { min: 1.0 });
  const alb = clampMeldLab(albumin_g_dl, { min: 1.0 });
  const ageBonus = age_years < 1 ? 4.36 : 0;
  const growthBonus = growth_failure ? 6.67 : 0;

  const raw = 4.80 * Math.log(bili) + 18.57 * Math.log(inrV) - 6.87 * Math.log(alb) + ageBonus + growthBonus;
  let score = Math.round(raw);
  if (score < 0) score = 0;
  if (score > 40) score = 40;
  return {
    score,
    formula: 'PELD',
    inputs: { bilirubin: bili, inr: inrV, albumin: alb, age_years, growth_failure },
    citation: 'McDiarmid SV et al. Transplantation 2002;74:173-181.',
  };
}

module.exports = {
  calculateMELD,
  calculateMELDNa,
  calculateMELD3,
  calculatePELD,
  REQUIRED_FIELDS: {
    MELD: ['creatinine_mg_dl', 'bilirubin_mg_dl', 'inr'],
    'MELD-Na': ['creatinine_mg_dl', 'bilirubin_mg_dl', 'inr', 'sodium_meq_l'],
    'MELD-3.0': ['creatinine_mg_dl', 'bilirubin_mg_dl', 'inr', 'sodium_meq_l', 'albumin_g_dl', 'sex'],
    PELD: ['bilirubin_mg_dl', 'inr', 'albumin_g_dl', 'age_years', 'growth_failure'],
  },
};
