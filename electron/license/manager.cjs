/**
 * TransTrack — License Manager.
 *
 * This module is the single source of truth for licensing status at
 * runtime. It exposes the same surface as the legacy stub so existing
 * call sites (`getLicenseInfo`, `checkFeature`, `checkLimit`,
 * `isLicenseValid`, `activateLicense`, ...) continue to compile, but
 * every method now consults a real, Ed25519-signed license payload or
 * falls back to a time-boxed trial.
 *
 * STATE MACHINE
 *
 *   no-license-file & trial-not-expired  -> "trial"       (full features, days remaining)
 *   no-license-file & trial-expired      -> "trial_expired" (read-only)
 *   license-file-present & valid         -> "active"
 *   license-file-present & in-grace      -> "in_grace"  (full features, renewal warning)
 *   license-file-present & invalid       -> "invalid"   (signature failed / machine mismatch / expired past grace)
 *
 * NEVER caches stale data across `activateLicense()` / `removeLicense()`
 * — those methods invalidate the cache so the renderer sees the new
 * state immediately.
 */

'use strict';

const path = require('path');
const tiers = require('./tiers.cjs');
const verifier = require('./verifier.cjs');
const storage = require('./storage.cjs');
const machineId = require('./machineId.cjs');
const { LICENSE_PROTOCOL_VERSION, IS_DEV_KEY } = require('./publisherPublicKey.cjs');

const {
  BUILD_VERSION,
  LICENSE_TIER,
  FEATURES,
  EVALUATION_RESTRICTIONS,
  PAYMENT_CONFIG,
  MAINTENANCE_CONFIG,
  getCurrentBuildVersion,
  isFeatureEnabled: _staticIsFeatureEnabled,
  getEnabledFeatures,
  getTierLimits,
  isEvaluationBuild,
  getTierDisplayName,
} = tiers;

const LICENSE_CONFIG = {
  contactEmail: 'sales@transtrack.health',
  supportEmail: 'support@transtrack.health',
  purchaseEmail: 'sales@transtrack.health',
  evaluationDays: storage.TRIAL_DURATION_DAYS,
  evaluationGraceDays: 0,
  protocolVersion: LICENSE_PROTOCOL_VERSION,
  isDevelopmentBuild: IS_DEV_KEY,
};

let _cached = null;
function _invalidate() { _cached = null; }

function _audit(eventType, info, details = {}) {
  // Best-effort audit: write to the DB audit table via the shared helper.
  // We can't `require('../ipc/shared.cjs')` at the top level without
  // creating a cycle (shared.cjs may depend on this module indirectly), so
  // we resolve lazily inside the function.
  try {
    const shared = require('../ipc/shared.cjs');
    if (typeof shared.logAudit === 'function') {
      shared.logAudit(
        'system',
        'License',
        info?.licenseId || null,
        null,
        `License event: ${eventType} ${JSON.stringify(details).slice(0, 500)}`,
        'system',
        'system',
      );
    }
  } catch { /* best-effort */ }
}

/**
 * Compute the runtime license state, with memoization. Pass
 * `force=true` to bypass the cache (e.g. immediately after activation).
 */
function _getState(force = false) {
  if (_cached && !force) return _cached;

  const wire = storage.loadLicense();
  if (!wire) {
    const trial = storage.getTrialState();
    _cached = {
      mode: trial.expired ? 'trial_expired' : 'trial',
      trial,
      payload: null,
      verification: null,
    };
    return _cached;
  }

  const result = verifier.verify(wire);
  if (!result.ok) {
    _cached = {
      mode: 'invalid',
      trial: null,
      payload: result.payload || null,
      verification: result,
    };
    return _cached;
  }

  _cached = {
    mode: result.status === 'in_grace' ? 'in_grace' : 'active',
    trial: null,
    payload: result.payload,
    verification: result,
  };
  return _cached;
}

// -----------------------------------------------------------------------------
// Public surface — must match the legacy stub's exports.
// -----------------------------------------------------------------------------

function getMachineId() { return machineId.getMachineFingerprint(); }

