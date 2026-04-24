/**
 * TransTrack - License Tiers (Stub)
 *
 * The licensing/activation system has been removed. This file remains as a
 * compatibility shim so existing imports continue to resolve. All tiers map
 * to the unrestricted full feature set, and there are no usage limits.
 */

const BUILD_VERSION = {
  EVALUATION: 'enterprise',
  ENTERPRISE: 'enterprise',
};

const LICENSE_TIER = {
  EVALUATION: 'enterprise',
  STARTER: 'enterprise',
  PROFESSIONAL: 'enterprise',
  ENTERPRISE: 'enterprise',
};

const FEATURES = {
  PATIENT_CREATE: 'patient_create',
  PATIENT_EDIT: 'patient_edit',
  PATIENT_DELETE: 'patient_delete',
  PATIENT_EXPORT: 'patient_export',
  DONOR_CREATE: 'donor_create',
  DONOR_EDIT: 'donor_edit',
  DONOR_MATCHING: 'donor_matching',
  FHIR_IMPORT: 'fhir_import',
  FHIR_EXPORT: 'fhir_export',
  EHR_SYNC: 'ehr_sync',
  AUDIT_VIEW: 'audit_view',
  AUDIT_EXPORT: 'audit_export',
  COMPLIANCE_REPORTS: 'compliance_reports',
  CUSTOM_REPORTS: 'custom_reports',
  PRIORITY_CONFIG: 'priority_config',
  NOTIFICATION_RULES: 'notification_rules',
  CUSTOM_SETTINGS: 'custom_settings',
  USER_MANAGEMENT: 'user_management',
  ROLE_MANAGEMENT: 'role_management',
  MULTI_USER: 'multi_user',
  BACKUP_CREATE: 'backup_create',
  BACKUP_RESTORE: 'backup_restore',
  RISK_DASHBOARD: 'risk_dashboard',
  RISK_REPORTS: 'risk_reports',
  READINESS_BARRIERS: 'readiness_barriers',
  DATA_EXPORT: 'data_export',
  DATA_IMPORT: 'data_import',
  BULK_OPERATIONS: 'bulk_operations',
};

const UNLIMITED_FEATURES = Object.freeze({
  maxPatients: -1,
  maxDonors: -1,
  maxUsers: -1,
  maxInstallations: -1,
  fhir: true,
  fhirImport: true,
  fhirExport: true,
  advancedAudit: true,
  multiUser: true,
  dataExport: true,
  dataImport: true,
  customIntegrations: true,
  bulkOperations: true,
  customReports: true,
  priorityConfig: true,
  apiAccess: true,
  ssoIntegration: true,
  advancedMatching: true,
  disasterRecovery: true,
  complianceCenter: true,
  riskDashboard: true,
  basicAudit: true,
  patientManagement: true,
  donorManagement: true,
  matching: true,
  notifications: true,
  backup: true,
  restore: true,
});

const LICENSE_FEATURES = Object.freeze({
  evaluation: UNLIMITED_FEATURES,
  starter: UNLIMITED_FEATURES,
  professional: UNLIMITED_FEATURES,
  enterprise: UNLIMITED_FEATURES,
});

const TIER_LIMITS = LICENSE_FEATURES;
const ALL_FEATURES = Object.values(FEATURES);
const TIER_FEATURES = {
  evaluation: ALL_FEATURES,
  starter: ALL_FEATURES,
  professional: ALL_FEATURES,
  enterprise: ALL_FEATURES,
};

const EVALUATION_RESTRICTIONS = {
  maxDays: -1,
  maxPatients: -1,
  maxDonors: -1,
  maxUsers: -1,
  disabledFeatures: [],
  showWatermark: false,
  watermarkText: '',
  showUpgradePrompts: false,
  readOnlyAuditLogs: false,
  disableDataExport: false,
  forceExpirationLockout: false,
};

const PRICING = {};
const PAYMENT_CONFIG = { businessEmail: '', contactEmail: '', paymentLinks: {}, manualPaymentInstructions: '' };
const MAINTENANCE_CONFIG = {
  gracePeriodDays: 0,
  warningStartDays: 0,
  expiredBehavior: { allowContinuedUse: true, showBanners: false, disableUpdates: false, disableSupport: false },
};

function getCurrentBuildVersion() { return BUILD_VERSION.ENTERPRISE; }
function isEvaluationBuild() { return false; }
function isFeatureEnabled() { return true; }
function getEnabledFeatures() { return ALL_FEATURES; }
function getTierLimits() { return UNLIMITED_FEATURES; }
function getLicenseFeatures() { return UNLIMITED_FEATURES; }
function hasFeature() { return true; }
function checkDataLimit(_tier, _limitName, currentCount) {
  return { allowed: true, limit: -1, current: currentCount, remaining: -1 };
}
function getTierPricing() { return null; }
function isWithinLimit() { return true; }
function getPaymentLink() { return null; }
function getTierDisplayName() { return 'TransTrack'; }

module.exports = {
  BUILD_VERSION,
  LICENSE_TIER,
  FEATURES,
  LICENSE_FEATURES,
  PRICING,
  TIER_LIMITS,
  TIER_FEATURES,
  EVALUATION_RESTRICTIONS,
  PAYMENT_CONFIG,
  MAINTENANCE_CONFIG,
  getCurrentBuildVersion,
  isFeatureEnabled,
  getEnabledFeatures,
  getTierLimits,
  getLicenseFeatures,
  hasFeature,
  checkDataLimit,
  getTierPricing,
  isWithinLimit,
  getPaymentLink,
  isEvaluationBuild,
  getTierDisplayName,
};
