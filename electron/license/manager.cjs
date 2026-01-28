/**
 * TransTrack - License Manager
 * 
 * Handles license validation, activation, and enforcement for
 * the two-version distribution model (Evaluation vs Enterprise).
 * 
 * Features:
 * - Offline-first license validation
 * - License tier enforcement
 * - Evaluation period management
 * - Maintenance expiry tracking
 * - Organization binding
 * - Cryptographic signature verification (future-ready)
 * 
 * IMPORTANT: This module is critical for license enforcement.
 * All changes must maintain HIPAA compliance and offline operation.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const {
  BUILD_VERSION,
  LICENSE_TIER,
  FEATURES,
  TIER_LIMITS,
  TIER_FEATURES,
  EVALUATION_RESTRICTIONS,
  PAYMENT_CONFIG,
  MAINTENANCE_CONFIG,
  getCurrentBuildVersion,
  isFeatureEnabled,
  getEnabledFeatures,
  getTierLimits,
  getTierPricing,
  isWithinLimit,
  getPaymentLink,
  isEvaluationBuild,
  getTierDisplayName,
} = require('./tiers.cjs');

// =============================================================================
// LICENSE CONFIGURATION
// =============================================================================

const LICENSE_CONFIG = {
  // Contact information
  contactEmail: 'Trans_Track@outlook.com',
  supportEmail: 'Trans_Track@outlook.com',
  purchaseEmail: 'Trans_Track@outlook.com',
  
  // Evaluation settings
  evaluationDays: 14,
  evaluationGraceDays: 3, // Grace period after expiry
  
  // License key prefixes
  keyPrefixes: {
    [LICENSE_TIER.STARTER]: 'ST',
    [LICENSE_TIER.PROFESSIONAL]: 'PR',
    [LICENSE_TIER.ENTERPRISE]: 'EN',
  },
  
  // Public key for signature verification (future-ready)
  publicKey: `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Z5RvPv2HK4d8S7xK5Qh
TransTrackLicenseVerificationPublicKey2026SecureOfflineValidation
ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123
-----END PUBLIC KEY-----`,
};

// =============================================================================
// FILE PATHS
// =============================================================================

function getLicenseFilePath() {
  return path.join(app.getPath('userData'), 'license.json');
}

function getEvalStartPath() {
  return path.join(app.getPath('userData'), '.eval-start');
}

function getOrganizationFilePath() {
  return path.join(app.getPath('userData'), 'organization.json');
}

function getLicenseAuditPath() {
  return path.join(app.getPath('userData'), 'license-audit.log');
}

// =============================================================================
// MACHINE & ORGANIZATION IDENTIFICATION
// =============================================================================

/**
 * Generate unique machine ID for license binding
 */
function getMachineId() {
  const os = require('os');
  const data = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.cpus()[0]?.model || 'unknown',
    os.totalmem(),
  ].join('|');
  
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
}

/**
 * Get or create organization ID
 */
function getOrganizationId() {
  const orgPath = getOrganizationFilePath();
  
  if (fs.existsSync(orgPath)) {
    try {
      const org = JSON.parse(fs.readFileSync(orgPath, 'utf8'));
      return org.id;
    } catch (e) {
      // Continue to create new
    }
  }
  
  // Generate new organization ID
  const orgId = 'ORG-' + crypto.randomBytes(8).toString('hex').toUpperCase();
  const orgData = {
    id: orgId,
    createdAt: new Date().toISOString(),
    machineId: getMachineId(),
  };
  
  fs.writeFileSync(orgPath, JSON.stringify(orgData, null, 2));
  return orgId;
}

/**
 * Get full organization info
 */
function getOrganizationInfo() {
  const orgPath = getOrganizationFilePath();
  
  if (fs.existsSync(orgPath)) {
    try {
      return JSON.parse(fs.readFileSync(orgPath, 'utf8'));
    } catch (e) {
      // Continue to create new
    }
  }
  
  // Create default organization
  getOrganizationId();
  return JSON.parse(fs.readFileSync(orgPath, 'utf8'));
}

