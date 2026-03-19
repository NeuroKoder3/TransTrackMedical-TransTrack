/**
 * TransTrack - Lab Results IPC Handlers
 * Handles: labs:*
 *
 * Strictly NON-CLINICAL and NON-ALLOCATIVE.
 * Lab results are stored for DOCUMENTATION COMPLETENESS only.
 */

const { ipcMain } = require('electron');
const labsService = require('../../services/labsService.cjs');
const shared = require('../shared.cjs');

function register() {
  ipcMain.handle('labs:getCodes', async () => labsService.COMMON_LAB_CODES);
  ipcMain.handle('labs:getSources', async () => labsService.LAB_SOURCES);

  ipcMain.handle('labs:create', async (event, data) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    return labsService.createLabResult(data, shared.getSessionOrgId(), currentUser.id, currentUser.email);
  });

  ipcMain.handle('labs:get', async (event, id) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return labsService.getLabResultById(id, shared.getSessionOrgId());
  });

  ipcMain.handle('labs:getByPatient', async (event, patientId, options) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return labsService.getLabResultsByPatient(patientId, shared.getSessionOrgId(), options);
  });

  ipcMain.handle('labs:getLatestByPatient', async (event, patientId) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return labsService.getLatestLabsByPatient(patientId, shared.getSessionOrgId());
  });

  ipcMain.handle('labs:update', async (event, id, data) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    return labsService.updateLabResult(id, data, shared.getSessionOrgId(), currentUser.id, currentUser.email);
  });

  ipcMain.handle('labs:delete', async (event, id) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    if (currentUser.role !== 'admin' && currentUser.role !== 'coordinator') {
      throw new Error('Coordinator or admin access required to delete lab results');
    }
    return labsService.deleteLabResult(id, shared.getSessionOrgId(), currentUser.email);
  });

  ipcMain.handle('labs:getPatientStatus', async (event, patientId) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return labsService.getPatientLabStatus(patientId, shared.getSessionOrgId());
  });

  ipcMain.handle('labs:getDashboard', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return labsService.getLabsDashboard(shared.getSessionOrgId());
  });

  ipcMain.handle('labs:getRequiredTypes', async (event, organType) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return labsService.getRequiredLabTypes(shared.getSessionOrgId(), organType);
  });
}

module.exports = { register };
