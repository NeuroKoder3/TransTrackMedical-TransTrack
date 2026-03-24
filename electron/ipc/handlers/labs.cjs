/**
 * TransTrack - Lab Results IPC Handlers
 * Handles: labs:*
 *
 * Strictly NON-CLINICAL and NON-ALLOCATIVE.
 * Lab results are stored for DOCUMENTATION COMPLETENESS only.
 *
 * Security:
 *  - wrapHandler() for standardized error handling + session validation
 *  - Org-scoped data access
 */

const { ipcMain } = require('electron');
const labsService = require('../../services/labsService.cjs');
const shared = require('../shared.cjs');

function register() {
  // Static lookups (no auth required)
  ipcMain.handle('labs:getCodes', async () => labsService.COMMON_LAB_CODES);
  ipcMain.handle('labs:getSources', async () => labsService.LAB_SOURCES);

  ipcMain.handle('labs:create', shared.wrapHandler(async (event, data) => {
    const { currentUser } = shared.getSessionState();
    return labsService.createLabResult(data, shared.getSessionOrgId(), currentUser.id, currentUser.email);
  }));

  ipcMain.handle('labs:get', shared.wrapHandler(async (event, id) => {
    return labsService.getLabResultById(id, shared.getSessionOrgId());
  }));

  ipcMain.handle('labs:getByPatient', shared.wrapHandler(async (event, patientId, options) => {
    return labsService.getLabResultsByPatient(patientId, shared.getSessionOrgId(), options);
  }));

  ipcMain.handle('labs:getLatestByPatient', shared.wrapHandler(async (event, patientId) => {
    return labsService.getLatestLabsByPatient(patientId, shared.getSessionOrgId());
  }));

  ipcMain.handle('labs:update', shared.wrapHandler(async (event, id, data) => {
    const { currentUser } = shared.getSessionState();
    return labsService.updateLabResult(id, data, shared.getSessionOrgId(), currentUser.id, currentUser.email);
  }));

  ipcMain.handle('labs:delete', shared.wrapHandler(async (event, id) => {
    const { currentUser } = shared.getSessionState();
    if (currentUser.role !== 'admin' && currentUser.role !== 'coordinator') {
      throw shared.createStandardError('UNAUTHORIZED', null, 'Coordinator or admin access required to delete lab results');
    }
    return labsService.deleteLabResult(id, shared.getSessionOrgId(), currentUser.email);
  }));

  ipcMain.handle('labs:getPatientStatus', shared.wrapHandler(async (event, patientId) => {
    return labsService.getPatientLabStatus(patientId, shared.getSessionOrgId());
  }));

  ipcMain.handle('labs:getDashboard', shared.wrapHandler(async () => {
    return labsService.getLabsDashboard(shared.getSessionOrgId());
  }));

  ipcMain.handle('labs:getRequiredTypes', shared.wrapHandler(async (event, organType) => {
    return labsService.getRequiredLabTypes(shared.getSessionOrgId(), organType);
  }));
}

module.exports = { register };