/**
 * Update organization info
 */
function updateOrganizationInfo(updates) {
  const orgPath = getOrganizationFilePath();
  const current = getOrganizationInfo();
  
  const updated = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  
  fs.writeFileSync(orgPath, JSON.stringify(updated, null, 2));
  logLicenseEvent('organization_updated', { updates });
  
  return updated;
}

// =============================================================================
// EVALUATION MANAGEMENT
// =============================================================================

/**
 * Check if currently in evaluation mode
 */
function isEvaluationMode() {
  // If this is an evaluation build, always in evaluation mode
  if (isEvaluationBuild()) {
    return true;
  }
  
  // Check for valid enterprise license
  const license = readLicenseFile();
  if (license && license.tier && license.tier !== LICENSE_TIER.EVALUATION) {
    return false;
  }
  
  return true;
}

/**
 * Get evaluation start date, creating if needed
 */
function getEvaluationStartDate() {
  const evalPath = getEvalStartPath();
  
  if (!fs.existsSync(evalPath)) {
    const startDate = new Date().toISOString();
    fs.writeFileSync(evalPath, startDate);
    logLicenseEvent('evaluation_started', { startDate });
    return new Date(startDate);
  }
  
  return new Date(fs.readFileSync(evalPath, 'utf8'));
}

/**
 * Get evaluation days remaining
 */
function getEvaluationDaysRemaining() {
  const startDate = getEvaluationStartDate();
  const now = new Date();
  const daysPassed = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
  const remaining = LICENSE_CONFIG.evaluationDays - daysPassed;
  
  return Math.max(0, remaining);
}

/**
 * Check if evaluation has expired
 */
function isEvaluationExpired() {
  if (!isEvaluationMode()) return false;
  
  const daysRemaining = getEvaluationDaysRemaining();
  return daysRemaining <= 0;
}

/**
 * Check if in evaluation grace period
 */
function isInEvaluationGracePeriod() {
  if (!isEvaluationExpired()) return false;
  
  const startDate = getEvaluationStartDate();
  const now = new Date();
  const daysPassed = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
  const totalAllowed = LICENSE_CONFIG.evaluationDays + LICENSE_CONFIG.evaluationGraceDays;
  
  return daysPassed <= totalAllowed;
}

// =============================================================================
// LICENSE FILE OPERATIONS
// =============================================================================

/**
 * Read license file
 */
function readLicenseFile() {
  const licensePath = getLicenseFilePath();
  
  if (!fs.existsSync(licensePath)) {
    return null;
  }
  
  try {
    return JSON.parse(fs.readFileSync(licensePath, 'utf8'));
  } catch (e) {
    console.error('Error reading license file:', e.message);
    return null;
  }
}

/**
 * Write license file
 */
function writeLicenseFile(licenseData) {
  const licensePath = getLicenseFilePath();
  fs.writeFileSync(licensePath, JSON.stringify(licenseData, null, 2));
}

/**
 * Remove license file
 */
function removeLicense() {
  const licensePath = getLicenseFilePath();
  if (fs.existsSync(licensePath)) {
    fs.unlinkSync(licensePath);
    logLicenseEvent('license_removed', {});
  }
}

// =============================================================================
// LICENSE VALIDATION
// =============================================================================

/**
 * Validate license key format
 * Format: XXXXX-XXXXX-XXXXX-XXXXX-XXXXX
 */
function validateLicenseKeyFormat(key) {
  if (!key || typeof key !== 'string') return false;
  const pattern = /^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/;
  return pattern.test(key.toUpperCase());
}

/**
 * Detect license tier from key prefix
 */
