/**
 * Post-transplant follow-up IPC handlers.
 * Channels: postTx:createEvent, postTx:updateEvent, postTx:listEventsByPatient,
 *           postTx:createImmuno, postTx:listImmunoByPatient,
 *           postTx:createRejection, postTx:listRejectionsByPatient,
 *           postTx:createBiopsy, postTx:listBiopsiesByPatient,
 *           postTx:createReadmission, postTx:listReadmissionsByPatient,
 *           postTx:getPatientSummary
 *
 * Authorisation: every record here belongs to a named recipient and describes
 * their post-operative course, so reads require PATIENT_VIEW and writes require
 * PATIENT_UPDATE. Previously any authenticated account could both read and
 * write rejection episodes, biopsies and immunosuppression regimens.
 */

'use strict';

const { ipcMain } = require('electron');
const svc = require('../../services/postTransplant.cjs');
const { PERMISSIONS } = require('../../services/accessControl.cjs');
const shared = require('../shared.cjs');

/** Authorise a read of a recipient's post-transplant record. */
function requireRead(activity) {
  shared.requirePermission(PERMISSIONS.PATIENT_VIEW, activity);
}

/** Authorise a write and return the acting user plus their organisation. */
function requireWrite(activity) {
  const user = shared.requirePermission(PERMISSIONS.PATIENT_UPDATE, activity);
  return { user, orgId: shared.getSessionOrgId() };
}

function register() {
  // Transplant events
  ipcMain.handle('postTx:createEvent', async (_event, data) => {
    const { user, orgId } = requireWrite('recording a transplant event');
    const created = svc.createTransplantEvent({ orgId, ...data, createdBy: user.email });
    shared.logAudit('create', 'TransplantEvent', created.id, null,
      JSON.stringify({ patient_id: created.patient_id, organ_type: created.organ_type, transplant_date: created.transplant_date }),
      user.email, user.role);
    return created;
  });

  ipcMain.handle('postTx:updateEvent', async (_event, params) => {
    const { user, orgId } = requireWrite('amending a transplant event');
    const updated = svc.updateTransplantEvent({ id: params.id, orgId, fields: params.fields || {}, updatedBy: user.email });
    shared.logAudit('update', 'TransplantEvent', params.id, null,
      JSON.stringify({ fields: Object.keys(params.fields || {}) }), user.email, user.role);
    return updated;
  });

  ipcMain.handle('postTx:listEventsByPatient', async (_event, patientId) => {
    requireRead("reading a recipient's transplant events");
    return svc.listTransplantEventsByPatient(patientId, shared.getSessionOrgId());
  });

  // Immunosuppression
  ipcMain.handle('postTx:createImmuno', async (_event, data) => {
    const { user, orgId } = requireWrite('recording an immunosuppression regimen');
    const created = svc.createImmunoRegimen({ orgId, ...data, createdBy: user.email });
    shared.logAudit('create', 'ImmunoRegimen', created.id, null, null, user.email, user.role);
    return created;
  });

  ipcMain.handle('postTx:listImmunoByPatient', async (_event, patientId) => {
    requireRead("reading a recipient's immunosuppression regimens");
    return svc.listImmunoRegimensByPatient(patientId, shared.getSessionOrgId());
  });

  // Rejection
  ipcMain.handle('postTx:createRejection', async (_event, data) => {
    const { user, orgId } = requireWrite('recording a rejection episode');
    const created = svc.createRejection({ orgId, ...data, createdBy: user.email });
    shared.logAudit('create', 'RejectionEpisode', created.id, null,
      JSON.stringify({ rejection_type: created.rejection_type }), user.email, user.role);
    return created;
  });

  ipcMain.handle('postTx:listRejectionsByPatient', async (_event, patientId) => {
    requireRead("reading a recipient's rejection episodes");
    return svc.listRejectionsByPatient(patientId, shared.getSessionOrgId());
  });

  // Biopsies
  ipcMain.handle('postTx:createBiopsy', async (_event, data) => {
    const { user, orgId } = requireWrite('recording a biopsy');
    const created = svc.createBiopsy({ orgId, ...data, createdBy: user.email });
    shared.logAudit('create', 'Biopsy', created.id, null, null, user.email, user.role);
    return created;
  });

  ipcMain.handle('postTx:listBiopsiesByPatient', async (_event, patientId) => {
    requireRead("reading a recipient's biopsies");
    return svc.listBiopsiesByPatient(patientId, shared.getSessionOrgId());
  });

  // Readmissions
  ipcMain.handle('postTx:createReadmission', async (_event, data) => {
    const { user, orgId } = requireWrite('recording a readmission');
    const created = svc.createReadmission({ orgId, ...data, createdBy: user.email });
    shared.logAudit('create', 'PostTxReadmission', created.id, null,
      JSON.stringify({ related_to_graft: !!created.related_to_graft }), user.email, user.role);
    return created;
  });

  ipcMain.handle('postTx:listReadmissionsByPatient', async (_event, patientId) => {
    requireRead("reading a recipient's readmissions");
    return svc.listReadmissionsByPatient(patientId, shared.getSessionOrgId());
  });

  // Patient summary
  ipcMain.handle('postTx:getPatientSummary', async (_event, patientId) => {
    requireRead("reading a recipient's post-transplant summary");
    return svc.getPatientPostTxSummary(patientId, shared.getSessionOrgId());
  });
}

module.exports = { register };
