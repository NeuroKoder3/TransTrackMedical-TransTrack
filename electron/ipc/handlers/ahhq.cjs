/**
 * TransTrack - Adult Health History Questionnaire IPC Handlers
 * Handles: ahhq:*
 *
 * Strictly NON-CLINICAL, NON-ALLOCATIVE — operational documentation only.
 */

const { ipcMain } = require('electron');
const ahhqService = require('../../services/ahhqService.cjs');
const shared = require('../shared.cjs');

function register() {
  ipcMain.handle('ahhq:getStatuses', async () => ahhqService.AHHQ_STATUS);
  ipcMain.handle('ahhq:getIssues', async () => ahhqService.AHHQ_ISSUES);
  ipcMain.handle('ahhq:getOwningRoles', async () => ahhqService.AHHQ_OWNING_ROLES);

  ipcMain.handle('ahhq:create', async (event, data) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    const orgId = shared.getSessionOrgId();
    if (data.notes && data.notes.length > 255) throw new Error('Notes must be 255 characters or less');

    const result = ahhqService.createAHHQ(data, currentUser.id, orgId);
    shared.logAudit('create', 'AdultHealthHistoryQuestionnaire', result.id, null,
      JSON.stringify({ patient_id: data.patient_id, status: data.status }), currentUser.email, currentUser.role);
    return result;
  });

  ipcMain.handle('ahhq:getById', async (event, id) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return ahhqService.getAHHQById(id, shared.getSessionOrgId());
  });

  ipcMain.handle('ahhq:getByPatient', async (event, patientId) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return ahhqService.getAHHQByPatientId(patientId, shared.getSessionOrgId());
  });

  ipcMain.handle('ahhq:getPatientSummary', async (event, patientId) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return ahhqService.getPatientAHHQSummary(patientId, shared.getSessionOrgId());
  });

  ipcMain.handle('ahhq:getAll', async (event, filters) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return ahhqService.getAllAHHQs(shared.getSessionOrgId(), filters);
  });

  ipcMain.handle('ahhq:getExpiring', async (event, days) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return ahhqService.getExpiringAHHQs(shared.getSessionOrgId(), days);
  });

  ipcMain.handle('ahhq:getExpired', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return ahhqService.getExpiredAHHQs(shared.getSessionOrgId());
  });

  ipcMain.handle('ahhq:getIncomplete', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return ahhqService.getIncompleteAHHQs(shared.getSessionOrgId());
  });

  ipcMain.handle('ahhq:update', async (event, id, data) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    const orgId = shared.getSessionOrgId();
    if (data.notes && data.notes.length > 255) throw new Error('Notes must be 255 characters or less');

    const existing = ahhqService.getAHHQById(id, orgId);
    if (!existing) throw new Error('aHHQ not found or access denied');

    const result = ahhqService.updateAHHQ(id, data, currentUser.id, orgId);
    const changes = {};
    if (data.status !== undefined && data.status !== existing.status) changes.status = { from: existing.status, to: data.status };

    shared.logAudit('update', 'AdultHealthHistoryQuestionnaire', id, null,
      JSON.stringify({ patient_id: existing.patient_id, changes }), currentUser.email, currentUser.role);
    return result;
  });

  ipcMain.handle('ahhq:markComplete', async (event, id, completedDate) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    const orgId = shared.getSessionOrgId();

    const existing = ahhqService.getAHHQById(id, orgId);
    if (!existing) throw new Error('aHHQ not found or access denied');

    const result = ahhqService.markAHHQComplete(id, completedDate, currentUser.id, orgId);
    shared.logAudit('complete', 'AdultHealthHistoryQuestionnaire', id, null,
      JSON.stringify({ patient_id: existing.patient_id, completed_date: completedDate || new Date().toISOString() }), currentUser.email, currentUser.role);
    return result;
  });

  ipcMain.handle('ahhq:markFollowUpRequired', async (event, id, issues) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    const orgId = shared.getSessionOrgId();

    const existing = ahhqService.getAHHQById(id, orgId);
    if (!existing) throw new Error('aHHQ not found or access denied');

    const result = ahhqService.markAHHQFollowUpRequired(id, issues, currentUser.id, orgId);
    shared.logAudit('follow_up_required', 'AdultHealthHistoryQuestionnaire', id, null,
      JSON.stringify({ patient_id: existing.patient_id, issues }), currentUser.email, currentUser.role);
    return result;
  });

  ipcMain.handle('ahhq:delete', async (event, id) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    if (currentUser.role !== 'admin') throw new Error('Admin access required');
    const orgId = shared.getSessionOrgId();

    const existing = ahhqService.getAHHQById(id, orgId);
    if (!existing) throw new Error('aHHQ not found or access denied');

    shared.logAudit('delete', 'AdultHealthHistoryQuestionnaire', id, null,
      JSON.stringify({ patient_id: existing.patient_id }), currentUser.email, currentUser.role);
    return ahhqService.deleteAHHQ(id, orgId);
  });

  ipcMain.handle('ahhq:getDashboard', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return ahhqService.getAHHQDashboard(shared.getSessionOrgId());
  });

  ipcMain.handle('ahhq:getPatientsWithIssues', async (event, limit) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return ahhqService.getPatientsWithAHHQIssues(shared.getSessionOrgId(), limit);
  });

  ipcMain.handle('ahhq:getAuditHistory', async (event, patientId, startDate, endDate) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return ahhqService.getAHHQAuditHistory(shared.getSessionOrgId(), patientId, startDate, endDate);
  });
}

module.exports = { register };
