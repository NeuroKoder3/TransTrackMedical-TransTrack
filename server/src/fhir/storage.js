'use strict';

const { newId } = require('../util/ids');
const compartment = require('./compartment');

/**
 * Generic FHIR resource storage backed by the fhir_resources table.
 * Versioning is monotonic per (org, type, id). Soft delete is supported.
 *
 * Every entry point enforces two independent boundaries:
 *   1. Tenant  — org_id equality, backed by PostgreSQL row-level security.
 *   2. Patient compartment — when ctx.compartment.patient is set (a SMART
 *      patient-level grant), the resource must belong to that patient.
 *
 * The compartment check lives here rather than in the routes so that no route,
 * transaction-bundle entry, or future call site can omit it (C-1, H-4).
 */

/** True when this request is confined to a single patient compartment. */
function compartmentPatient(ctx) {
  return ctx?.compartment?.patient || null;
}

/**
 * Guard a resource body that has already been loaded. Returns the row when the
 * caller is entitled to it, otherwise null (rendered as 404, not 403, so the
 * existence of another patient's resource is not disclosed).
 */
function guardRow(ctx, type, row) {
  const patientId = compartmentPatient(ctx);
  if (!patientId || !row) return row;
  return compartment.resourceBelongsToPatient(type, row.body, patientId) ? row : null;
}

/**
 * Guard an already-stored resource that is about to be modified or removed.
 */
function guardWritableExisting(ctx, type, row) {
  const patientId = compartmentPatient(ctx);
  if (!patientId) return;
  if (!compartment.resourceBelongsToPatient(type, row.body, patientId)) {
    const err = new Error(
      `Patient-scoped access may not modify ${type} outside the launch patient compartment`
    );
    err.statusCode = 403;
    err.code = 'forbidden';
    throw err;
  }
}

/**
 * Guard an inbound body on create/update. Throws so the caller sees a hard
 * failure rather than silently writing outside the compartment.
 */
function assertWritable(ctx, type, body) {
  const patientId = compartmentPatient(ctx);
  if (!patientId) return;
  if (!compartment.resourceBelongsToPatient(type, body, patientId)) {
    const err = new Error(
      `Patient-scoped access may not write ${type} outside the launch patient compartment`
    );
    err.statusCode = 403;
    err.code = 'forbidden';
    throw err;
  }
}

/** Unguarded read used internally where the compartment check is applied separately. */
async function readRaw(client, ctx, type, id) {
  const r = await client.query(
    `SELECT body, version_id, last_updated, deleted FROM fhir_resources
     WHERE org_id = $1 AND resource_type = $2 AND resource_id = $3`,
    [ctx.orgId, type, id]
  );
  return r.rows[0] || null;
}

async function read(client, ctx, type, id) {
  return guardRow(ctx, type, await readRaw(client, ctx, type, id));
}

async function create(client, ctx, type, body) {
  const id = body.id || newId();
  const now = new Date().toISOString();
  const stamped = {
    ...body,
    id,
    resourceType: type,
    meta: { ...(body.meta || {}), versionId: '1', lastUpdated: now },
  };
  assertWritable(ctx, type, stamped);
  await client.query(
    `INSERT INTO fhir_resources (org_id, resource_type, resource_id, version_id, last_updated, body, deleted)
     VALUES ($1, $2, $3, 1, now(), $4, FALSE)
     ON CONFLICT (org_id, resource_type, resource_id) DO UPDATE
       SET version_id = fhir_resources.version_id + 1,
           last_updated = now(),
           body = EXCLUDED.body,
           deleted = FALSE`,
    [ctx.orgId, type, id, JSON.stringify(stamped)]
  );
  return read(client, ctx, type, id);
}

