/**
 * TransTrack - Lab Results IPC Handlers
 * Handles: labs:*
 *
 * Strictly NON-CLINICAL and NON-ALLOCATIVE.
 * Lab results are stored for DOCUMENTATION COMPLETENESS only.
 *
 * Authorisation: a lab result is a clinical record attached to a named patient,
 * so reads require PATIENT_VIEW and writes require PATIENT_UPDATE. Every handler
 * below used to check only that a session existed, which let a read-only
 * `viewer` create and amend results.
 */

const { ipcMain } = require('electron');
const labsService = require('../../services/labsService.cjs');
const { PERMISSIONS } = require('../../services/accessControl.cjs');
const shared = require('../shared.cjs');

function register() {
  // Reference data only: LOINC-style codes and source names, no patient content.
  ipcMain.handle('labs:getCodes', async () => labsService.COMMON_LAB_CODES);
  ipcMain.handle('labs:getSources', async () => labsService.LAB_SOURCES);

  ipcMain.handle('labs:create', async (event, data) => {
    const currentUser = shared.requirePermission(PERMISSIONS.PATIENT_UPDATE, 'recording a lab result');
    return labsService.createLabResult(data, shared.getSessionOrgId(), currentUser.id, currentUser.email);
  });

  ipcMain.handle('labs:get', async (event, id) => {
    shared.requirePermission(PERMISSIONS.PATIENT_VIEW, 'reading a lab result');
    return labsService.getLabResultById(id, shared.getSessionOrgId());
  });

  ipcMain.handle('labs:getByPatient', async (event, patientId, options) => {
    shared.requirePermission(PERMISSIONS.PATIENT_VIEW, 'reading lab results');
    return labsService.getLabResultsByPatient(patientId, shared.getSessionOrgId(), options);
  });

  ipcMain.handle('labs:getLatestByPatient', async (event, patientId) => {
    shared.requirePermission(PERMISSIONS.PATIENT_VIEW, 'reading lab results');
    return labsService.getLatestLabsByPatient(patientId, shared.getSessionOrgId());
  });

  ipcMain.handle('labs:update', async (event, id, data) => {
    const currentUser = shared.requirePermission(PERMISSIONS.PATIENT_UPDATE, 'amending a lab result');
    return labsService.updateLabResult(id, data, shared.getSessionOrgId(), currentUser.id, currentUser.email);
  });

  ipcMain.handle('labs:delete', async (event, id) => {
    const currentUser = shared.requirePermission(PERMISSIONS.PATIENT_UPDATE, 'deleting a lab result');
    // Narrower than the permission above: removing documentation is an act of
    // record management, not clinical data entry.
    if (currentUser.role !== 'admin' && currentUser.role !== 'coordinator') {
      throw new Error('Coordinator or admin access required to delete lab results');
    }
    return labsService.deleteLabResult(id, shared.getSessionOrgId(), currentUser.email);
  });

  ipcMain.handle('labs:getPatientStatus', async (event, patientId) => {
    shared.requirePermission(PERMISSIONS.PATIENT_VIEW, 'reading lab completeness for a patient');
    return labsService.getPatientLabStatus(patientId, shared.getSessionOrgId());
  });

  ipcMain.handle('labs:getDashboard', async () => {
    shared.requirePermission(PERMISSIONS.PATIENT_VIEW, 'reading the labs dashboard');
    return labsService.getLabsDashboard(shared.getSessionOrgId());
  });

  ipcMain.handle('labs:getRequiredTypes', async (event, organType) => {
    shared.requirePermission(PERMISSIONS.PATIENT_VIEW, 'reading required lab types');
    return labsService.getRequiredLabTypes(shared.getSessionOrgId(), organType);
  });
}

module.exports = { register };
