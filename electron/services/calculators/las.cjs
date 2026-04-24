/**
 * Lung Allocation Score (LAS) — adult, 2005 OPTN formula.
 *
 * NOTE: OPTN replaced LAS with the **Composite Allocation Score (CAS)** for
 * lungs in March 2023. Many transplant programs still record LAS as a
 * reference value; CAS is computed centrally by UNet and is not reproducible
 * outside that system. This module computes the *legacy LAS* as a reference
 * value only.
 *
 * For programmatic use:
 *   - Output is a *reference value*, not the official OPTN-submitted score.
 *   - Returns { score: null, reason: 'INSUFFICIENT_DATA' } when inputs are
 *     missing.
 *
 * The full LAS formula uses Cox proportional-hazards survival models for
 * waitlist-without-transplant urgency and post-transplant survival benefit.
 * A faithful, accreditation-grade reproduction of the full Cox model is
 * outside the scope of this reference module; this implementation returns
 * the **diagnosis-group base contribution + clinical multipliers**, which is
 * the form most commonly recorded in pre-listing operational notes.
 *
 * If a center requires the full LAS formula for any decision-supporting use,
 * it must be supplied by an externally-validated source and entered as an
 * opaque value via the patient.las_score field.
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
 * Compute the legacy LAS reference value.
 *
 * Returns:
 *   { score: <number 0..100>, formula: 'LAS-REF', inputs, citation, disclaimer }
 *   or { score: null, reason: 'INSUFFICIENT_DATA', missing, formula }.
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
    return { score: null, reason: 'INSUFFICIENT_DATA', missing, formula: 'LAS-REF' };
  }

  const dx = DIAGNOSIS_GROUPS[input.diagnosis_group];
  if (!dx) {
    return { score: null, reason: 'INVALID_DIAGNOSIS_GROUP', missing: ['diagnosis_group'], formula: 'LAS-REF' };
  }
  if (!isPositiveNumber(input.age_years) || !isPositiveNumber(input.bmi)) {
    return { score: null, reason: 'INSUFFICIENT_DATA', missing, formula: 'LAS-REF' };
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

  // Map urgency (relative hazard, expected range ~1.0–8.0) to LAS-style 0..100.
  const score = Math.max(0, Math.min(100, Math.round((urgency - 1) * 15 + 30)));

  return {
    score,
    formula: 'LAS-REF',
    inputs: input,
    citation: 'OPTN Policy 10 (legacy LAS, 2005); CAS replaced LAS effective 2023-03-09.',
    disclaimer: 'Reference value only. The official LAS / CAS is computed by UNet and may differ. Do not use for allocation.',
  };
}

module.exports = {
  calculateLAS,
  DIAGNOSIS_GROUPS,
  REQUIRED_FIELDS: {
    LAS: [
      'diagnosis_group', 'age_years', 'bmi', 'functional_status',
      'six_minute_walk_ft', 'continuous_o2_l_min', 'pco2_mmHg',
      'on_mechanical_ventilation', 'creatinine_mg_dl', 'bilirubin_mg_dl',
    ],
  },
};