function detectLicenseTier(key) {
  if (!key) return LICENSE_TIER.EVALUATION;
  
  const prefix = key.substring(0, 2).toUpperCase();
  
  for (const [tier, tierPrefix] of Object.entries(LICENSE_CONFIG.keyPrefixes)) {
    if (prefix === tierPrefix) {
      return tier;
    }
  }
  
  return LICENSE_TIER.STARTER; // Default for unknown prefixes
}

/**
 * Validate license data integrity
 */
function validateLicenseData(license) {
  if (!license) return { valid: false, reason: 'No license data' };
  
  // Required fields
  if (!license.key) return { valid: false, reason: 'Missing license key' };
  if (!license.tier) return { valid: false, reason: 'Missing license tier' };
  if (!license.orgId) return { valid: false, reason: 'Missing organization ID' };
  if (!license.activatedAt) return { valid: false, reason: 'Missing activation date' };
  
  // Check organization binding
  const currentOrgId = getOrganizationId();
  if (license.orgId !== currentOrgId) {
    return { valid: false, reason: 'License bound to different organization' };
  }
  
  // Check tier validity
  if (!Object.values(LICENSE_TIER).includes(license.tier)) {
    return { valid: false, reason: 'Invalid license tier' };
  }
  
  return { valid: true };
}

/**
 * Check if license is valid for current use
 */
function isLicenseValid() {
  // Evaluation build has different rules
  if (isEvaluationBuild()) {
    return !isEvaluationExpired() || isInEvaluationGracePeriod();
  }
  
  const license = readLicenseFile();
  
  // No license - check evaluation
  if (!license) {
    return !isEvaluationExpired() || isInEvaluationGracePeriod();
  }
  
  // Validate license data
  const validation = validateLicenseData(license);
  return validation.valid;
}

/**
 * Check maintenance status
 */
function getMaintenanceStatus() {
  const license = readLicenseFile();
  
  if (!license || !license.maintenanceExpiry) {
    return {
      active: false,
      expired: true,
      expiryDate: null,
      daysRemaining: 0,
      inGracePeriod: false,
    };
  }
  
  const expiryDate = new Date(license.maintenanceExpiry);
  const now = new Date();
  const daysRemaining = Math.floor((expiryDate - now) / (1000 * 60 * 60 * 24));
  const gracePeriodEnd = new Date(expiryDate);
  gracePeriodEnd.setDate(gracePeriodEnd.getDate() + MAINTENANCE_CONFIG.gracePeriodDays);
  
  return {
    active: daysRemaining > 0,
    expired: daysRemaining <= 0,
    expiryDate: license.maintenanceExpiry,
    daysRemaining: Math.max(0, daysRemaining),
    inGracePeriod: daysRemaining <= 0 && now <= gracePeriodEnd,
    showWarning: daysRemaining > 0 && daysRemaining <= MAINTENANCE_CONFIG.warningStartDays,
  };
}

// =============================================================================
// LICENSE ACTIVATION
// =============================================================================

/**
 * Activate license with key
 */
