/**
 * TransTrack — Clinical Data Validators
 *
 * Single authority for clinical range and domain validation. Shared by:
 *   - the Electron IPC entity layer      (electron/ipc/handlers/entities.cjs)
 *   - HL7 v2 ingestion                   (electron/services/hl7Ingest.cjs)
 *   - FHIR import                        (electron/functions/index.cjs)
 *   - the server REST tier               (server/src/services/patientService.js)
 *
 * Every persistence path MUST call validateEntity() before writing. Validation
 * that exists only in the renderer is bypassable by IPC, REST, FHIR, HL7 and
 * CSV import and is therefore not validation at all (finding C-4).
 *
 * Ranges are traceable to the controlled-source register in
 * docs/compliance/CLINICAL_SOURCES.md. Each entry below names the source id.
 */

'use strict';

/**
 * Numeric score ranges.
 *
 * MELD / MELD-Na / MELD 3.0 : 6..40      (SRC-OPTN-P9, OPTN Policy 9.1.D)
 * PELD                      : 0..40      (SRC-OPTN-P9, OPTN Policy 9.1.E)
 * LAS-REF                   : 0..100     (SRC-INTERNAL-LASREF — see note in
 *                                         electron/services/calculators/las.cjs;
 *                                         this is a TransTrack reference score,
 *                                         not the OPTN LAS)
 * PRA / CPRA                : 0..100     (percentage, by definition)
 * KDPI / EPTS               : 0..100     (percentile, by definition)
 */
const SCORE_RANGES = {
  MELD:  { min: 6, max: 40,  source: 'SRC-OPTN-P9', description: 'Model for End-Stage Liver Disease' },
  MELDNA:{ min: 6, max: 40,  source: 'SRC-OPTN-P9', description: 'MELD-Na' },
  MELD3: { min: 6, max: 40,  source: 'SRC-OPTN-P9', description: 'MELD 3.0' },
  PELD:  { min: 0, max: 40,  source: 'SRC-OPTN-P9', description: 'Pediatric End-Stage Liver Disease' },
  LAS:   { min: 0, max: 100, source: 'SRC-INTERNAL-LASREF', description: 'Lung Allocation reference score (LAS-REF)' },
  PRA:   { min: 0, max: 100, source: 'SRC-DEF-PCT', description: 'Panel Reactive Antibodies' },
  CPRA:  { min: 0, max: 100, source: 'SRC-DEF-PCT', description: 'Calculated Panel Reactive Antibodies' },
  EPTS:  { min: 0, max: 100, source: 'SRC-DEF-PCT', description: 'Estimated Post-Transplant Survival percentile' },
  KDPI:  { min: 0, max: 100, source: 'SRC-DEF-PCT', description: 'Kidney Donor Profile Index percentile' },
};

const VALID_BLOOD_TYPES = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];

const VALID_URGENCY_LEVELS = ['critical', 'high', 'medium', 'low'];

const VALID_ORGAN_TYPES = ['kidney', 'liver', 'heart', 'lung', 'pancreas', 'intestine'];

/** Plausibility bound for a human lifespan, used to reject impossible dates. */
const MAX_AGE_YEARS = 130;

/**
 * Laboratory analyte plausibility bounds, expressed in the canonical unit the
 * calculators consume. Values outside these bounds are almost certainly a unit
 * error or a transcription error and are rejected rather than silently scored
 * (finding C-3: no unit-system validation existed anywhere in the pipeline).
 *
 * Bounds are deliberately wide — they reject the physically impossible, not the
 * clinically unusual.
 */
const LAB_BOUNDS = {
  bilirubin_mg_dl:  { min: 0.01, max: 100,  unit: 'mg/dL' },
  creatinine_mg_dl: { min: 0.01, max: 30,   unit: 'mg/dL' },
  albumin_g_dl:     { min: 0.1,  max: 8,    unit: 'g/dL' },
  sodium_meq_l:     { min: 90,   max: 200,  unit: 'mEq/L' },
  inr:              { min: 0.1,  max: 20,   unit: 'ratio' },
  height_cm:        { min: 20,   max: 260,  unit: 'cm' },
  weight_kg:        { min: 0.3,  max: 400,  unit: 'kg' },
  age_years:        { min: 0,    max: MAX_AGE_YEARS, unit: 'years' },
};

function ok(value) {
  return { valid: true, value };
}

function fail(error) {
  return { valid: false, error };
}

function validateNumericScore(value, scoreName) {
  const range = SCORE_RANGES[scoreName];
  if (!range) return fail(`Unknown score type: ${scoreName}`);

  if (value === null || value === undefined || value === '') return ok(null);

  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fail(`${scoreName} score must be a finite number, got: ${JSON.stringify(value)}`);
  }

  if (num < range.min || num > range.max) {
    return fail(`${scoreName} score must be between ${range.min} and ${range.max}, got: ${num}`);
  }

  return ok(num);
}

