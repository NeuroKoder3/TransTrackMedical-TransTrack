/**
 * Organ Offer IPC handlers.
 * Channels: organOffer:create, organOffer:get, organOffer:list,
 *           organOffer:transition, organOffer:expireDue,
 *           organOffer:getEvents, organOffer:getStatuses,
 *           organOffer:getDeclineReasons
 *
 * Authorisation: an offer links a named donor organ to a named candidate and is
 * the record of an allocation decision, so reads require MATCH_VIEW and creating
 * one requires MATCH_CREATE. Accepting or declining requires MATCH_APPROVE; see
 * SIGNED_TRANSITIONS below.
 */

'use strict';

const { ipcMain } = require('electron');
const crypto = require('crypto');
const offers = require('../../services/organOffers.cjs');
const { PERMISSIONS } = require('../../services/accessControl.cjs');
const shared = require('../shared.cjs');
const electronicSignature = require('../../services/electronicSignature.cjs');

/**
 * Offer states that record a clinician's acceptance or refusal of an organ.
 * These are the transitions 21 CFR Part 11 treats as signed acts, and the ones
 * that require approval authority rather than routine update rights.
 */
const SIGNED_TRANSITIONS = ['ACCEPTED_PROVISIONAL', 'ACCEPTED_FINAL', 'DECLINED'];

function register() {
  ipcMain.handle('organOffer:getStatuses', async () => offers.STATUSES);
  ipcMain.handle('organOffer:getDeclineReasons', async () => offers.DECLINE_REASON_CODES);

  ipcMain.handle('organOffer:create', async (_event, data) => {
    const currentUser = shared.requirePermission(PERMISSIONS.MATCH_CREATE, 'creating an organ offer');
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
    shared.requirePermission(PERMISSIONS.MATCH_VIEW, 'reading an organ offer');
    return offers.getOffer(id, shared.getSessionOrgId());
  });

  ipcMain.handle('organOffer:list', async (_event, filters = {}) => {
    shared.requirePermission(PERMISSIONS.MATCH_VIEW, 'listing organ offers');
    return offers.listOffers({ orgId: shared.getSessionOrgId(), ...filters });
  });

  ipcMain.handle('organOffer:transition', async (_event, params) => {
    // Accepting or declining an organ on a candidate's behalf is the allocation
    // decision, so it takes MATCH_APPROVE — the same set of transitions that
    // already carry an electronic signature below. Administrative moves
    // (expiry, rescission) stay with MATCH_UPDATE so a coordinator can keep the
    // offer chain moving without holding approval authority.
    const currentUser = shared.requirePermission(
      SIGNED_TRANSITIONS.includes(params?.to_status)
        ? PERMISSIONS.MATCH_APPROVE
        : PERMISSIONS.MATCH_UPDATE,
      `transitioning an organ offer to ${params?.to_status || 'an unspecified status'}`
    );
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

    // Electronic signature for regulated state changes
    if (SIGNED_TRANSITIONS.includes(params.to_status)) {
      try {
        const payloadHash = crypto.createHash('sha256').update(
          JSON.stringify({ offerId: params.id, toStatus: params.to_status, declineReason: params.decline_reason_code || null })
        ).digest('hex');
        electronicSignature.signRecord({
          orgId, userId: currentUser.id, userEmail: currentUser.email,
          userFullName: currentUser.full_name,
          meaning: params.to_status === 'DECLINED' ? 'declined' : 'accepted',
          entityType: 'OrganOffer', entityId: params.id, payloadHash,
        });
      } catch { /* best effort — do not block transition */ }
    }

    return updated;
  });

  ipcMain.handle('organOffer:expireDue', async () => {
    // Expiry advances offers past their response deadline, which is a state
    // change on the allocation record even though no operator chose it.
    shared.requirePermission(PERMISSIONS.MATCH_UPDATE, 'expiring overdue organ offers');
    return offers.expireDue({ orgId: shared.getSessionOrgId() });
  });

  ipcMain.handle('organOffer:getEvents', async (_event, offerId) => {
    shared.requirePermission(PERMISSIONS.MATCH_VIEW, 'reading the history of an organ offer');
    return offers.getEvents(offerId, shared.getSessionOrgId());
  });
}

module.exports = { register };
