/**
 * TransTrack - Clinical Operations IPC Handlers
 * Handles: risk:*, clock:*, function:invoke
 */

const { ipcMain } = require('electron');
const { getDatabase } = require('../../database/init.cjs');
const riskEngine = require('../../services/riskEngine.cjs');
const transplantClock = require('../../services/transplantClock.cjs');
const shared = require('../shared.cjs');

function register() {
  const db = getDatabase();

  // Risk intelligence
  ipcMain.handle('risk:getDashboard', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return riskEngine.getRiskDashboard(shared.getSessionOrgId());
  });

  ipcMain.handle('risk:getFullReport', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return riskEngine.generateOperationalRiskReport(shared.getSessionOrgId());
  });

  ipcMain.handle('risk:assessPatient', async (event, patientId) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = shared.getSessionOrgId();
    const patient = db.prepare('SELECT * FROM patients WHERE id = ? AND org_id = ?').get(patientId, orgId);
    if (!patient) throw new Error('Patient not found');
    return riskEngine.assessPatientOperationalRisk(patient, orgId);
  });

  // --- transplant clock ---
  ipcMain.handle('clock:getData', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return transplantClock.getTransplantClockData(shared.getSessionOrgId());
  });

  ipcMain.handle('clock:getTimeSinceLastUpdate', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return transplantClock.getTimeSinceLastUpdate(shared.getSessionOrgId());
  });

  ipcMain.handle('clock:getAverageResolutionTime', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return transplantClock.getAverageResolutionTime(shared.getSessionOrgId());
  });

  ipcMain.handle('clock:getNextExpiration', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return transplantClock.getNextExpiration(shared.getSessionOrgId());
  });

  ipcMain.handle('clock:getTaskCounts', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return transplantClock.getTaskCounts(shared.getSessionOrgId());
  });

  ipcMain.handle('clock:getCoordinatorLoad', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return transplantClock.getCoordinatorLoad(shared.getSessionOrgId());
  });

  // Business functions
  ipcMain.handle('function:invoke', async (event, functionName, params) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();

    const functions = require('../../functions/index.cjs');
    if (!functions[functionName]) throw new Error(`Unknown function: ${functionName}`);

    return await functions[functionName](params, { db, currentUser, logAudit: shared.logAudit });
  });
}

module.exports = { register };
