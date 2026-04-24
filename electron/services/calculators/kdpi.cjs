/**
 * KDPI / KDRI — Kidney Donor Profile Index / Kidney Donor Risk Index.
 *
 * KDRI formula (Rao et al., 2009; OPTN Policy 8.5.A) — current OPTN-published
 * coefficients (effective March 2023; reference dataset year 2022):
 *
 *   xβ = 0.0128 * (age - 40)
 *      - 0.0194 * (age - 18)         if age <  18
 *      + 0.0107 * (age - 50)         if age >  50
 *      - 0.0464 * ((height - 170) / 10)
 *      - 0.0199 * ((weight - 80) / 5)   if weight <  80
 *      + 0.179  * (african_american)
 *      + 0.126  * (hypertension)
 *      + 0.130  * (diabetes)
 *      + 0.0881 * (cause_of_death == 'CVA')
 *      + 0.220  * ((creatinine - 1.0))     if creatinine ≤ 1.5
 *      - 0.209  * ((creatinine - 1.5))     if creatinine >  1.5  (additive on top of the previous)
 *      + 0.133  * (hcv_positive)
 *      + 0.133  * (dcd)
 *
 *   KDRI_RAO     = exp(xβ)
 *   KDRI_MEDIAN  = KDRI_RAO / scaling_factor       (scaling_factor = OPTN's
 *                  median KDRI for the reference cohort; published annually)
 *   KDPI         = percentile of KDRI_MEDIAN within the OPTN reference cohort
 *                  (computed by table lookup against the published mapping)
 *
 * The percentile mapping table is a published OPTN dataset that is updated
 * annually. Rather than embedding a copy that would silently go stale, we
 * compute KDRI_MEDIAN here and approximate KDPI using the reference scaling
 * factor and the cumulative-distribution approximation published in the OPTN
 * Calculator Programmer's Guide (a 5-piece linear approximation). For
 * decision-grade KDPI, customers should consult the OPTN calculator and
 * record the value directly.
 *
 * Output is a *reference value*. Allocation occurs in UNet.
 *
 * Citation: Rao PS et al. Transplantation 2009; OPTN Policy 8.5.A.
 */

'use strict';

// Reference scaling factor — KDRI_MEDIAN at published reference cohort.
// Updated annually by OPTN; review before each release.
const KDRI_MEDIAN_SCALING_FACTOR = 1.32; // 2022 reference cohort.

// 5-segment piecewise linear approximation of the KDRI_MEDIAN → KDPI(%) map.
// Based on the OPTN Calculator Programmer's Guide (2022 reference cohort).
// Anchors: (KDRI, KDPI%)
const KDPI_ANCHORS = [
  [0.50, 0],
  [0.85, 25],
  [1.00, 50],
  [1.30, 75],
  [1.65, 90],
  [2.50, 100],
];

function isPositiveNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

function kdriToKdpi(kdriMedian) {
  for (let i = 0; i < KDPI_ANCHORS.length - 1; i++) {
    const [x0, y0] = KDPI_ANCHORS[i];
    const [x1, y1] = KDPI_ANCHORS[i + 1];
    if (kdriMedian <= x1) {
      const t = (kdriMedian - x0) / (x1 - x0);
      return Math.max(0, Math.min(100, Math.round(y0 + t * (y1 - y0))));
    }
  }
  return 100;
}

/**
 * Compute KDRI and KDPI for a deceased donor.
 *
 * Inputs:
 *   age_years:        number
 *   height_cm:        number
 *   weight_kg:        number
 *   african_american: boolean
 *   hypertension:     boolean
 *   diabetes:         boolean
 *   cause_of_death:   'CVA' | 'TRAUMA' | 'ANOXIA' | 'OTHER'
 *   creatinine_mg_dl: number
 *   hcv_positive:     boolean
 *   dcd:              boolean   (Donation after Circulatory Death)
 */
function calculateKDPI(input) {
  const required = [
    'age_years', 'height_cm', 'weight_kg', 'african_american', 'hypertension',
    'diabetes', 'cause_of_death', 'creatinine_mg_dl', 'hcv_positive', 'dcd',
  ];
  const missing = required.filter(f => input[f] === undefined || input[f] === null);
  if (missing.length) {
    return { kdri: null, kdpi: null, reason: 'INSUFFICIENT_DATA', missing, formula: 'KDPI' };
  }
  if (!isPositiveNumber(input.age_years) || !isPositiveNumber(input.height_cm) ||
      !isPositiveNumber(input.weight_kg) || !isPositiveNumber(input.creatinine_mg_dl)) {
    return { kdri: null, kdpi: null, reason: 'INVALID_INPUTS', missing, formula: 'KDPI' };
  }

  const age = input.age_years;
  const cr = input.creatinine_mg_dl;

  let xb =
    0.0128 * (age - 40) +
    -0.0464 * ((input.height_cm - 170) / 10) +
    (input.african_american ? 0.179 : 0) +
    (input.hypertension ? 0.126 : 0) +
    (input.diabetes ? 0.130 : 0) +
    (input.cause_of_death === 'CVA' ? 0.0881 : 0) +
    (input.hcv_positive ? 0.133 : 0) +
    (input.dcd ? 0.133 : 0);

  if (age < 18) xb += -0.0194 * (age - 18);
  if (age > 50) xb += 0.0107 * (age - 50);
  if (input.weight_kg < 80) xb += -0.0199 * ((input.weight_kg - 80) / 5);

  if (cr <= 1.5) {
    xb += 0.220 * (cr - 1.0);
  } else {
    xb += 0.220 * (1.5 - 1.0);
    xb += -0.209 * (cr - 1.5);
  }

  const kdriRao = Math.exp(xb);
  const kdriMedian = kdriRao / KDRI_MEDIAN_SCALING_FACTOR;
  const kdpi = kdriToKdpi(kdriMedian);

  return {
    kdri_rao: Number(kdriRao.toFixed(3)),
    kdri_median: Number(kdriMedian.toFixed(3)),
    kdpi,
    formula: 'KDPI',
    inputs: input,
    citation: 'Rao PS et al. Transplantation 2009;88:231-236; OPTN Policy 8.5.A.',
    disclaimer: 'Reference value only. KDPI percentile is approximated. The decision-grade KDPI must be obtained from the OPTN Calculator. Do not use for allocation.',
  };
}

module.exports = {
  calculateKDPI,
  REQUIRED_FIELDS: {
    KDPI: [
      'age_years', 'height_cm', 'weight_kg', 'african_american', 'hypertension',
      'diabetes', 'cause_of_death', 'creatinine_mg_dl', 'hcv_positive', 'dcd',
    ],
  },
};
