/**
 * TransTrack - License Management IPC Handlers
 * Handles: license:*
 */

const { ipcMain } = require('electron');
const { v4: uuidv4 } = require('uuid');
const { getDatabase, getOrgLicense, getPatientCount, getUserCount } = require('../../database/init.cjs');
const licenseManager = require('../../license/manager.cjs');
const featureGate = require('../../license/featureGate.cjs');
const { FEATURES, LICENSE_TIER, LICENSE_FEATURES, isEvaluationBuild } = require('../../license/tiers.cjs');
const shared = require('../shared.cjs');

function register() {
  const db = getDatabase();

  ipcMain.handle('license:getInfo', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = shared.getSessionOrgId();
    const license = getOrgLicense(orgId);
    const tier = license?.tier || LICENSE_TIER.EVALUATION;
    const features = LICENSE_FEATURES[tier] || LICENSE_FEATURES[LICENSE_TIER.EVALUATION];
    return {
      tier, features, license,
      usage: { patients: getPatientCount(orgId), users: getUserCount(orgId) },
      limits: { maxPatients: features.maxPatients, maxUsers: features.maxUsers },
    };
  });

  ipcMain.handle('license:activate', async (event, licenseKey, customerInfo) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    if (currentUser.role !== 'admin') throw new Error('Admin access required');

    const orgId = shared.getSessionOrgId();
    if (isEvaluationBuild()) {
      throw new Error('Cannot activate license on Evaluation build. Please download the Enterprise version.');
    }

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

      shared.logAudit('license_activated', 'License', orgId, null, `License activated: ${result.tier}`, currentUser.email, currentUser.role);
    }
    return result;
  });

  ipcMain.handle('license:checkFeature', async (event, featureName) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return { enabled: shared.sessionHasFeature(featureName), tier: shared.getSessionTier() };
  });

  ipcMain.handle('license:renewMaintenance', async (event, renewalKey, years) => {
    const { currentUser } = shared.getSessionState();
    if (!currentUser) throw new Error('Not authenticated');
    if (currentUser.role !== 'admin') throw new Error('Admin access required');
    const result = await licenseManager.renewMaintenance(renewalKey, years);
    shared.logAudit('maintenance_renewed', 'License', null, null, `Maintenance renewed for ${years} year(s)`, currentUser.email, currentUser.role);
    return result;
  });

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

  ipcMain.handle('license:updateOrganization', async (event, updates) => {
    const { currentUser } = shared.getSessionState();
    if (!currentUser) throw new Error('Not authenticated');
    if (currentUser.role !== 'admin') throw new Error('Admin access required');
    return licenseManager.updateOrganizationInfo(updates);
  });

  ipcMain.handle('license:getMaintenanceStatus', async () => licenseManager.getMaintenanceStatus());

  ipcMain.handle('license:getAuditHistory', async (event, limit) => {
    const { currentUser } = shared.getSessionState();
    if (!currentUser) throw new Error('Not authenticated');
    return licenseManager.getLicenseAuditHistory(limit);
  });

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
