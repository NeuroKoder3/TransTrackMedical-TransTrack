/**
 * TransTrack - License Manager (Stub)
 *
 * The licensing/activation system has been removed. This file is retained as
 * a compatibility shim so existing imports continue to work; everything now
 * reports the application as fully licensed with no usage limits.
 */

const {
  BUILD_VERSION,
  LICENSE_TIER,
  FEATURES,
  EVALUATION_RESTRICTIONS,
  PAYMENT_CONFIG,
  MAINTENANCE_CONFIG,
  getCurrentBuildVersion,
  isFeatureEnabled,
  getEnabledFeatures,
  getTierLimits,
  isEvaluationBuild,
  getTierDisplayName,
} = require('./tiers.cjs');

const LICENSE_CONFIG = {
  contactEmail: '',
  supportEmail: '',
  purchaseEmail: '',
  evaluationDays: -1,
  evaluationGraceDays: 0,
  keyPrefixes: {},
  publicKey: '',
};

function getMachineId() { return 'local-machine'; }
function getOrganizationId() { return 'LOCAL-ORG'; }
function getOrganizationInfo() {
  return { id: 'LOCAL-ORG', name: 'TransTrack', createdAt: new Date().toISOString() };
}
function updateOrganizationInfo(updates) { return { ...getOrganizationInfo(), ...updates }; }

function isEvaluationMode() { return false; }
function getEvaluationStartDate() { return new Date(); }
function getEvaluationDaysRemaining() { return -1; }
function isEvaluationExpired() { return false; }
function isInEvaluationGracePeriod() { return false; }

function validateLicenseKeyFormat() { return true; }
function validateLicenseData() { return { valid: true }; }
function isLicenseValid() { return true; }
function getMaintenanceStatus() {
  return { active: true, expired: false, expiryDate: null, daysRemaining: -1, inGracePeriod: false, showWarning: false };
}

async function activateLicense() {
  return {
    success: true,
    tier: LICENSE_TIER.ENTERPRISE,
    tierName: 'TransTrack',
    orgId: 'LOCAL-ORG',
    activatedAt: new Date().toISOString(),
    maintenanceExpiry: null,
    limits: getTierLimits(LICENSE_TIER.ENTERPRISE),
    features: getEnabledFeatures(LICENSE_TIER.ENTERPRISE),
  };
}

async function renewMaintenance() {
  return { success: true, newExpiry: null };
}

function removeLicense() { /* no-op */ }

function getLicenseInfo() {
  return {
    buildVersion: BUILD_VERSION.ENTERPRISE,
    isLicensed: true,
    isEvaluation: false,
    tier: LICENSE_TIER.ENTERPRISE,
    tierName: 'TransTrack',
    orgId: 'LOCAL-ORG',
    orgName: 'TransTrack',
    limits: getTierLimits(LICENSE_TIER.ENTERPRISE),
    features: getEnabledFeatures(LICENSE_TIER.ENTERPRISE),
    canActivate: false,
    canUpgrade: false,
  };
}

function getCurrentTier() { return LICENSE_TIER.ENTERPRISE; }
function checkFeature() { return { enabled: true }; }
function checkLimit(_limitType, currentCount) {
  return { withinLimit: true, current: currentCount, limit: -1, remaining: -1 };
}
function logLicenseEvent() { /* no-op */ }
function getLicenseAuditHistory() { return []; }
function getPaymentInfo() { return null; }
function getAllPaymentOptions() { return { tiers: [], businessEmail: '', contactEmail: '', manualInstructions: '' }; }

module.exports = {
  LICENSE_CONFIG,
  LICENSE_TIER,
  FEATURES,
  BUILD_VERSION,
  getMachineId,
  getOrganizationId,
  getOrganizationInfo,
  updateOrganizationInfo,
  isEvaluationMode,
  getEvaluationStartDate,
  getEvaluationDaysRemaining,
  isEvaluationExpired,
  isInEvaluationGracePeriod,
  isEvaluationBuild,
  validateLicenseKeyFormat,
  validateLicenseData,
  isLicenseValid,
  getMaintenanceStatus,
  activateLicense,
  renewMaintenance,
  removeLicense,
  getLicenseInfo,
  getCurrentTier,
  checkFeature,
  checkLimit,
  getTierLimits,
  getTierDisplayName,
  logLicenseEvent,
  getLicenseAuditHistory,
  getPaymentInfo,
  getAllPaymentOptions,
  getCurrentBuildVersion,
  isFeatureEnabled,
  getEnabledFeatures,
  EVALUATION_RESTRICTIONS,
  PAYMENT_CONFIG,
  MAINTENANCE_CONFIG,
};
