/**
 * TransTrack - Readiness Barriers IPC Handlers
 * Handles: barrier:*
 *
 * Strictly NON-CLINICAL, NON-ALLOCATIVE — designed for
 * operational workflow visibility only.
 */

const { ipcMain } = require('electron');
const { getDatabase } = require('../../database/init.cjs');
const readinessBarriers = require('../../services/readinessBarriers.cjs');
const shared = require('../shared.cjs');

function register() {
  const db = getDatabase();

  ipcMain.handle('barrier:getTypes', async () => readinessBarriers.BARRIER_TYPES);
  ipcMain.handle('barrier:getStatuses', async () => readinessBarriers.BARRIER_STATUS);
  ipcMain.handle('barrier:getRiskLevels', async () => readinessBarriers.BARRIER_RISK_LEVEL);
  ipcMain.handle('barrier:getOwningRoles', async () => readinessBarriers.OWNING_ROLES);

  ipcMain.handle('barrier:create', async (event, data) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
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
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
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
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
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
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    const orgId = shared.getSessionOrgId();

    if (currentUser.role !== 'admin') throw new Error('Only administrators can delete barriers. Consider resolving the barrier instead.');

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
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return readinessBarriers.getBarriersByPatientId(patientId, shared.getSessionOrgId(), includeResolved);
  });

  ipcMain.handle('barrier:getPatientSummary', async (event, patientId) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return readinessBarriers.getPatientBarrierSummary(patientId, shared.getSessionOrgId());
  });

  ipcMain.handle('barrier:getAllOpen', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return readinessBarriers.getAllOpenBarriers(shared.getSessionOrgId());
  });

  ipcMain.handle('barrier:getDashboard', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return readinessBarriers.getBarriersDashboard(shared.getSessionOrgId());
  });

  ipcMain.handle('barrier:getAuditHistory', async (event, patientId, startDate, endDate) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return readinessBarriers.getBarrierAuditHistory(shared.getSessionOrgId(), patientId, startDate, endDate);
  });
}

module.exports = { register };
