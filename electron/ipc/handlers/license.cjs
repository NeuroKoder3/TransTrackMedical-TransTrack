/**
 * TransTrack - License Management IPC Handlers
 * Handles: license:*
 *
 * Security:
 *  - wrapHandler() for standardized error handling + session validation
 *  - Admin-gated operations for activation, renewal, and org updates
 *  - Request-ID tracing
 */

const { ipcMain } = require('electron');
const { v4: uuidv4 } = require('uuid');
const { getDatabase, getOrgLicense, getPatientCount, getUserCount } = require('../../database/init.cjs');
const licenseManager = require('../../license/manager.cjs');
const featureGate = require('../../license/featureGate.cjs');
const { FEATURES, LICENSE_TIER, LICENSE_FEATURES, isEvaluationBuild } = require('../../license/tiers.cjs');
const shared = require('../shared.cjs');
const { createContext, endContext } = require('../requestContext.cjs');

function register() {
  const db = getDatabase();

  ipcMain.handle('license:getInfo', shared.wrapHandler(async () => {
    const orgId = shared.getSessionOrgId();
    const license = getOrgLicense(orgId);
    const tier = license?.tier || LICENSE_TIER.EVALUATION;
    const features = LICENSE_FEATURES[tier] || LICENSE_FEATURES[LICENSE_TIER.EVALUATION];
    return {
      tier, features, license,
      usage: { patients: getPatientCount(orgId), users: getUserCount(orgId) },
      limits: { maxPatients: features.maxPatients, maxUsers: features.maxUsers },
    };
  }));

  ipcMain.handle('license:activate', shared.wrapHandler(async (event, licenseKey, customerInfo) => {
    const { currentUser } = shared.getSessionState();
    if (currentUser.role !== 'admin') throw shared.createStandardError('ADMIN_REQUIRED');

    const orgId = shared.getSessionOrgId();
    if (isEvaluationBuild()) {
      throw shared.createStandardError('FEATURE_UNAVAILABLE', null, 'Cannot activate license on Evaluation build. Please download the Enterprise version.');
    }

    const ctx = createContext({ orgId: currentUser.org_id, userId: currentUser.id, userEmail: currentUser.email, userRole: currentUser.role });
    try {
      const result = await licenseManager.activateLicense(licenseKey, { ...customerInfo, orgId });
      if (result.success) {
        const now = new Date().toISOString();
        const existingLicense = getOrgLicense(orgId);

        if (existingLicense) {
          db.prepare(
            'UPDATE licenses SET license_key = ?, tier = ?, activated_at = ?, maintenance_expires_at = ?, customer_name = ?, customer_email = ?, updated_at = ? WHERE org_id = ?'
          ).run(licenseKey, result.tier, now, result.maintenanceExpiry, customerInfo?.name || '', customerInfo?.email || '', now, orgId);
        } else {
          db.prepare(
            'INSERT INTO licenses (id, org_id, license_key, tier, activated_at, maintenance_expires_at, customer_name, customer_email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
          ).run(uuidv4(), orgId, licenseKey, result.tier, now, result.maintenanceExpiry, customerInfo?.name || '', customerInfo?.email || '', now, now);
        }

        shared.logAudit('license_activated', 'License', orgId, null, `License activated: ${result.tier}`, currentUser.email, currentUser.role, ctx.requestId);
      }
      return result;
    } finally {
      endContext(ctx.requestId);
    }
  }));

  ipcMain.handle('license:checkFeature', shared.wrapHandler(async (event, featureName) => {
    return { enabled: shared.sessionHasFeature(featureName), tier: shared.getSessionTier() };
  }));

  ipcMain.handle('license:renewMaintenance', shared.wrapHandler(async (event, renewalKey, years) => {
    const { currentUser } = shared.getSessionState();
    if (currentUser.role !== 'admin') throw shared.createStandardError('ADMIN_REQUIRED');

    const ctx = createContext({ orgId: currentUser.org_id, userId: currentUser.id, userEmail: currentUser.email, userRole: currentUser.role });
    try {
      const result = await licenseManager.renewMaintenance(renewalKey, years);
      shared.logAudit('maintenance_renewed', 'License', null, null, `Maintenance renewed for ${years} year(s)`, currentUser.email, currentUser.role, ctx.requestId);
      return result;
    } finally {
      endContext(ctx.requestId);
    }
  }));

  ipcMain.handle('license:isValid', async () => licenseManager.isLicenseValid());
  ipcMain.handle('license:getTier', async () => licenseManager.getCurrentTier());

  ipcMain.handle('license:getLimits', async () => {
    const tier = licenseManager.getCurrentTier();
    return licenseManager.getTierLimits(tier);
  });

  ipcMain.handle('license:checkLimit', async (event, limitType, currentCount) => featureGate.canWithinLimit(limitType, currentCount));
  ipcMain.handle('license:getAppState', async () => featureGate.checkApplicationState());
  ipcMain.handle('license:getPaymentOptions', async () => licenseManager.getAllPaymentOptions());
  ipcMain.handle('license:getPaymentInfo', async (event, tier) => licenseManager.getPaymentInfo(tier));
  ipcMain.handle('license:getOrganization', async () => licenseManager.getOrganizationInfo());

  ipcMain.handle('license:updateOrganization', shared.wrapHandler(async (event, updates) => {
    const { currentUser } = shared.getSessionState();
    if (currentUser.role !== 'admin') throw shared.createStandardError('ADMIN_REQUIRED');
    return licenseManager.updateOrganizationInfo(updates);
  }));

  ipcMain.handle('license:getMaintenanceStatus', async () => licenseManager.getMaintenanceStatus());

  ipcMain.handle('license:getAuditHistory', shared.wrapHandler(async (event, limit) => {
    return licenseManager.getLicenseAuditHistory(limit);
  }));

  ipcMain.handle('license:isEvaluationBuild', async () => licenseManager.isEvaluationBuild());

  ipcMain.handle('license:getEvaluationStatus', async () => ({
    isEvaluation: licenseManager.isEvaluationMode(),
    daysRemaining: licenseManager.getEvaluationDaysRemaining(),
    expired: licenseManager.isEvaluationExpired(),
    inGracePeriod: licenseManager.isInEvaluationGracePeriod(),
  }));

  ipcMain.handle('license:getAllFeatures', async () => {
    return Object.values(FEATURES).map(feature => ({
      feature,
      ...featureGate.canAccessFeature(feature),
    }));
  });

  ipcMain.handle('license:checkFullAccess', async (event, options) => featureGate.checkFullAccess(options));
}

module.exports = { register };
