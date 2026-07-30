'use strict';

const { z } = require('zod');
const { withTransaction } = require('../db/pool');
const authService = require('../services/authService');
const password = require('../auth/password');
const mfa = require('../auth/mfa');
const samlMod = require('../auth/saml');
const oidcMod = require('../auth/oidc');
const { errors } = require('../util/errors');
const { setSessionCookies, clearSessionCookies, readRefreshToken } = require('../auth/sessionCookies');

const VALID_ROLES = new Set(['admin', 'coordinator', 'physician', 'user', 'viewer', 'regulator']);

function mapSsoRole(rawRole, config) {
  if (!rawRole) {
    if (config.SSO_UNKNOWN_ROLE_POLICY === 'deny') return null;
    return 'user';
  }
  const mapped = config.SSO_ROLE_MAP_PARSED?.[rawRole];
  if (mapped && VALID_ROLES.has(mapped)) return mapped;
  if (VALID_ROLES.has(rawRole)) return rawRole;
  if (config.SSO_UNKNOWN_ROLE_POLICY === 'deny') return null;
  return 'user';
}

module.exports = async function authRoutes(app, opts) {
  const { config } = opts;

  // ----- POST /auth/login (local password) -----
  app.post('/auth/login', { config: { public: true, rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = z.object({
      email: z.string().email(),
      password: z.string().min(1),
    }).parse(req.body);
    const result = await withTransaction({}, async (client) => {
      return authService.passwordLogin(client, config, {
        email: body.email,
        plaintext: body.password,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
    });
    if (result.kind === 'session') {
      setSessionCookies(reply, {
        access: result.access,
        refresh: result.refresh,
        config,
      });
      // Sanitize: keep access in body (remoteClient needs it for Authorization header)
      // but remove refresh from JSON — it's carried by httpOnly cookie only
      const { refresh: _omit, ...sanitized } = result;
      return sanitized;
    }
    return result;
  });

  // ----- POST /auth/mfa/verify -----
  app.post('/auth/mfa/verify', { config: { public: true, rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = z.object({
      challengeId: z.string().uuid(),
      code: z.string().min(6).max(20),
    }).parse(req.body);
    const result = await withTransaction({}, async (client) => {
      return authService.consumeMfaChallenge(client, config, {
        challengeId: body.challengeId,
        code: body.code,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
    });
    if (result.kind === 'session') {
      setSessionCookies(reply, {
        access: result.access,
        refresh: result.refresh,
        config,
      });
      const { refresh: _omit, ...sanitized } = result;
      return sanitized;
    }
    return result;
  });

  // ----- POST /auth/refresh -----
  app.post('/auth/refresh', { config: { public: true, rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = z.object({ refresh: z.string().min(10).optional() }).parse(req.body || {});
    const refreshToken = readRefreshToken(req, body.refresh);
    if (!refreshToken) throw errors.unauthorized('Missing refresh token');
    const result = await withTransaction({}, async (client) => {
      return authService.refresh(client, config, {
        refreshToken,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
    });
    setSessionCookies(reply, {
      access: result.access,
      refresh: result.refresh,
      config,
    });
    // Remove refresh from JSON body — cookie carries it
    const { refresh: _omit, ...sanitized } = result;
    return sanitized;
  });

  // ----- POST /auth/logout -----
  app.post('/auth/logout', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = z.object({ refresh: z.string().optional() }).parse(req.body || {});
    const refreshToken = readRefreshToken(req, body.refresh);
    await withTransaction({}, async (client) => {
      await authService.revoke(client, refreshToken);
    });
    clearSessionCookies(reply);
    return { ok: true };
  });

  /**
   * Extract auth context from either normal session auth (req.auth) or
   * a Bearer token with purpose=mfa_enroll (enrollment JWT).
   */
  function resolveEnrollAuth(req) {
    if (req.auth) return req.auth;
    const header = req.headers.authorization || '';
    if (!header.toLowerCase().startsWith('bearer ')) return null;
    const token = header.slice(7).trim();
    if (!token) return null;
    const jwtMod = require('../auth/jwt');
    try {
      const payload = jwtMod.verify(token, config.JWT_SECRET, { issuer: config.JWT_ISSUER });
      if (payload.purpose !== 'mfa_enroll') return null;
      return { userId: payload.sub, orgId: payload.org };
    } catch {
      return null;
    }
  }

  // ----- POST /auth/mfa/enroll/begin -----
  app.post('/auth/mfa/enroll/begin', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const enrollAuth = resolveEnrollAuth(req);
    if (!enrollAuth) throw errors.unauthorized();
    const reqAuth = enrollAuth;
    // Override req.auth for downstream compatibility
    if (!req.auth) req.auth = reqAuth;
    const secret = mfa.generateSecret();
    const otpauth = mfa.buildOtpauthUrl({
      secret,
      label: req.auth.email,
      issuer: config.MFA_ISSUER_LABEL,
    });
    const qr = await mfa.buildQrCodeDataUrl(otpauth);
    const enc = mfa.encryptSecret(secret, config.JWT_SECRET);
    await withTransaction({ orgId: req.auth.orgId, userId: req.auth.userId }, async (client) => {
      await client.query(
        `INSERT INTO mfa_enrollments (user_id, secret_encrypted, label)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE
           SET secret_encrypted = EXCLUDED.secret_encrypted,
               label = EXCLUDED.label,
               confirmed_at = NULL,
               recovery_codes = '[]'::jsonb`,
        [req.auth.userId, enc, config.MFA_ISSUER_LABEL]
      );
    });
    return { otpauth, qrDataUrl: qr };
  });

  // ----- POST /auth/mfa/enroll/confirm -----
  app.post('/auth/mfa/enroll/confirm', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const enrollAuth = resolveEnrollAuth(req);
    if (!enrollAuth) throw errors.unauthorized();
    if (!req.auth) req.auth = enrollAuth;
    const body = z.object({ code: z.string().min(6).max(10) }).parse(req.body);
    return withTransaction({ orgId: req.auth.orgId, userId: req.auth.userId }, async (client) => {
      const r = await client.query(
        `SELECT secret_encrypted FROM mfa_enrollments WHERE user_id = $1`,
        [req.auth.userId]
      );
      if (!r.rows[0]) throw errors.badRequest('No pending enrolment');
      const secret = mfa.decryptSecret(r.rows[0].secret_encrypted, config.JWT_SECRET);
      if (!mfa.verifyCode(secret, body.code)) throw errors.badRequest('Invalid code');
      const codes = mfa.generateRecoveryCodes(10);
      const stored = await Promise.all(
        codes.map(async (c) => ({ hash: await mfa.hashRecoveryCode(c), used_at: null }))
      );
      await client.query(
        `UPDATE mfa_enrollments
           SET confirmed_at = now(), recovery_codes = $1
           WHERE user_id = $2`,
        [JSON.stringify(stored), req.auth.userId]
      );
      return { confirmed: true, recoveryCodes: codes };
    });
  });

  // ----- POST /auth/password/change -----
  app.post('/auth/password/change', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    if (!req.auth) throw errors.unauthorized();
    const raw = req.body || {};
    const body = z.object({
      current: z.string().min(1),
      next: z.string().min(config.PASSWORD_MIN_LENGTH),
    }).parse({
      current: raw.current || raw.currentPassword,
      next: raw.next || raw.newPassword,
    });
    if (!password.meetsPolicy(body.next, config.PASSWORD_MIN_LENGTH)) {
      throw errors.badRequest('Password does not meet policy');
    }
    return withTransaction({ orgId: req.auth.orgId, userId: req.auth.userId }, async (client) => {
      const u = await client.query(
        `SELECT password_hash FROM users WHERE id = $1`, [req.auth.userId]
      );
      if (!u.rows[0]) throw errors.notFound();
      if (!await password.verify(u.rows[0].password_hash, body.current)) {
        throw errors.unauthorized('Current password incorrect');
      }
      const hist = await client.query(
        `SELECT password_hash FROM password_history
         WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [req.auth.userId, config.PASSWORD_HISTORY_COUNT]
      );
      for (const h of hist.rows) {
        if (await password.verify(h.password_hash, body.next)) {
          throw errors.badRequest('Cannot reuse one of the last ' + config.PASSWORD_HISTORY_COUNT + ' passwords');
        }
      }
      const newHash = await password.hash(body.next);
      await client.query(
        `INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)`,
        [req.auth.userId, u.rows[0].password_hash]
      );
      await client.query(
        `UPDATE users SET password_hash = $1, must_change_password = FALSE,
            last_password_change_at = now()
         WHERE id = $2`,
        [newHash, req.auth.userId]
      );
      // prune history beyond N
      await client.query(
        `DELETE FROM password_history
         WHERE user_id = $1
           AND id NOT IN (
             SELECT id FROM password_history
             WHERE user_id = $1
             ORDER BY created_at DESC LIMIT $2
           )`,
        [req.auth.userId, config.PASSWORD_HISTORY_COUNT]
      );
      return { ok: true };
    });
  });

  // ===========================================================
  // SAML 2.0
  // ===========================================================
  if (config.SAML_ENABLED) {
    samlMod.init(config);
    app.get('/auth/saml/login', { config: { public: true, rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
      const relay = sanitizeRedirectPath(req.query?.relay || '/');
      const url = await samlMod.buildLoginUrl(relay);
      return reply.redirect(url);
    });
    app.post('/auth/saml/callback', { config: { public: true, rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
      const profile = await samlMod.validatePostResponse(req.body?.SAMLResponse, req.body);
      const attrs = samlMod.extractAttributes(profile, config);
      const orgId = config.HL7_DEFAULT_ORG_ID;
      if (!orgId) throw errors.badRequest('Server has no default org configured for SSO');
      const resolvedRole = mapSsoRole(attrs.role, config);
      if (!resolvedRole) throw errors.forbidden('IdP role not permitted by SSO_UNKNOWN_ROLE_POLICY');
      const session = await withTransaction({}, async (client) => {
        const user = await authService.findOrProvisionFederated(client, {
          orgId,
          provider: 'saml',
          subject: attrs.nameId,
          email: attrs.email,
          name: attrs.name,
          role: resolvedRole,
        });
        return authService.issueSessionForFederatedUser(client, config, user, {
          ip: req.ip, userAgent: req.headers['user-agent'],
        });
      });
      const target = '/';
      reply.setCookie('transtrack_access', session.access, {
        path: '/', httpOnly: true, secure: config.NODE_ENV === 'production',
        sameSite: 'Lax', maxAge: config.JWT_ACCESS_TTL_SECONDS,
      });
      return reply.redirect(target);
    });
  }

  // ===========================================================
  // OIDC
  // ===========================================================
  if (config.OIDC_ENABLED) {
    await oidcMod.init(config);
    const pool = require('../db/pool');

    async function cleanupExpiredStates() {
      try { await pool.query(`DELETE FROM oidc_auth_states WHERE expires_at < now()`); } catch { /* ignore */ }
    }
    const cleanupInterval = setInterval(cleanupExpiredStates, 5 * 60 * 1000);
    app.addHook('onClose', () => clearInterval(cleanupInterval));

    app.get('/auth/oidc/login', { config: { public: true, rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
      const a = oidcMod.buildAuthRequest();
      await pool.query(
        `INSERT INTO oidc_auth_states (state, payload) VALUES ($1, $2)`,
        [a.state, JSON.stringify({ codeVerifier: a.codeVerifier, nonce: a.nonce, state: a.state })],
      );
      return reply.redirect(a.url);
    });

    app.get('/auth/oidc/callback', { config: { public: true, rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
      const stateRow = await pool.query(
        `DELETE FROM oidc_auth_states WHERE state = $1 AND expires_at > now() RETURNING payload`,
        [req.query.state],
      );
      const expected = stateRow.rows[0]?.payload;
      if (!expected) throw errors.badRequest('Invalid or expired OIDC state');
      const { tokenSet, userInfo } = await oidcMod.handleCallback(req.query, expected);
      const profile = oidcMod.extractProfile(userInfo, tokenSet.claims());
      const orgId = config.HL7_DEFAULT_ORG_ID;
      if (!orgId) throw errors.badRequest('Server has no default org configured for SSO');
      const resolvedRole = mapSsoRole(profile.role, config);
      if (!resolvedRole) throw errors.forbidden('IdP role not permitted by SSO_UNKNOWN_ROLE_POLICY');
      const session = await withTransaction({}, async (client) => {
        const user = await authService.findOrProvisionFederated(client, {
          orgId,
          provider: 'oidc',
          subject: profile.sub,
          email: profile.email,
          name: profile.name,
          role: resolvedRole,
        });
        return authService.issueSessionForFederatedUser(client, config, user, {
          ip: req.ip, userAgent: req.headers['user-agent'],
        });
      });
      reply.setCookie('transtrack_access', session.access, {
        path: '/', httpOnly: true, secure: config.NODE_ENV === 'production',
        sameSite: 'Lax', maxAge: config.JWT_ACCESS_TTL_SECONDS,
      });
      return reply.redirect('/');
    });
  }

  /**
   * Prevent open-redirect: only allow same-origin paths (starts with /,
   * does not start with // or contain protocol scheme).
   */
  function sanitizeRedirectPath(input) {
    const s = String(input || '/');
    if (s.startsWith('/') && !s.startsWith('//') && !/^\/[\\@]/.test(s) && !s.includes(':')) return s;
    return '/';
  }

  // ----- GET /auth/me -----
  app.get('/auth/me', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    if (!req.auth) throw errors.unauthorized();
    return withTransaction({ orgId: req.auth.orgId, userId: req.auth.userId }, async (client) => {
      const r = await client.query(
        `SELECT id, email, full_name, role, org_id, is_active, last_login_at
         FROM users WHERE id = $1`,
        [req.auth.userId]
      );
      return r.rows[0];
    });
  });
};
