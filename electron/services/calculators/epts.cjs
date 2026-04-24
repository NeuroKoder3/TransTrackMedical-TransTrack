/**
 * EPTS — Estimated Post-Transplant Survival, kidney candidates.
 *
 * Raw EPTS (Rao 2009 model, OPTN Policy 8.5.B):
 *
 *   xβ = 0.047 * max(age - 25, 0)
 *      - 0.015 * (diabetes) * max(age - 25, 0)
 *      + 0.398 * (prior_solid_organ_transplant)
 *      - 0.237 * (diabetes) * (prior_solid_organ_transplant)
 *      + 0.315 * ln(years_on_dialysis + 1)
 *      - 0.099 * (diabetes) * ln(years_on_dialysis + 1)
 *      + 0.130 * (years_on_dialysis == 0)
 *      - 0.348 * (diabetes) * (years_on_dialysis == 0)
 *      + 1.262 * (diabetes)
 *
 *   raw_EPTS = xβ
 *   EPTS_PCT = percentile of raw_EPTS in OPTN reference cohort (annually
 *              published table; lower percentile = better predicted survival)
 *
 * Output is a *reference value*. Allocation occurs in UNet.
 *
 * Citation: Rao PS et al. Transplantation 2009; OPTN Policy 8.5.B.
 */

'use strict';

// 5-segment piecewise linear approximation of raw_EPTS → EPTS_PCT (%).
// Lower raw EPTS → lower percentile → better expected outcomes.
// Anchors derived from OPTN Calculator Programmer's Guide (2022 cohort).
const EPTS_ANCHORS = [
  [-0.50, 0],
  [ 0.30, 20],
  [ 0.95, 50],
  [ 1.55, 80],
  [ 2.10, 95],
  [ 3.00, 100],
];

function isFiniteNumber(v) { return typeof v === 'number' && Number.isFinite(v); }

function rawToPct(raw) {
  for (let i = 0; i < EPTS_ANCHORS.length - 1; i++) {
    const [x0, y0] = EPTS_ANCHORS[i];
    const [x1, y1] = EPTS_ANCHORS[i + 1];
    if (raw <= x1) {
      const t = (raw - x0) / (x1 - x0);
      return Math.max(0, Math.min(100, Math.round(y0 + t * (y1 - y0))));
    }
  }
  return 100;
}

/**
 * Inputs:
 *   age_years:                       number
 *   diabetes:                        boolean
 *   prior_solid_organ_transplant:    boolean
 *   years_on_dialysis:               number  (0 = pre-emptive)
 */
function calculateEPTS({ age_years, diabetes, prior_solid_organ_transplant, years_on_dialysis }) {
  const missing = [];
  if (!isFiniteNumber(age_years) || age_years < 0) missing.push('age_years');
  if (typeof diabetes !== 'boolean') missing.push('diabetes');
  if (typeof prior_solid_organ_transplant !== 'boolean') missing.push('prior_solid_organ_transplant');
  if (!isFiniteNumber(years_on_dialysis) || years_on_dialysis < 0) missing.push('years_on_dialysis');
  if (missing.length) return { raw: null, epts_pct: null, reason: 'INSUFFICIENT_DATA', missing, formula: 'EPTS' };

  const ageOver25 = Math.max(age_years - 25, 0);
  const dx = diabetes ? 1 : 0;
  const prior = prior_solid_organ_transplant ? 1 : 0;
  const yod = years_on_dialysis;
  const preemptive = (yod === 0) ? 1 : 0;

  const xb =
    0.047 * ageOver25 +
    -0.015 * dx * ageOver25 +
    0.398 * prior +
    -0.237 * dx * prior +
    0.315 * Math.log(yod + 1) +
    -0.099 * dx * Math.log(yod + 1) +
    0.130 * preemptive +
    -0.348 * dx * preemptive +
    1.262 * dx;

  return {
    raw: Number(xb.toFixed(3)),
    epts_pct: rawToPct(xb),
    formula: 'EPTS',
    inputs: { age_years, diabetes, prior_solid_organ_transplant, years_on_dialysis },
    citation: 'Rao PS et al. Transplantation 2009; OPTN Policy 8.5.B.',
    disclaimer: 'Reference value only. EPTS percentile is approximated. The decision-grade EPTS must be obtained from the OPTN Calculator. Do not use for allocation.',
  };
}

module.exports = {
  calculateEPTS,
  REQUIRED_FIELDS: {
    EPTS: ['age_years', 'diabetes', 'prior_solid_organ_transplant', 'years_on_dialysis'],
  },
};