const validateMELDScore = (v) => validateNumericScore(v, 'MELD');
const validateLASScore = (v) => validateNumericScore(v, 'LAS');
const validatePRAScore = (v) => validateNumericScore(v, 'PRA');
const validateCPRAScore = (v) => validateNumericScore(v, 'CPRA');
const validatePELDScore = (v) => validateNumericScore(v, 'PELD');
const validateKDPIScore = (v) => validateNumericScore(v, 'KDPI');
const validateEPTSScore = (v) => validateNumericScore(v, 'EPTS');

function validateBloodType(value) {
  if (!value) return ok(null);
  if (!VALID_BLOOD_TYPES.includes(value)) {
    return fail(`Invalid blood type: "${value}". Valid: ${VALID_BLOOD_TYPES.join(', ')}`);
  }
  return ok(value);
}

function validateUrgencyLevel(value) {
  if (!value) return ok(null);
  if (!VALID_URGENCY_LEVELS.includes(value)) {
    return fail(`Invalid urgency level: "${value}". Valid: ${VALID_URGENCY_LEVELS.join(', ')}`);
  }
  return ok(value);
}

function validateOrganType(value) {
  if (!value) return ok(null);
  if (!VALID_ORGAN_TYPES.includes(value)) {
    return fail(`Invalid organ type: "${value}". Valid: ${VALID_ORGAN_TYPES.join(', ')}`);
  }
  return ok(value);
}

/**
 * Validate an HLA typing string.
 * Accepts formats like "A2 A24 B7 B44 DR4 DR11" or "A*02:01,B*07:02"
 */
function validateHLATyping(value) {
  if (!value || typeof value !== 'string') return ok(null);

  const trimmed = value.trim();
  if (trimmed.length === 0) return ok(null);
  if (trimmed.length > 500) {
    return fail('HLA typing string exceeds maximum length of 500 characters');
  }

  const antigens = trimmed.split(/[\s,;]+/).filter(Boolean);
  if (antigens.length > 20) {
    return fail(`Too many HLA antigens: ${antigens.length} (max 20)`);
  }

  const hlaPattern = /^[A-Z]{1,3}\*?\d{1,4}(:\d{1,4})?(:[A-Z]{1,2})?$/;
  const hlaSimple = /^[A-Z]{1,3}\d{1,4}$/;

  const errors = [];
  for (const antigen of antigens) {
    if (!hlaPattern.test(antigen) && !hlaSimple.test(antigen)) {
      errors.push(`Invalid HLA antigen format: "${antigen}"`);
    }
  }

  if (errors.length > 0) return fail(errors.join('; '));

  return { valid: true, value: trimmed, antigens };
}

/**
 * Validate a calendar date. `opts.notFuture` rejects future dates (birth dates,
 * specimen collection times); `opts.notAncient` rejects dates implying an
 * implausible age.
 */
function validateDate(value, label, opts = {}) {
  if (value === null || value === undefined || value === '') return ok(null);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return fail(`${label} is not a valid date: ${JSON.stringify(value)}`);
  }
  const now = opts.now instanceof Date ? opts.now : new Date();
  if (opts.notFuture && d.getTime() > now.getTime() + 86400000) {
    return fail(`${label} may not be in the future: ${d.toISOString().slice(0, 10)}`);
  }
  if (opts.notAncient) {
    const ageMs = now.getTime() - d.getTime();
    if (ageMs > MAX_AGE_YEARS * 365.25 * 86400000) {
      return fail(`${label} implies an age over ${MAX_AGE_YEARS} years: ${d.toISOString().slice(0, 10)}`);
    }
  }
  return ok(value);
}

/**
 * Validate a laboratory value against its canonical-unit plausibility bounds.
 * `field` must be one of LAB_BOUNDS. Rejecting out-of-band values is the
 * control that stops a µmol/L creatinine being scored as mg/dL.
 */
function validateLabValue(value, field) {
  const bounds = LAB_BOUNDS[field];
  if (!bounds) return fail(`Unknown laboratory field: ${field}`);
  if (value === null || value === undefined || value === '') return ok(null);
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fail(`${field} must be a finite number, got: ${JSON.stringify(value)}`);
  }
  if (num < bounds.min || num > bounds.max) {
    return fail(
      `${field} = ${num} is outside the plausible range ${bounds.min}–${bounds.max} ${bounds.unit}. ` +
      `Check the unit of measure: TransTrack expects ${bounds.unit}.`
    );
  }
  return ok(num);
}

/**
 * Reject a laboratory unit string that does not match the canonical unit for
 * the analyte. Accepts common equivalent spellings; rejects anything else so
 * that a mismatched unit is a hard error rather than a silent miscalculation.
 */
const CANONICAL_LAB_UNITS = {
  bilirubin:  ['mg/dl', 'mg/dL'],
  creatinine: ['mg/dl', 'mg/dL'],
  albumin:    ['g/dl', 'g/dL'],
  sodium:     ['meq/l', 'mmol/l', 'mEq/L', 'mmol/L'],
  inr:        ['', 'ratio', 'inr'],
};

