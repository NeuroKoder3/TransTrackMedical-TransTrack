/**
 * Post-transplant follow-up IPC handlers.
 * Channels: postTx:createEvent, postTx:updateEvent, postTx:listEventsByPatient,
 *           postTx:createImmuno, postTx:listImmunoByPatient,
 *           postTx:createRejection, postTx:listRejectionsByPatient,
 *           postTx:createBiopsy, postTx:listBiopsiesByPatient,
 *           postTx:createReadmission, postTx:listReadmissionsByPatient,
 *           postTx:getPatientSummary
 */

'use strict';

const { ipcMain } = require('electron');
const svc = require('../../services/postTransplant.cjs');
const shared = require('../shared.cjs');

function requireSession() {
  if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
}

function withCtx() {
  const { currentUser } = shared.getSessionState();
  return { user: currentUser, orgId: shared.getSessionOrgId() };
}

function register() {
  // Transplant events
  ipcMain.handle('postTx:createEvent', async (_event, data) => {
    requireSession();
    const { user, orgId } = withCtx();
    const created = svc.createTransplantEvent({ orgId, ...data, createdBy: user.email });
    shared.logAudit('create', 'TransplantEvent', created.id, null,
      JSON.stringify({ patient_id: created.patient_id, organ_type: created.organ_type, transplant_date: created.transplant_date }),
      user.email, user.role);
    return created;
  });

  ipcMain.handle('postTx:updateEvent', async (_event, params) => {
    requireSession();
    const { user, orgId } = withCtx();
    const updated = svc.updateTransplantEvent({ id: params.id, orgId, fields: params.fields || {}, updatedBy: user.email });
    shared.logAudit('update', 'TransplantEvent', params.id, null,
      JSON.stringify({ fields: Object.keys(params.fields || {}) }), user.email, user.role);
    return updated;
  });

  ipcMain.handle('postTx:listEventsByPatient', async (_event, patientId) => {
    requireSession();
    return svc.listTransplantEventsByPatient(patientId, shared.getSessionOrgId());
  });

  // Immunosuppression
  ipcMain.handle('postTx:createImmuno', async (_event, data) => {
    requireSession();
    const { user, orgId } = withCtx();
    const created = svc.createImmunoRegimen({ orgId, ...data, createdBy: user.email });
    shared.logAudit('create', 'ImmunoRegimen', created.id, null, null, user.email, user.role);
    return created;
  });

  ipcMain.handle('postTx:listImmunoByPatient', async (_event, patientId) => {
    requireSession();
    return svc.listImmunoRegimensByPatient(patientId, shared.getSessionOrgId());
  });

  // Rejection
  ipcMain.handle('postTx:createRejection', async (_event, data) => {
    requireSession();
    const { user, orgId } = withCtx();
    const created = svc.createRejection({ orgId, ...data, createdBy: user.email });
    shared.logAudit('create', 'RejectionEpisode', created.id, null,
      JSON.stringify({ rejection_type: created.rejection_type }), user.email, user.role);
    return created;
  });

  ipcMain.handle('postTx:listRejectionsByPatient', async (_event, patientId) => {
    requireSession();
    return svc.listRejectionsByPatient(patientId, shared.getSessionOrgId());
  });

  // Biopsies
  ipcMain.handle('postTx:createBiopsy', async (_event, data) => {
    requireSession();
    const { user, orgId } = withCtx();
    const created = svc.createBiopsy({ orgId, ...data, createdBy: user.email });
    shared.logAudit('create', 'Biopsy', created.id, null, null, user.email, user.role);
    return created;
  });

  ipcMain.handle('postTx:listBiopsiesByPatient', async (_event, patientId) => {
    requireSession();
    return svc.listBiopsiesByPatient(patientId, shared.getSessionOrgId());
  });

  // Readmissions
  ipcMain.handle('postTx:createReadmission', async (_event, data) => {
    requireSession();
    const { user, orgId } = withCtx();
    const created = svc.createReadmission({ orgId, ...data, createdBy: user.email });
    shared.logAudit('create', 'PostTxReadmission', created.id, null,
      JSON.stringify({ related_to_graft: !!created.related_to_graft }), user.email, user.role);
    return created;
  });

  ipcMain.handle('postTx:listReadmissionsByPatient', async (_event, patientId) => {
    requireSession();
    return svc.listReadmissionsByPatient(patientId, shared.getSessionOrgId());
  });

  // Patient summary
  ipcMain.handle('postTx:getPatientSummary', async (_event, patientId) => {
    requireSession();
    return svc.getPatientPostTxSummary(patientId, shared.getSessionOrgId());
  });
}

module.exports = { register };
