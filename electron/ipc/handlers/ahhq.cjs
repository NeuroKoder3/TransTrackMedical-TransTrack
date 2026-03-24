/**
 * TransTrack - Adult Health History Questionnaire IPC Handlers
 * Handles: ahhq:*
 *
 * Strictly NON-CLINICAL, NON-ALLOCATIVE — operational documentation only.
 *
 * Security:
 *  - wrapHandler() for standardized error handling + session validation
 *  - Org-scoped data access
 *  - Request-ID tracing
 */

const { ipcMain } = require('electron');
const ahhqService = require('../../services/ahhqService.cjs');
const shared = require('../shared.cjs');
const { createContext, endContext } = require('../requestContext.cjs');

function register() {
  // Static lookups (no auth required)
  ipcMain.handle('ahhq:getStatuses', async () => ahhqService.AHHQ_STATUS);
  ipcMain.handle('ahhq:getIssues', async () => ahhqService.AHHQ_ISSUES);
  ipcMain.handle('ahhq:getOwningRoles', async () => ahhqService.AHHQ_OWNING_ROLES);

  ipcMain.handle('ahhq:create', shared.wrapHandler(async (event, data) => {
    const { currentUser } = shared.getSessionState();
    const orgId = shared.getSessionOrgId();
    const ctx = createContext({ orgId: currentUser.org_id, userId: currentUser.id, userEmail: currentUser.email, userRole: currentUser.role });

    try {
      if (data.notes && data.notes.length > 255) throw shared.createStandardError('VALIDATION_ERROR', null, 'Notes must be 255 characters or less');

      const result = ahhqService.createAHHQ(data, currentUser.id, orgId);
      shared.logAudit('create', 'AdultHealthHistoryQuestionnaire', result.id, null,
        JSON.stringify({ patient_id: data.patient_id, status: data.status }), currentUser.email, currentUser.role, ctx.requestId);
      return result;
    } finally {
      endContext(ctx.requestId);
    }
  }));

  ipcMain.handle('ahhq:getById', shared.wrapHandler(async (event, id) => {
    return ahhqService.getAHHQById(id, shared.getSessionOrgId());
  }));

  ipcMain.handle('ahhq:getByPatient', shared.wrapHandler(async (event, patientId) => {
    return ahhqService.getAHHQByPatientId(patientId, shared.getSessionOrgId());
  }));

  ipcMain.handle('ahhq:getPatientSummary', shared.wrapHandler(async (event, patientId) => {
    return ahhqService.getPatientAHHQSummary(patientId, shared.getSessionOrgId());
  }));

  ipcMain.handle('ahhq:getAll', shared.wrapHandler(async (event, filters) => {
    return ahhqService.getAllAHHQs(shared.getSessionOrgId(), filters);
  }));

  ipcMain.handle('ahhq:getExpiring', shared.wrapHandler(async (event, days) => {
    return ahhqService.getExpiringAHHQs(shared.getSessionOrgId(), days);
  }));

  ipcMain.handle('ahhq:getExpired', shared.wrapHandler(async () => {
    return ahhqService.getExpiredAHHQs(shared.getSessionOrgId());
  }));

  ipcMain.handle('ahhq:getIncomplete', shared.wrapHandler(async () => {
    return ahhqService.getIncompleteAHHQs(shared.getSessionOrgId());
  }));

  ipcMain.handle('ahhq:update', shared.wrapHandler(async (event, id, data) => {
    const { currentUser } = shared.getSessionState();
    const orgId = shared.getSessionOrgId();
    const ctx = createContext({ orgId: currentUser.org_id, userId: currentUser.id, userEmail: currentUser.email, userRole: currentUser.role });

    try {
      if (data.notes && data.notes.length > 255) throw shared.createStandardError('VALIDATION_ERROR', null, 'Notes must be 255 characters or less');

      const existing = ahhqService.getAHHQById(id, orgId);
      if (!existing) throw shared.createStandardError('NOT_FOUND', null, 'aHHQ not found or access denied');

      const result = ahhqService.updateAHHQ(id, data, currentUser.id, orgId);
      const changes = {};
      if (data.status !== undefined && data.status !== existing.status) changes.status = { from: existing.status, to: data.status };

      shared.logAudit('update', 'AdultHealthHistoryQuestionnaire', id, null,
        JSON.stringify({ patient_id: existing.patient_id, changes }), currentUser.email, currentUser.role, ctx.requestId);
      return result;
    } finally {
      endContext(ctx.requestId);
    }
  }));

  ipcMain.handle('ahhq:markComplete', shared.wrapHandler(async (event, id, completedDate) => {
    const { currentUser } = shared.getSessionState();
    const orgId = shared.getSessionOrgId();
    const ctx = createContext({ orgId: currentUser.org_id, userId: currentUser.id, userEmail: currentUser.email, userRole: currentUser.role });

    try {
      const existing = ahhqService.getAHHQById(id, orgId);
      if (!existing) throw shared.createStandardError('NOT_FOUND', null, 'aHHQ not found or access denied');

      const result = ahhqService.markAHHQComplete(id, completedDate, currentUser.id, orgId);
      shared.logAudit('complete', 'AdultHealthHistoryQuestionnaire', id, null,
        JSON.stringify({ patient_id: existing.patient_id, completed_date: completedDate || new Date().toISOString() }), currentUser.email, currentUser.role, ctx.requestId);
      return result;
    } finally {
      endContext(ctx.requestId);
    }
  }));

  ipcMain.handle('ahhq:markFollowUpRequired', shared.wrapHandler(async (event, id, issues) => {
    const { currentUser } = shared.getSessionState();
    const orgId = shared.getSessionOrgId();
    const ctx = createContext({ orgId: currentUser.org_id, userId: currentUser.id, userEmail: currentUser.email, userRole: currentUser.role });

    try {
      const existing = ahhqService.getAHHQById(id, orgId);
      if (!existing) throw shared.createStandardError('NOT_FOUND', null, 'aHHQ not found or access denied');

      const result = ahhqService.markAHHQFollowUpRequired(id, issues, currentUser.id, orgId);
      shared.logAudit('follow_up_required', 'AdultHealthHistoryQuestionnaire', id, null,
        JSON.stringify({ patient_id: existing.patient_id, issues }), currentUser.email, currentUser.role, ctx.requestId);
      return result;
    } finally {
      endContext(ctx.requestId);
    }
  }));

  ipcMain.handle('ahhq:delete', shared.wrapHandler(async (event, id) => {
    const { currentUser } = shared.getSessionState();
    if (currentUser.role !== 'admin') throw shared.createStandardError('ADMIN_REQUIRED');

    const orgId = shared.getSessionOrgId();
    const ctx = createContext({ orgId: currentUser.org_id, userId: currentUser.id, userEmail: currentUser.email, userRole: currentUser.role });

    try {
      const existing = ahhqService.getAHHQById(id, orgId);
      if (!existing) throw shared.createStandardError('NOT_FOUND', null, 'aHHQ not found or access denied');

      shared.logAudit('delete', 'AdultHealthHistoryQuestionnaire', id, null,
        JSON.stringify({ patient_id: existing.patient_id }), currentUser.email, currentUser.role, ctx.requestId);
      return ahhqService.deleteAHHQ(id, orgId);
    } finally {
      endContext(ctx.requestId);
    }
  }));

  ipcMain.handle('ahhq:getDashboard', shared.wrapHandler(async () => {
    return ahhqService.getAHHQDashboard(shared.getSessionOrgId());
  }));

  ipcMain.handle('ahhq:getPatientsWithIssues', shared.wrapHandler(async (event, limit) => {
    return ahhqService.getPatientsWithAHHQIssues(shared.getSessionOrgId(), limit);
  }));

  ipcMain.handle('ahhq:getAuditHistory', shared.wrapHandler(async (event, patientId, startDate, endDate) => {
    return ahhqService.getAHHQAuditHistory(shared.getSessionOrgId(), patientId, startDate, endDate);
  }));
}

module.exports = { register };
