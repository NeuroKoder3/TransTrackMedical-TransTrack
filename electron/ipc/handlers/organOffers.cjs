/**
 * Organ Offer IPC handlers.
 * Channels: organOffer:create, organOffer:get, organOffer:list,
 *           organOffer:transition, organOffer:expireDue,
 *           organOffer:getEvents, organOffer:getStatuses,
 *           organOffer:getDeclineReasons
 */

'use strict';

const { ipcMain } = require('electron');
const offers = require('../../services/organOffers.cjs');
const shared = require('../shared.cjs');

function register() {
  ipcMain.handle('organOffer:getStatuses', async () => offers.STATUSES);
  ipcMain.handle('organOffer:getDeclineReasons', async () => offers.DECLINE_REASON_CODES);

  ipcMain.handle('organOffer:create', async (_event, data) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    const orgId = shared.getSessionOrgId();
    const offer = offers.createOffer({
      orgId,
      donorOrganId: data?.donor_organ_id,
      patientId: data?.patient_id,
      rank: data?.rank,
      responseDueAt: data?.response_due_at,
      backupChainPosition: data?.backup_chain_position,
      notes: data?.notes,
      createdBy: currentUser.email,
    });
    shared.logAudit('create', 'OrganOffer', offer.id, null,
      JSON.stringify({ donor_organ_id: offer.donor_organ_id, patient_id: offer.patient_id, rank: offer.rank }),
      currentUser.email, currentUser.role);
    return offer;
  });

  ipcMain.handle('organOffer:get', async (_event, id) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return offers.getOffer(id, shared.getSessionOrgId());
  });

  ipcMain.handle('organOffer:list', async (_event, filters = {}) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return offers.listOffers({ orgId: shared.getSessionOrgId(), ...filters });
  });

  ipcMain.handle('organOffer:transition', async (_event, params) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    const orgId = shared.getSessionOrgId();
    const updated = offers.transition({
      id: params.id,
      orgId,
      toStatus: params.to_status,
      actor: currentUser.email,
      declineReasonCode: params.decline_reason_code,
      declineReasonText: params.decline_reason_text,
      notes: params.notes,
    });
    shared.logAudit('transition', 'OrganOffer', params.id, null,
      JSON.stringify({ to_status: params.to_status, decline_reason_code: params.decline_reason_code || null }),
      currentUser.email, currentUser.role);
    return updated;
  });

  ipcMain.handle('organOffer:expireDue', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return offers.expireDue({ orgId: shared.getSessionOrgId() });
  });

  ipcMain.handle('organOffer:getEvents', async (_event, offerId) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return offers.getEvents(offerId, shared.getSessionOrgId());
  });
}

module.exports = { register };
