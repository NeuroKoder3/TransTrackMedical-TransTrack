/**
 * TransTrack - Feature Gating Service
 * 
 * Provides middleware and utilities for enforcing feature access
 * based on license tier and build version.
 * 
 * Used by IPC handlers to gate access to protected features.
 */

const {
  LICENSE_TIER,
  FEATURES,
  BUILD_VERSION,
  getCurrentBuildVersion,
  isEvaluationBuild,
  isFeatureEnabled,
  getTierLimits,
  EVALUATION_RESTRICTIONS,
} = require('./tiers.cjs');

const {
  getLicenseInfo,
  getCurrentTier,
  checkFeature,
  checkLimit,
  isLicenseValid,
  isEvaluationExpired,
  isInEvaluationGracePeriod,
  logLicenseEvent,
} = require('./manager.cjs');

// =============================================================================
// FEATURE GATE ERRORS
// =============================================================================

class FeatureGateError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'FeatureGateError';
    this.code = 'FEATURE_GATED';
    this.details = details;
  }
}

class LimitExceededError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'LimitExceededError';
    this.code = 'LIMIT_EXCEEDED';
    this.details = details;
  }
}

class LicenseExpiredError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'LicenseExpiredError';
    this.code = 'LICENSE_EXPIRED';
    this.details = details;
  }
}

class EvaluationBuildError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'EvaluationBuildError';
    this.code = 'EVALUATION_BUILD';
    this.details = details;
  }
}

// =============================================================================
// LICENSE STATE CHECKS
// =============================================================================

/**
 * Check if application is in a usable state
 * Returns error info if not usable
 */
function checkApplicationState() {
  const info = getLicenseInfo();
  
  // Check if evaluation has hard expired (no grace period)
  if (info.isEvaluation && info.evaluationExpired && !info.evaluationInGracePeriod) {
    if (isEvaluationBuild() && EVALUATION_RESTRICTIONS.forceExpirationLockout) {
      return {
        usable: false,
        reason: 'evaluation_expired',
        message: 'Your 14-day evaluation period has expired. Please purchase a license to continue.',
        upgradeRequired: true,
        readOnlyAllowed: true, // Allow read-only access
      };
    }
  }
  
  // License validation failed
  if (info.validationError) {
    return {
      usable: false,
      reason: 'license_invalid',
      message: info.validationError,
      upgradeRequired: false,
      readOnlyAllowed: true,
    };
  }
  
  return {
    usable: true,
    info: info,
  };
}

/**
 * Require application to be in usable state
 * Throws if not usable
 */
function requireUsableState() {
  const state = checkApplicationState();
  
  if (!state.usable) {
    throw new LicenseExpiredError(state.message, {
      reason: state.reason,
      upgradeRequired: state.upgradeRequired,
    });
  }
  
  return state.info;
}

// =============================================================================
// FEATURE GATES
// =============================================================================

/**
 * Check if a feature is accessible
 * Returns { allowed, reason, details }
 */
function canAccessFeature(feature) {
  // First check application state
  const appState = checkApplicationState();
  if (!appState.usable && !appState.readOnlyAllowed) {
    return {
      allowed: false,
      reason: appState.reason,
      message: appState.message,
      upgradeRequired: appState.upgradeRequired,
    };
  }
  
  // Check feature access
  const featureCheck = checkFeature(feature);
  
  if (!featureCheck.enabled) {
    return {
      allowed: false,
      reason: 'feature_not_available',
      message: featureCheck.reason,
      upgradeRequired: featureCheck.upgradeRequired,
      requiredTiers: featureCheck.requiredTiers,
    };
  }
  
  return {
    allowed: true,
  };
}

/**
 * Require feature access, throw if not allowed
 */
function requireFeature(feature) {
  const result = canAccessFeature(feature);
  
  if (!result.allowed) {
    logLicenseEvent('feature_blocked', { feature, reason: result.reason });
    throw new FeatureGateError(result.message, {
      feature,
      reason: result.reason,
      upgradeRequired: result.upgradeRequired,
      requiredTiers: result.requiredTiers,
    });
  }
  
  return true;
}

/**
 * Decorator-style feature gate for IPC handlers
 */
function gateFeature(feature) {
  return function(handler) {
    return async function(...args) {
      requireFeature(feature);
      return handler.apply(this, args);
    };
  };
}

// =============================================================================
// LIMIT GATES
// =============================================================================

/**
 * Check if within a specific limit
 */
function canWithinLimit(limitType, currentCount) {
  const result = checkLimit(limitType, currentCount);
  
  if (!result.withinLimit) {
    return {
      allowed: false,
      reason: 'limit_exceeded',
      message: result.reason,
      current: result.current,
      limit: result.limit,
      upgradeRequired: result.upgradeRequired,
    };
  }
  
  return {
    allowed: true,
    current: result.current,
    limit: result.limit,
    remaining: result.remaining,
  };
}

/**
 * Require to be within limit, throw if exceeded
 */
function requireWithinLimit(limitType, currentCount) {
  const result = canWithinLimit(limitType, currentCount);
  
  if (!result.allowed) {
    logLicenseEvent('limit_exceeded', { limitType, current: result.current, limit: result.limit });
    throw new LimitExceededError(result.message, {
      limitType,
      current: result.current,
      limit: result.limit,
      upgradeRequired: result.upgradeRequired,
    });
  }
  
  return result;
}

// =============================================================================
// EVALUATION BUILD GATES
// =============================================================================

/**
 * Check if action is allowed on evaluation build
 */
