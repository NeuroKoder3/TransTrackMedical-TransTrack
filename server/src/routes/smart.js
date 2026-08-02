'use strict';

/**
 * SMART on FHIR endpoints.
 *
 *   GET  /.well-known/smart-configuration   discovery (RFC 8414 + SMART)
 *   GET  /oauth2/authorize                  OAuth2 authorization endpoint
 *   POST /oauth2/authorize                  user-consent submission (form post)
 *   POST /oauth2/token                      token endpoint
 *   POST /oauth2/register                   dynamic client registration (admin)
 *   POST /oauth2/introspect                 RFC 7662 token introspection
 *   POST /oauth2/revoke                     RFC 7009 token revocation
 *
 * Notes:
 *  - The /authorize flow renders a minimal HTML consent page when called by
 *    a browser. EHR clients launching us with launch=<token> will pre-populate
 *    the launch context.
 *  - The /token endpoint supports four grant types:
 *       authorization_code          (standalone + EHR launch)
 *       refresh_token               (rotation)
 *       client_credentials          (legacy, secret-auth)
 *       urn:ietf:params:oauth:grant-type:jwt-bearer  (Backend Services)
 */

const { z } = require('zod');
const { errors } = require('../util/errors');
const { requireRole } = require('../middleware/auth');
const { getPool } = require('../db/pool');
const tokens = require('../smart/tokens');
const authzCodes = require('../smart/authzCodes');
const clients = require('../smart/clients');
const backendJwt = require('../smart/backendJwt');
const idToken = require('../smart/idToken');
const launchContexts = require('../smart/launchContexts');
const { authenticateOAuthClient } = require('../smart/clientAuth');
const {
  assertRegisteredRedirect, constrainScopes, requirePkceForPublic,
} = require('../smart/scopes');
const authService = require('../services/authService');

