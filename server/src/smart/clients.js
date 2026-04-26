'use strict';

/**
 * SMART on FHIR client registration helpers (RFC 7591 Dynamic Client Registration
 * style, with SMART/Backend-Services extensions).
 */

const { createHash } = require('crypto');
const { withTransaction } = require('../db/pool');
const { newOpaque } = require('./tokens');

function hashSecret(s) {
  return createHash('sha256').update(s).digest('hex');
}

async function register(ctx, input) {
  return withTransaction(ctx, async (client) => {
    const clientId = input.client_id || `tt-${newOpaque(10).slice(0, 16)}`;
    let clientSecret = null;
    let clientSecretHash = null;
    if (input.client_type === 'confidential') {
      clientSecret = newOpaque(32);
      clientSecretHash = hashSecret(clientSecret);
    }
    const r = await client.query(
      `INSERT INTO smart_clients
         (org_id, client_id, client_secret_hash, client_type, client_name,
          redirect_uris, scope, launch_uri, logo_uri, contacts,
          jwks_uri, jwks, grant_types, response_types, token_endpoint_auth_method,
          is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id, client_id, client_type, client_name, redirect_uris,
                 scope, launch_uri, jwks_uri, grant_types, response_types,
                 token_endpoint_auth_method, is_active`,
      [
        ctx.orgId,
        clientId,
        clientSecretHash,
        input.client_type || 'public',
        input.client_name || 'Unnamed SMART Client',
        JSON.stringify(input.redirect_uris || []),
        input.scope || '',
        input.launch_uri || null,
        input.logo_uri || null,
        JSON.stringify(input.contacts || []),
        input.jwks_uri || null,
        input.jwks ? JSON.stringify(input.jwks) : null,
        JSON.stringify(input.grant_types || ['authorization_code', 'refresh_token']),
        JSON.stringify(input.response_types || ['code']),
        input.token_endpoint_auth_method
          || (input.client_type === 'confidential' ? 'client_secret_basic'
            : input.client_type === 'backend' ? 'private_key_jwt' : 'none'),
        input.is_active !== false,
      ]
    );
    const row = r.rows[0];
    if (clientSecret) row.client_secret = clientSecret;
    return row;
  });
}

async function get(ctx, clientId) {
  return withTransaction(ctx, async (client) => {
    const r = await client.query(
      `SELECT * FROM smart_clients WHERE org_id = $1 AND client_id = $2 AND is_active = TRUE`,
      [ctx.orgId, clientId]
    );
    return r.rows[0] || null;
  });
}

async function getUnscoped(clientId) {
  // Used by /token where we don't yet have an org context — match by client_id alone.
  return withTransaction({}, async (client) => {
    const r = await client.query(
      `SELECT * FROM smart_clients WHERE client_id = $1 AND is_active = TRUE`,
      [clientId]
    );
    return r.rows[0] || null;
  });
}

async function verifySecret(clientRow, providedSecret) {
  if (!clientRow.client_secret_hash) return false;
  if (!providedSecret) return false;
  return clientRow.client_secret_hash === hashSecret(providedSecret);
}

async function list(ctx) {
  return withTransaction(ctx, async (client) => {
    const r = await client.query(
      `SELECT id, client_id, client_type, client_name, redirect_uris,
              scope, launch_uri, jwks_uri, is_active, created_at
       FROM smart_clients WHERE org_id = $1 ORDER BY client_name`,
      [ctx.orgId]
    );
    return r.rows;
  });
}

module.exports = { register, get, getUnscoped, verifySecret, list };
