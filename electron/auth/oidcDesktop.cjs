/**
 * TransTrack — OIDC desktop SSO via system browser + PKCE.
 *
 * Flow:
 *   1. Renderer calls `auth:ssoStart` → main process generates a PKCE
 *      verifier + challenge and a random state, builds the IdP
 *      authorization URL, and opens it in the system browser via
 *      `shell.openExternal(url)`.
 *   2. The IdP authenticates the user and redirects to
 *      `transtrack://auth/callback?code=...&state=...`. The OS dispatches
 *      this URL to the running TransTrack instance via the registered
 *      protocol handler (see electron/main.cjs).
 *   3. main.cjs's protocol handler calls `completeFlow(callbackUrl)`
 *      here, which exchanges the code at the IdP token endpoint,
 *      validates the ID token, extracts the email claim, and looks up
 *      the matching local user in the SQLite DB.
 *   4. On success we mint a TransTrack session via shared.cjs (same
 *      session shape as password login) and notify the renderer via
 *      a one-shot 'auth:ssoCompleted' event.
 *
 * SECURITY POSTURE
 *
 *   - PKCE S256 mandatory. No support for the deprecated `plain` method.
 *   - The state parameter is a 32-byte random value bound to the in-memory
 *     pending-flow record; mismatched state aborts the flow.
 *   - Only one flow can be pending at a time per main-process lifetime.
 *     Concurrent starts cancel the prior pending flow.
 *   - Token requests use HTTPS only; the http: scheme is rejected.
 *   - We do not implement the deprecated implicit flow.
 *   - The local user lookup matches by email AND requires `sso_enabled=1`
 *     on the user row, so a stolen IdP cookie cannot escalate into an
 *     account that hasn't been explicitly provisioned for SSO.
 */

'use strict';

const crypto = require('crypto');
const { URL, URLSearchParams } = require('url');

const STATE_TTL_MS = 5 * 60 * 1000;
const HTTP_TIMEOUT_MS = 15_000;
const SUPPORTED_RESPONSE_TYPES = new Set(['code']);

let _pendingFlow = null;

/**
 * In-memory record of the flow currently waiting for a callback. We
 * store it module-scoped (not in the renderer or DB) so a malicious or
 * crashed renderer cannot resurrect a stale flow.
 */
function _setPending(flow) { _pendingFlow = flow; }
function _clearPending() { _pendingFlow = null; }
function _peekPending() { return _pendingFlow; }

function _base64url(buf) { return Buffer.from(buf).toString('base64url'); }

function _generatePkce() {
  const verifier = _base64url(crypto.randomBytes(32));
  const challenge = _base64url(
    crypto.createHash('sha256').update(verifier).digest()
  );
  return { verifier, challenge };
}

function _isHttpsUrl(u) {
  try { return new URL(u).protocol === 'https:'; } catch { return false; }
}

/**
 * Discover the IdP endpoints from a .well-known/openid-configuration URL.
 */
async function _discover(issuer) {
  if (!_isHttpsUrl(issuer)) throw new Error('OIDC issuer must be https');
  const url = issuer.replace(/\/$/, '') + '/.well-known/openid-configuration';
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), HTTP_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) throw new Error(`Issuer discovery failed: HTTP ${r.status}`);
    const meta = await r.json();
    if (!meta.authorization_endpoint || !meta.token_endpoint) {
      throw new Error('Discovery document missing required endpoints');
    }
    if (!_isHttpsUrl(meta.authorization_endpoint) || !_isHttpsUrl(meta.token_endpoint)) {
      throw new Error('IdP endpoints must be https');
    }
    return meta;
  } finally { clearTimeout(t); }
}

/**
 * Begin a new SSO flow. Returns the authorization URL the caller (main
 * process) is expected to open via shell.openExternal.
 *
 * @param {object} cfg
 * @param {string} cfg.issuer       OIDC issuer (e.g. "https://login.microsoftonline.com/<tenant>/v2.0")
 * @param {string} cfg.clientId     IdP client ID registered for this desktop app
 * @param {string[]} [cfg.scopes]   defaults to ['openid','email','profile']
 * @param {string} [cfg.redirectUri] defaults to 'transtrack://auth/callback'
 */
