/**
 * MFA IPC handlers.
 * Channels: mfa:status, mfa:beginEnrollment, mfa:confirmEnrollment,
 *           mfa:verifyChallenge, mfa:regenerateBackupCodes, mfa:disable,
 *           mfa:isRequired
 */

'use strict';

const { ipcMain } = require('electron');
const mfa = require('../../services/mfa.cjs');
const shared = require('../shared.cjs');

function requireSession() {
  if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
}

function register() {
  ipcMain.handle('mfa:status', async () => {
    requireSession();
    const { currentUser } = shared.getSessionState();
    return mfa.getStatus(currentUser.id);
  });

  ipcMain.handle('mfa:beginEnrollment', async () => {
    requireSession();
    const { currentUser } = shared.getSessionState();
    const orgId = shared.getSessionOrgId();
    return mfa.beginEnrollment({ userId: currentUser.id, orgId, userEmail: currentUser.email });
  });

  ipcMain.handle('mfa:confirmEnrollment', async (_event, params) => {
    requireSession();
    const { currentUser } = shared.getSessionState();
    const orgId = shared.getSessionOrgId();
    const result = mfa.verifyAndEnableEnrollment({
      userId: currentUser.id,
      orgId,
      secret: params?.secret,
      code: params?.code,
    });
    shared.logAudit('mfa_enroll', 'User', currentUser.id, null,
      JSON.stringify({ enabled: true }), currentUser.email, currentUser.role);
    return result;
  });

  // Used during the login flow — caller passes the user_id obtained from
  // step-1 password verification.
  ipcMain.handle('mfa:verifyChallenge', async (_event, params) => {
    if (!params?.user_id || !params?.code) throw new Error('user_id and code are required');
    return mfa.verifyChallenge({ userId: params.user_id, code: params.code });
  });

  ipcMain.handle('mfa:regenerateBackupCodes', async () => {
    requireSession();
    const { currentUser } = shared.getSessionState();
    const orgId = shared.getSessionOrgId();
    const result = mfa.regenerateBackupCodes({ userId: currentUser.id, orgId });
    shared.logAudit('mfa_backup_regen', 'User', currentUser.id, null, null,
      currentUser.email, currentUser.role);
    return result;
  });

  ipcMain.handle('mfa:disable', async (_event, params = {}) => {
    requireSession();
    const { currentUser } = shared.getSessionState();
    // Only allow self-disable, or admin disabling another user
    let targetUserId = currentUser.id;
    if (params.user_id && params.user_id !== currentUser.id) {
      if (currentUser.role !== 'admin') {
        throw new Error('Admin access required to disable MFA for another user');
      }
      targetUserId = params.user_id;
    }
    const r = mfa.disable({ userId: targetUserId });
    shared.logAudit('mfa_disable', 'User', targetUserId, null, null,
      currentUser.email, currentUser.role);
    return r;
  });

  ipcMain.handle('mfa:isRequired', async (_event, userId) => {
    const { getDatabase } = require('../../database/init.cjs');
    const row = getDatabase().prepare('SELECT mfa_required FROM users WHERE id = ?').get(userId);
    return { required: !!(row && row.mfa_required) };
  });
}

module.exports = { register };
