/**
 * TransTrack Lung Triage Index (TTLI) — an internal operational triage score.
 *
 * THIS IS NOT THE LUNG ALLOCATION SCORE. It is not the OPTN LAS, it is not the
 * Composite Allocation Score, and its output will not match either.
 *
 * Finding C-3 recorded that this module was presented as "LAS" while
 * implementing an invented heuristic: multiplicative adjustments applied to a
 * diagnosis-group base hazard, mapped through an arbitrary linear transform.
 * The multipliers and the transform correspond to no published coefficient set.
 * Naming it after a published clinical score gave its output an authority the
 * evidence base does not support, so the score has been renamed to something
 * that cannot be mistaken for a published instrument.
 *
 * What it actually is: an ordinal 0-100 triage indicator that ranks a centre's
 * own lung candidates by a coarse notion of urgency, for internal worklist
 * ordering. Its constants are expert-set, not fitted, and it has no published
 * derivation or external validation.
 *
 * What it is not, and must never be used as:
 *   - the OPTN Lung Allocation Score (retired for allocation in March 2023),
 *   - the Composite Allocation Score (computed centrally in UNet and not
 *     reproducible outside it),
 *   - any input to an allocation, listing or clinical decision.
 *
 * A centre that needs a real LAS or CAS value must obtain it from UNet and
 * record it as an opaque value in patient.las_score. TransTrack does not
 * compute it.
 *
 * Controlled-source id: SRC-INTERNAL-TTLI (an internal instrument; the register
 * entry in docs/compliance/CLINICAL_SOURCES.md records that it has no external
 * source and no validation evidence).
 */

'use strict';

// LAS diagnosis groups (OPTN Policy 10.1.B)
const DIAGNOSIS_GROUPS = {
  A: { name: 'Obstructive lung disease (e.g., COPD, alpha-1)', baseHazard: 1.00 },
  B: { name: 'Pulmonary vascular disease (e.g., IPAH)', baseHazard: 1.40 },
  C: { name: 'Cystic fibrosis & immunodeficiency disorders', baseHazard: 1.30 },
  D: { name: 'Restrictive lung disease (e.g., IPF)', baseHazard: 1.55 },
};

function isPositiveNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/**
 * Compute the TransTrack Lung Triage Index.
 *
 * Returns:
 *   { score: <number 0..100>, formula: 'TTLI', inputs, disclaimer } or
 *   { score: null, reason: 'INSUFFICIENT_DATA', missing, formula }.
 *
 * Inputs:
 *   diagnosis_group:   'A' | 'B' | 'C' | 'D'
 *   age_years:         number
 *   bmi:               number
 *   functional_status: 'no_assistance' | 'some_assistance' | 'total_assistance'
 *   diabetes:          boolean
 *   six_minute_walk_ft:           number (feet)
 *   continuous_o2_l_min:          number (L/min, 0 if room air)
 *   pco2_mmHg:                    number
 *   pap_systolic_mmHg:            number (echo or RHC)
 *   on_mechanical_ventilation:    boolean
 *   creatinine_mg_dl:             number
 *   bilirubin_mg_dl:              number
 */
function calculateLAS(input) {
  const required = [
    'diagnosis_group', 'age_years', 'bmi', 'functional_status',
    'six_minute_walk_ft', 'continuous_o2_l_min', 'pco2_mmHg',
    'on_mechanical_ventilation', 'creatinine_mg_dl', 'bilirubin_mg_dl',
  ];
  const missing = required.filter(f => input[f] === undefined || input[f] === null);
  if (missing.length) {
    return { score: null, reason: 'INSUFFICIENT_DATA', missing, formula: 'TTLI' };
  }

  const dx = DIAGNOSIS_GROUPS[input.diagnosis_group];
  if (!dx) {
    return { score: null, reason: 'INVALID_DIAGNOSIS_GROUP', missing: ['diagnosis_group'], formula: 'TTLI' };
  }
  if (!isPositiveNumber(input.age_years) || !isPositiveNumber(input.bmi)) {
    return { score: null, reason: 'INSUFFICIENT_DATA', missing, formula: 'TTLI' };
  }

  // Reference urgency contribution (relative hazard).
  let urgency = dx.baseHazard;

  // Functional status — Karnofsky-like adjustment.
  if (input.functional_status === 'total_assistance') urgency *= 1.6;
  else if (input.functional_status === 'some_assistance') urgency *= 1.2;

  // Mechanical ventilation strongly increases waitlist mortality.
  if (input.on_mechanical_ventilation) urgency *= 2.5;

  // Six-minute walk (lower = sicker). Reference at 1200 ft.
  const walk = Math.max(0, input.six_minute_walk_ft);
  urgency *= 1 + Math.max(0, (1200 - walk) / 1200) * 0.5;

  // Continuous oxygen requirement.
  urgency *= 1 + Math.min(input.continuous_o2_l_min, 10) * 0.05;

  // Hypercapnia.
  if (input.pco2_mmHg > 50) urgency *= 1.2;

  // Pulmonary hypertension (group B/D weights).
  if (input.pap_systolic_mmHg && input.pap_systolic_mmHg > 50) urgency *= 1.15;

  // Diabetes modest contribution.
  if (input.diabetes) urgency *= 1.05;

  // Renal / hepatic function modest contribution.
  if (input.creatinine_mg_dl > 2.0) urgency *= 1.1;
  if (input.bilirubin_mg_dl > 2.0) urgency *= 1.1;

  // Map the expert-set relative hazard (expected range ~1.0-8.0) onto an
  // ordinal 0..100 worklist position. The transform is arbitrary and exists
  // only to make the index comparable between candidates at the same centre.
  const score = Math.max(0, Math.min(100, Math.round((urgency - 1) * 15 + 30)));

  return {
    score,
    formula: 'TTLI',
    scoreName: 'TransTrack Lung Triage Index',
    isPublishedInstrument: false,
    inputs: input,
    source: {
      sourceId: 'SRC-INTERNAL-TTLI',
      sourceRevision: 'TransTrack internal, expert-set constants, no external validation',
      externallyValidated: false,
    },
    disclaimer:
      'TransTrack Lung Triage Index — an internal operational triage indicator. ' +
      'It is NOT the OPTN Lung Allocation Score and NOT the Composite Allocation ' +
      'Score, and it will not match either. Its constants are expert-set, not ' +
      'derived from a published model, and it has no external validation. ' +
      'Use for internal worklist ordering only. Obtain LAS/CAS from UNet.',
  };
}

const TTLI_FIELDS = [
  'diagnosis_group', 'age_years', 'bmi', 'functional_status',
  'six_minute_walk_ft', 'continuous_o2_l_min', 'pco2_mmHg',
  'on_mechanical_ventilation', 'creatinine_mg_dl', 'bilirubin_mg_dl',
];

module.exports = {
  calculateTTLI: calculateLAS,
  // Legacy export name, kept so existing callers keep working. It returns the
  // same TTLI result, explicitly flagged as not a published instrument.
  calculateLAS,
  DIAGNOSIS_GROUPS,
  REQUIRED_FIELDS: {
    TTLI: TTLI_FIELDS,
    LAS: TTLI_FIELDS,
  },
};
