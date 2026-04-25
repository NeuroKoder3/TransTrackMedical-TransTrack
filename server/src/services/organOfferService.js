'use strict';

const audit = require('./auditService');
const { errors } = require('../util/errors');

const COLS = [
  'id', 'org_id', 'donor_organ_id', 'patient_id', 'optn_match_id',
  'offer_status', 'sequence_number', 'offered_at', 'response_due_at',
  'responded_at', 'response_user_id', 'decline_code', 'decline_reason',
  'implanted_at', 'cold_ischemia_hours', 'notes', 'state_history',
  'created_at', 'updated_at',
];

const VALID_TRANSITIONS = {
  OFFERED:  ['ACCEPTED', 'DECLINED', 'EXPIRED', 'BACKUP'],
  BACKUP:   ['ACCEPTED', 'DECLINED', 'EXPIRED'],
  ACCEPTED: ['IMPLANTED', 'DECLINED'],
  DECLINED: [],
  EXPIRED:  [],
  IMPLANTED:[],
};

async function list(client, ctx, { status, patientId, limit = 100 }) {
  const params = [ctx.orgId];
  let where = 'org_id = $1';
  if (status) { params.push(status); where += ` AND offer_status = $${params.length}`; }
  if (patientId) { params.push(patientId); where += ` AND patient_id = $${params.length}`; }
  params.push(limit);
  const r = await client.query(
    `SELECT ${COLS.join(',')} FROM organ_offers
     WHERE ${where} ORDER BY offered_at DESC LIMIT $${params.length}`,
    params
  );
  return r.rows;
}

async function create(client, ctx, input) {
  const cols = ['org_id'];
  const vals = [ctx.orgId];
  const allowed = ['donor_organ_id', 'patient_id', 'optn_match_id', 'sequence_number',
    'response_due_at', 'cold_ischemia_hours', 'notes'];
  for (const k of allowed) {
    if (k in input) {
      cols.push(k);
      vals.push(input[k]);
    }
  }
  cols.push('state_history');
  vals.push(JSON.stringify([{ at: new Date().toISOString(), to: 'OFFERED', by: ctx.userId }]));
  const ph = vals.map((_, i) => `$${i + 1}`).join(',');
  const r = await client.query(
    `INSERT INTO organ_offers (${cols.join(',')}) VALUES (${ph}) RETURNING ${COLS.join(',')}`,
    vals
  );
  await audit.record(client, ctx, {
    action: 'organ_offer.create', entityType: 'organ_offer', entityId: r.rows[0].id,
    details: { donor_organ_id: input.donor_organ_id, patient_id: input.patient_id },
  });
  return r.rows[0];
}

async function transition(client, ctx, id, action, payload = {}) {
  const cur = await client.query(
    `SELECT * FROM organ_offers WHERE org_id = $1 AND id = $2 FOR UPDATE`,
    [ctx.orgId, id]
  );
  const row = cur.rows[0];
  if (!row) throw errors.notFound('Offer not found');
  const targets = {
    accept:   'ACCEPTED',
    decline:  'DECLINED',
    expire:   'EXPIRED',
    implant:  'IMPLANTED',
    backup:   'BACKUP',
  };
  const next = targets[action];
  if (!next) throw errors.badRequest(`Unknown action: ${action}`);
  const allowed = VALID_TRANSITIONS[row.offer_status] || [];
  if (!allowed.includes(next)) {
    throw errors.conflict(`Cannot transition ${row.offer_status} → ${next}`);
  }
  const history = Array.isArray(row.state_history) ? row.state_history : [];
  history.push({
    at: new Date().toISOString(), from: row.offer_status, to: next,
    by: ctx.userId, reason: payload.decline_reason || null,
  });
  const sets = ['offer_status = $1', 'state_history = $2'];
  const vals = [next, JSON.stringify(history)];
  if (next === 'ACCEPTED' || next === 'DECLINED') {
    sets.push('responded_at = now()');
    sets.push(`response_user_id = $${vals.length + 1}`);
    vals.push(ctx.userId);
  }
  if (next === 'DECLINED') {
    if (payload.decline_code) {
      vals.push(payload.decline_code);
      sets.push(`decline_code = $${vals.length}`);
    }
    if (payload.decline_reason) {
      vals.push(payload.decline_reason);
      sets.push(`decline_reason = $${vals.length}`);
    }
  }
  if (next === 'IMPLANTED') {
    sets.push('implanted_at = now()');
    if (payload.cold_ischemia_hours != null) {
      vals.push(payload.cold_ischemia_hours);
      sets.push(`cold_ischemia_hours = $${vals.length}`);
    }
  }
  vals.push(ctx.orgId, id);
  const r = await client.query(
    `UPDATE organ_offers SET ${sets.join(', ')}
     WHERE org_id = $${vals.length - 1} AND id = $${vals.length}
     RETURNING ${COLS.join(',')}`,
    vals
  );
  await audit.record(client, ctx, {
    action: `organ_offer.${action}`, entityType: 'organ_offer', entityId: id,
    details: { from: row.offer_status, to: next, ...payload },
  });
  return r.rows[0];
}

module.exports = { list, create, transition, COLS, VALID_TRANSITIONS };
