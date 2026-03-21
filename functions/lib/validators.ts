/**
 * TransTrack - Input Validation
 *
 * Provides comprehensive validation for medical scores, HLA typing,
 * and other critical transplant data to ensure HIPAA/FDA compliance.
 */

import {
  MEDICAL_SCORE_RANGES,
  MATCHING,
  VALID_BLOOD_TYPES,
  VALID_URGENCY_LEVELS,
  VALID_ORGAN_TYPES,
} from './constants.ts';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ParsedHLA {
  raw: string;
  antigens: string[];
}

// ── UUID Validation ─────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUUID(value: string): boolean {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

// ── Medical Score Validation ────────────────────────────────────

export function validateMELDScore(score: unknown): ValidationResult {
  const errors: string[] = [];
  if (score === null || score === undefined) {
    return { valid: true, errors: [] };
  }
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    errors.push('MELD score must be a finite number');
  } else if (score < MEDICAL_SCORE_RANGES.MELD.MIN || score > MEDICAL_SCORE_RANGES.MELD.MAX) {
    errors.push(
      `MELD score must be between ${MEDICAL_SCORE_RANGES.MELD.MIN} and ${MEDICAL_SCORE_RANGES.MELD.MAX}, got ${score}`
    );
  }
  return { valid: errors.length === 0, errors };
}

export function validateLASScore(score: unknown): ValidationResult {
  const errors: string[] = [];
  if (score === null || score === undefined) {
    return { valid: true, errors: [] };
  }
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    errors.push('LAS score must be a finite number');
  } else if (score < MEDICAL_SCORE_RANGES.LAS.MIN || score > MEDICAL_SCORE_RANGES.LAS.MAX) {
    errors.push(
      `LAS score must be between ${MEDICAL_SCORE_RANGES.LAS.MIN} and ${MEDICAL_SCORE_RANGES.LAS.MAX}, got ${score}`
    );
  }
  return { valid: errors.length === 0, errors };
}

export function validatePRAPercentage(pra: unknown): ValidationResult {
  const errors: string[] = [];
  if (pra === null || pra === undefined) {
    return { valid: true, errors: [] };
  }
  if (typeof pra !== 'number' || !Number.isFinite(pra)) {
    errors.push('PRA percentage must be a finite number');
  } else if (pra < MEDICAL_SCORE_RANGES.PRA.MIN || pra > MEDICAL_SCORE_RANGES.PRA.MAX) {
    errors.push(
      `PRA percentage must be between ${MEDICAL_SCORE_RANGES.PRA.MIN} and ${MEDICAL_SCORE_RANGES.PRA.MAX}, got ${pra}`
    );
  }
  return { valid: errors.length === 0, errors };
}

