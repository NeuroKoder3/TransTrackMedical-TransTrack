/**
 * TransTrack - Canonical audit record serialization
 *
 * SINGLE SOURCE OF TRUTH for how an audit row is turned into the bytes that
 * are hashed and HMAC'd. Both the writer (electron/ipc/shared.cjs logAudit)
 * and every verifier must go through here, otherwise a verifier can report
 * false tampering on rows that were written correctly.
 *
 * Chain definition:
 *   canonical   = JSON.stringify(payload, sortedKeys)
 *   record_hash = sha256(prev_hash || canonical)
 *   record_hmac = hmac_sha256(auditKey, prev_hash || canonical)   [optional]
 *
 * The first row of each organization uses prev_hash = 'GENESIS'.
 *
 * Row ordering:
 *   Rows MUST be replayed in insertion order. Primary keys are random UUIDs,
 *   so `ORDER BY id` is meaningless. Rows written from migration 19 onward
 *   carry a per-org `seq` counter which is the authoritative order; older rows
 *   have none and fall back to created_at plus rowid. CHAIN_ORDER_BY below is
 *   that fallback — services/auditChain.cjs owns the sequenced ordering.
 *
 * COMPATIBILITY: the payload field set below matches what logAudit has always
 * written, so audit rows in existing production databases continue to verify.
 * Do not add, remove, or rename fields — doing so invalidates every hash
 * already on disk. `seq` is the one permitted extension and it is included
 * ONLY when the row carries one, so pre-migration rows hash exactly as before.
 *
 * HIPAA 164.312(b) / 164.312(c)(1) - Audit Controls, Integrity
 * 21 CFR 11.10(a)/(e)
 */

'use strict';

const crypto = require('crypto');

const GENESIS = 'GENESIS';

/** Deterministic row ordering used by every chain replay. */
const CHAIN_ORDER_BY = 'ORDER BY created_at ASC, rowid ASC';

/** Columns a verifier must select to rebuild the canonical payload. */
const CHAIN_SELECT_COLUMNS = [
  'id', 'org_id', 'action', 'entity_type', 'entity_id', 'patient_name',
  'details', 'user_email', 'user_role', 'prev_hash', 'record_hash',
].join(', ');

/**
 * Build the canonical payload object for an audit row.
 * Accepts either a database row or the values being inserted.
 */
function buildAuditPayload(row) {
  const payload = {
    org_id: row.org_id,
    action: row.action,
    entity_type: row.entity_type || null,
    entity_id: row.entity_id || null,
    patient_name: row.patient_name || null,
    details: row.details || null,
    user_email: row.user_email || null,
    user_role: row.user_role || null,
  };
  // Signing the sequence is what makes it tamper-evident: an administrator who
  // renumbers rows to hide a deletion invalidates the hash. Rows written before
  // the column existed carry no sequence and must hash exactly as they did
  // then, so the field is added only when there is one.
  if (row.seq !== null && row.seq !== undefined) {
    payload.seq = Number(row.seq);
  }
  return payload;
}

/** Serialize a payload to its canonical string form (sorted keys). */
function canonicalize(payload) {
  return JSON.stringify(payload, Object.keys(payload).sort());
}

/** The exact string that both the hash and the HMAC cover. */
function buildSignedString(prevHash, row) {
  return prevHash + canonicalize(buildAuditPayload(row));
}

function computeRecordHash(prevHash, row) {
  return crypto.createHash('sha256').update(buildSignedString(prevHash, row)).digest('hex');
}

module.exports = {
  GENESIS,
  CHAIN_ORDER_BY,
  CHAIN_SELECT_COLUMNS,
  buildAuditPayload,
  canonicalize,
  buildSignedString,
  computeRecordHash,
};
