/**
 * Organ Offer Management — operational state machine.
 *
 * Per SRS TT-R066. Implements the offer lifecycle:
 *   PENDING → ACCEPTED_PROVISIONAL → ACCEPTED_FINAL
 *   PENDING → DECLINED  (decline_reason_code REQUIRED)
 *   PENDING → EXPIRED   (timer-driven; idempotent)
 *   PENDING/ACCEPTED_PROVISIONAL → RESCINDED  (any time before FINAL)
 *
 * Allocation occurs in OPTN/UNet. This module records the *operational
 * coordination* of offers received by the center.
 */

'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('../database/init.cjs');

const STATUSES = Object.freeze({
  PENDING: 'PENDING',
  ACCEPTED_PROVISIONAL: 'ACCEPTED_PROVISIONAL',
  ACCEPTED_FINAL: 'ACCEPTED_FINAL',
  DECLINED: 'DECLINED',
  EXPIRED: 'EXPIRED',
  RESCINDED: 'RESCINDED',
});

// Standard OPTN-aligned decline reason codes. Extensible per organization.
const DECLINE_REASON_CODES = Object.freeze({
  '700': 'Donor age',
  '701': 'Donor size mismatch',
  '702': 'Donor history (medical/social)',
  '730': 'Organ-specific anatomy/function concern',
  '740': 'Cold ischemia time',
  '750': 'Positive crossmatch / DSA concern',
  '798': 'Recipient unavailable',
  '799': 'Other (free text required)',
  '830': 'Recipient too sick',
  '831': 'Recipient declined',
  '850': 'Center capacity',
});

// Allowed transitions: from → set(to)
const TRANSITIONS = Object.freeze({
  PENDING: new Set(['ACCEPTED_PROVISIONAL', 'ACCEPTED_FINAL', 'DECLINED', 'EXPIRED', 'RESCINDED']),
  ACCEPTED_PROVISIONAL: new Set(['ACCEPTED_FINAL', 'DECLINED', 'RESCINDED']),
  ACCEPTED_FINAL: new Set([]), // terminal
  DECLINED: new Set([]),       // terminal
  EXPIRED: new Set([]),        // terminal
  RESCINDED: new Set([]),      // terminal
});

function recordEvent(db, offerId, orgId, eventType, fromStatus, toStatus, actor, payload) {
  db.prepare(`
    INSERT INTO organ_offer_events (id, org_id, offer_id, event_type, from_status, to_status, actor, payload, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(uuidv4(), orgId, offerId, eventType, fromStatus, toStatus, actor, payload ? JSON.stringify(payload) : null);
}

function createOffer({ orgId, donorOrganId, patientId, rank, responseDueAt, backupChainPosition, notes, createdBy }) {
  if (!orgId) throw new Error('orgId required');
  if (!donorOrganId) throw new Error('donorOrganId required');
  if (!patientId) throw new Error('patientId required');

  const db = getDatabase();
  const id = uuidv4();
  db.prepare(`
    INSERT INTO organ_offers (
      id, org_id, donor_organ_id, patient_id, status, rank,
      offered_at, response_due_at, backup_chain_position, notes,
      created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'PENDING', ?, datetime('now'), ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(id, orgId, donorOrganId, patientId, rank ?? null, responseDueAt ?? null,
    backupChainPosition ?? null, notes ?? null, createdBy ?? null, createdBy ?? null);

  recordEvent(db, id, orgId, 'OFFER_CREATED', null, 'PENDING', createdBy, {
    donor_organ_id: donorOrganId,
    patient_id: patientId,
    response_due_at: responseDueAt ?? null,
  });

  return getOffer(id, orgId);
}

function getOffer(id, orgId) {
  return getDatabase().prepare(
    'SELECT * FROM organ_offers WHERE id = ? AND org_id = ?'
  ).get(id, orgId);
}

function listOffers({ orgId, status, donorOrganId, patientId, limit = 200 } = {}) {
  if (!orgId) throw new Error('orgId required');
  let sql = 'SELECT * FROM organ_offers WHERE org_id = ?';
  const params = [orgId];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (donorOrganId) { sql += ' AND donor_organ_id = ?'; params.push(donorOrganId); }
  if (patientId) { sql += ' AND patient_id = ?'; params.push(patientId); }
  sql += ' ORDER BY offered_at DESC LIMIT ?';
  params.push(Math.max(1, Math.min(500, limit)));
  return getDatabase().prepare(sql).all(...params);
}

function transition({ id, orgId, toStatus, actor, declineReasonCode, declineReasonText, notes }) {
  if (!orgId) throw new Error('orgId required');
  const db = getDatabase();
  const offer = getOffer(id, orgId);
  if (!offer) throw new Error('Offer not found or access denied');

  const allowed = TRANSITIONS[offer.status] || new Set();
  if (!allowed.has(toStatus)) {
    throw new Error(`Illegal transition ${offer.status} → ${toStatus}`);
  }

  if (toStatus === STATUSES.DECLINED) {
    if (!declineReasonCode || !DECLINE_REASON_CODES[declineReasonCode]) {
      throw new Error('decline_reason_code is required and must be a known code');
    }
    if (declineReasonCode === '799' && !declineReasonText) {
      throw new Error('decline_reason_text is required when decline_reason_code = 799 (Other)');
    }
  }

  const fromStatus = offer.status;
  db.prepare(`
    UPDATE organ_offers
       SET status = ?,
           responded_at = COALESCE(responded_at, datetime('now')),
           decline_reason_code = COALESCE(?, decline_reason_code),
           decline_reason_text = COALESCE(?, decline_reason_text),
           notes = COALESCE(?, notes),
           updated_by = ?,
           updated_at = datetime('now')
     WHERE id = ? AND org_id = ?
  `).run(
    toStatus,
    declineReasonCode ?? null,
    declineReasonText ?? null,
    notes ?? null,
    actor ?? null,
    id,
    orgId
  );
  recordEvent(db, id, orgId, 'STATUS_CHANGE', fromStatus, toStatus, actor, {
    decline_reason_code: declineReasonCode,
    decline_reason_text: declineReasonText,
  });
  return getOffer(id, orgId);
}

/**
 * Idempotent expiration sweep. Marks PENDING offers whose response_due_at has
 * elapsed as EXPIRED. Returns the list of expired offer ids.
 */
function expireDue({ orgId } = {}) {
  const db = getDatabase();
  const sql = orgId
    ? `SELECT id FROM organ_offers WHERE org_id = ? AND status = 'PENDING' AND response_due_at IS NOT NULL AND response_due_at < datetime('now')`
    : `SELECT id, org_id FROM organ_offers WHERE status = 'PENDING' AND response_due_at IS NOT NULL AND response_due_at < datetime('now')`;
  const rows = orgId ? db.prepare(sql).all(orgId) : db.prepare(sql).all();
  const expired = [];
  for (const r of rows) {
    const oid = r.org_id || orgId;
    transition({ id: r.id, orgId: oid, toStatus: 'EXPIRED', actor: 'system' });
    expired.push(r.id);
  }
  return { expiredCount: expired.length, expired };
}

function getEvents(offerId, orgId) {
  return getDatabase().prepare(`
    SELECT * FROM organ_offer_events WHERE offer_id = ? AND org_id = ? ORDER BY created_at ASC
  `).all(offerId, orgId);
}

module.exports = {
  STATUSES,
  DECLINE_REASON_CODES,
  TRANSITIONS,
  createOffer,
  getOffer,
  listOffers,
  transition,
  expireDue,
  getEvents,
};
