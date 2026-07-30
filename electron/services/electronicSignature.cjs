/**
 * TransTrack — Electronic Signatures (21 CFR Part 11).
 *
 * signRecord() creates a cryptographic binding between a user's identity,
 * their stated meaning (e.g. "approved", "reviewed"), the entity being
 * signed, and a hash of the payload at the moment of signing.
 *
 * The signature_hash = sha256(userId + meaning + entityType + entityId +
 * payloadHash + ISO timestamp). This is NOT a PKI digital signature — it
 * is an application-level electronic signature record stored alongside
 * the audit trail.
 */

'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('../database/init.cjs');

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Create an electronic signature record.
 *
 * @param {object} params
 * @param {string} params.orgId
 * @param {string} params.userId
 * @param {string} params.userEmail
 * @param {string} [params.userFullName]
 * @param {string} params.meaning - e.g. 'approved', 'reviewed', 'authored'
 * @param {string} params.entityType - e.g. 'OrganOffer', 'Patient'
 * @param {string} params.entityId
 * @param {string} params.payloadHash - sha256 of the payload being signed
 * @returns {object} the signature record
 */
function signRecord({ orgId, userId, userEmail, userFullName, meaning, entityType, entityId, payloadHash }) {
  if (!orgId) throw new Error('orgId required');
  if (!userId) throw new Error('userId required');
  if (!meaning) throw new Error('meaning required');
  if (!entityType) throw new Error('entityType required');
  if (!entityId) throw new Error('entityId required');
  if (!payloadHash) throw new Error('payloadHash required');

  const db = getDatabase();
  const id = uuidv4();
  const signedAt = new Date().toISOString();

  const signatureHash = sha256(
    [userId, meaning, entityType, entityId, payloadHash, signedAt].join('|')
  );

  db.prepare(`
    INSERT INTO electronic_signatures
      (id, org_id, user_id, user_email, user_full_name, meaning, entity_type, entity_id, payload_hash, signature_hash, signed_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, orgId, userId, userEmail || null, userFullName || null,
    meaning, entityType, entityId, payloadHash, signatureHash, signedAt, signedAt);

  return {
    id,
    orgId,
    userId,
    userEmail,
    meaning,
    entityType,
    entityId,
    payloadHash,
    signatureHash,
    signedAt,
  };
}

/**
 * List signatures for a given entity.
 */
function getSignatures(orgId, entityType, entityId) {
  return getDatabase().prepare(
    `SELECT * FROM electronic_signatures
     WHERE org_id = ? AND entity_type = ? AND entity_id = ?
     ORDER BY signed_at DESC`
  ).all(orgId, entityType, entityId);
}

/**
 * Verify a signature record by recomputing the hash.
 */
function verifySignature(signatureId) {
  const db = getDatabase();
  const sig = db.prepare('SELECT * FROM electronic_signatures WHERE id = ?').get(signatureId);
  if (!sig) return { valid: false, error: 'Signature not found' };

  const expected = sha256(
    [sig.user_id, sig.meaning, sig.entity_type, sig.entity_id, sig.payload_hash, sig.signed_at].join('|')
  );

  return {
    valid: expected === sig.signature_hash,
    signature: sig,
  };
}

module.exports = { signRecord, getSignatures, verifySignature };
