/**
 * TransTrack - License Tiers & Feature Configuration
 * 
 * Defines license tiers, pricing, feature entitlements, and limits
 * for the two-version distribution model (Evaluation vs Enterprise).
 * 
 * IMPORTANT: This file defines the source of truth for all license
 * feature gating. Changes here affect application behavior.
 */

// =============================================================================
// BUILD VERSION TYPES
// =============================================================================

const BUILD_VERSION = {
  EVALUATION: 'evaluation',   // Demo/trial build with hard restrictions
  ENTERPRISE: 'enterprise',   // Full production build with license enforcement
};

// Detect current build version from environment or build config
function getCurrentBuildVersion() {
  // Check environment variable first (set during build)
  if (process.env.TRANSTRACK_BUILD_VERSION) {
    return process.env.TRANSTRACK_BUILD_VERSION;
  }
  
  // Check for build marker file
  const fs = require('fs');
  const path = require('path');
  const { app } = require('electron');
  
  try {
    const markerPath = path.join(app.getAppPath(), '.build-version');
    if (fs.existsSync(markerPath)) {
      const version = fs.readFileSync(markerPath, 'utf8').trim();
      if (Object.values(BUILD_VERSION).includes(version)) {
        return version;
      }
    }
  } catch (e) {
    // Fallback to evaluation for safety
  }
  
  // Default to evaluation for safety
  return BUILD_VERSION.EVALUATION;
}

// =============================================================================
// LICENSE TIERS
// =============================================================================

const LICENSE_TIER = {
  EVALUATION: 'evaluation',
  STARTER: 'starter',
  PROFESSIONAL: 'professional',
  ENTERPRISE: 'enterprise',
};

// =============================================================================
// PRICING CONFIGURATION
// =============================================================================

const PRICING = {
  [LICENSE_TIER.STARTER]: {
    name: 'Starter',
    price: 2499,
    currency: 'USD',
    description: 'Single workstation license for small programs',
    includes: [
      'Single workstation installation',
      'Up to 500 patients',
      'Email support (48hr response)',
      '1 year software updates',
      'Basic audit reporting',
    ],
    annualMaintenance: 499,
    updatePeriodYears: 1,
  },
  [LICENSE_TIER.PROFESSIONAL]: {
    name: 'Professional',
    price: 7499,
    currency: 'USD',
    description: 'Multi-workstation license for growing programs',
    includes: [
      'Up to 5 workstation installations',
      'Unlimited patients',
      'Priority email support (24hr response)',
      '2 years software updates',
      'Advanced audit reporting',
      'Custom operational priority configuration',
      'FHIR R4 import/export',
    ],
    annualMaintenance: 1499,
    updatePeriodYears: 2,
  },
  [LICENSE_TIER.ENTERPRISE]: {
    name: 'Enterprise',
    price: 24999,
    currency: 'USD',
    description: 'Unlimited license for large organizations',
    includes: [
      'Unlimited workstation installations',
      'Unlimited patients',
      '24/7 phone & email support',
      'Lifetime software updates',
      'Full audit & compliance reporting',
      'Custom integrations support',
      'Optional on-site training',
      'Source code escrow',
      'Custom development hours included',
    ],
    annualMaintenance: 4999,
    updatePeriodYears: -1, // Lifetime
  },
};

// =============================================================================
// FEATURE FLAGS
// =============================================================================

const FEATURES = {
  // Patient Management
  PATIENT_CREATE: 'patient_create',
  PATIENT_EDIT: 'patient_edit',
  PATIENT_DELETE: 'patient_delete',
  PATIENT_EXPORT: 'patient_export',
  
  // Donor Management
  DONOR_CREATE: 'donor_create',
  DONOR_EDIT: 'donor_edit',
  DONOR_MATCHING: 'donor_matching',
  
  // EHR Integration
  FHIR_IMPORT: 'fhir_import',
  FHIR_EXPORT: 'fhir_export',
  EHR_SYNC: 'ehr_sync',
  
  // Reporting & Audit
  AUDIT_VIEW: 'audit_view',
  AUDIT_EXPORT: 'audit_export',
  COMPLIANCE_REPORTS: 'compliance_reports',
  CUSTOM_REPORTS: 'custom_reports',
  
  // Configuration
  PRIORITY_CONFIG: 'priority_config',
  NOTIFICATION_RULES: 'notification_rules',
  CUSTOM_SETTINGS: 'custom_settings',
  
  // User Management
  USER_MANAGEMENT: 'user_management',
  ROLE_MANAGEMENT: 'role_management',
  MULTI_USER: 'multi_user',
  
  // Disaster Recovery
  BACKUP_CREATE: 'backup_create',
  BACKUP_RESTORE: 'backup_restore',
  
  // Risk Intelligence
  RISK_DASHBOARD: 'risk_dashboard',
  RISK_REPORTS: 'risk_reports',
  READINESS_BARRIERS: 'readiness_barriers',
  
  // Data Operations
  DATA_EXPORT: 'data_export',
  DATA_IMPORT: 'data_import',
  BULK_OPERATIONS: 'bulk_operations',
};

