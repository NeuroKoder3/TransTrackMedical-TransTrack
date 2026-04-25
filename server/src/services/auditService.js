'use strict';

const { sha256 } = require('../util/ids');

/**
 * Append-only audit log writer with hash chaining for tamper evidence.
 *
 * Each row's record_hash = sha256(prev_hash || canonical_json(payload)).
 * The previous hash is the most recent row for the same org.
 *
 * Rows cannot be UPDATEd or DELETEd (enforced by trigger).
 */
async function record(client, ctx, event) {
  const prev = await client.query(
    `SELECT record_hash FROM audit_logs
     WHERE org_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [ctx.orgId]
  );
  const prevHash = prev.rows[0]?.record_hash || 'GENESIS';
  const payload = {
    org_id: ctx.orgId,
    action: event.action,
    entity_type: event.entityType || null,
    entity_id: event.entityId || null,
    patient_name: event.patientName || null,
    details: event.details || null,
    user_id: ctx.userId || null,
    user_email: ctx.userEmail || null,
    user_role: ctx.role || null,
    ip_address: ctx.ip || null,
    user_agent: ctx.userAgent || null,
  };
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  const recordHash = sha256(prevHash + canonical);

  await client.query(
    `INSERT INTO audit_logs
       (org_id, action, entity_type, entity_id, patient_name, details,
        user_id, user_email, user_role, ip_address, user_agent,
        prev_hash, record_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      payload.org_id, payload.action, payload.entity_type, payload.entity_id,
      payload.patient_name, payload.details ? JSON.stringify(payload.details) : null,
      payload.user_id, payload.user_email, payload.user_role,
      payload.ip_address, payload.user_agent,
      prevHash, recordHash,
    ]
  );
}

/**
 * Verify the integrity of the audit log chain for an org.
 * Returns { ok, brokenAt? }.
 */
async function verifyChain(client, orgId) {
  const rows = await client.query(
    `SELECT id, prev_hash, record_hash, action, entity_type, entity_id,
            patient_name, details, user_id, user_email, user_role,
            ip_address, user_agent, org_id
     FROM audit_logs
     WHERE org_id = $1
     ORDER BY created_at ASC, id ASC`,
    [orgId]
  );
  let prev = 'GENESIS';
  for (const r of rows.rows) {
    const payload = {
      org_id: r.org_id,
      action: r.action,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      patient_name: r.patient_name,
      details: r.details,
      user_id: r.user_id,
      user_email: r.user_email,
      user_role: r.user_role,
      ip_address: r.ip_address,
      user_agent: r.user_agent,
    };
    const canonical = JSON.stringify(payload, Object.keys(payload).sort());
    const expected = sha256(prev + canonical);
    if (r.prev_hash !== prev || r.record_hash !== expected) {
      return { ok: false, brokenAt: r.id };
    }
    prev = r.record_hash;
  }
  return { ok: true };
}

module.exports = { record, verifyChain };
