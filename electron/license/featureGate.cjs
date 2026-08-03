/**
 * TransTrack - Feature Gating Service
 *
 * Enforces feature access, limits, and read-only mode from the license
 * manager. IPC handlers and mutating paths must call these gates rather
 * than assuming entitlement.
 *
 * Finding refs: H-6 (was stubbed always-allow), M-21 (trial/clock via manager).
 */

'use strict';

const {
  FEATURES,
  EVALUATION_RESTRICTIONS,
  isEvaluationBuild,
} = require('./tiers.cjs');

const {
  getLicenseInfo,
  checkFeature,
  checkLimit,
  logLicenseEvent,
} = require('./manager.cjs');

function _logger() {
  try {
    return require('../services/logger.cjs').logger;
  } catch {
    return {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
  }
}

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

function _isDevFailOpen() {
  try {
    const { app } = require('electron');
    return (
      !app.isPackaged &&
      process.env.NODE_ENV === 'development' &&
      process.env.LICENSE_FAIL_OPEN === 'true'
    );
  } catch {
    return (
      process.env.NODE_ENV === 'development' &&
      process.env.LICENSE_FAIL_OPEN === 'true'
    );
  }
}

/**
 * Check if application is in a usable state.
 * Returns error info if not usable.
 */
function checkApplicationState() {
  try {
    const info = getLicenseInfo();

    if (info.mode === 'trial_expired' || info.isEvaluationExpired) {
      if (EVALUATION_RESTRICTIONS.forceExpirationLockout !== false) {
        return {
          usable: false,
          reason: 'evaluation_expired',
          message:
            'Your trial period has expired. Please activate a license to continue making changes.',
          upgradeRequired: true,
          readOnlyAllowed: true,
        };
      }
    }

    if (info.mode === 'invalid' || info.verificationError) {
      return {
        usable: false,
        reason: 'license_invalid',
        message:
          info.verificationError ||
          'License validation failed. Please contact your administrator.',
        upgradeRequired: false,
        readOnlyAllowed: true,
      };
    }

    return {
      usable: true,
      info,
    };
  } catch (error) {
    _logger().error('License check error', { error: error.message });

    if (_isDevFailOpen()) {
      _logger().warn('Failing open due to LICENSE_FAIL_OPEN flag (dev only)');
      return {
        usable: true,
        info: null,
        warning: error.message,
      };
    }

    return {
      usable: false,
      reason: 'license_check_error',
      message: 'Unable to verify license. Please contact support.',
      error: error.message,
    };
  }
}

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

function canAccessFeature(feature) {
  const appState = checkApplicationState();
  if (!appState.usable && !appState.readOnlyAllowed) {
    return {
      allowed: false,
      reason: appState.reason,
      message: appState.message,
      upgradeRequired: appState.upgradeRequired,
    };
  }

  // Read-only mode blocks mutating feature flags even when reads are allowed.
  if (!appState.usable && appState.readOnlyAllowed) {
    return {
      allowed: false,
      reason: appState.reason,
      message: appState.message,
      upgradeRequired: appState.upgradeRequired,
    };
  }

  const featureCheck = checkFeature(feature);
  if (!featureCheck.enabled) {
    return {
      allowed: false,
      reason: 'feature_not_available',
      message: featureCheck.reason || `Feature '${feature}' is not available.`,
      upgradeRequired: true,
    };
  }

  return { allowed: true };
}

function requireFeature(feature) {
  const result = canAccessFeature(feature);
  if (!result.allowed) {
    logLicenseEvent('feature_blocked', { feature, reason: result.reason });
    throw new FeatureGateError(result.message, {
      feature,
      reason: result.reason,
      upgradeRequired: result.upgradeRequired,
    });
  }
  return true;
}

function gateFeature(feature) {
  return function (handler) {
    return async function (...args) {
      requireFeature(feature);
      return handler.apply(this, args);
    };
  };
}

function canWithinLimit(limitType, currentCount) {
  try {
    const result = checkLimit(limitType, currentCount);
    if (!result.withinLimit) {
      return {
        allowed: false,
        reason: 'limit_exceeded',
        message:
          result.reason ||
          `License limit reached for ${limitType} (${result.current}/${result.limit}).`,
        current: result.current,
        limit: result.limit,
        upgradeRequired: true,
      };
    }
    return {
      allowed: true,
      current: result.current,
      limit: result.limit,
      remaining: result.remaining,
    };
  } catch (error) {
    _logger().error('Limit check error', { error: error.message });
    if (_isDevFailOpen()) {
      return {
        allowed: true,
        current: currentCount,
        limit: -1,
        remaining: -1,
        warning: error.message,
      };
    }
    return {
      allowed: false,
      reason: 'limit_check_error',
      message: 'Unable to verify limits. Please contact support.',
      error: error.message,
    };
  }
}

function requireWithinLimit(limitType, currentCount) {
  const result = canWithinLimit(limitType, currentCount);
  if (!result.allowed) {
    logLicenseEvent('limit_exceeded', {
      limitType,
      current: result.current,
      limit: result.limit,
    });
    throw new LimitExceededError(result.message, {
      limitType,
      current: result.current,
      limit: result.limit,
      upgradeRequired: result.upgradeRequired,
    });
  }
  return result;
}

function canOnEvaluationBuild(action) {
  if (!isEvaluationBuild()) {
    return { allowed: true };
  }

  switch (action) {
    case 'activate_license':
      return {
        allowed: false,
        reason: 'evaluation_build',
        message:
          'Cannot activate licenses on Evaluation build. Download the Enterprise version.',
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
    default:
      break;
  }

  return { allowed: true };
}

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

function isReadOnlyMode() {
  try {
    const state = checkApplicationState();
    return !state.usable && !!state.readOnlyAllowed;
  } catch (error) {
    _logger().error('Read-only mode check error — failing closed to read-only', {
      error: error.message,
    });
    return true;
  }
}

function requireWriteAccess() {
  if (isReadOnlyMode()) {
    throw new LicenseExpiredError(
      'Application is in read-only mode. Please activate or renew your license to make changes.',
      { readOnlyMode: true }
    );
  }
  return true;
}

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

function requireFullAccess(options = {}) {
  const result = checkFullAccess(options);
  if (!result.allowed) {
    const blockingDetails =
      result.checks.find((c) => c.type === result.blockingCheck)?.details || {};
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

module.exports = {
  FeatureGateError,
  LimitExceededError,
  LicenseExpiredError,
  EvaluationBuildError,
  FEATURES,
  checkApplicationState,
  requireUsableState,
  canAccessFeature,
  requireFeature,
  gateFeature,
  canWithinLimit,
  requireWithinLimit,
  canOnEvaluationBuild,
  requireAllowedOnBuild,
  isReadOnlyMode,
  requireWriteAccess,
  checkFullAccess,
  requireFullAccess,
};
