/**
 * TransTrack — Desktop audit hash chain verification.
 *
 * Each audit_logs row contains prev_hash (the record_hash of the preceding
 * row for the same org) and record_hash = sha256(prev_hash || canonical_json(payload)).
 * The first row in each org has prev_hash = 'GENESIS'.
 *
 * verifyAuditChain(orgId) replays the chain and returns { ok, brokenAt? }.
 */

'use strict';

const crypto = require('crypto');
const { getDatabase } = require('../database/init.cjs');

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Verify the integrity of the audit log hash chain for a given organization.
 * @param {string} orgId
 * @returns {{ ok: boolean, verified: number, brokenAt?: string }}
 */
function verifyAuditChain(orgId) {
  if (!orgId) throw new Error('orgId required');
  const db = getDatabase();

  const rows = db.prepare(
    `SELECT id, org_id, action, entity_type, entity_id, patient_name,
            details, user_id, user_email, user_role,
            prev_hash, record_hash
     FROM audit_logs
     WHERE org_id = ? AND record_hash IS NOT NULL
     ORDER BY id ASC`
  ).all(orgId);

  let prev = 'GENESIS';
  for (const r of rows) {
    const payload = {
      action: r.action,
      details: r.details || null,
      entity_id: r.entity_id || null,
      entity_type: r.entity_type || null,
      org_id: r.org_id,
      patient_name: r.patient_name || null,
      user_email: r.user_email || null,
      user_id: r.user_id || null,
      user_role: r.user_role || null,
    };
    const canonical = JSON.stringify(payload, Object.keys(payload).sort());
    const expected = sha256(prev + canonical);

    if (r.prev_hash !== prev || r.record_hash !== expected) {
      return { ok: false, verified: rows.indexOf(r), brokenAt: r.id };
    }
    prev = r.record_hash;
  }

  return { ok: true, verified: rows.length };
}

module.exports = { verifyAuditChain };
