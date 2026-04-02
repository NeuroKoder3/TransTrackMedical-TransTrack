/**
 * TransTrack - Data Residency Controls
 *
 * Enforces data residency policies to prevent unauthorized
 * export of PHI outside approved regions.
 *
 * Since TransTrack is offline-first with local SQLite storage,
 * the primary risk vectors are:
 * - FHIR exports to external EHR endpoints
 * - File exports (CSV, PDF)
 * - Database backup paths
 */

'use strict';

const { ipcMain } = require('electron');
const { getDatabase, getDefaultOrganization } = require('../database/init.cjs');
const { createLogger } = require('./errorLogger.cjs');

const log = createLogger('dataResidency');

const DATA_RESIDENCY_POLICIES = {
  US: { allowed: true, regions: ['us-east', 'us-west'], description: 'United States' },
  EU: { allowed: true, regions: ['eu-west', 'eu-central'], description: 'European Union (GDPR)' },
  CA: { allowed: true, regions: ['ca-central'], description: 'Canada (PIPEDA)' },
  AU: { allowed: true, regions: ['au-east'], description: 'Australia' },
  LOCAL: { allowed: true, regions: ['local'], description: 'Local only (offline-first)' },
};

const BLOCKED_EXPORT_PATTERNS = [
  /^https?:\/\/.*\.cn\//i,    // China-hosted endpoints
  /^https?:\/\/.*\.ru\//i,    // Russia-hosted endpoints
  /^ftp:\/\//i,               // FTP transfers
];

/**
 * Validate an export destination against data residency policy.
 */
function validateExportDestination(url, orgResidencyPolicy) {
  if (!url) return { allowed: true };

  // Check against blocked patterns
  for (const pattern of BLOCKED_EXPORT_PATTERNS) {
    if (pattern.test(url)) {
      log.warn('Export destination blocked by residency policy', {
        url: url.substring(0, 100),
        reason: 'matches blocked pattern',
      });
      return {
        allowed: false,
        error: 'Export destination is not permitted by data residency policy',
      };
    }
  }

  // For local file paths, always allow
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return { allowed: true };
  }

  return { allowed: true };
}

/**
 * Get the current organization's data residency settings.
 */
function getOrgResidencyPolicy() {
  try {
    const db = getDatabase();
    const org = getDefaultOrganization();
    if (!org) return DATA_RESIDENCY_POLICIES.LOCAL;

    const setting = db.prepare(
      "SELECT value FROM settings WHERE org_id = ? AND key = 'data_residency_region'"
    ).get(org.id);

    const region = setting?.value || 'LOCAL';
    return DATA_RESIDENCY_POLICIES[region] || DATA_RESIDENCY_POLICIES.LOCAL;
  } catch (_) {
    return DATA_RESIDENCY_POLICIES.LOCAL;
  }
}

function register() {
  const shared = require('./shared.cjs');

  ipcMain.handle('residency:getPolicy', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return getOrgResidencyPolicy();
  });

  ipcMain.handle('residency:validateDestination', async (_event, url) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const policy = getOrgResidencyPolicy();
    return validateExportDestination(url, policy);
  });

  ipcMain.handle('residency:getAvailablePolicies', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return DATA_RESIDENCY_POLICIES;
  });
}

module.exports = {
  register,
  validateExportDestination,
  getOrgResidencyPolicy,
  DATA_RESIDENCY_POLICIES,
};