async function activateLicense(licenseKey, customerInfo = {}) {
  // Validate key format
  if (!validateLicenseKeyFormat(licenseKey)) {
    throw new Error('Invalid license key format. Expected: XXXXX-XXXXX-XXXXX-XXXXX-XXXXX');
  }
  
  // Cannot activate license on evaluation build
  if (isEvaluationBuild()) {
    throw new Error('Cannot activate license on Evaluation build. Please download the Enterprise version.');
  }
  
  const normalizedKey = licenseKey.toUpperCase();
  const tier = detectLicenseTier(normalizedKey);
  const orgId = getOrganizationId();
  const machineId = getMachineId();
  const now = new Date();
  
  // Calculate maintenance expiry based on tier
  const tierPricing = getTierPricing(tier);
  let maintenanceExpiry = null;
  
  if (tierPricing && tierPricing.updatePeriodYears > 0) {
    maintenanceExpiry = new Date(now);
    maintenanceExpiry.setFullYear(maintenanceExpiry.getFullYear() + tierPricing.updatePeriodYears);
    maintenanceExpiry = maintenanceExpiry.toISOString();
  } else if (tierPricing && tierPricing.updatePeriodYears === -1) {
    // Lifetime - set far future date
    maintenanceExpiry = new Date('2099-12-31').toISOString();
  }
  
  const licenseData = {
    key: normalizedKey,
    tier: tier,
    orgId: orgId,
    machineId: machineId,
    activatedAt: now.toISOString(),
    maintenanceExpiry: maintenanceExpiry,
    customer: {
      name: customerInfo.name || '',
      email: customerInfo.email || '',
      organization: customerInfo.organization || '',
      ...customerInfo,
    },
    activationHistory: [{
      date: now.toISOString(),
      machineId: machineId,
      action: 'initial_activation',
    }],
  };
  
  // Save license
  writeLicenseFile(licenseData);
  
  // Update organization with license info
  updateOrganizationInfo({
    name: customerInfo.organization || customerInfo.name,
    licenseTier: tier,
    licenseActivatedAt: now.toISOString(),
  });
  
  // Log activation
  logLicenseEvent('license_activated', {
    tier,
    orgId,
    keyPrefix: normalizedKey.substring(0, 5),
  });
  
  return {
    success: true,
    tier: tier,
    tierName: getTierDisplayName(tier),
    orgId: orgId,
    activatedAt: licenseData.activatedAt,
    maintenanceExpiry: maintenanceExpiry,
    limits: getTierLimits(tier),
    features: getEnabledFeatures(tier),
  };
}

/**
 * Renew maintenance
 */
async function renewMaintenance(renewalKey, years = 1) {
  const license = readLicenseFile();
  
  if (!license) {
    throw new Error('No active license to renew');
  }
  
  const now = new Date();
  let newExpiry;
  
  // If currently active, extend from current expiry
  // If expired, extend from today
  const currentExpiry = license.maintenanceExpiry ? new Date(license.maintenanceExpiry) : now;
  const baseDate = currentExpiry > now ? currentExpiry : now;
  
  newExpiry = new Date(baseDate);
  newExpiry.setFullYear(newExpiry.getFullYear() + years);
  
  license.maintenanceExpiry = newExpiry.toISOString();
  license.activationHistory = license.activationHistory || [];
  license.activationHistory.push({
    date: now.toISOString(),
    machineId: getMachineId(),
    action: 'maintenance_renewed',
    years: years,
  });
  
  writeLicenseFile(license);
  
  logLicenseEvent('maintenance_renewed', {
    tier: license.tier,
    newExpiry: newExpiry.toISOString(),
    years,
  });
  
  return {
    success: true,
    newExpiry: newExpiry.toISOString(),
  };
}

// =============================================================================
// LICENSE INFO & STATUS
// =============================================================================

/**
 * Get comprehensive license info
 */
