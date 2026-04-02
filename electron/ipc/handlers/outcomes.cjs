/**
 * TransTrack - Outcomes Tracking IPC Handlers
 * Handles: outcomes:getDashboard, outcomes:saveSnapshot, outcomes:getSnapshots,
 *          outcomes:computeCurrent
 */

const { ipcMain } = require('electron');
const outcomesService = require('../../services/outcomesService.cjs');
const shared = require('../shared.cjs');

function register() {
  ipcMain.handle('outcomes:getDashboard', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = shared.getSessionOrgId();
    return outcomesService.getDashboard(orgId);
  });

  ipcMain.handle('outcomes:saveSnapshot', async (_event, periodStart, periodEnd) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    const orgId = shared.getSessionOrgId();
    const snapshot = outcomesService.saveSnapshot(orgId, periodStart, periodEnd, currentUser.email);
    shared.logAudit('create', 'OutcomesSnapshot', snapshot.id, null, 'Outcomes snapshot saved', currentUser.email, currentUser.role);
    return snapshot;
  });

  ipcMain.handle('outcomes:getSnapshots', async (_event, limit) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = shared.getSessionOrgId();
    return outcomesService.getSnapshots(orgId, limit || 12);
  });

  ipcMain.handle('outcomes:computeCurrent', async (_event, periodStart, periodEnd) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = shared.getSessionOrgId();
    return outcomesService.computeOutcomesSnapshot(orgId, periodStart, periodEnd);
  });
}

module.exports = { register };
