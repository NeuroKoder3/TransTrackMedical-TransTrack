'use strict';

/**
 * SMART access/refresh token store.
 *
 * Tokens are issued as cryptographically random opaque strings and stored
 * hashed (SHA-256) in smart_access_tokens. The bearer holds the raw value;
 * the resource server looks up by hash. This means a stolen DB row cannot
 * be reused as a bearer token, which is the property OAuth introspection
 * regulations care about.
 */

const { randomBytes, createHash } = require('crypto');
const { withTransaction, getPool } = require('../db/pool');

function newOpaque(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}
function hash(token) {
  return createHash('sha256').update(token).digest('hex');
}

async function issue({
  orgId, clientId, userId, scope, launchContext,
  accessTtlSeconds = 3600, refreshTtlSeconds = 30 * 24 * 3600, withRefresh = true,
}) {
  const accessToken = newOpaque(32);
  const refreshToken = withRefresh ? newOpaque(48) : null;
  const accessHash = hash(accessToken);
  const refreshHash = refreshToken ? hash(refreshToken) : null;

  await withTransaction({ orgId }, async (client) => {
    await client.query(
      `INSERT INTO smart_access_tokens
         (access_token_hash, org_id, client_id, user_id, scope,
          launch_context, refresh_token_hash, expires_at, refresh_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now() + ($8 || ' seconds')::interval,
               CASE WHEN $9::text IS NULL THEN NULL ELSE now() + ($10 || ' seconds')::interval END)`,
      [
        accessHash, orgId, clientId, userId || null, scope,
        JSON.stringify(launchContext || {}),
        refreshHash,
        accessTtlSeconds,
        refreshHash, refreshTtlSeconds,
      ]
    );
  });

  const out = {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: accessTtlSeconds,
    scope,
  };
  if (refreshToken) out.refresh_token = refreshToken;
  if (launchContext?.patient) out.patient = launchContext.patient;
  if (launchContext?.encounter) out.encounter = launchContext.encounter;
  if (launchContext?.fhirUser) out.fhirUser = launchContext.fhirUser;
  if (launchContext?.id_token) out.id_token = launchContext.id_token;
  return out;
}

async function lookupAccess(rawToken) {
  const r = await getPool().query(
    `SELECT org_id, client_id, user_id, scope, launch_context, expires_at, revoked_at
     FROM smart_access_tokens WHERE access_token_hash = $1`,
    [hash(rawToken)]
  );
  const row = r.rows[0];
  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return {
    orgId: row.org_id,
    clientId: row.client_id,
    userId: row.user_id,
    scope: row.scope,
    launchContext: row.launch_context || {},
    expiresAt: row.expires_at,
  };
}

async function refresh(rawRefresh, { ttlSeconds = 3600 } = {}) {
  const refreshHash = hash(rawRefresh);
  return withTransaction({}, async (client) => {
    const r = await client.query(
      `SELECT org_id, client_id, user_id, scope, launch_context, refresh_expires_at, revoked_at
       FROM smart_access_tokens WHERE refresh_token_hash = $1`,
      [refreshHash]
    );
    const row = r.rows[0];
    if (!row) throw new Error('invalid_grant');
    if (row.revoked_at) throw new Error('invalid_grant');
    if (row.refresh_expires_at && new Date(row.refresh_expires_at).getTime() < Date.now()) {
      throw new Error('invalid_grant');
    }
    // Rotate: revoke prior, issue new
    await client.query(
      `UPDATE smart_access_tokens SET revoked_at = now() WHERE refresh_token_hash = $1`,
      [refreshHash]
    );
    return issue({
      orgId: row.org_id,
      clientId: row.client_id,
      userId: row.user_id,
      scope: row.scope,
      launchContext: row.launch_context,
      accessTtlSeconds: ttlSeconds,
      withRefresh: true,
    });
  });
}

async function revoke(rawToken) {
  await getPool().query(
    `UPDATE smart_access_tokens SET revoked_at = now()
       WHERE access_token_hash = $1 OR refresh_token_hash = $1`,
    [hash(rawToken)]
  );
}

module.exports = { issue, lookupAccess, refresh, revoke, hash, newOpaque };