function getLicenseInfo() {
  const buildVersion = getCurrentBuildVersion();
  const isEvalBuild = isEvaluationBuild();
  const license = readLicenseFile();
  const orgInfo = getOrganizationInfo();
  
  // Evaluation build
  if (isEvalBuild) {
    const daysRemaining = getEvaluationDaysRemaining();
    const expired = isEvaluationExpired();
    const inGrace = isInEvaluationGracePeriod();
    
    return {
      buildVersion: BUILD_VERSION.EVALUATION,
      isLicensed: false,
      isEvaluation: true,
      tier: LICENSE_TIER.EVALUATION,
      tierName: 'Evaluation',
      evaluationDaysRemaining: daysRemaining,
      evaluationExpired: expired,
      evaluationInGracePeriod: inGrace,
      orgId: orgInfo.id,
      orgName: orgInfo.name || 'Evaluation Organization',
      limits: getTierLimits(LICENSE_TIER.EVALUATION),
      features: getEnabledFeatures(LICENSE_TIER.EVALUATION),
      restrictions: EVALUATION_RESTRICTIONS,
      canActivate: false, // Cannot activate on eval build
      upgradeRequired: true,
      upgradeMessage: 'Download the Enterprise version to activate a license.',
    };
  }
  
  // Enterprise build - no license
  if (!license) {
    const daysRemaining = getEvaluationDaysRemaining();
    const expired = isEvaluationExpired();
    const inGrace = isInEvaluationGracePeriod();
    
    return {
      buildVersion: BUILD_VERSION.ENTERPRISE,
      isLicensed: false,
      isEvaluation: true,
      tier: LICENSE_TIER.EVALUATION,
      tierName: 'Evaluation (Unlicensed)',
      evaluationDaysRemaining: daysRemaining,
      evaluationExpired: expired,
      evaluationInGracePeriod: inGrace,
      orgId: orgInfo.id,
      orgName: orgInfo.name || 'Unlicensed Organization',
      limits: getTierLimits(LICENSE_TIER.EVALUATION),
      features: getEnabledFeatures(LICENSE_TIER.EVALUATION),
      restrictions: EVALUATION_RESTRICTIONS,
      canActivate: true,
      upgradeRequired: true,
      upgradeMessage: 'Activate a license to unlock all features.',
    };
  }
  
  // Enterprise build - licensed
  const validation = validateLicenseData(license);
  const maintenance = getMaintenanceStatus();
  
  return {
    buildVersion: BUILD_VERSION.ENTERPRISE,
    isLicensed: validation.valid,
    isEvaluation: false,
    tier: license.tier,
    tierName: getTierDisplayName(license.tier),
    licenseKey: license.key ? license.key.substring(0, 5) + '-XXXXX-XXXXX-XXXXX-XXXXX' : null,
    activatedAt: license.activatedAt,
    orgId: license.orgId,
    orgName: orgInfo.name || license.customer?.organization || 'Licensed Organization',
    customer: license.customer,
    maintenance: maintenance,
    limits: getTierLimits(license.tier),
    features: getEnabledFeatures(license.tier),
    canActivate: true,
    canUpgrade: license.tier !== LICENSE_TIER.ENTERPRISE,
    validationError: validation.valid ? null : validation.reason,
  };
}

/**
 * Get current license tier
 */
function getCurrentTier() {
  const info = getLicenseInfo();
  return info.tier;
}

/**
 * Check if a specific feature is enabled
 */
function checkFeature(feature) {
  const tier = getCurrentTier();
  
  // Check build-level restrictions first
  if (isEvaluationBuild()) {
    if (EVALUATION_RESTRICTIONS.disabledFeatures.includes(feature)) {
      return {
        enabled: false,
        reason: 'Feature not available in Evaluation version',
        upgradeRequired: true,
      };
    }
  }
  
  // Check tier-level features
  const enabled = isFeatureEnabled(feature, tier);
  
  if (!enabled) {
    const tierName = getTierDisplayName(tier);
    return {
      enabled: false,
      reason: `Feature not available in ${tierName} tier`,
      upgradeRequired: true,
      requiredTiers: getRequiredTiersForFeature(feature),
    };
  }
  
  return { enabled: true };
}

/**
 * Get required tiers for a feature
 */
function getRequiredTiersForFeature(feature) {
  const tiers = [];
  
  for (const [tier, features] of Object.entries(TIER_FEATURES)) {
    if (features.includes(feature)) {
      tiers.push(tier);
    }
  }
  
  return tiers;
}

/**
 * Check if within usage limits
 */
function checkLimit(limitType, currentCount) {
  const tier = getCurrentTier();
  const limits = getTierLimits(tier);
  const limit = limits[limitType];
  
  if (limit === undefined) {
    return { withinLimit: true };
  }
  
  const withinLimit = isWithinLimit(currentCount, limit);
  
  if (!withinLimit) {
    const tierName = getTierDisplayName(tier);
    return {
      withinLimit: false,
      current: currentCount,
      limit: limit,
      reason: `${tierName} tier limit of ${limit} reached`,
      upgradeRequired: true,
    };
  }
  
  return {
    withinLimit: true,
    current: currentCount,
    limit: limit,
    remaining: limit === -1 ? -1 : limit - currentCount,
  };
}

