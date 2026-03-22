/**
 * TransTrack - Medical Score Validators
 *
 * Ensures medical scores conform to UNOS/OPTN specifications
 * before being used in priority calculations.
 *
 * CRITICAL: These validators protect against data integrity issues
 * that could affect organ allocation fairness.
 */

'use strict';

const SCORE_RANGES = {
  MELD: { min: 6, max: 40, description: 'Model for End-Stage Liver Disease' },
  LAS: { min: 0, max: 100, description: 'Lung Allocation Score' },
  PRA: { min: 0, max: 100, description: 'Panel Reactive Antibodies' },
  CPRA: { min: 0, max: 100, description: 'Calculated Panel Reactive Antibodies' },
  EPTS: { min: 0, max: 100, description: 'Estimated Post-Transplant Survival' },
};

const VALID_BLOOD_TYPES = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];

const VALID_URGENCY_LEVELS = ['critical', 'high', 'medium', 'low'];

const VALID_ORGAN_TYPES = ['kidney', 'liver', 'heart', 'lung', 'pancreas', 'intestine'];

function validateNumericScore(value, scoreName) {
  const range = SCORE_RANGES[scoreName];
  if (!range) return { valid: false, error: `Unknown score type: ${scoreName}` };

  if (value === null || value === undefined) {
    return { valid: true, value: null };
  }

  const num = Number(value);
  if (!Number.isFinite(num)) {
    return { valid: false, error: `${scoreName} score must be a number, got: ${typeof value}` };
  }

  if (num < range.min || num > range.max) {
    return {
      valid: false,
      error: `${scoreName} score must be between ${range.min} and ${range.max}, got: ${num}`,
    };
  }

  return { valid: true, value: num };
}

function validateMELDScore(value) {
  return validateNumericScore(value, 'MELD');
}

function validateLASScore(value) {
  return validateNumericScore(value, 'LAS');
}

function validatePRAScore(value) {
  return validateNumericScore(value, 'PRA');
}

function validateCPRAScore(value) {
  return validateNumericScore(value, 'CPRA');
}

function validateBloodType(value) {
  if (!value) return { valid: true, value: null };
  if (!VALID_BLOOD_TYPES.includes(value)) {
    return { valid: false, error: `Invalid blood type: "${value}". Valid: ${VALID_BLOOD_TYPES.join(', ')}` };
  }
  return { valid: true, value };
}

function validateUrgencyLevel(value) {
  if (!value) return { valid: true, value: null };
  if (!VALID_URGENCY_LEVELS.includes(value)) {
    return { valid: false, error: `Invalid urgency level: "${value}". Valid: ${VALID_URGENCY_LEVELS.join(', ')}` };
  }
  return { valid: true, value };
}

function validateOrganType(value) {
  if (!value) return { valid: true, value: null };
  if (!VALID_ORGAN_TYPES.includes(value)) {
    return { valid: false, error: `Invalid organ type: "${value}". Valid: ${VALID_ORGAN_TYPES.join(', ')}` };
  }
  return { valid: true, value };
}

/**
 * Validate an HLA typing string.
 * Accepts formats like "A2 A24 B7 B44 DR4 DR11" or "A*02:01,B*07:02"
 */
function validateHLATyping(value) {
  if (!value || typeof value !== 'string') return { valid: true, value: null };

  const trimmed = value.trim();
  if (trimmed.length === 0) return { valid: true, value: null };
  if (trimmed.length > 500) {
    return { valid: false, error: 'HLA typing string exceeds maximum length of 500 characters' };
  }

  const antigens = trimmed.split(/[\s,;]+/).filter(Boolean);
  if (antigens.length > 20) {
    return { valid: false, error: `Too many HLA antigens: ${antigens.length} (max 20)` };
  }

  const hlaPattern = /^[A-Z]{1,3}\*?\d{1,4}(:\d{1,4})?(:[A-Z]{1,2})?$/;
  const hlaSimple = /^[A-Z]{1,3}\d{1,4}$/;

  const errors = [];
  for (const antigen of antigens) {
    if (!hlaPattern.test(antigen) && !hlaSimple.test(antigen)) {
      errors.push(`Invalid HLA antigen format: "${antigen}"`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, error: errors.join('; ') };
  }

  return { valid: true, value: trimmed, antigens };
}

/**
 * Validate all patient medical scores at once.
 * Returns { valid, errors[] }
 */
function validatePatientScores(patient) {
  const errors = [];

  const checks = [
    { field: 'meld_score', fn: validateMELDScore },
    { field: 'las_score', fn: validateLASScore },
    { field: 'pra_percentage', fn: validatePRAScore },
    { field: 'cpra_percentage', fn: validateCPRAScore },
    { field: 'blood_type', fn: validateBloodType },
    { field: 'medical_urgency', fn: validateUrgencyLevel },
    { field: 'organ_needed', fn: validateOrganType },
    { field: 'hla_typing', fn: validateHLATyping },
  ];

  for (const { field, fn } of checks) {
    if (patient[field] !== undefined && patient[field] !== null) {
      const result = fn(patient[field]);
      if (!result.valid) {
        errors.push(result.error);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  SCORE_RANGES,
  VALID_BLOOD_TYPES,
  VALID_URGENCY_LEVELS,
  VALID_ORGAN_TYPES,
  validateMELDScore,
  validateLASScore,
  validatePRAScore,
  validateCPRAScore,
  validateBloodType,
  validateUrgencyLevel,
  validateOrganType,
  validateHLATyping,
  validatePatientScores,
};