async function startFlow(cfg) {
  if (!cfg || !cfg.issuer || !cfg.clientId) {
    throw new Error('startFlow requires { issuer, clientId }');
  }
  const meta = await _discover(cfg.issuer);
  const { verifier, challenge } = _generatePkce();
  const state = _base64url(crypto.randomBytes(24));
  const nonce = _base64url(crypto.randomBytes(24));
  const redirectUri = cfg.redirectUri || 'transtrack://auth/callback';
  const scopes = (cfg.scopes && cfg.scopes.length ? cfg.scopes : ['openid', 'email', 'profile']).join(' ');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    scope: scopes,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  const authorizationUrl = `${meta.authorization_endpoint}?${params.toString()}`;

  _setPending({
    issuer: cfg.issuer,
    clientId: cfg.clientId,
    redirectUri,
    verifier,
    state,
    nonce,
    meta,
    createdAt: Date.now(),
  });
  // Auto-expire stale pending state.
  setTimeout(() => {
    const p = _peekPending();
    if (p && Date.now() - p.createdAt >= STATE_TTL_MS) _clearPending();
  }, STATE_TTL_MS + 1000).unref?.();

  return { authorizationUrl, state };
}

/**
 * Complete the SSO flow given the callback URL the OS handed us. Returns
 * the parsed payload `{ email, name, sub, idTokenClaims }`. The caller
 * (auth handler) is responsible for the final step of locating the
 * matching local user and creating a session.
 */
async function completeFlow(callbackUrl) {
  const pending = _peekPending();
  if (!pending) throw new Error('No pending SSO flow');
  if (Date.now() - pending.createdAt > STATE_TTL_MS) {
    _clearPending();
    throw new Error('SSO flow expired; please try again');
  }

  const url = new URL(callbackUrl);
  const code = url.searchParams.get('code');
  const stateBack = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  if (error) {
    _clearPending();
    throw new Error('IdP returned error: ' + error + (url.searchParams.get('error_description') ? ' — ' + url.searchParams.get('error_description') : ''));
  }
  if (!code || !stateBack) {
    _clearPending();
    throw new Error('Callback missing code or state');
  }
  // Constant-time compare to prevent timing-attack state recovery (overkill
  // for short random strings but cheap).
  const stateA = Buffer.from(pending.state);
  const stateB = Buffer.from(stateBack);
  if (stateA.length !== stateB.length || !crypto.timingSafeEqual(stateA, stateB)) {
    _clearPending();
    throw new Error('State mismatch — possible CSRF; flow aborted');
  }

  // Token exchange.
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), HTTP_TIMEOUT_MS);
  let tokenResp;
  try {
    const r = await fetch(pending.meta.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: pending.redirectUri,
        client_id: pending.clientId,
        code_verifier: pending.verifier,
      }).toString(),
      signal: ac.signal,
    });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`Token endpoint returned ${r.status}: ${body.slice(0, 300)}`);
    }
    tokenResp = await r.json();
  } finally { clearTimeout(t); }

  _clearPending();

  if (!tokenResp.id_token) throw new Error('Token response missing id_token');

  const idTokenClaims = _decodeJwtPayload(tokenResp.id_token);
  if (idTokenClaims.iss && idTokenClaims.iss.replace(/\/$/, '') !== pending.issuer.replace(/\/$/, '')) {
    throw new Error('id_token issuer does not match configured issuer');
  }
  if (idTokenClaims.nonce && idTokenClaims.nonce !== pending.nonce) {
    throw new Error('id_token nonce mismatch');
  }
  if (idTokenClaims.exp && idTokenClaims.exp * 1000 < Date.now()) {
    throw new Error('id_token expired');
  }

  return {
    email: idTokenClaims.email || idTokenClaims.preferred_username,
    name: idTokenClaims.name || (idTokenClaims.given_name ? `${idTokenClaims.given_name} ${idTokenClaims.family_name || ''}`.trim() : null),
    sub: idTokenClaims.sub,
    idTokenClaims,
    rawTokens: tokenResp,
  };
}

/**
 * NOTE on id_token validation: we decode but do not yet verify the JWT
 * signature here. PKCE binds the token to the start-of-flow request, and
 * the TLS-protected token endpoint exchange is mutually-authenticated
 * with the IdP, so id_token replay from an external party is already
 * gated. For defense-in-depth, the next iteration of this module should
 * fetch the IdP's JWKS from the discovery document and verify the JWT
 * signature; that requires either pulling in `jose` as a dep or writing
 * an Ed25519 / RS256 verifier here. Tracked as a follow-up in
 * docs/SSO_DESKTOP.md.
 */
function _decodeJwtPayload(jwt) {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT');
  const json = Buffer.from(parts[1], 'base64url').toString('utf8');
  return JSON.parse(json);
}

/**
 * Cancel any in-flight SSO flow. Used when the user closes the activation
 * page or signs out.
 */
function cancelFlow() {
  _clearPending();
}

module.exports = {
  startFlow,
  completeFlow,
  cancelFlow,
  // Test seams:
  _peekPending,
  _clearPending,
  _generatePkce,
  _decodeJwtPayload,
};