// =============================================================================
// AUDIT LOGGING
// =============================================================================

/**
 * Log license-related event
 */
function logLicenseEvent(event, details = {}) {
  const auditPath = getLicenseAuditPath();
  const entry = {
    timestamp: new Date().toISOString(),
    event: event,
    machineId: getMachineId(),
    orgId: getOrganizationId(),
    details: details,
  };
  
  const line = JSON.stringify(entry) + '\n';
  
  try {
    fs.appendFileSync(auditPath, line);
  } catch (e) {
    console.error('Failed to write license audit log:', e.message);
  }
}

/**
 * Get license audit history
 */
function getLicenseAuditHistory(limit = 100) {
  const auditPath = getLicenseAuditPath();
  
  if (!fs.existsSync(auditPath)) {
    return [];
  }
  
  try {
    const content = fs.readFileSync(auditPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const entries = lines.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);
    
    return entries.slice(-limit).reverse();
  } catch (e) {
    console.error('Failed to read license audit log:', e.message);
    return [];
  }
}

// =============================================================================
// PAYMENT HELPERS
// =============================================================================

/**
 * Get payment info for tier
 */
function getPaymentInfo(tier) {
  const pricing = getTierPricing(tier);
  const paymentLink = getPaymentLink(tier);
  
  if (!pricing) {
    return null;
  }
  
  return {
    tier: tier,
    tierName: getTierDisplayName(tier),
    price: pricing.price,
    currency: pricing.currency,
    description: pricing.description,
    includes: pricing.includes,
    annualMaintenance: pricing.annualMaintenance,
    paymentLink: paymentLink,
    paypalEmail: PAYMENT_CONFIG.paypalEmail,
    contactEmail: PAYMENT_CONFIG.contactEmail,
    manualInstructions: PAYMENT_CONFIG.manualPaymentInstructions,
  };
}

/**
 * Get all payment options
 */
function getAllPaymentOptions() {
  return {
    tiers: [
      getPaymentInfo(LICENSE_TIER.STARTER),
      getPaymentInfo(LICENSE_TIER.PROFESSIONAL),
      getPaymentInfo(LICENSE_TIER.ENTERPRISE),
    ].filter(Boolean),
    paypalEmail: PAYMENT_CONFIG.paypalEmail,
    contactEmail: PAYMENT_CONFIG.contactEmail,
    manualInstructions: PAYMENT_CONFIG.manualPaymentInstructions,
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Configuration
  LICENSE_CONFIG,
  LICENSE_TIER,
  FEATURES,
  BUILD_VERSION,
  
  // Machine/Org identification
  getMachineId,
  getOrganizationId,
  getOrganizationInfo,
  updateOrganizationInfo,
  
  // Evaluation management
  isEvaluationMode,
  getEvaluationStartDate,
  getEvaluationDaysRemaining,
  isEvaluationExpired,
  isInEvaluationGracePeriod,
  isEvaluationBuild,
  
  // License validation
  validateLicenseKeyFormat,
  validateLicenseData,
  isLicenseValid,
  getMaintenanceStatus,
  
  // License activation
  activateLicense,
  renewMaintenance,
  removeLicense,
  
  // License info
  getLicenseInfo,
  getCurrentTier,
  checkFeature,
  checkLimit,
  getTierLimits,
  getTierDisplayName,
  
  // Audit
  logLicenseEvent,
  getLicenseAuditHistory,
  
  // Payment
  getPaymentInfo,
  getAllPaymentOptions,
  
  // Re-exports from tiers
  getCurrentBuildVersion,
  isFeatureEnabled,
  getEnabledFeatures,
  EVALUATION_RESTRICTIONS,
  PAYMENT_CONFIG,
  MAINTENANCE_CONFIG,
};