// =============================================================================
// TIER LIMITS
// =============================================================================

const TIER_LIMITS = {
  [LICENSE_TIER.EVALUATION]: {
    maxPatients: 50,
    maxDonors: 5,
    maxUsers: 1,
    maxInstallations: 1,
    evaluationDays: 14,
    dataExportAllowed: false,
    dataImportAllowed: false,
  },
  [LICENSE_TIER.STARTER]: {
    maxPatients: 500,
    maxDonors: -1, // Unlimited
    maxUsers: 3,
    maxInstallations: 1,
    dataExportAllowed: true,
    dataImportAllowed: true,
  },
  [LICENSE_TIER.PROFESSIONAL]: {
    maxPatients: -1, // Unlimited
    maxDonors: -1,
    maxUsers: 10,
    maxInstallations: 5,
    dataExportAllowed: true,
    dataImportAllowed: true,
  },
  [LICENSE_TIER.ENTERPRISE]: {
    maxPatients: -1,
    maxDonors: -1,
    maxUsers: -1, // Unlimited
    maxInstallations: -1,
    dataExportAllowed: true,
    dataImportAllowed: true,
  },
};

// =============================================================================
// FEATURE ENTITLEMENTS BY TIER
// =============================================================================

const TIER_FEATURES = {
  [LICENSE_TIER.EVALUATION]: [
    // Basic read operations
    FEATURES.PATIENT_CREATE,
    FEATURES.PATIENT_EDIT,
    FEATURES.DONOR_CREATE,
    FEATURES.DONOR_EDIT,
    FEATURES.DONOR_MATCHING,
    FEATURES.AUDIT_VIEW, // Read-only
    FEATURES.RISK_DASHBOARD,
    FEATURES.READINESS_BARRIERS,
    FEATURES.BACKUP_CREATE,
    // Disabled: FHIR, Export, Multi-user, Custom config
  ],
  [LICENSE_TIER.STARTER]: [
    // All evaluation features plus:
    FEATURES.PATIENT_CREATE,
    FEATURES.PATIENT_EDIT,
    FEATURES.PATIENT_DELETE,
    FEATURES.DONOR_CREATE,
    FEATURES.DONOR_EDIT,
    FEATURES.DONOR_MATCHING,
    FEATURES.AUDIT_VIEW,
    FEATURES.AUDIT_EXPORT,
    FEATURES.COMPLIANCE_REPORTS,
    FEATURES.USER_MANAGEMENT,
    FEATURES.BACKUP_CREATE,
    FEATURES.BACKUP_RESTORE,
    FEATURES.RISK_DASHBOARD,
    FEATURES.RISK_REPORTS,
    FEATURES.READINESS_BARRIERS,
    FEATURES.DATA_EXPORT,
    FEATURES.DATA_IMPORT,
    FEATURES.NOTIFICATION_RULES,
    // Disabled: FHIR, Custom config, Multi-user beyond 3
  ],
  [LICENSE_TIER.PROFESSIONAL]: [
    // All starter features plus:
    FEATURES.PATIENT_CREATE,
    FEATURES.PATIENT_EDIT,
    FEATURES.PATIENT_DELETE,
    FEATURES.PATIENT_EXPORT,
    FEATURES.DONOR_CREATE,
    FEATURES.DONOR_EDIT,
    FEATURES.DONOR_MATCHING,
    FEATURES.FHIR_IMPORT,
    FEATURES.FHIR_EXPORT,
    FEATURES.EHR_SYNC,
    FEATURES.AUDIT_VIEW,
    FEATURES.AUDIT_EXPORT,
    FEATURES.COMPLIANCE_REPORTS,
    FEATURES.CUSTOM_REPORTS,
    FEATURES.PRIORITY_CONFIG,
    FEATURES.NOTIFICATION_RULES,
    FEATURES.CUSTOM_SETTINGS,
    FEATURES.USER_MANAGEMENT,
    FEATURES.ROLE_MANAGEMENT,
    FEATURES.MULTI_USER,
    FEATURES.BACKUP_CREATE,
    FEATURES.BACKUP_RESTORE,
    FEATURES.RISK_DASHBOARD,
    FEATURES.RISK_REPORTS,
    FEATURES.READINESS_BARRIERS,
    FEATURES.DATA_EXPORT,
    FEATURES.DATA_IMPORT,
    FEATURES.BULK_OPERATIONS,
  ],
  [LICENSE_TIER.ENTERPRISE]: [
    // All features enabled
    ...Object.values(FEATURES),
  ],
};

// =============================================================================
// EVALUATION BUILD RESTRICTIONS
// =============================================================================