function getOrganizationId() {
  const s = _getState();
  return s.payload?.customer?.orgId || 'LOCAL-ORG';
}

function getOrganizationInfo() {
  const s = _getState();
  if (s.payload?.customer) {
    return {
      id: s.payload.customer.orgId,
      name: s.payload.customer.name,
      email: s.payload.customer.email,
      createdAt: s.payload.issuedAt,
    };
  }
  return { id: 'LOCAL-ORG', name: 'TransTrack (Trial)', createdAt: new Date().toISOString() };
}

function updateOrganizationInfo(updates) {
  // We can't mutate a signed license. This is a read-only view for the UI.
  return { ...getOrganizationInfo(), ...updates };
}

function isEvaluationMode() {
  return _getState().mode === 'trial';
}

function getEvaluationStartDate() {
  const s = _getState();
  if (s.trial) return new Date(s.trial.startedAt);
  return null;
}

function getEvaluationDaysRemaining() {
  const s = _getState();
  if (s.mode === 'trial') return s.trial.daysRemaining;
  if (s.mode === 'trial_expired') return 0;
  return -1; // not in eval
}

function isEvaluationExpired() {
  return _getState().mode === 'trial_expired';
}

function isInEvaluationGracePeriod() { return false; }

function validateLicenseKeyFormat(key) {
  return typeof key === 'string' && key.startsWith('LIC1.') && key.length > 100;
}

function validateLicenseData() { return { valid: true }; }

function isLicenseValid() {
  const m = _getState().mode;
  return m === 'active' || m === 'in_grace' || m === 'trial';
}

function getMaintenanceStatus() {
  const s = _getState();
  if (!s.payload) {
    return { active: false, expired: false, expiryDate: null, daysRemaining: -1, inGracePeriod: false, showWarning: false };
  }
  const exp = Date.parse(s.payload.maintenanceExpiresAt || s.payload.expiresAt);
  const days = Math.ceil((exp - Date.now()) / 86400000);
  return {
    active: days > 0,
    expired: days <= 0,
    expiryDate: new Date(exp).toISOString(),
    daysRemaining: days,
    inGracePeriod: s.mode === 'in_grace',
    showWarning: days < 30,
  };
}

/**
 * Activate (install) a signed license. The caller passes the LIC1.* wire
 * string typically pasted from a customer license file. We verify it
 * BEFORE writing it to disk so a bad license cannot lock the user out.
 */
async function activateLicense(licenseWire) {
  if (typeof licenseWire !== 'string' || !licenseWire.trim()) {
    return { success: false, error: 'Paste the license string from the .lic file provided by your account manager.' };
  }
  const trimmed = licenseWire.trim();
  const result = verifier.verify(trimmed);
  if (!result.ok) {
    _audit('activation_failed', null, { code: result.code, message: result.message });
    return { success: false, error: result.message, code: result.code };
  }
  storage.storeLicense(trimmed);
  _invalidate();
  _audit('activated', result.payload, {
    tier: result.payload.tier,
    orgId: result.payload.customer.orgId,
    expiresAt: result.payload.expiresAt,
  });
  return {
    success: true,
    tier: result.payload.tier,
    tierName: getTierDisplayName(result.payload.tier),
    orgId: result.payload.customer.orgId,
    activatedAt: new Date().toISOString(),
    maintenanceExpiry: result.payload.maintenanceExpiresAt,
    limits: result.payload.limits,
    features: result.payload.features,
  };
}

async function renewMaintenance(newWire) {
  // Renewal works by activating the new license file — we replace the
  // installed license entirely.
  return activateLicense(newWire);
}

function removeLicense() {
  const before = _getState().payload;
  storage.deleteLicense();
  _invalidate();
  _audit('removed', before, {});
}

