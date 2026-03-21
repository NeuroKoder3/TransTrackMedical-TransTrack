/**
 * TransTrack - Named Constants
 *
 * Centralizes all magic numbers and configuration values used across
 * Deno edge functions to improve readability and maintainability.
 */

export const PRIORITY_SCORING = {
  MAX_URGENCY_POINTS: 30,
  MAX_WAITTIME_POINTS: 25,
  MAX_ORGAN_SPECIFIC_POINTS: 25,
  MAX_EVALUATION_POINTS: 10,
  MAX_BLOOD_RARITY_POINTS: 10,
  DAYS_PER_WAITTIME_POINT: 14.6,
  MAX_WAITTIME_DAYS: 365,
  EVALUATION_RECENT_DAYS: 90,
  EVALUATION_MODERATE_DAYS: 180,
  MAX_TOTAL_SCORE: 100,
  MIN_TOTAL_SCORE: 0,
} as const;

export const MEDICAL_SCORE_RANGES = {
  MELD: { MIN: 6, MAX: 40 },
  LAS: { MIN: 0, MAX: 100 },
  PRA: { MIN: 0, MAX: 100 },
  CPRA: { MIN: 0, MAX: 100 },
} as const;

export const MATCHING = {
  MAX_MATCHES_TO_CREATE: 10,
  TOP_PRIORITY_NOTIFICATIONS: 3,
  HLA_ANTIGEN_COUNT: 6,
  WEIGHT_RATIO_MIN: 0.7,
  WEIGHT_RATIO_MAX: 1.5,
  DEFAULT_HLA_SCORE: 50,
  WEIGHT_PRIORITY: 0.40,
  WEIGHT_HLA: 0.25,
  WEIGHT_BLOOD_TYPE: 0.15,
  WEIGHT_SIZE: 0.10,
  WEIGHT_WAITTIME: 0.10,
} as const;

export const URGENCY_SCORES: Record<string, number> = {
  critical: 30,
  high: 20,
  medium: 10,
  low: 5,
};

export const BLOOD_TYPE_RARITY: Record<string, number> = {
  'AB-': 10,
  'B-': 8,
  'A-': 6,
  'O-': 5,
  'AB+': 4,
  'B+': 3,
  'A+': 2,
  'O+': 1,
};

export const BLOOD_COMPATIBILITY: Record<string, string[]> = {
  'O-': ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'],
  'O+': ['O+', 'A+', 'B+', 'AB+'],
  'A-': ['A-', 'A+', 'AB-', 'AB+'],
  'A+': ['A+', 'AB+'],
  'B-': ['B-', 'B+', 'AB-', 'AB+'],
  'B+': ['B+', 'AB+'],
  'AB-': ['AB-', 'AB+'],
  'AB+': ['AB+'],
};

export const VALID_BLOOD_TYPES = [
  'O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+',
] as const;

export const VALID_URGENCY_LEVELS = [
  'critical', 'high', 'medium', 'low',
] as const;

export const VALID_ORGAN_TYPES = [
  'kidney', 'liver', 'heart', 'lung', 'pancreas', 'intestine',
] as const;