const EVALUATION_RESTRICTIONS = {
  // Time restriction
  maxDays: 14,
  
  // Data restrictions
  maxPatients: 50,
  maxDonors: 5,
  maxUsers: 1,
  
  // Feature restrictions
  disabledFeatures: [
    FEATURES.FHIR_IMPORT,
    FEATURES.FHIR_EXPORT,
    FEATURES.EHR_SYNC,
    FEATURES.AUDIT_EXPORT,
    FEATURES.CUSTOM_REPORTS,
    FEATURES.PRIORITY_CONFIG,
    FEATURES.CUSTOM_SETTINGS,
    FEATURES.MULTI_USER,
    FEATURES.ROLE_MANAGEMENT,
    FEATURES.DATA_EXPORT,
    FEATURES.DATA_IMPORT,
    FEATURES.BULK_OPERATIONS,
    FEATURES.BACKUP_RESTORE,
  ],
  
  // UI restrictions
  showWatermark: true,
  watermarkText: 'EVALUATION VERSION - NOT FOR CLINICAL USE',
  showUpgradePrompts: true,
  
  // Behavior
  readOnlyAuditLogs: true,
  disableDataExport: true,
  forceExpirationLockout: true,
};

// =============================================================================
// PAYMENT CONFIGURATION
// =============================================================================

const PAYMENT_CONFIG = {
  paypalEmail: 'lilnicole0383@gmail.com',
  contactEmail: 'Trans_Track@outlook.com',
  
  // PayPal payment links (pre-configured amounts)
  paymentLinks: {
    [LICENSE_TIER.STARTER]: {
      amount: 2499,
      description: 'TransTrack Starter License',
      // PayPal.me link format
      url: 'https://www.paypal.com/paypalme/transtrack/2499USD',
    },
    [LICENSE_TIER.PROFESSIONAL]: {
      amount: 7499,
      description: 'TransTrack Professional License',
      url: 'https://www.paypal.com/paypalme/transtrack/7499USD',
    },
    [LICENSE_TIER.ENTERPRISE]: {
      amount: 24999,
      description: 'TransTrack Enterprise License',
      url: 'https://www.paypal.com/paypalme/transtrack/24999USD',
    },
  },
  
  // Manual payment fallback
  manualPaymentInstructions: `
To complete your purchase:

1. Send payment via PayPal to: lilnicole0383@gmail.com
2. Include your Organization ID in the payment note
3. Email Trans_Track@outlook.com with:
   - Payment confirmation
   - Organization name
   - License tier requested
   - Number of installations needed

You will receive your license key within 24-48 hours.
`,
};

// =============================================================================
// MAINTENANCE CONFIGURATION
// =============================================================================

const MAINTENANCE_CONFIG = {
  gracePeriodDays: 30, // Days after expiry before warnings appear
  warningStartDays: 60, // Days before expiry to start showing warnings
  
  // Behavior when maintenance expired
  expiredBehavior: {
    allowContinuedUse: true, // Software remains usable
    showBanners: true, // Show renewal banners
    disableUpdates: true, // No new updates
    disableSupport: true, // No support access
  },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if a feature is enabled for a given license tier
 */
function isFeatureEnabled(feature, tier) {
  const tierFeatures = TIER_FEATURES[tier] || [];
  return tierFeatures.includes(feature);
}

/**
 * Get all enabled features for a tier
 */
function getEnabledFeatures(tier) {
  return TIER_FEATURES[tier] || [];
}

/**
 * Get limits for a tier
 */
function getTierLimits(tier) {
  return TIER_LIMITS[tier] || TIER_LIMITS[LICENSE_TIER.EVALUATION];
}

/**
 * Get pricing info for a tier
 */
function getTierPricing(tier) {
  return PRICING[tier] || null;
}

/**
 * Check if within limit (-1 means unlimited)
 */
function isWithinLimit(current, limit) {
  if (limit === -1) return true;
  return current < limit;
}

/**
 * Get payment link for tier
 */
function getPaymentLink(tier) {
  return PAYMENT_CONFIG.paymentLinks[tier] || null;
}

/**
 * Check if this is an evaluation build
 */
function isEvaluationBuild() {
  return getCurrentBuildVersion() === BUILD_VERSION.EVALUATION;
}

/**
 * Get display name for license tier
 */
function getTierDisplayName(tier) {
  const pricing = PRICING[tier];
  return pricing ? pricing.name : 'Evaluation';
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Enums
  BUILD_VERSION,
  LICENSE_TIER,
  FEATURES,
  
  // Configuration
  PRICING,
  TIER_LIMITS,
  TIER_FEATURES,
  EVALUATION_RESTRICTIONS,
  PAYMENT_CONFIG,
  MAINTENANCE_CONFIG,
  
  // Functions
  getCurrentBuildVersion,
  isFeatureEnabled,
  getEnabledFeatures,
  getTierLimits,
  getTierPricing,
  isWithinLimit,
  getPaymentLink,
  isEvaluationBuild,
  getTierDisplayName,
};
