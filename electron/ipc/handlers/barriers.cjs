/**
 * TransTrack - Readiness Barriers IPC Handlers
 * Handles: barrier:*
 *
 * Strictly NON-CLINICAL, NON-ALLOCATIVE — designed for
 * operational workflow visibility only.
 *
 * Security:
 *  - wrapHandler() for standardized error handling + session validation
 *  - Org-scoped data access
 *  - Request-ID tracing
 */

const { ipcMain } = require('electron');
const { getDatabase } = require('../../database/init.cjs');
const readinessBarriers = require('../../services/readinessBarriers.cjs');
const shared = require('../shared.cjs');
const { createContext, endContext } = require('../requestContext.cjs');

function register() {
  const db = getDatabase();

  // Static lookups (no auth required)
  ipcMain.handle('barrier:getTypes', async () => readinessBarriers.BARRIER_TYPES);
  ipcMain.handle('barrier:getStatuses', async () => readinessBarriers.BARRIER_STATUS);
  ipcMain.handle('barrier:getRiskLevels', async () => readinessBarriers.BARRIER_RISK_LEVEL);
  ipcMain.handle('barrier:getOwningRoles', async () => readinessBarriers.OWNING_ROLES);

  ipcMain.handle('barrier:create', shared.wrapHandler(async (event, data) => {
    const { currentUser } = shared.getSessionState();
    const orgId = shared.getSessionOrgId();
    const ctx = createContext({ orgId: currentUser.org_id, userId: currentUser.id, userEmail: currentUser.email, userRole: currentUser.role });

    try {
      if (!data.patient_id) throw shared.createStandardError('VALIDATION_ERROR', null, 'Patient ID is required');
      if (!data.barrier_type) throw shared.createStandardError('VALIDATION_ERROR', null, 'Barrier type is required');
      if (!data.owning_role) throw shared.createStandardError('VALIDATION_ERROR', null, 'Owning role is required');
      if (data.notes && data.notes.length > 255) throw shared.createStandardError('VALIDATION_ERROR', null, 'Notes must be 255 characters or less');

      const barrier = readinessBarriers.createBarrier(data, currentUser.id, orgId);
      const patient = db.prepare('SELECT first_name, last_name FROM patients WHERE id = ? AND org_id = ?').get(data.patient_id, orgId);
      const patientName = patient ? `${patient.first_name} ${patient.last_name}` : null;

      shared.logAudit('create', 'ReadinessBarrier', barrier.id, patientName,
        JSON.stringify({ patient_id: data.patient_id, barrier_type: data.barrier_type, status: barrier.status, risk_level: barrier.risk_level }),
        currentUser.email, currentUser.role, ctx.requestId);
      return barrier;
    } finally {
      endContext(ctx.requestId);
    }
  }));

  ipcMain.handle('barrier:update', shared.wrapHandler(async (event, id, data) => {
    const { currentUser } = shared.getSessionState();
    const orgId = shared.getSessionOrgId();
    const ctx = createContext({ orgId: currentUser.org_id, userId: currentUser.id, userEmail: currentUser.email, userRole: currentUser.role });

    try {
      const existing = readinessBarriers.getBarrierById(id, orgId);
      if (!existing) throw shared.createStandardError('NOT_FOUND', null, 'Barrier not found or access denied');
      if (data.notes && data.notes.length > 255) throw shared.createStandardError('VALIDATION_ERROR', null, 'Notes must be 255 characters or less');

      const barrier = readinessBarriers.updateBarrier(id, data, currentUser.id, orgId);
      const patient = db.prepare('SELECT first_name, last_name FROM patients WHERE id = ? AND org_id = ?').get(existing.patient_id, orgId);
      const patientName = patient ? `${patient.first_name} ${patient.last_name}` : null;

      const changes = {};
      if (data.status && data.status !== existing.status) changes.status = { from: existing.status, to: data.status };
      if (data.risk_level && data.risk_level !== existing.risk_level) changes.risk_level = { from: existing.risk_level, to: data.risk_level };

      shared.logAudit('update', 'ReadinessBarrier', id, patientName,
        JSON.stringify({ patient_id: existing.patient_id, changes }), currentUser.email, currentUser.role, ctx.requestId);
      return barrier;
    } finally {
      endContext(ctx.requestId);
    }
  }));

  ipcMain.handle('barrier:resolve', shared.wrapHandler(async (event, id) => {
    const { currentUser } = shared.getSessionState();
    const orgId = shared.getSessionOrgId();
    const ctx = createContext({ orgId: currentUser.org_id, userId: currentUser.id, userEmail: currentUser.email, userRole: currentUser.role });

    try {
      const existing = readinessBarriers.getBarrierById(id, orgId);
      if (!existing) throw shared.createStandardError('NOT_FOUND', null, 'Barrier not found or access denied');

      const barrier = readinessBarriers.updateBarrier(id, { status: 'resolved' }, currentUser.id, orgId);
      const patient = db.prepare('SELECT first_name, last_name FROM patients WHERE id = ? AND org_id = ?').get(existing.patient_id, orgId);
      const patientName = patient ? `${patient.first_name} ${patient.last_name}` : null;

      shared.logAudit('resolve', 'ReadinessBarrier', id, patientName,
        JSON.stringify({ patient_id: existing.patient_id, barrier_type: existing.barrier_type }), currentUser.email, currentUser.role, ctx.requestId);
      return barrier;
    } finally {
      endContext(ctx.requestId);
    }
  }));

  ipcMain.handle('barrier:delete', shared.wrapHandler(async (event, id) => {
    const { currentUser } = shared.getSessionState();
    if (currentUser.role !== 'admin') throw shared.createStandardError('ADMIN_REQUIRED', null, 'Only administrators can delete barriers. Consider resolving the barrier instead.');

    const orgId = shared.getSessionOrgId();
    const ctx = createContext({ orgId: currentUser.org_id, userId: currentUser.id, userEmail: currentUser.email, userRole: currentUser.role });

    try {
      const existing = readinessBarriers.getBarrierById(id, orgId);
      if (!existing) throw shared.createStandardError('NOT_FOUND', null, 'Barrier not found or access denied');

      const patient = db.prepare('SELECT first_name, last_name FROM patients WHERE id = ? AND org_id = ?').get(existing.patient_id, orgId);
      const patientName = patient ? `${patient.first_name} ${patient.last_name}` : null;

      readinessBarriers.deleteBarrier(id, orgId);
      shared.logAudit('delete', 'ReadinessBarrier', id, patientName,
        JSON.stringify({ patient_id: existing.patient_id, barrier_type: existing.barrier_type }), currentUser.email, currentUser.role, ctx.requestId);
      return { success: true };
    } finally {
      endContext(ctx.requestId);
    }
  }));

  ipcMain.handle('barrier:getByPatient', shared.wrapHandler(async (event, patientId, includeResolved = false) => {
    return readinessBarriers.getBarriersByPatientId(patientId, shared.getSessionOrgId(), includeResolved);
  }));

  ipcMain.handle('barrier:getPatientSummary', shared.wrapHandler(async (event, patientId) => {
    return readinessBarriers.getPatientBarrierSummary(patientId, shared.getSessionOrgId());
  }));

  ipcMain.handle('barrier:getAllOpen', shared.wrapHandler(async () => {
    return readinessBarriers.getAllOpenBarriers(shared.getSessionOrgId());
  }));

  ipcMain.handle('barrier:getDashboard', shared.wrapHandler(async () => {
    return readinessBarriers.getBarriersDashboard(shared.getSessionOrgId());
  }));

  ipcMain.handle('barrier:getAuditHistory', shared.wrapHandler(async (event, patientId, startDate, endDate) => {
    return readinessBarriers.getBarrierAuditHistory(shared.getSessionOrgId(), patientId, startDate, endDate);
  }));
}

module.exports = { register };