function validateLabUnit(analyte, unit) {
  const key = String(analyte || '').toLowerCase();
  const accepted = CANONICAL_LAB_UNITS[key];
  if (!accepted) return ok(unit ?? null);
  const normalised = String(unit ?? '').trim().toLowerCase();
  if (accepted.map((u) => u.toLowerCase()).includes(normalised)) return ok(unit ?? null);
  return fail(
    `Unit "${unit}" is not valid for ${analyte}. TransTrack scores ${analyte} in ` +
    `${accepted.filter(Boolean)[0]}; convert the value before recording it.`
  );
}

/** Field-by-field rule table per entity. */
const ENTITY_RULES = {
  Patient: [
    { field: 'meld_score', fn: validateMELDScore },
    { field: 'meld_na_score', fn: (v) => validateNumericScore(v, 'MELDNA') },
    { field: 'meld_3_score', fn: (v) => validateNumericScore(v, 'MELD3') },
    { field: 'peld_score', fn: validatePELDScore },
    { field: 'las_score', fn: validateLASScore },
    { field: 'epts_score', fn: validateEPTSScore },
    { field: 'pra_percentage', fn: validatePRAScore },
    { field: 'cpra_percentage', fn: validateCPRAScore },
    { field: 'blood_type', fn: validateBloodType },
    { field: 'medical_urgency', fn: validateUrgencyLevel },
    { field: 'organ_needed', fn: validateOrganType },
    { field: 'hla_typing', fn: validateHLATyping },
    { field: 'date_of_birth', fn: (v) => validateDate(v, 'date_of_birth', { notFuture: true, notAncient: true }) },
    { field: 'listing_date', fn: (v) => validateDate(v, 'listing_date', { notFuture: true }) },
    { field: 'height_cm', fn: (v) => validateLabValue(v, 'height_cm') },
    { field: 'weight_kg', fn: (v) => validateLabValue(v, 'weight_kg') },
  ],
  DonorOrgan: [
    { field: 'blood_type', fn: validateBloodType },
    { field: 'organ_type', fn: validateOrganType },
    { field: 'hla_typing', fn: validateHLATyping },
    { field: 'kdpi_score', fn: validateKDPIScore },
    { field: 'height_cm', fn: (v) => validateLabValue(v, 'height_cm') },
    { field: 'weight_kg', fn: (v) => validateLabValue(v, 'weight_kg') },
    { field: 'donor_age', fn: (v) => validateLabValue(v, 'age_years') },
  ],
  LivingDonor: [
    { field: 'blood_type', fn: validateBloodType },
    { field: 'hla_typing', fn: validateHLATyping },
    { field: 'date_of_birth', fn: (v) => validateDate(v, 'date_of_birth', { notFuture: true, notAncient: true }) },
  ],
};

/**
 * Validate all patient medical scores at once.
 * Retained for backward compatibility; delegates to validateEntity.
 */
function validatePatientScores(patient) {
  return validateEntity('Patient', patient);
}

/**
 * Validate an entity payload against its rule table.
 *
 * Only fields present on the payload are checked, so this is safe for partial
 * updates. Unknown entity types return valid (the entity has no clinical
 * fields) — the caller's column allowlist remains the structural gate.
 *
 * Returns { valid, errors[] }.
 */
function validateEntity(entityName, data) {
  const rules = ENTITY_RULES[entityName];
  if (!rules || !data || typeof data !== 'object') return { valid: true, errors: [] };

  const errors = [];
  for (const { field, fn } of rules) {
    if (!Object.prototype.hasOwnProperty.call(data, field)) continue;
    const value = data[field];
    if (value === undefined || value === null) continue;
    const result = fn(value);
    if (!result.valid) errors.push(result.error);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Throwing form used at persistence boundaries. The thrown error carries
 * `.validationErrors` so callers can surface the full list.
 */
function assertValidEntity(entityName, data, context = '') {
  const { valid, errors } = validateEntity(entityName, data);
  if (valid) return;
  const where = context ? ` (${context})` : '';
  const err = new Error(
    `Clinical validation failed for ${entityName}${where}: ${errors.join('; ')}`
  );
  err.code = 'CLINICAL_VALIDATION_FAILED';
  err.validationErrors = errors;
  throw err;
}

module.exports = {
  SCORE_RANGES,
  LAB_BOUNDS,
  CANONICAL_LAB_UNITS,
  VALID_BLOOD_TYPES,
  VALID_URGENCY_LEVELS,
  VALID_ORGAN_TYPES,
  ENTITY_RULES,
  validateMELDScore,
  validateLASScore,
  validatePRAScore,
  validateCPRAScore,
  validatePELDScore,
  validateKDPIScore,
  validateEPTSScore,
  validateBloodType,
  validateUrgencyLevel,
  validateOrganType,
  validateHLATyping,
  validateDate,
  validateLabValue,
  validateLabUnit,
  validatePatientScores,
  validateEntity,
  assertValidEntity,
};