export function validateCPRAPercentage(cpra: unknown): ValidationResult {
  const errors: string[] = [];
  if (cpra === null || cpra === undefined) {
    return { valid: true, errors: [] };
  }
  if (typeof cpra !== 'number' || !Number.isFinite(cpra)) {
    errors.push('cPRA percentage must be a finite number');
  } else if (cpra < MEDICAL_SCORE_RANGES.CPRA.MIN || cpra > MEDICAL_SCORE_RANGES.CPRA.MAX) {
    errors.push(
      `cPRA percentage must be between ${MEDICAL_SCORE_RANGES.CPRA.MIN} and ${MEDICAL_SCORE_RANGES.CPRA.MAX}, got ${cpra}`
    );
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validates all organ-specific medical scores on a patient record.
 * Returns aggregated validation result.
 */
export function validatePatientMedicalScores(patient: Record<string, unknown>): ValidationResult {
  const allErrors: string[] = [];

  const checks = [
    validateMELDScore(patient.meld_score),
    validateLASScore(patient.las_score),
    validatePRAPercentage(patient.pra_percentage),
    validateCPRAPercentage(patient.cpra_percentage),
  ];

  for (const check of checks) {
    allErrors.push(...check.errors);
  }

  if (patient.blood_type && !VALID_BLOOD_TYPES.includes(patient.blood_type as typeof VALID_BLOOD_TYPES[number])) {
    allErrors.push(`Invalid blood type: ${patient.blood_type}`);
  }

  if (patient.medical_urgency && !VALID_URGENCY_LEVELS.includes(patient.medical_urgency as typeof VALID_URGENCY_LEVELS[number])) {
    allErrors.push(`Invalid medical urgency level: ${patient.medical_urgency}`);
  }

  if (patient.organ_needed && !VALID_ORGAN_TYPES.includes(patient.organ_needed as typeof VALID_ORGAN_TYPES[number])) {
    allErrors.push(`Invalid organ type: ${patient.organ_needed}`);
  }

  return { valid: allErrors.length === 0, errors: allErrors };
}

// ── HLA Validation & Parsing ────────────────────────────────────

/**
 * HLA antigen format: A*02:01, B*07:02, DR*04:01, etc.
 * Also accepts simplified formats: A2, B7, DR4, etc.
 */
const HLA_STRICT_REGEX = /^[A-Z]{1,3}\*?\d{1,4}(:\d{1,4})?(:[A-Z]{1,2})?$/;
const HLA_SIMPLIFIED_REGEX = /^[A-Z]{1,3}\d{1,4}$/;

export function validateHLATyping(typing: unknown): ValidationResult & { antigens: string[] } {
  if (typing === null || typing === undefined || typing === '') {
    return { valid: true, errors: [], antigens: [] };
  }

  if (typeof typing !== 'string') {
    return { valid: false, errors: ['HLA typing must be a string'], antigens: [] };
  }

  const trimmed = typing.trim();
  if (trimmed.length === 0) {
    return { valid: true, errors: [], antigens: [] };
  }

  if (trimmed.length > 500) {
    return { valid: false, errors: ['HLA typing string exceeds maximum length of 500 characters'], antigens: [] };
  }

  const antigens = trimmed.split(/[\s,;]+/).filter(Boolean);

  if (antigens.length === 0) {
    return { valid: true, errors: [], antigens: [] };
  }

  if (antigens.length > 20) {
    return {
      valid: false,
      errors: [`HLA typing contains too many antigens (${antigens.length}), maximum is 20`],
      antigens: [],
    };
  }

  const errors: string[] = [];
  for (const antigen of antigens) {
    if (!HLA_STRICT_REGEX.test(antigen) && !HLA_SIMPLIFIED_REGEX.test(antigen)) {
      errors.push(`Invalid HLA antigen format: "${antigen}"`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    antigens: errors.length === 0 ? antigens : [],
  };
}

/**
 * Parse and cache HLA typing. Returns empty array on invalid input.
 */
export function parseHLATyping(typing: string | null | undefined): string[] {
  if (!typing || typeof typing !== 'string') return [];
  const result = validateHLATyping(typing);
  return result.antigens;
}

/**
 * Calculate HLA match score between donor and patient antigens.
 * Uses actual antigen count rather than hard-coded 6.
 */
export function calculateHLAMatchScore(donorAntigens: string[], patientAntigens: string[]): number {
  if (donorAntigens.length === 0 || patientAntigens.length === 0) {
    return MATCHING.DEFAULT_HLA_SCORE;
  }

  const patientSet = new Set(patientAntigens.map(a => a.toUpperCase()));
  let matches = 0;
  for (const antigen of donorAntigens) {
    if (patientSet.has(antigen.toUpperCase())) {
      matches++;
    }
  }

  const totalAntigens = Math.max(donorAntigens.length, patientAntigens.length, MATCHING.HLA_ANTIGEN_COUNT);
  return (matches / totalAntigens) * 100;
}

// ── Diagnosis Validation ────────────────────────────────────────

const ICD10_REGEX = /^[A-Z]\d{2}(\.\d{1,4})?$/;

export function isValidICD10Code(code: string): boolean {
  return ICD10_REGEX.test(code);
}

/**
 * Validates or sanitizes a diagnosis string for safe use in FHIR exports.
 * Strips HTML/script content and enforces length limits.
 */
export function sanitizeDiagnosis(diagnosis: unknown): string {
  if (!diagnosis || typeof diagnosis !== 'string') return '';
  return sanitizePlainText(diagnosis, 500);
}

// ── General Text Sanitization ───────────────────────────────────

/**
 * Strips HTML tags and dangerous characters from a string.
 */
export function sanitizePlainText(input: string, maxLength = 1000): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/<[^>]*>/g, '')
    .replace(/[<>"'&]/g, (ch) => {
      const entities: Record<string, string> = {
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
        '&': '&amp;',
      };
      return entities[ch] || ch;
    })
    .slice(0, maxLength);
}

/**
 * Sanitize a patient name for use in notifications / messages.
 */
export function sanitizePatientName(firstName: unknown, lastName: unknown): string {
  const first = sanitizePlainText(String(firstName || ''), 100);
  const last = sanitizePlainText(String(lastName || ''), 100);
  return `${first} ${last}`.trim();
}
