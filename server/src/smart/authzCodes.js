'use strict';

/**
 * SMART OAuth authorization code store with PKCE support.
 *
 * Codes are issued at /authorize, exchanged once at /token. They live in
 * smart_authz_codes for 5 minutes. Single-use is enforced by setting
 * consumed_at on first redemption.
 */

const { randomBytes, createHash } = require('crypto');
const { getPool } = require('../db/pool');

function newCode() {
  return randomBytes(24).toString('base64url');
}
function hash(code) {
  return createHash('sha256').update(code).digest('hex');
}

async function issue({
  orgId, clientId, userId, redirectUri, scope,
  codeChallenge, codeChallengeMethod, launchContext, nonce,
  ttlSeconds = 300,
}) {
  const code = newCode();
  await getPool().query(
    `INSERT INTO smart_authz_codes
      (code_hash, org_id, client_id, user_id, redirect_uri, scope,
       code_challenge, code_challenge_method, launch_context, nonce,
       expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now() + ($11 || ' seconds')::interval)`,
    [
      hash(code), orgId, clientId, userId, redirectUri, scope,
      codeChallenge || null, codeChallengeMethod || null,
      JSON.stringify(launchContext || {}), nonce || null,
      ttlSeconds,
    ]
  );
  return code;
}

async function consume(code, { codeVerifier } = {}) {
  const r = await getPool().query(
    `UPDATE smart_authz_codes
        SET consumed_at = now()
      WHERE code_hash = $1 AND consumed_at IS NULL AND expires_at > now()
      RETURNING org_id, client_id, user_id, redirect_uri, scope,
                code_challenge, code_challenge_method, launch_context, nonce`,
    [hash(code)]
  );
  const row = r.rows[0];
  if (!row) throw new Error('invalid_grant');

  // PKCE verification (mandatory for public clients per SMART v2)
  if (row.code_challenge) {
    if (!codeVerifier) throw new Error('invalid_grant');
    if (row.code_challenge_method === 'S256') {
      const computed = createHash('sha256').update(codeVerifier).digest('base64url');
      if (computed !== row.code_challenge) throw new Error('invalid_grant');
    } else if (row.code_challenge_method === 'plain') {
      if (codeVerifier !== row.code_challenge) throw new Error('invalid_grant');
    } else {
      throw new Error('invalid_grant');
    }
  }
  return {
    orgId: row.org_id,
    clientId: row.client_id,
    userId: row.user_id,
    redirectUri: row.redirect_uri,
    scope: row.scope,
    launchContext: row.launch_context || {},
    nonce: row.nonce,
  };
}

module.exports = { issue, consume };
