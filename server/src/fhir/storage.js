'use strict';

const { newId } = require('../util/ids');

/**
 * Generic FHIR resource storage backed by the fhir_resources table.
 * Versioning is monotonic per (org, type, id). Soft delete is supported.
 */

async function read(client, ctx, type, id) {
  const r = await client.query(
    `SELECT body, version_id, last_updated, deleted FROM fhir_resources
     WHERE org_id = $1 AND resource_type = $2 AND resource_id = $3`,
    [ctx.orgId, type, id]
  );
  return r.rows[0] || null;
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
  const cur = await read(client, ctx, type, id);
  const versionId = (cur?.version_id || 0) + 1;
  const now = new Date().toISOString();
  const stamped = {
    ...body,
    id,
    resourceType: type,
    meta: { ...(body.meta || {}), versionId: String(versionId), lastUpdated: now },
  };
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

module.exports = { read, create, update, search };
