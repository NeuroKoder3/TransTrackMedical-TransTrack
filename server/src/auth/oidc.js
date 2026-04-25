'use strict';

const { Issuer, generators } = require('openid-client');

/**
 * OpenID Connect helper. Compatible with Epic, Cerner, Azure AD, Okta,
 * Keycloak, Auth0 and any other RFC 6749 / OIDC Core 1.0 conformant IdP.
 *
 * Role assignment: a configurable claim (default `transtrack_role`) is
 * mapped onto the TransTrack role enum. Unknown roles default to `user`.
 */

let client = null;
let cfg = null;

async function init(config) {
  if (!config.OIDC_ENABLED) return null;
  cfg = config;
  const issuer = await Issuer.discover(config.OIDC_ISSUER);
  client = new issuer.Client({
    client_id: config.OIDC_CLIENT_ID,
    client_secret: config.OIDC_CLIENT_SECRET,
    redirect_uris: [config.OIDC_REDIRECT_URI],
    response_types: ['code'],
  });
  return client;
}

function buildAuthRequest() {
  if (!client) throw new Error('OIDC is not enabled');
  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);
  const state = generators.state();
  const nonce = generators.nonce();
  const url = client.authorizationUrl({
    scope: cfg.OIDC_SCOPES,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return { url, codeVerifier, state, nonce };
}

async function handleCallback(query, expected) {
  if (!client) throw new Error('OIDC is not enabled');
  const params = client.callbackParams(query);
  const tokenSet = await client.callback(cfg.OIDC_REDIRECT_URI, params, {
    code_verifier: expected.codeVerifier,
    state: expected.state,
    nonce: expected.nonce,
  });
  const userInfo = await client.userinfo(tokenSet.access_token);
  return { tokenSet, userInfo };
}

function extractProfile(userInfo, idTokenClaims) {
  const role = userInfo[cfg.OIDC_ROLE_CLAIM]
    || idTokenClaims?.[cfg.OIDC_ROLE_CLAIM];
  return {
    email: userInfo.email,
    name: userInfo.name || `${userInfo.given_name || ''} ${userInfo.family_name || ''}`.trim(),
    role,
    sub: userInfo.sub,
  };
}

module.exports = { init, buildAuthRequest, handleCallback, extractProfile };
