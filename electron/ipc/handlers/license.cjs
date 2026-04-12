/**
 * TransTrack - License Management IPC Handlers
 * Handles: license:*
 *
 * PRE-AUTH handlers (no session required):
 *   These must work before the user logs in so the renderer can
 *   check license status, show the activation page, and let the
 *   user activate a key on first launch.
 *
 * POST-AUTH handlers (session required):
 *   These deal with session-scoped data or privileged operations
 *   that should only be available after login.
 */

const { ipcMain } = require('electron');
const { v4: uuidv4 } = require('uuid');
const { getDatabase, getDefaultOrganization, getOrgLicense, getPatientCount, getUserCount } = require('../../database/init.cjs');
const licenseManager = require('../../license/manager.cjs');
const featureGate = require('../../license/featureGate.cjs');
const { FEATURES, LICENSE_TIER, LICENSE_FEATURES, isEvaluationBuild } = require('../../license/tiers.cjs');
const shared = require('../shared.cjs');

function register() {
  const db = getDatabase();

  // ── PRE-AUTH: these work before login ────────────────────────
  // SECURITY NOTE: these are safe because Electron IPC is local-only
  // (renderer ↔ main within the same process). No data leaves the machine.

  ipcMain.handle('license:isValid', async () => {
    return licenseManager.isLicenseValid();
  });

  ipcMain.handle('license:isEvaluationBuild', async () => {
    return licenseManager.isEvaluationBuild();
  });

  ipcMain.handle('license:getEvaluationStatus', async () => {
    return {
      isEvaluation: licenseManager.isEvaluationMode(),
      daysRemaining: licenseManager.getEvaluationDaysRemaining(),
      expired: licenseManager.isEvaluationExpired(),
      inGracePeriod: licenseManager.isInEvaluationGracePeriod(),
    };
  });

  ipcMain.handle('license:getOrganization', async () => {
    return licenseManager.getOrganizationInfo();
  });

  ipcMain.handle('license:getTier', async () => {
    return licenseManager.getCurrentTier();
  });

  ipcMain.handle('license:getAppState', async () => {
    return featureGate.checkApplicationState();
  });

  ipcMain.handle('license:getPaymentOptions', async () => {
    return licenseManager.getAllPaymentOptions();
  });

  ipcMain.handle('license:getPaymentInfo', async (event, tier) => {
    return licenseManager.getPaymentInfo(tier);
  });

  ipcMain.handle('license:getInfo', async () => {
    if (shared.validateSession()) {
      const orgId = shared.getSessionOrgId();
      const license = getOrgLicense(orgId);
      const tier = license?.tier || LICENSE_TIER.EVALUATION;
      const features = LICENSE_FEATURES[tier] || LICENSE_FEATURES[LICENSE_TIER.EVALUATION];
      return {
        tier, features, license,
        usage: { patients: getPatientCount(orgId), users: getUserCount(orgId) },
        limits: { maxPatients: features.maxPatients, maxUsers: features.maxUsers },
      };
    }

    const info = licenseManager.getLicenseInfo();
    const tier = info.tier || LICENSE_TIER.EVALUATION;
    const features = LICENSE_FEATURES[tier] || LICENSE_FEATURES[LICENSE_TIER.EVALUATION];
    const defaultOrg = getDefaultOrganization();
    return {
      ...info,
      tier, features,
      usage: defaultOrg
        ? { patients: getPatientCount(defaultOrg.id), users: getUserCount(defaultOrg.id) }
        : { patients: 0, users: 0 },
      limits: { maxPatients: features.maxPatients, maxUsers: features.maxUsers },
    };
  });

  ipcMain.handle('license:activate', async (event, licenseKey, customerInfo) => {
    const hasSession = shared.validateSession();
    if (hasSession) {
      const { currentUser } = shared.getSessionState();
      if (currentUser.role !== 'admin') throw new Error('Admin access required');
    }

    if (isEvaluationBuild()) {
      throw new Error('Cannot activate license on Evaluation build. Please download the Enterprise version.');
    }

    const orgId = hasSession
      ? shared.getSessionOrgId()
      : getDefaultOrganization()?.id;

    if (!orgId) {
      throw new Error('No organization found. Please set up your organization before activating a license.');
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

      if (hasSession) {
        const { currentUser } = shared.getSessionState();
        shared.logAudit('license_activated', 'License', orgId, null, `License activated: ${result.tier}`, currentUser.email, currentUser.role);
      }
    }
    return result;
  });

  // ── POST-AUTH: these require a valid session ─────────────────

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

  ipcMain.handle('license:getLimits', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const tier = licenseManager.getCurrentTier();
    return licenseManager.getTierLimits(tier);
  });

  ipcMain.handle('license:checkLimit', async (event, limitType, currentCount) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return featureGate.canWithinLimit(limitType, currentCount);
  });

  ipcMain.handle('license:updateOrganization', async (event, updates) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    if (!currentUser || currentUser.role !== 'admin') throw new Error('Admin access required');
    return licenseManager.updateOrganizationInfo(updates);
  });

  ipcMain.handle('license:getMaintenanceStatus', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return licenseManager.getMaintenanceStatus();
  });

  ipcMain.handle('license:getAuditHistory', async (event, limit) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return licenseManager.getLicenseAuditHistory(limit);
  });

  ipcMain.handle('license:getAllFeatures', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return Object.values(FEATURES).map(feature => ({
      feature,
      ...featureGate.canAccessFeature(feature),
    }));
  });

  ipcMain.handle('license:checkFullAccess', async (event, options) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return featureGate.checkFullAccess(options);
  });
}

module.exports = { register };
