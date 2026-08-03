/**
 * TransTrack - Readiness Barriers IPC Handlers
 * Handles: barrier:*
 *
 * Strictly NON-CLINICAL, NON-ALLOCATIVE — designed for
 * operational workflow visibility only.
 *
 * Authorisation: a barrier names a patient and describes why they are not ready
 * for transplant, so reads require PATIENT_VIEW and writes require
 * PATIENT_UPDATE. Only the type/status/role vocabularies below are open to any
 * signed-in user; they are static reference data with no patient content.
 */

const { ipcMain } = require('electron');
const { getDatabase } = require('../../database/init.cjs');
const readinessBarriers = require('../../services/readinessBarriers.cjs');
const { PERMISSIONS } = require('../../services/accessControl.cjs');
const shared = require('../shared.cjs');

function register() {
  const db = getDatabase();

  ipcMain.handle('barrier:getTypes', async () => readinessBarriers.BARRIER_TYPES);
  ipcMain.handle('barrier:getStatuses', async () => readinessBarriers.BARRIER_STATUS);
  ipcMain.handle('barrier:getRiskLevels', async () => readinessBarriers.BARRIER_RISK_LEVEL);
  ipcMain.handle('barrier:getOwningRoles', async () => readinessBarriers.OWNING_ROLES);

  ipcMain.handle('barrier:create', async (event, data) => {
    const currentUser = shared.requirePermission(PERMISSIONS.PATIENT_UPDATE, 'recording a readiness barrier');
    const orgId = shared.getSessionOrgId();

    if (!data.patient_id) throw new Error('Patient ID is required');
    if (!data.barrier_type) throw new Error('Barrier type is required');
    if (!data.owning_role) throw new Error('Owning role is required');
    if (data.notes && data.notes.length > 255) throw new Error('Notes must be 255 characters or less');

    const barrier = readinessBarriers.createBarrier(data, currentUser.id, orgId);
    const patient = db.prepare('SELECT first_name, last_name FROM patients WHERE id = ? AND org_id = ?').get(data.patient_id, orgId);
    const patientName = patient ? `${patient.first_name} ${patient.last_name}` : null;

    shared.logAudit('create', 'ReadinessBarrier', barrier.id, patientName,
      JSON.stringify({ patient_id: data.patient_id, barrier_type: data.barrier_type, status: barrier.status, risk_level: barrier.risk_level }),
      currentUser.email, currentUser.role);
    return barrier;
  });

  ipcMain.handle('barrier:update', async (event, id, data) => {
    const currentUser = shared.requirePermission(PERMISSIONS.PATIENT_UPDATE, 'amending a readiness barrier');
    const orgId = shared.getSessionOrgId();

    const existing = readinessBarriers.getBarrierById(id, orgId);
    if (!existing) throw new Error('Barrier not found or access denied');
    if (data.notes && data.notes.length > 255) throw new Error('Notes must be 255 characters or less');

    const barrier = readinessBarriers.updateBarrier(id, data, currentUser.id, orgId);
    const patient = db.prepare('SELECT first_name, last_name FROM patients WHERE id = ? AND org_id = ?').get(existing.patient_id, orgId);
    const patientName = patient ? `${patient.first_name} ${patient.last_name}` : null;

    const changes = {};
    if (data.status && data.status !== existing.status) changes.status = { from: existing.status, to: data.status };
    if (data.risk_level && data.risk_level !== existing.risk_level) changes.risk_level = { from: existing.risk_level, to: data.risk_level };

    shared.logAudit('update', 'ReadinessBarrier', id, patientName,
      JSON.stringify({ patient_id: existing.patient_id, changes }), currentUser.email, currentUser.role);
    return barrier;
  });

  ipcMain.handle('barrier:resolve', async (event, id) => {
    const currentUser = shared.requirePermission(PERMISSIONS.PATIENT_UPDATE, 'resolving a readiness barrier');
    const orgId = shared.getSessionOrgId();

    const existing = readinessBarriers.getBarrierById(id, orgId);
    if (!existing) throw new Error('Barrier not found or access denied');

    const barrier = readinessBarriers.updateBarrier(id, { status: 'resolved' }, currentUser.id, orgId);
    const patient = db.prepare('SELECT first_name, last_name FROM patients WHERE id = ? AND org_id = ?').get(existing.patient_id, orgId);
    const patientName = patient ? `${patient.first_name} ${patient.last_name}` : null;

    shared.logAudit('resolve', 'ReadinessBarrier', id, patientName,
      JSON.stringify({ patient_id: existing.patient_id, barrier_type: existing.barrier_type }), currentUser.email, currentUser.role);
    return barrier;
  });

  ipcMain.handle('barrier:delete', async (event, id) => {
    const currentUser = shared.requireAdmin('deleting a readiness barrier');
    const orgId = shared.getSessionOrgId();

    const existing = readinessBarriers.getBarrierById(id, orgId);
    if (!existing) throw new Error('Barrier not found or access denied');

    const patient = db.prepare('SELECT first_name, last_name FROM patients WHERE id = ? AND org_id = ?').get(existing.patient_id, orgId);
    const patientName = patient ? `${patient.first_name} ${patient.last_name}` : null;

    readinessBarriers.deleteBarrier(id, orgId);
    shared.logAudit('delete', 'ReadinessBarrier', id, patientName,
      JSON.stringify({ patient_id: existing.patient_id, barrier_type: existing.barrier_type }), currentUser.email, currentUser.role);
    return { success: true };
  });

  ipcMain.handle('barrier:getByPatient', async (event, patientId, includeResolved = false) => {
    shared.requirePermission(PERMISSIONS.PATIENT_VIEW, "reading a patient's readiness barriers");
    return readinessBarriers.getBarriersByPatientId(patientId, shared.getSessionOrgId(), includeResolved);
  });

  ipcMain.handle('barrier:getPatientSummary', async (event, patientId) => {
    shared.requirePermission(PERMISSIONS.PATIENT_VIEW, "reading a patient's barrier summary");
    return readinessBarriers.getPatientBarrierSummary(patientId, shared.getSessionOrgId());
  });

  ipcMain.handle('barrier:getAllOpen', async () => {
    shared.requirePermission(PERMISSIONS.PATIENT_VIEW, "reading open readiness barriers");
    return readinessBarriers.getAllOpenBarriers(shared.getSessionOrgId());
  });

  ipcMain.handle('barrier:getDashboard', async () => {
    shared.requirePermission(PERMISSIONS.PATIENT_VIEW, "reading the readiness dashboard");
    return readinessBarriers.getBarriersDashboard(shared.getSessionOrgId());
  });

  ipcMain.handle('barrier:getAuditHistory', async (event, patientId, startDate, endDate) => {
    // The audit history of a barrier is audit-trail content, not clinical data.
    shared.requirePermission(PERMISSIONS.AUDIT_VIEW, 'reading barrier audit history');
    return readinessBarriers.getBarrierAuditHistory(shared.getSessionOrgId(), patientId, startDate, endDate);
  });
}

module.exports = { register };
