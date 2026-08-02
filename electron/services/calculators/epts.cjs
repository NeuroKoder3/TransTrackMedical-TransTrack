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

const referenceData = require('./referenceData.cjs');

function isFiniteNumber(v) { return typeof v === 'number' && Number.isFinite(v); }

function rawToPct(raw, anchors) {
  for (let i = 0; i < anchors.length - 1; i++) {
    const [x0, y0] = anchors[i];
    const [x1, y1] = anchors[i + 1];
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

  const table = referenceData.loadTable(referenceData.TABLE_IDS.EPTS);
  if (!table.available) {
    return {
      raw: null,
      epts_pct: null,
      reason: table.reason,
      message: table.message,
      formula: 'EPTS',
      source: { sourceId: 'SRC-OPTN-P8B', status: table.status },
    };
  }

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

  const source = referenceData.provenanceOf(table);

  return {
    raw: Number(xb.toFixed(3)),
    epts_pct: rawToPct(xb, table.data.mapping),
    formula: 'EPTS',
    inputs: { age_years, diabetes, prior_solid_organ_transplant, years_on_dialysis },
    citation: 'Rao PS et al. Transplantation 2009; OPTN Policy 8.5.B.',
    source,
    disclaimer:
      'Reference value only. The EPTS percentile is derived from a piecewise ' +
      'approximation of the OPTN mapping table; the decision-grade EPTS must be ' +
      'obtained from the OPTN Calculator. Do not use for allocation.' +
      (source.stale
        ? ` WARNING: the OPTN reference table in use (revision ${source.sourceRevision}) ` +
          `passed its review date ${source.reviewBy} ${source.daysOverdue} day(s) ago and may ` +
          `no longer match the current OPTN cohort.`
        : ''),
  };
}

module.exports = {
  calculateEPTS,
  REQUIRED_FIELDS: {
    EPTS: ['age_years', 'diabetes', 'prior_solid_organ_transplant', 'years_on_dialysis'],
  },
};
