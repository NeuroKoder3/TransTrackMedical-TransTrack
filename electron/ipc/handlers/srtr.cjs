/**
 * TransTrack - SRTR/CMS Readiness IPC Handlers
 * Handles: srtr:getDashboard, srtr:saveSnapshot, srtr:getHistory,
 *          srtr:getCMSChecklist, srtr:computeCurrent
 * 
 * NON-CLINICAL: These metrics are operational approximations and
 * do NOT replace official SRTR reports or CMS survey data.
 */

const { ipcMain } = require('electron');
const srtrService = require('../../services/srtrService.cjs');
const shared = require('../shared.cjs');

function register() {
  ipcMain.handle('srtr:getDashboard', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = shared.getSessionOrgId();
    return srtrService.getDashboard(orgId);
  });

  ipcMain.handle('srtr:saveSnapshot', async (_event, periodLabel) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    const orgId = shared.getSessionOrgId();
    const snapshot = srtrService.saveMetricSnapshot(orgId, periodLabel, currentUser.email);
    shared.logAudit('create', 'SRTRMetric', snapshot.id, null, 'SRTR metric snapshot saved', currentUser.email, currentUser.role);
    return snapshot;
  });

  ipcMain.handle('srtr:getHistory', async (_event, limit) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = shared.getSessionOrgId();
    return srtrService.getMetricHistory(orgId, limit || 12);
  });

  ipcMain.handle('srtr:getCMSChecklist', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    const orgId = shared.getSessionOrgId();
    shared.logAudit('view', 'CMSChecklist', null, null, 'CMS readiness checklist viewed', currentUser.email, currentUser.role);
    return srtrService.getCMSChecklist(orgId);
  });

  ipcMain.handle('srtr:computeCurrent', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = shared.getSessionOrgId();
    return srtrService.computeCurrentMetrics(orgId);
  });
}

module.exports = { register };
