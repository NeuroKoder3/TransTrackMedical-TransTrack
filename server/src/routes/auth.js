'use strict';

const { z } = require('zod');
const { withTransaction } = require('../db/pool');
const authService = require('../services/authService');
const password = require('../auth/password');
const mfa = require('../auth/mfa');
const samlMod = require('../auth/saml');
const oidcMod = require('../auth/oidc');
const { errors } = require('../util/errors');

module.exports = async function authRoutes(app, opts) {
  const { config } = opts;

  // ----- POST /auth/login (local password) -----
  app.post('/auth/login', { config: { public: true, rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const body = z.object({
      email: z.string().email(),
      password: z.string().min(1),
    }).parse(req.body);
    return withTransaction({}, async (client) => {
      const result = await authService.passwordLogin(client, config, {
        email: body.email,
        plaintext: body.password,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return result;
    });
  });

  // ----- POST /auth/mfa/verify -----
  app.post('/auth/mfa/verify', { config: { public: true, rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const body = z.object({
      challengeId: z.string().uuid(),
      code: z.string().min(6).max(20),
    }).parse(req.body);
    return withTransaction({}, async (client) => {
      return authService.consumeMfaChallenge(client, config, {
        challengeId: body.challengeId,
        code: body.code,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
    });
  });

  // ----- POST /auth/refresh -----
  app.post('/auth/refresh', { config: { public: true, rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const body = z.object({ refresh: z.string().min(10) }).parse(req.body);
    return withTransaction({}, async (client) => {
      return authService.refresh(client, config, {
        refreshToken: body.refresh,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
    });
  });

  // ----- POST /auth/logout -----
  app.post('/auth/logout', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const body = z.object({ refresh: z.string().optional() }).parse(req.body || {});
    await withTransaction({}, async (client) => {
      await authService.revoke(client, body.refresh);
    });
    return { ok: true };
  });

  // ----- POST /auth/mfa/enroll/begin -----
  app.post('/auth/mfa/enroll/begin', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    if (!req.auth) throw errors.unauthorized();
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
    if (!req.auth) throw errors.unauthorized();
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
      const stored = codes.map(c => ({ hash: mfa.hashRecoveryCode(c), used_at: null }));
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
    const body = z.object({
      current: z.string().min(1),
      next: z.string().min(config.PASSWORD_MIN_LENGTH),
    }).parse(req.body);
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
      const session = await withTransaction({}, async (client) => {
        const user = await authService.findOrProvisionFederated(client, {
          orgId,
          provider: 'saml',
          subject: attrs.nameId,
          email: attrs.email,
          name: attrs.name,
          role: attrs.role || 'user',
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
    const stateStore = new Map(); // dev-only; production should use redis/db

    app.get('/auth/oidc/login', { config: { public: true, rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
      const a = oidcMod.buildAuthRequest();
      stateStore.set(a.state, a);
      return reply.redirect(a.url);
    });

    app.get('/auth/oidc/callback', { config: { public: true, rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
      const expected = stateStore.get(req.query.state);
      if (!expected) throw errors.badRequest('Invalid OIDC state');
      stateStore.delete(req.query.state);
      const { tokenSet, userInfo } = await oidcMod.handleCallback(req.query, expected);
      const profile = oidcMod.extractProfile(userInfo, tokenSet.claims());
      const orgId = config.HL7_DEFAULT_ORG_ID;
      if (!orgId) throw errors.badRequest('Server has no default org configured for SSO');
      const session = await withTransaction({}, async (client) => {
        const user = await authService.findOrProvisionFederated(client, {
          orgId,
          provider: 'oidc',
          subject: profile.sub,
          email: profile.email,
          name: profile.name,
          role: profile.role || 'user',
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
