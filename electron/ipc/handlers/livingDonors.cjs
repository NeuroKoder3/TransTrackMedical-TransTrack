/**
 * Living donor IPC handlers.
 * Channels: livingDonor:create, livingDonor:get, livingDonor:list,
 *           livingDonor:transition, livingDonor:addEvalStep,
 *           livingDonor:updateEvalStep, livingDonor:listEvals,
 *           livingDonor:listFollowups, livingDonor:updateFollowup,
 *           livingDonor:markOverdue, livingDonor:summary,
 *           livingDonor:getStatuses, livingDonor:getMilestones
 *
 * Authorisation: a living donor record is a donor record that additionally
 * carries direct identifiers (name, date of birth, contact details), so reads
 * require DONOR_VIEW, registration requires DONOR_CREATE, and everything that
 * changes an existing record — status transitions, evaluation steps, follow-up
 * outcomes — requires DONOR_UPDATE. Before this, any signed-in account reached
 * all of it.
 */

'use strict';

const { ipcMain } = require('electron');
const svc = require('../../services/livingDonors.cjs');
const { PERMISSIONS } = require('../../services/accessControl.cjs');
const shared = require('../shared.cjs');

/** Authorise a read of living-donor data. */
function requireRead(activity) {
  shared.requirePermission(PERMISSIONS.DONOR_VIEW, activity);
}

/** Authorise a write and return the acting user plus their organisation. */
function requireWrite(permission, activity) {
  const user = shared.requirePermission(permission, activity);
  return { user, orgId: shared.getSessionOrgId() };
}

function register() {
  ipcMain.handle('livingDonor:getStatuses', async () => svc.STATUSES);
  ipcMain.handle('livingDonor:getMilestones', async () => svc.FOLLOWUP_MILESTONES);

  ipcMain.handle('livingDonor:create', async (_event, data) => {
    const { user, orgId } = requireWrite(PERMISSIONS.DONOR_CREATE, 'registering a living donor');
    const created = svc.createDonor({
      orgId,
      mrn: data?.mrn,
      firstName: data?.first_name,
      lastName: data?.last_name,
      dateOfBirth: data?.date_of_birth,
      sex: data?.sex,
      bloodType: data?.blood_type,
      relationshipToRecipient: data?.relationship_to_recipient,
      recipientPatientId: data?.recipient_patient_id,
      intendedOrgan: data?.intended_organ,
      phone: data?.phone,
      email: data?.email,
      address: data?.address,
      notes: data?.notes,
      createdBy: user.email,
    });
    shared.logAudit('create', 'LivingDonor', created.id, null,
      JSON.stringify({ intended_organ: created.intended_organ, recipient_patient_id: created.recipient_patient_id }),
      user.email, user.role);
    return created;
  });

  ipcMain.handle('livingDonor:get', async (_event, id) => {
    requireRead('reading a living donor record');
    return svc.getDonor(id, shared.getSessionOrgId());
  });

  ipcMain.handle('livingDonor:list', async (_event, filters = {}) => {
    requireRead('listing living donors');
    return svc.listDonors({ orgId: shared.getSessionOrgId(), ...filters });
  });

  ipcMain.handle('livingDonor:transition', async (_event, params) => {
    const { user, orgId } = requireWrite(PERMISSIONS.DONOR_UPDATE, 'changing a living donor\'s status');
    const updated = svc.transitionDonor({
      id: params.id,
      orgId,
      toStatus: params.to_status,
      reason: params.reason,
      donationDate: params.donation_date,
      updatedBy: user.email,
    });
    shared.logAudit('transition', 'LivingDonor', params.id, null,
      JSON.stringify({ to_status: params.to_status }), user.email, user.role);
    return updated;
  });

  ipcMain.handle('livingDonor:addEvalStep', async (_event, data) => {
    const { user, orgId } = requireWrite(PERMISSIONS.DONOR_UPDATE, 'adding a donor evaluation step');
    const created = svc.addEvaluationStep({
      orgId,
      livingDonorId: data?.living_donor_id,
      step: data?.step,
      scheduledDate: data?.scheduled_date,
      ownerRole: data?.owner_role,
      notes: data?.notes,
    });
    shared.logAudit('create', 'LivingDonorEval', created.id, null,
      JSON.stringify({ living_donor_id: created.living_donor_id, step: created.step }),
      user.email, user.role);
    return created;
  });

  ipcMain.handle('livingDonor:updateEvalStep', async (_event, data) => {
    const { user, orgId } = requireWrite(PERMISSIONS.DONOR_UPDATE, 'updating a donor evaluation step');
    const updated = svc.updateEvaluationStep({
      id: data?.id, orgId,
      status: data?.status, completedDate: data?.completed_date, notes: data?.notes,
    });
    shared.logAudit('update', 'LivingDonorEval', data?.id, null,
      JSON.stringify({ status: data?.status }), user.email, user.role);
    return updated;
  });

  ipcMain.handle('livingDonor:listEvals', async (_event, livingDonorId) => {
    requireRead('reading donor evaluation steps');
    return svc.listEvaluations(livingDonorId, shared.getSessionOrgId());
  });

  ipcMain.handle('livingDonor:listFollowups', async (_event, livingDonorId) => {
    requireRead('reading donor follow-ups');
    return svc.listFollowups(livingDonorId, shared.getSessionOrgId());
  });

  ipcMain.handle('livingDonor:updateFollowup', async (_event, data) => {
    const { user, orgId } = requireWrite(PERMISSIONS.DONOR_UPDATE, 'recording a donor follow-up outcome');
    const updated = svc.updateFollowup({
      id: data?.id, orgId,
      status: data?.status, completedDate: data?.completed_date, notes: data?.notes,
    });
    shared.logAudit('update', 'LivingDonorFollowup', data?.id, null,
      JSON.stringify({ status: data?.status }), user.email, user.role);
    return updated;
  });

  ipcMain.handle('livingDonor:markOverdue', async () => {
    // Flags follow-ups whose milestone date has passed; it writes to the record.
    shared.requirePermission(PERMISSIONS.DONOR_UPDATE, 'flagging overdue donor follow-ups');
    return svc.markOverdueFollowups(shared.getSessionOrgId());
  });

  ipcMain.handle('livingDonor:summary', async (_event, donorId) => {
    requireRead('reading a living donor summary');
    return svc.getDonorSummary(donorId, shared.getSessionOrgId());
  });
}

module.exports = { register };
