/**
 * TransTrack - Clinical Operations IPC Handlers
 * Handles: risk:*, clock:*, function:invoke
 *
 * Security:
 *  - wrapHandler() for standardized error handling + session validation
 *  - Org-scoped data access
 *  - Request-ID tracing
 */

const { ipcMain } = require('electron');
const { getDatabase } = require('../../database/init.cjs');
const riskEngine = require('../../services/riskEngine.cjs');
const transplantClock = require('../../services/transplantClock.cjs');
const shared = require('../shared.cjs');
const { createContext, endContext } = require('../requestContext.cjs');

function register() {
  const db = getDatabase();

  // ===== OPERATIONAL RISK INTELLIGENCE =====
  ipcMain.handle('risk:getDashboard', shared.wrapHandler(async () => {
    return riskEngine.getRiskDashboard();
  }));

  ipcMain.handle('risk:getFullReport', shared.wrapHandler(async () => {
    return riskEngine.generateOperationalRiskReport();
  }));

  ipcMain.handle('risk:assessPatient', shared.wrapHandler(async (event, patientId) => {
    const orgId = shared.getSessionOrgId();
    const patient = db.prepare('SELECT * FROM patients WHERE id = ? AND org_id = ?').get(patientId, orgId);
    if (!patient) throw shared.createStandardError('NOT_FOUND', null, 'Patient not found');
    return riskEngine.assessPatientOperationalRisk(patient);
  }));

  // ===== TRANSPLANT CLOCK =====
  ipcMain.handle('clock:getData', shared.wrapHandler(async () => {
    return transplantClock.getTransplantClockData(shared.getSessionOrgId());
  }));

  ipcMain.handle('clock:getTimeSinceLastUpdate', shared.wrapHandler(async () => {
    return transplantClock.getTimeSinceLastUpdate(shared.getSessionOrgId());
  }));

  ipcMain.handle('clock:getAverageResolutionTime', shared.wrapHandler(async () => {
    return transplantClock.getAverageResolutionTime(shared.getSessionOrgId());
  }));

  ipcMain.handle('clock:getNextExpiration', shared.wrapHandler(async () => {
    return transplantClock.getNextExpiration(shared.getSessionOrgId());
  }));

  ipcMain.handle('clock:getTaskCounts', shared.wrapHandler(async () => {
    return transplantClock.getTaskCounts(shared.getSessionOrgId());
  }));

  ipcMain.handle('clock:getCoordinatorLoad', shared.wrapHandler(async () => {
    return transplantClock.getCoordinatorLoad(shared.getSessionOrgId());
  }));

  // ===== BUSINESS FUNCTIONS =====
  ipcMain.handle('function:invoke', shared.wrapHandler(async (event, functionName, params) => {
    const { currentUser } = shared.getSessionState();
    const ctx = createContext({ orgId: currentUser.org_id, userId: currentUser.id, userEmail: currentUser.email, userRole: currentUser.role });

    try {
      const functions = require('../../functions/index.cjs');
      if (!functions[functionName]) throw shared.createStandardError('VALIDATION_ERROR', null, `Unknown function: ${functionName}`);
      return await functions[functionName](params, { db, currentUser, logAudit: shared.logAudit, requestId: ctx.requestId });
    } finally {
      endContext(ctx.requestId);
    }
  }));
}

module.exports = { register };