function canOnEvaluationBuild(action) {
  if (!isEvaluationBuild()) {
    return { allowed: true };
  }
  
  // Check specific restrictions
  switch (action) {
    case 'activate_license':
      return {
        allowed: false,
        reason: 'evaluation_build',
        message: 'Cannot activate licenses on Evaluation build. Download the Enterprise version.',
      };
    
    case 'export_data':
      if (EVALUATION_RESTRICTIONS.disableDataExport) {
        return {
          allowed: false,
          reason: 'evaluation_build',
          message: 'Data export is disabled in Evaluation version.',
        };
      }
      break;
    
    case 'import_data':
      return {
        allowed: false,
        reason: 'evaluation_build',
        message: 'Data import is disabled in Evaluation version.',
      };
    
    case 'fhir_operations':
      return {
        allowed: false,
        reason: 'evaluation_build',
        message: 'FHIR operations are not available in Evaluation version.',
      };
  }
  
  return { allowed: true };
}

/**
 * Require action to be allowed on current build
 */
function requireAllowedOnBuild(action) {
  const result = canOnEvaluationBuild(action);
  
  if (!result.allowed) {
    throw new EvaluationBuildError(result.message, {
      action,
      reason: result.reason,
    });
  }
  
  return true;
}

// =============================================================================
// READ-ONLY MODE CHECKS
// =============================================================================

/**
 * Check if in read-only mode (expired evaluation or invalid license)
 */
function isReadOnlyMode() {
  const state = checkApplicationState();
  
  if (!state.usable && state.readOnlyAllowed) {
    return true;
  }
  
  return false;
}

/**
 * Require write access (not in read-only mode)
 */
function requireWriteAccess() {
  if (isReadOnlyMode()) {
    throw new LicenseExpiredError(
      'Application is in read-only mode. Please activate or renew your license to make changes.',
      { readOnlyMode: true }
    );
  }
  
  return true;
}

// =============================================================================
// COMBINED GATE HELPERS
// =============================================================================

/**
 * Full access check combining multiple gates
 */
function checkFullAccess(options = {}) {
  const {
    feature = null,
    limitType = null,
    currentCount = 0,
    requireWrite = false,
    action = null,
  } = options;
  
  const result = {
    allowed: true,
    checks: [],
  };
  
  // Check application state
  const appState = checkApplicationState();
  result.checks.push({
    type: 'application_state',
    passed: appState.usable || appState.readOnlyAllowed,
    details: appState,
  });
  
  if (!appState.usable && !appState.readOnlyAllowed) {
    result.allowed = false;
    result.blockingCheck = 'application_state';
    return result;
  }
  
  // Check write access if required
  if (requireWrite) {
    const readOnly = isReadOnlyMode();
    result.checks.push({
      type: 'write_access',
      passed: !readOnly,
      details: { readOnlyMode: readOnly },
    });
    
    if (readOnly) {
      result.allowed = false;
      result.blockingCheck = 'write_access';
      return result;
    }
  }
  
  // Check feature access
  if (feature) {
    const featureResult = canAccessFeature(feature);
    result.checks.push({
      type: 'feature',
      passed: featureResult.allowed,
      details: featureResult,
    });
    
    if (!featureResult.allowed) {
      result.allowed = false;
      result.blockingCheck = 'feature';
      return result;
    }
  }
  
  // Check limits
  if (limitType !== null) {
    const limitResult = canWithinLimit(limitType, currentCount);
    result.checks.push({
      type: 'limit',
      passed: limitResult.allowed,
      details: limitResult,
    });
    
    if (!limitResult.allowed) {
      result.allowed = false;
      result.blockingCheck = 'limit';
      return result;
    }
  }
  
  // Check build-specific action
  if (action) {
    const actionResult = canOnEvaluationBuild(action);
    result.checks.push({
      type: 'build_action',
      passed: actionResult.allowed,
      details: actionResult,
    });
    
    if (!actionResult.allowed) {
      result.allowed = false;
      result.blockingCheck = 'build_action';
      return result;
    }
  }
  
  return result;
}

/**
 * Require full access with multiple checks
 */
function requireFullAccess(options = {}) {
  const result = checkFullAccess(options);
  
  if (!result.allowed) {
    const blockingDetails = result.checks.find(c => c.type === result.blockingCheck)?.details || {};
    const message = blockingDetails.message || 'Access denied';
    
    switch (result.blockingCheck) {
      case 'application_state':
        throw new LicenseExpiredError(message, blockingDetails);
      case 'write_access':
        throw new LicenseExpiredError('Read-only mode - write access denied', blockingDetails);
      case 'feature':
        throw new FeatureGateError(message, blockingDetails);
      case 'limit':
        throw new LimitExceededError(message, blockingDetails);
      case 'build_action':
        throw new EvaluationBuildError(message, blockingDetails);
      default:
        throw new Error(message);
    }
  }
  
  return result;
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Error classes
  FeatureGateError,
  LimitExceededError,
  LicenseExpiredError,
  EvaluationBuildError,
  
  // State checks
  checkApplicationState,
  requireUsableState,
  
  // Feature gates
  canAccessFeature,
  requireFeature,
  gateFeature,
  
  // Limit gates
  canWithinLimit,
  requireWithinLimit,
  
  // Build gates
  canOnEvaluationBuild,
  requireAllowedOnBuild,
  
  // Read-only mode
  isReadOnlyMode,
  requireWriteAccess,
  
  // Combined gates
  checkFullAccess,
  requireFullAccess,
};
