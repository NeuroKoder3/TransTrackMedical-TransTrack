/**
 * TransTrack — License IPC handlers.
 *
 * Channels:
 *   license:getInfo            -> {LicenseInfo} (always available, even pre-login)
 *   license:getMachineId       -> string  (the fingerprint to send to sales for binding)
 *   license:activate           -> {success, ...}  (requires admin)
 *   license:remove             -> {success}       (requires admin)
 *   license:checkFeature       -> {enabled, reason?}
 *   license:checkLimit         -> {withinLimit, current, limit, remaining}
 *
 * Authentication: read methods (getInfo, getMachineId, checkFeature,
 * checkLimit) are intentionally callable WITHOUT a valid session because
 * the renderer needs to display the activation screen before any user
 * logs in. Mutating methods (activate, remove) require an admin session.
 */

'use strict';

const { ipcMain } = require('electron');
const manager = require('../../license/manager.cjs');
const shared = require('../shared.cjs');

function register() {
  ipcMain.handle('license:getInfo', () => {
    return manager.getLicenseInfo();
  });

  ipcMain.handle('license:getMachineId', () => {
    return manager.getMachineId();
  });

  ipcMain.handle('license:activate', async (_event, licenseWire) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    if (!currentUser || currentUser.role !== 'admin') {
      throw new Error('Admin access required to activate a license.');
    }
    const result = await manager.activateLicense(licenseWire);
    if (result.success) {
      shared.logAudit('update', 'License', result.orgId || null, null,
        `License activated for ${result.tierName || result.tier} tier`,
        currentUser.email, currentUser.role);
    } else {
      shared.logAudit('update', 'License', null, null,
        `License activation failed: ${result.error}`,
        currentUser.email, currentUser.role);
    }
    return result;
  });

  ipcMain.handle('license:remove', async (_event) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    if (!currentUser || currentUser.role !== 'admin') {
      throw new Error('Admin access required to remove a license.');
    }
    manager.removeLicense();
    shared.logAudit('delete', 'License', null, null, 'License removed; reverted to trial mode',
      currentUser.email, currentUser.role);
    return { success: true };
  });

  ipcMain.handle('license:checkFeature', (_event, featureFlag) => {
    return manager.checkFeature(featureFlag);
  });

  ipcMain.handle('license:checkLimit', (_event, limitType, currentCount) => {
    return manager.checkLimit(limitType, currentCount);
  });
}

module.exports = { register };
