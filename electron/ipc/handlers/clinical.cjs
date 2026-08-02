/**
 * TransTrack - Clinical Operations IPC Handlers
 * Handles: risk:*, clock:*, function:invoke
 */

const { ipcMain } = require('electron');
const { getDatabase } = require('../../database/init.cjs');
const riskEngine = require('../../services/riskEngine.cjs');
const transplantClock = require('../../services/transplantClock.cjs');
const { hasPermission, PERMISSIONS } = require('../../services/accessControl.cjs');
const shared = require('../shared.cjs');

/**
 * The complete set of names `function:invoke` will dispatch, each mapped to the
 * permission the caller must hold.
 *
 * `function:invoke` is dynamic dispatch into functions/index.cjs, and it used to
 * accept any exported name from any authenticated session. That surface
 * includes importFHIRData (writes patient records from an external payload),
 * pushToEHR (sends patient data to a configured external system) and
 * exportWaitlist (returns the whole candidate list) — so a read-only `viewer`
 * could import, export and transmit.
 *
 * The mapping lives here, not in functions/index.cjs, deliberately: the IPC
 * boundary is where authorisation belongs, and keeping the list on this side
 * means a new export is unreachable until someone decides what it costs.
 *
 * Entries whose permission is REPORT_EXPORT or PATIENT_CREATE/UPDATE are the
 * ones that move PHI; the rest are read-side calculations.
 */
const INVOCABLE_FUNCTIONS = Object.freeze({
  // Scoring and matching: read patient and donor data, write nothing.
  calculatePriorityAdvanced: PERMISSIONS.PATIENT_VIEW,
  calculatePriority: PERMISSIONS.PATIENT_VIEW,
  matchDonorAdvanced: PERMISSIONS.MATCH_VIEW,
  matchDonor: PERMISSIONS.MATCH_VIEW,
  checkNotificationRules: PERMISSIONS.PATIENT_VIEW,

  // Disclosure: the result leaves the application.
  exportWaitlist: PERMISSIONS.REPORT_EXPORT,
  exportToFHIR: PERMISSIONS.REPORT_EXPORT,
  pushToEHR: PERMISSIONS.REPORT_EXPORT,

  // Ingest: creates or amends patient records from an external payload.
  importFHIRData: PERMISSIONS.PATIENT_CREATE,
  fhirWebhook: PERMISSIONS.PATIENT_CREATE,

  // Validation only — parses a payload and reports on it without persisting.
  validateFHIRData: PERMISSIONS.PATIENT_VIEW,

  // Renderer-side error reporting.
  logError: PERMISSIONS.PATIENT_VIEW,
});

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
    const currentUser = shared.validateSession()
      ? shared.getSessionState().currentUser
      : null;
    if (!currentUser) throw new Error('Session expired. Please log in again.');

    // Deny by default: a name absent from the allowlist is refused before the
    // module is even consulted, so adding an export to functions/index.cjs
    // cannot quietly publish a new privileged IPC entry point.
    if (!Object.prototype.hasOwnProperty.call(INVOCABLE_FUNCTIONS, functionName)) {
      throw new Error(`Unknown function: ${functionName}`);
    }
    const required = INVOCABLE_FUNCTIONS[functionName];
    if (!hasPermission(currentUser.role, required)) {
      throw new Error(
        `Permission denied: invoking "${functionName}" requires the "${required}" permission`
      );
    }

    const functions = require('../../functions/index.cjs');
    if (typeof functions[functionName] !== 'function') {
      throw new Error(`Unknown function: ${functionName}`);
    }

    return await functions[functionName](params, { db, currentUser, logAudit: shared.logAudit });
  });
}

module.exports = { register };
