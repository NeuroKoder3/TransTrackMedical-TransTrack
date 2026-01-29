/**
 * Adult Health History Questionnaire (aHHQ) Components
 * 
 * Components for tracking aHHQ documentation status.
 * 
 * IMPORTANT DISCLAIMER:
 * These components are for OPERATIONAL DOCUMENTATION tracking only.
 * They track whether required health history questionnaires are present,
 * complete, and current. They do NOT store medical narratives,
 * clinical interpretations, or eligibility determinations.
 */

export { default as AHHQPanel } from './AHHQPanel';
export { default as AHHQForm } from './AHHQForm';
export { 
  default as AHHQStatusBadge,
  AHHQExpirationBadge,
  AHHQRiskBadge,
} from './AHHQStatusBadge';
