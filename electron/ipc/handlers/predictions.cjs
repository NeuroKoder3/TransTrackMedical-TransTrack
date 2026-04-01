/**
 * TransTrack - Predictive Inactivation IPC Handlers
 * Handles: predictions:getDashboard, predictions:runAll, predictions:getCurrent,
 *          predictions:getPatientHistory
 * 
 * NON-CLINICAL: These predictions are operational risk indicators only.
 */

const { ipcMain } = require('electron');
const predictiveService = require('../../services/predictiveService.cjs');
const shared = require('../shared.cjs');

function register() {
  ipcMain.handle('predictions:getDashboard', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = shared.getSessionOrgId();
    return predictiveService.getPredictionDashboard(orgId);
  });

  ipcMain.handle('predictions:runAll', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    const orgId = shared.getSessionOrgId();
    const result = predictiveService.runPredictions(orgId);
    shared.logAudit('execute', 'InactivationPrediction', null, null, `Predictions computed for ${result.patientsScored} patients`, currentUser.email, currentUser.role);
    return result;
  });

  ipcMain.handle('predictions:getCurrent', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = shared.getSessionOrgId();
    return predictiveService.getCurrentPredictions(orgId);
  });

  ipcMain.handle('predictions:getPatientHistory', async (_event, patientId, limit) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = shared.getSessionOrgId();
    return predictiveService.getPatientPredictionHistory(orgId, patientId, limit || 10);
  });
}

module.exports = { register };
