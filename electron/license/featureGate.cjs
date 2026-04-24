/**
 * TransTrack - Feature Gate (Stub)
 *
 * The licensing/activation system has been removed. This file is retained as
 * a compatibility shim so existing imports continue to work; all gates now
 * unconditionally allow access.
 */

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

function checkApplicationState() {
  return { usable: true, info: null };
}

function requireUsableState() { return null; }

function canAccessFeature() { return { allowed: true }; }
function requireFeature() { return true; }
function gateFeature() {
  return function (handler) {
    return async function (...args) { return handler.apply(this, args); };
  };
}

function canWithinLimit(_limitType, currentCount) {
  return { allowed: true, current: currentCount, limit: -1, remaining: -1 };
}
function requireWithinLimit(_limitType, currentCount) {
  return canWithinLimit(_limitType, currentCount);
}

function canOnEvaluationBuild() { return { allowed: true }; }
function requireAllowedOnBuild() { return true; }

function isReadOnlyMode() { return false; }
function requireWriteAccess() { return true; }

function checkFullAccess() { return { allowed: true, checks: [] }; }
function requireFullAccess() { return { allowed: true, checks: [] }; }

module.exports = {
  FeatureGateError,
  LimitExceededError,
  LicenseExpiredError,
  EvaluationBuildError,
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
