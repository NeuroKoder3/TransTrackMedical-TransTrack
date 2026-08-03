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
 * The median-KDRI scaling factor and the KDRI-to-KDPI percentile mapping are
 * OPTN-owned data republished annually. Finding H-10 recorded that embedding
 * them as literals guaranteed silent divergence. They now live in the
 * provenanced reference table `optn-kdpi` (see ./referenceData.cjs): every
 * result names the source revision it was computed against, an overdue review
 * marks the result `stale`, and an absent table produces no score at all.
 *
 * Output is a *reference value*. Allocation occurs in UNet.
 *
 * Citation: Rao PS et al. Transplantation 2009; OPTN Policy 8.5.A.
 * Controlled-source id SRC-OPTN-P8.
 */

'use strict';

const referenceData = require('./referenceData.cjs');

/**
 * Donor demographics are non-negative; a zero age is implausible for a
 * deceased donor and is rejected separately below (finding L-11).
 */
function isNonNegativeNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

function kdriToKdpi(kdriMedian, anchors) {
  for (let i = 0; i < anchors.length - 1; i++) {
    const [x0, y0] = anchors[i];
    const [x1, y1] = anchors[i + 1];
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
  if (!isNonNegativeNumber(input.age_years) || !isNonNegativeNumber(input.height_cm) ||
      !isNonNegativeNumber(input.weight_kg) || !isNonNegativeNumber(input.creatinine_mg_dl)) {
    return { kdri: null, kdpi: null, reason: 'INVALID_INPUTS', missing, formula: 'KDPI' };
  }
  // L-11: a deceased-donor age of 0 is not a plausible KDRI input. The Rao
  // model's age spline is anchored at 40 and extrapolates nonsensically at 0,
  // so accept it only as a genuine measured value above zero.
  if (input.age_years <= 0 || input.height_cm <= 0 || input.weight_kg <= 0 || input.creatinine_mg_dl <= 0) {
    return {
      kdri: null,
      kdpi: null,
      reason: 'INVALID_INPUTS',
      invalid: ['age_years', 'height_cm', 'weight_kg', 'creatinine_mg_dl'].filter(
        (f) => !(input[f] > 0)
      ),
      formula: 'KDPI',
    };
  }

  const table = referenceData.loadTable(referenceData.TABLE_IDS.KDPI);
  if (!table.available) {
    return {
      kdri: null,
      kdpi: null,
      reason: table.reason,
      message: table.message,
      formula: 'KDPI',
      source: { sourceId: 'SRC-OPTN-P8', status: table.status },
    };
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
  const kdriMedian = kdriRao / table.data.kdriMedianScalingFactor;
  const kdpi = kdriToKdpi(kdriMedian, table.data.mapping);
  const source = referenceData.provenanceOf(table);

  return {
    kdri_rao: Number(kdriRao.toFixed(3)),
    kdri_median: Number(kdriMedian.toFixed(3)),
    kdpi,
    formula: 'KDPI',
    inputs: input,
    citation: 'Rao PS et al. Transplantation 2009;88:231-236; OPTN Policy 8.5.A.',
    source,
    disclaimer:
      'Reference value only. The KDPI percentile is derived from a piecewise ' +
      'approximation of the OPTN mapping table; the decision-grade KDPI must be ' +
      'obtained from the OPTN Calculator. Do not use for allocation.' +
      (source.stale
        ? ` WARNING: the OPTN reference table in use (revision ${source.sourceRevision}) ` +
          `passed its review date ${source.reviewBy} ${source.daysOverdue} day(s) ago and may ` +
          `no longer match the current OPTN cohort.`
        : ''),
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