module.exports = async function smartRoutes(app, opts) {
  const { config } = opts;
  const baseUrl = config.FHIR_BASE_URL;
  const issuer = (() => {
    try { return new URL(baseUrl).origin; }
    catch { return baseUrl.replace(/\/fhir\/?$/, ''); }
  })();
  const tokenUrl = `${issuer}/oauth2/token`;

  // ----- Discovery ----------------------------------------------------------
  app.get('/.well-known/smart-configuration',
    { config: { public: true, rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (_req, reply) => {
      reply.type('application/json');
      return {
        issuer,
        authorization_endpoint: `${issuer}/oauth2/authorize`,
        token_endpoint: tokenUrl,
        token_endpoint_auth_methods_supported: [
          'client_secret_basic', 'client_secret_post', 'private_key_jwt', 'none',
        ],
        registration_endpoint: `${issuer}/oauth2/register`,
        jwks_uri: `${issuer}/.well-known/jwks.json`,
        id_token_signing_alg_values_supported: [config.SMART_ID_TOKEN_ALG || 'RS256'],
        introspection_endpoint: `${issuer}/oauth2/introspect`,
        revocation_endpoint: `${issuer}/oauth2/revoke`,
        introspection_endpoint_auth_methods_supported: [
          'client_secret_basic', 'client_secret_post', 'private_key_jwt',
        ],
        revocation_endpoint_auth_methods_supported: [
          'client_secret_basic', 'client_secret_post', 'private_key_jwt',
        ],
        scopes_supported: [
          'openid', 'fhirUser', 'profile', 'email',
          'launch', 'launch/patient', 'launch/encounter', 'launch/practitioner',
          'offline_access', 'online_access',
          'patient/*.cruds', 'patient/*.rs',
          'user/*.cruds', 'user/*.rs',
          'system/*.cruds', 'system/*.rs',
        ],
        response_types_supported: ['code'],
        grant_types_supported: [
          'authorization_code', 'refresh_token', 'client_credentials',
          'urn:ietf:params:oauth:grant-type:jwt-bearer',
        ],
        code_challenge_methods_supported: ['S256'],
        capabilities: [
          'launch-ehr',
          'launch-standalone',
          'client-public',
          'client-confidential-symmetric',
          'client-confidential-asymmetric',
          'context-passthrough-banner',
          'context-passthrough-style',
          'context-ehr-patient',
          'context-ehr-encounter',
          'context-standalone-patient',
          'context-standalone-encounter',
          'permission-patient',
          'permission-user',
          'permission-v2',
          'sso-openid-connect',
          'permission-offline',
        ],
      };
    });

  // ----- ID token JWK Set ---------------------------------------------------
  // Relying parties verify SMART/OIDC ID tokens against this. It carries only
  // public key material.
  app.get('/.well-known/jwks.json',
    { config: { public: true, rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      reply.type('application/json');
      try {
        return idToken.publicJwks(config);
      } catch (err) {
        req.log.error({ err }, 'ID token signing key unavailable');
        reply.code(503);
        return { error: 'id_token_signing_key_unavailable' };
      }
    });

  // Also publish the SMART config under the FHIR base, per the spec.
  app.get('/fhir/.well-known/smart-configuration',
    { config: { public: true, rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const handler = app.routeIndex
        ? app.routeIndex.find(r => r.path === '/.well-known/smart-configuration')?.handler
        : null;
      if (handler) return handler(req, reply);
      reply.code(308).header('Location', '/.well-known/smart-configuration').send();
    });

  // ----- Authorization endpoint --------------------------------------------
  app.get('/oauth2/authorize',
    { config: { public: true, rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const q = z.object({
        response_type: z.literal('code'),
        client_id: z.string().min(1),
        redirect_uri: z.string().url(),
        scope: z.string().min(1),
        state: z.string().optional(),
        aud: z.string().optional(),
        launch: z.string().optional(),
        code_challenge: z.string().optional(),
        code_challenge_method: z.enum(['S256']).optional(),
        nonce: z.string().optional(),
      }).parse(req.query);

      const smartClient = await clients.getUnscoped(q.client_id);
      if (!smartClient) throw errors.badRequest('unknown client_id');

      // Validate redirect unconditionally
      assertRegisteredRedirect(smartClient, q.redirect_uri);

      // Constrain scopes to registered set
      const constrainedScope = constrainScopes(q.scope, smartClient.scope);

      // Require S256 PKCE for public clients
      requirePkceForPublic(smartClient, q.code_challenge, q.code_challenge_method);

      // Validate aud against config.FHIR_BASE_URL if provided
      if (q.aud && q.aud !== baseUrl) {
        throw errors.badRequest('aud parameter does not match this server\'s FHIR base URL');
      }

      // M-11: resolve the launch here, once, and hand the browser only an
      // opaque handle. The patient is never round-tripped through the client.
      const launchContext = q.launch
        ? await resolveLaunchContext(q.launch, smartClient.org_id)
        : {};
      const launchHandle = await launchContexts.issue({
        orgId: smartClient.org_id,
        clientId: smartClient.client_id,
        context: launchContext,
      });

      reply.type('text/html');
      return consentPage({
        clientId: q.client_id,
        clientName: smartClient.client_name,
        redirectUri: q.redirect_uri,
        scope: constrainedScope,
        state: q.state || '',
        codeChallenge: q.code_challenge || '',
        codeChallengeMethod: q.code_challenge_method || '',
        nonce: q.nonce || '',
        launchHandle: launchHandle || '',
      });
    });

  app.post('/oauth2/authorize',
    { config: { public: true, rateLimit: { max: 15, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = z.object({
        client_id: z.string(),
        redirect_uri: z.string().url(),
        scope: z.string(),
        state: z.string().optional(),
        code_challenge: z.string().optional(),
        code_challenge_method: z.enum(['S256']).optional(),
        nonce: z.string().optional(),
        // Opaque reference to the server-side launch record created at
        // GET /oauth2/authorize. The launch context itself is never accepted
        // from the client (M-11).
        launch_handle: z.string().optional(),
        username: z.string().optional(),
        password: z.string().optional(),
        mfa_code: z.string().optional(),
        mfa_challenge_id: z.string().optional(),
        decision: z.enum(['approve', 'deny']).default('approve'),
      }).parse(req.body || {});

      const smartClient = await clients.getUnscoped(body.client_id);
      if (!smartClient) throw errors.badRequest('unknown client_id');

      // FIRST: validate redirect_uri BEFORE any redirect (including deny)
      assertRegisteredRedirect(smartClient, body.redirect_uri);

      // Constrain scopes
      const constrainedScope = constrainScopes(body.scope, smartClient.scope);

      // Require PKCE S256 for public clients
      requirePkceForPublic(smartClient, body.code_challenge, body.code_challenge_method);

      if (body.decision === 'deny') {
        const url = new URL(body.redirect_uri);
        url.searchParams.set('error', 'access_denied');
        if (body.state) url.searchParams.set('state', body.state);
        reply.code(302).header('Location', url.toString()).send();
        return;
      }

      // Authenticate using the hardened authenticateForSmart
      if (!body.username || !body.password) {
        throw errors.unauthorized('username and password required');
      }

      let userId;
      // If MFA code is provided alongside a challenge, verify it
      if (body.mfa_code && body.mfa_challenge_id) {
        const mfaResult = await authService.verifySmartMfa({
          challengeId: body.mfa_challenge_id,
          code: body.mfa_code,
          userId: null,
        });
        if (mfaResult.kind !== 'ok') {
          throw errors.unauthorized('MFA verification failed');
        }
        userId = mfaResult.userId;
      } else {
        const result = await authService.authenticateForSmart(smartClient, config, {
          orgHint: smartClient.org_id,
          email: body.username,
          plaintext: body.password,
          ip: req.ip,
        });

        if (result.kind === 'mfa_required') {
          // Do NOT issue auth code — return MFA challenge info
          throw errors.unauthorized('mfa_required', {
            challengeId: result.challengeId,
            userId: result.userId,
          });
        }
        if (result.kind === 'must_enroll') {
          throw errors.unauthorized('MFA enrollment required before authorization');
        }
        if (result.kind !== 'ok') {
          throw errors.unauthorized('invalid credentials');
        }
        userId = result.userId;
      }

      // The launch context comes from the server-side record only. A request
      // with no handle, or one whose handle is expired, already spent, or
      // belongs to another client, gets no launch context — not a
      // client-supplied one.
      const launchContext = body.launch_handle
        ? (await launchContexts.consume(body.launch_handle, {
            clientId: smartClient.client_id,
          })) || {}
        : {};

      const code = await authzCodes.issue({
        orgId: smartClient.org_id,
        clientId: smartClient.client_id,
        userId,
        redirectUri: body.redirect_uri,
        scope: constrainedScope,
        codeChallenge: body.code_challenge,
        codeChallengeMethod: body.code_challenge_method,
        launchContext,
        nonce: body.nonce,
      });

      const url = new URL(body.redirect_uri);
      url.searchParams.set('code', code);
      if (body.state) url.searchParams.set('state', body.state);
      reply.code(302).header('Location', url.toString()).send();
    });

  // ----- Token endpoint -----------------------------------------------------
  app.post('/oauth2/token',
    { config: { public: true, rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      reply.header('Pragma', 'no-cache');

      const SUPPORTED_GRANT_TYPES = /** @type {const} */ ([
        'authorization_code',
        'refresh_token',
        'client_credentials',
        'urn:ietf:params:oauth:grant-type:jwt-bearer',
      ]);

      const body = req.body || {};
      const grantParsed = z.enum(SUPPORTED_GRANT_TYPES).safeParse(body.grant_type);
      if (!grantParsed.success) throw errors.badRequest('unsupported_grant_type');
      const grantType = grantParsed.data;

      // ---------- Auth header parsing (basic) -------------------------------
      let basicClientId = null;
      let basicSecret = null;
      const auth = req.headers.authorization || '';
      if (auth.toLowerCase().startsWith('basic ')) {
        const decoded = Buffer.from(auth.slice(6).trim(), 'base64').toString('utf8');
        const colon = decoded.indexOf(':');
        if (colon > 0) {
          basicClientId = decoded.slice(0, colon);
          basicSecret = decoded.slice(colon + 1);
        }
      }
      const clientId = body.client_id || basicClientId;
      const clientSecret = body.client_secret || basicSecret;

      if (grantType === 'authorization_code') {
        const data = z.object({
          code: z.string().min(1),
          redirect_uri: z.string().url(),
          code_verifier: z.string().optional(),
        }).parse(body);
        const consumed = await authzCodes.consume(data.code, { codeVerifier: data.code_verifier });
        if (consumed.redirectUri !== data.redirect_uri) {
          throw errors.badRequest('invalid_grant: redirect_uri mismatch');
        }
        if (clientId && consumed.clientId !== clientId) {
          throw errors.badRequest('invalid_grant: client_id mismatch');
        }
        // For confidential clients, verify the secret
        const smartClient = await clients.getUnscoped(consumed.clientId);
        if (smartClient.client_type === 'confidential') {
          const ok = await clients.verifySecret(smartClient, clientSecret);
          if (!ok) throw errors.unauthorized('invalid_client');
        }
        const launchCtx = consumed.launchContext || {};
        if (consumed.scope.includes('openid')) {
          launchCtx.id_token = idToken.signIdToken(config, {
            issuer, clientId: consumed.clientId, userId: consumed.userId,
            nonce: consumed.nonce,
          });
          launchCtx.fhirUser = `Practitioner/${consumed.userId}`;
        }
        const issued = await tokens.issue({
          orgId: consumed.orgId,
          clientId: consumed.clientId,
          userId: consumed.userId,
          scope: consumed.scope,
          launchContext: launchCtx,
          accessTtlSeconds: config.JWT_ACCESS_TTL_SECONDS,
          refreshTtlSeconds: config.JWT_REFRESH_TTL_SECONDS,
          withRefresh: consumed.scope.includes('offline_access') || consumed.scope.includes('online_access'),
        });
        return issued;
      }

      if (grantType === 'refresh_token') {
        const data = z.object({ refresh_token: z.string().min(1) }).parse(body);
        // Resolve the client from the refresh token (server-controlled), not from
        // caller-supplied client_id. Confidential clients MUST authenticate.
        const tokenClientId = await tokens.lookupTokenClientId(data.refresh_token);
        if (!tokenClientId) throw errors.unauthorized('invalid_grant');
        if (clientId && clientId !== tokenClientId) {
          throw errors.unauthorized('invalid_grant');
        }
        const smartClient = await clients.getUnscoped(tokenClientId);
        if (!smartClient) throw errors.unauthorized('invalid_client');
        if (smartClient.client_type === 'confidential') {
          const ok = await clients.verifySecret(smartClient, clientSecret);
          if (!ok) throw errors.unauthorized('invalid_client');
        }
        try {
          return await tokens.refresh(data.refresh_token, {
            ttlSeconds: config.JWT_ACCESS_TTL_SECONDS,
            clientId: tokenClientId,
          });
        } catch (_e) {
          throw errors.unauthorized('invalid_grant');
        }
      }

      if (grantType === 'client_credentials') {
        if (!clientId || !clientSecret) throw errors.unauthorized('client credentials required');
        const smartClient = await clients.getUnscoped(clientId);
        if (!smartClient || smartClient.client_type !== 'confidential') {
          throw errors.unauthorized('invalid_client');
        }
        const ok = await clients.verifySecret(smartClient, clientSecret);
        if (!ok) throw errors.unauthorized('invalid_client');
        if (!smartClient.scope) {
          throw errors.badRequest('Client has no registered scopes');
        }
        const requestedScope = body.scope
          ? constrainScopes(body.scope, smartClient.scope)
          : smartClient.scope;
        return tokens.issue({
          orgId: smartClient.org_id,
          clientId: smartClient.client_id,
          userId: null,
          scope: requestedScope,
          launchContext: {},
          accessTtlSeconds: config.JWT_ACCESS_TTL_SECONDS,
          withRefresh: false,
        });
      }

      if (grantType === 'urn:ietf:params:oauth:grant-type:jwt-bearer') {
        const data = z.object({
          client_assertion_type: z.literal('urn:ietf:params:oauth:client-assertion-type:jwt-bearer'),
          client_assertion: z.string().min(20),
          scope: z.string().optional(),
        }).parse(body);
        const [, payloadB64] = data.client_assertion.split('.');
        let assertedClientId;
        try {
          assertedClientId = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')).iss;
        } catch {
          throw errors.badRequest('invalid client_assertion');
        }
        const smartClient = await clients.getUnscoped(assertedClientId);
        if (!smartClient || smartClient.client_type !== 'backend') {
          throw errors.unauthorized('invalid_client');
        }
        try {
          await backendJwt.verifyAssertion(smartClient, data.client_assertion, tokenUrl);
        } catch (e) {
          throw errors.unauthorized(e.message);
        }
        if (!smartClient.scope) {
          throw errors.badRequest('Client has no registered scopes');
        }
        const requestedScope = data.scope
          ? constrainScopes(data.scope, smartClient.scope)
          : smartClient.scope;
        return tokens.issue({
          orgId: smartClient.org_id,
          clientId: smartClient.client_id,
          userId: null,
          scope: requestedScope,
          launchContext: {},
          accessTtlSeconds: 300,
          withRefresh: false,
        });
      }

      // unreachable: grant_type validated by z.enum above
    });

  // ----- Dynamic client registration (admin only) ---------------------------
  app.post('/oauth2/register',
    { preHandler: requireRole('admin') },
    async (req) => clients.register(req.auth, req.body || {}));

  app.get('/oauth2/clients',
    { preHandler: requireRole('admin') },
    async (req) => clients.list(req.auth));

  // ----- Introspection (RFC 7662) ------------------------------------------
  app.post('/oauth2/introspect',
    { config: { public: true, rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req) => {
      const body = req.body || {};
      const { clientId } = await authenticateOAuthClient(req, body, { tokenUrl });
      const data = z.object({ token: z.string().min(1) }).parse(body);
      const found = await tokens.lookupAccess(data.token);
      if (!found || found.clientId !== clientId) return { active: false };
      return {
        active: true,
        scope: found.scope,
        client_id: found.clientId,
        token_type: 'Bearer',
        exp: Math.floor(new Date(found.expiresAt).getTime() / 1000),
        sub: found.userId,
      };
    });

  app.post('/oauth2/revoke',
    { config: { public: true, rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = req.body || {};
      const { clientId } = await authenticateOAuthClient(req, body, { tokenUrl });
      const data = z.object({ token: z.string().min(1) }).parse(body);
      const ownerClientId = await tokens.lookupTokenClientId(data.token);
      if (ownerClientId && ownerClientId === clientId) {
        await tokens.revoke(data.token);
      }
      reply.code(200).send({ revoked: true });
    });
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveLaunchContext(launchToken, orgId) {
  // EHR launch tokens are opaque references stored by the EHR. For the
  // standalone server we accept either a JSON-encoded string ({patient, encounter})
  // base64url-encoded, or a UUID that maps to a Patient row.
  try {
    const decoded = JSON.parse(Buffer.from(launchToken, 'base64url').toString('utf8'));
    return decoded;
  } catch { /* not JSON */ }
  // Try as patient UUID
  if (/^[0-9a-f-]{36}$/i.test(launchToken) && orgId) {
    const r = await getPool().query(
      `SELECT id FROM patients WHERE org_id = $1 AND id = $2`,
      [orgId, launchToken]
    );
    if (r.rows[0]) return { patient: launchToken };
  }
  return {};
}

function consentPage(args) {
  const escape = (s) => String(s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const a = Object.fromEntries(Object.entries(args).map(([k, v]) => [k, escape(v)]));
  const scopeList = String(args.scope).split(/\s+/).filter(Boolean)
    .map(s => `<li><code>${escape(s)}</code></li>`).join('');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>TransTrack — Authorize ${a.clientName}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 480px; margin: 4rem auto; color: #222; }
  h1 { font-size: 1.4rem; }
  ul { padding-left: 1.2rem; }
  form { margin-top: 1rem; }
  input { width: 100%; padding: 0.5rem; margin: 0.25rem 0 0.75rem; box-sizing: border-box; }
  .row { display: flex; gap: 0.5rem; }
  button { padding: 0.6rem 1rem; cursor: pointer; }
  .approve { background: #1f7a3b; color: #fff; border: 0; }
  .deny { background: #fff; border: 1px solid #888; }
</style></head>
<body>
<h1>${a.clientName} requests access</h1>
<p>This application is requesting the following permissions:</p>
<ul>${scopeList}</ul>
<p>Sign in with your TransTrack credentials to approve.</p>
<form method="POST" action="/oauth2/authorize">
  <input type="hidden" name="client_id" value="${a.clientId}">
  <input type="hidden" name="redirect_uri" value="${a.redirectUri}">
  <input type="hidden" name="scope" value="${a.scope}">
  <input type="hidden" name="state" value="${a.state}">
  <input type="hidden" name="code_challenge" value="${a.codeChallenge}">
  <input type="hidden" name="code_challenge_method" value="${a.codeChallengeMethod}">
  <input type="hidden" name="nonce" value="${a.nonce}">
  <input type="hidden" name="launch_handle" value="${a.launchHandle}">
  <label>Email <input type="email" name="username" autocomplete="username" required></label>
  <label>Password <input type="password" name="password" autocomplete="current-password" required></label>
  <div class="row">
    <button class="approve" name="decision" value="approve" type="submit">Authorize</button>
    <button class="deny" name="decision" value="deny" type="submit">Deny</button>
  </div>
</form>
</body></html>`;
}