async function update(client, ctx, type, id, body) {
  const existing = await readRaw(client, ctx, type, id);
  // Both the stored resource and the replacement must be inside the caller's
  // compartment, otherwise an update could be used to move a foreign resource
  // into (or a compartment resource out of) the caller's reach.
  if (existing) guardWritableExisting(ctx, type, existing);
  const versionId = (existing?.version_id || 0) + 1;
  const now = new Date().toISOString();
  const stamped = {
    ...body,
    id,
    resourceType: type,
    meta: { ...(body.meta || {}), versionId: String(versionId), lastUpdated: now },
  };
  assertWritable(ctx, type, stamped);
  await client.query(
    `INSERT INTO fhir_resources (org_id, resource_type, resource_id, version_id, last_updated, body, deleted)
     VALUES ($1, $2, $3, $4, now(), $5, FALSE)
     ON CONFLICT (org_id, resource_type, resource_id) DO UPDATE
       SET version_id = EXCLUDED.version_id,
           last_updated = now(),
           body = EXCLUDED.body,
           deleted = FALSE`,
    [ctx.orgId, type, id, versionId, JSON.stringify(stamped)]
  );
  return read(client, ctx, type, id);
}

async function search(client, ctx, type, params) {
  const where = ['org_id = $1', 'resource_type = $2', 'deleted = FALSE'];
  const vals = [ctx.orgId, type];

  // Patient-compartment restriction is applied as a SQL predicate so that the
  // result set can never contain another patient's resources, regardless of
  // which search parameters the caller supplied (C-1).
  const patientId = compartmentPatient(ctx);
  if (patientId) {
    const pred = compartment.searchPredicate(type, patientId, vals.length + 1);
    if (!pred) {
      // Type is outside every patient compartment — deny rather than return all.
      return [];
    }
    where.push(pred.sql);
    vals.push(...pred.values);
  }

  if (params._id) {
    vals.push(params._id);
    where.push(`resource_id = $${vals.length}`);
  }
  if (params._lastUpdated) {
    vals.push(params._lastUpdated);
    where.push(`last_updated >= $${vals.length}::timestamptz`);
  }
  // identifier=system|value (Patient)
  if (params.identifier) {
    const v = params.identifier.split('|').slice(-1)[0];
    vals.push(v);
    where.push(`body @> jsonb_build_object('identifier', jsonb_build_array(jsonb_build_object('value', $${vals.length}::text)))`);
  }
  if (params.name || params.family) {
    const f = params.family || params.name;
    vals.push(`%${f.toLowerCase()}%`);
    where.push(`lower(body->'name'->0->>'family') LIKE $${vals.length}`);
  }
  if (params.patient) {
    const ref = params.patient.startsWith('Patient/') ? params.patient : `Patient/${params.patient}`;
    vals.push(ref);
    where.push(`body->'subject'->>'reference' = $${vals.length}`);
  }
  if (params.code) {
    vals.push(params.code);
    where.push(`body @> jsonb_build_object('code', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object('code', $${vals.length}::text))))`);
  }
  if (params.status) {
    vals.push(params.status);
    where.push(`body->>'status' = $${vals.length}`);
  }
  const limit = Math.min(parseInt(params._count, 10) || 50, 200);
  vals.push(limit);
  const r = await client.query(
    `SELECT body, version_id, last_updated FROM fhir_resources
     WHERE ${where.join(' AND ')}
     ORDER BY last_updated DESC LIMIT $${vals.length}`,
    vals
  );
  return r.rows;
}

async function softDelete(client, ctx, type, id) {
  const cur = await readRaw(client, ctx, type, id);
  if (!cur || cur.deleted) return null;
  guardWritableExisting(ctx, type, cur);
  const versionId = (cur.version_id || 0) + 1;
  await client.query(
    `UPDATE fhir_resources
       SET deleted = TRUE, version_id = $4, last_updated = now()
     WHERE org_id = $1 AND resource_type = $2 AND resource_id = $3`,
    [ctx.orgId, type, id, versionId]
  );
  return { version_id: versionId };
}

/**
 * Return version history for a resource. We store only current state in
 * fhir_resources (no separate versions table yet), so history returns the
 * current version only with proper Bundle framing.
 * NOTE: Profile validation in this server is structural-only (Zod/custom
 * schemas per resource type) — not a full FHIR profile validator.
 */
async function history(client, ctx, type, id, vid) {
  const row = await read(client, ctx, type, id);
  if (!row) return null;
  if (vid && String(row.version_id) !== String(vid)) return null;
  return [row];
}

module.exports = { read, create, update, search, softDelete, history };