function getLicenseInfo() {
  const s = _getState();
  const base = {
    buildVersion: getCurrentBuildVersion(),
    machineId: getMachineId(),
    isLicensed: isLicenseValid(),
    isEvaluation: isEvaluationMode(),
    isEvaluationExpired: isEvaluationExpired(),
    trial: s.trial,
    mode: s.mode,
    canActivate: true,
    canUpgrade: false,
    isDevelopmentBuild: IS_DEV_KEY,
  };
  if (s.payload) {
    return {
      ...base,
      tier: s.payload.tier,
      tierName: getTierDisplayName(s.payload.tier),
      orgId: s.payload.customer.orgId,
      orgName: s.payload.customer.name,
      customerEmail: s.payload.customer.email,
      licenseId: s.payload.licenseId,
      issuedAt: s.payload.issuedAt,
      expiresAt: s.payload.expiresAt,
      maintenanceExpiresAt: s.payload.maintenanceExpiresAt,
      limits: s.payload.limits,
      features: s.payload.features,
      machineBound: Array.isArray(s.payload.machineBindings) && s.payload.machineBindings.length > 0,
      verificationStatus: s.verification?.status || 'invalid',
      verificationError: s.verification?.ok ? null : s.verification?.message || null,
    };
  }
  // Trial fallback: full features, time-limited.
  const fullLimits = getTierLimits(LICENSE_TIER.ENTERPRISE);
  return {
    ...base,
    tier: LICENSE_TIER.EVALUATION,
    tierName: 'Trial',
    orgId: 'TRIAL',
    orgName: 'TransTrack Trial',
    licenseId: null,
    expiresAt: s.trial?.expiresAt || null,
    limits: fullLimits,
    features: getEnabledFeatures(LICENSE_TIER.ENTERPRISE),
    machineBound: false,
    verificationStatus: s.mode,
    verificationError: null,
  };
}

function getCurrentTier() {
  const s = _getState();
  if (s.payload) return s.payload.tier;
  return LICENSE_TIER.EVALUATION;
}

function checkFeature(featureFlag) {
  const s = _getState();
  if (s.mode === 'trial' || s.mode === 'in_grace' || s.mode === 'active') {
    if (s.payload) {
      const enabled = Array.isArray(s.payload.features) && s.payload.features.includes(featureFlag);
      return { enabled, reason: enabled ? null : 'Feature not included in your license tier.' };
    }
    return { enabled: true };
  }
  // trial_expired or invalid: only read paths are allowed; refuse mutating features.
  return { enabled: false, reason: s.mode === 'trial_expired'
    ? 'Trial period has ended. Activate a license to continue using TransTrack.'
    : 'License is invalid: ' + (s.verification?.message || 'unknown error') };
}

function checkLimit(limitType, currentCount) {
  const s = _getState();
  let limit = -1;
  if (s.payload && s.payload.limits) {
    if (limitType === 'patients') limit = s.payload.limits.maxPatients;
    else if (limitType === 'users') limit = s.payload.limits.maxUsers;
    else if (limitType === 'installations') limit = s.payload.limits.maxInstallations;
  }
  if (limit < 0) {
    return { withinLimit: true, current: currentCount, limit: -1, remaining: -1 };
  }
  const remaining = limit - currentCount;
  return { withinLimit: currentCount < limit, current: currentCount, limit, remaining: Math.max(0, remaining) };
}

function logLicenseEvent(eventType, details) { _audit(eventType, _getState().payload, details || {}); }

function getLicenseAuditHistory() {
  // The audit log lives in the regular audit_logs table and is queryable
  // via the standard audit IPC. We don't duplicate that here.
  return [];
}

function getPaymentInfo() { return null; }
function getAllPaymentOptions() {
  return {
    tiers: ['starter', 'professional', 'enterprise'],
    businessEmail: LICENSE_CONFIG.contactEmail,
    contactEmail: LICENSE_CONFIG.contactEmail,
    manualInstructions: 'Contact ' + LICENSE_CONFIG.purchaseEmail + ' for a quote and license file.',
  };
}

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
  isFeatureEnabled: _staticIsFeatureEnabled,
  getEnabledFeatures,
  EVALUATION_RESTRICTIONS,
  PAYMENT_CONFIG,
  MAINTENANCE_CONFIG,
  // Test seam:
  _invalidate,
};
