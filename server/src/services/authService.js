'use strict';

const { newId, newToken, sha256 } = require('../util/ids');
const password = require('../auth/password');
const mfa = require('../auth/mfa');
const jwt = require('../auth/jwt');
const audit = require('./auditService');
const { errors } = require('../util/errors');

/**
 * Look up a user by email. Returns { user, org } or null.
 */
async function findUser(client, { orgId, email }) {
  const sql = orgId
    ? `SELECT u.*, o.name AS org_name FROM users u
       JOIN organizations o ON o.id = u.org_id
       WHERE u.org_id = $1 AND u.email = $2 AND u.is_active = TRUE`
    : `SELECT u.*, o.name AS org_name FROM users u
       JOIN organizations o ON o.id = u.org_id
       WHERE u.email = $1 AND u.is_active = TRUE
       LIMIT 1`;
  const params = orgId ? [orgId, email] : [email];
  const r = await client.query(sql, params);
  return r.rows[0] || null;
}

async function recordLoginAttempt(client, { email, orgId, ip, success, reason }) {
  await client.query(
    `INSERT INTO login_attempts (email, org_id, ip_address, success, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [email, orgId || null, ip || null, !!success, reason || null]
  );
}

async function isLockedOut(client, { email, threshold, windowMinutes }) {
  const r = await client.query(
    `SELECT COUNT(*)::int AS n
     FROM login_attempts
     WHERE email = $1
       AND success = FALSE
       AND attempted_at > now() - ($2 || ' minutes')::interval`,
    [email, windowMinutes]
  );
  return r.rows[0].n >= threshold;
}

async function clearFailedAttempts(client, email) {
  await client.query(
    `UPDATE users SET failed_login_attempts = 0, locked_until = NULL
     WHERE email = $1`,
    [email]
  );
}

function buildSessionTokens(user, config) {
  const access = jwt.sign(
    { sub: user.id, org: user.org_id, role: user.role, email: user.email },
    config.JWT_SECRET,
    {
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
      ttlSeconds: config.JWT_ACCESS_TTL_SECONDS,
    }
  );
  const refreshToken = newToken(48);
  const refreshHash = sha256(refreshToken);
  return { access, refreshToken, refreshHash };
}

async function persistSession(client, { userId, orgId, refreshHash, ttl, ip, userAgent }) {
  const expiresAt = new Date(Date.now() + ttl * 1000);
  await client.query(
    `INSERT INTO sessions (user_id, org_id, refresh_token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, orgId, refreshHash, expiresAt, ip || null, userAgent || null]
  );
}

async function passwordLogin(client, config, { email, plaintext, ip, userAgent }) {
  if (await isLockedOut(client, {
    email, threshold: config.LOCKOUT_THRESHOLD, windowMinutes: config.LOCKOUT_WINDOW_MINUTES,
  })) {
    await recordLoginAttempt(client, { email, ip, success: false, reason: 'locked_out' });
    throw errors.tooManyRequests('Account temporarily locked');
  }
  const user = await findUser(client, { email });
  if (!user || user.auth_provider !== 'local' || !user.password_hash) {
    await recordLoginAttempt(client, { email, ip, success: false, reason: 'unknown_user' });
    throw errors.unauthorized('Invalid credentials');
  }
  const ok = await password.verify(user.password_hash, plaintext);
  if (!ok) {
    await recordLoginAttempt(client, {
      email, orgId: user.org_id, ip, success: false, reason: 'bad_password',
    });
    throw errors.unauthorized('Invalid credentials');
  }
  await recordLoginAttempt(client, {
    email, orgId: user.org_id, ip, success: true, reason: null,
  });
  await clearFailedAttempts(client, email);
  await client.query(
    `UPDATE users SET last_login_at = now(), last_login_ip = $1 WHERE id = $2`,
    [ip || null, user.id]
  );

  // MFA step-up?
  const mfaRequired = config.MFA_REQUIRED_FOR_ROLES_SET.has(user.role);
  const mfaRow = await client.query(
    `SELECT confirmed_at FROM mfa_enrollments WHERE user_id = $1`, [user.id]
  );
  const enrolled = !!mfaRow.rows[0]?.confirmed_at;

  if (mfaRequired && enrolled) {
    const challenge = await client.query(
      `INSERT INTO mfa_challenges (user_id, expires_at)
       VALUES ($1, now() + interval '5 minutes')
       RETURNING id`,
      [user.id]
    );
    return {
      kind: 'mfa_required',
      challengeId: challenge.rows[0].id,
      mustEnroll: false,
    };
  }
  if (mfaRequired && !enrolled) {
    // Caller must enroll before any session token is issued.
    return { kind: 'mfa_required', challengeId: null, mustEnroll: true, userId: user.id };
  }

  await audit.record(client, {
    orgId: user.org_id, userId: user.id, userEmail: user.email,
    role: user.role, ip, userAgent,
  }, { action: 'auth.login.password', entityType: 'user', entityId: user.id });

  const tokens = buildSessionTokens(user, config);
  await persistSession(client, {
    userId: user.id, orgId: user.org_id, refreshHash: tokens.refreshHash,
    ttl: config.JWT_REFRESH_TTL_SECONDS, ip, userAgent,
  });
  return {
    kind: 'session',
    access: tokens.access,
    refresh: tokens.refreshToken,
    user: { id: user.id, email: user.email, role: user.role, name: user.full_name, orgId: user.org_id },
  };
}

async function consumeMfaChallenge(client, config, { challengeId, code, ip, userAgent }) {
  const r = await client.query(
    `SELECT c.id, c.user_id, c.expires_at, c.consumed_at,
            u.role, u.email, u.org_id, u.full_name,
            m.secret_encrypted, m.recovery_codes
     FROM mfa_challenges c
     JOIN users u ON u.id = c.user_id
     LEFT JOIN mfa_enrollments m ON m.user_id = u.id
     WHERE c.id = $1`,
    [challengeId]
  );
  const ch = r.rows[0];
  if (!ch) throw errors.unauthorized('Challenge not found');
  if (ch.consumed_at) throw errors.unauthorized('Challenge already consumed');
  if (new Date(ch.expires_at) < new Date()) throw errors.unauthorized('Challenge expired');
  if (!ch.secret_encrypted) throw errors.unauthorized('No MFA enrolled');
  const secret = mfa.decryptSecret(ch.secret_encrypted, config.JWT_SECRET);
  const ok = mfa.verifyCode(secret, code);
  if (!ok) {
    // Try recovery codes (one-time)
    const codeHash = mfa.hashRecoveryCode(String(code || ''));
    const list = ch.recovery_codes || [];
    const idx = list.findIndex(c => c.hash === codeHash && !c.used_at);
    if (idx < 0) throw errors.unauthorized('Invalid code');
    list[idx].used_at = new Date().toISOString();
    await client.query(
      `UPDATE mfa_enrollments SET recovery_codes = $1 WHERE user_id = $2`,
      [JSON.stringify(list), ch.user_id]
    );
  }
  await client.query(
    `UPDATE mfa_challenges SET consumed_at = now() WHERE id = $1`, [challengeId]
  );
  await client.query(
    `UPDATE mfa_enrollments SET last_used_at = now() WHERE user_id = $1`, [ch.user_id]
  );
  const user = {
    id: ch.user_id, email: ch.email, role: ch.role,
    full_name: ch.full_name, org_id: ch.org_id,
  };
  await audit.record(client, {
    orgId: user.org_id, userId: user.id, userEmail: user.email,
    role: user.role, ip, userAgent,
  }, { action: 'auth.login.mfa_passed', entityType: 'user', entityId: user.id });

  const tokens = buildSessionTokens(user, config);
  await persistSession(client, {
    userId: user.id, orgId: user.org_id, refreshHash: tokens.refreshHash,
    ttl: config.JWT_REFRESH_TTL_SECONDS, ip, userAgent,
  });
  return {
    kind: 'session',
    access: tokens.access,
    refresh: tokens.refreshToken,
    user: { id: user.id, email: user.email, role: user.role, name: user.full_name, orgId: user.org_id },
  };
}

async function refresh(client, config, { refreshToken, ip, userAgent }) {
  const refreshHash = sha256(refreshToken);
  const r = await client.query(
    `SELECT s.id, s.user_id, s.org_id, s.expires_at, s.revoked_at,
            u.email, u.role, u.full_name
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.refresh_token_hash = $1`,
    [refreshHash]
  );
  const sess = r.rows[0];
  if (!sess) throw errors.unauthorized('Invalid refresh token');
  if (sess.revoked_at) throw errors.unauthorized('Session revoked');
  if (new Date(sess.expires_at) < new Date()) throw errors.unauthorized('Session expired');
  const user = {
    id: sess.user_id, email: sess.email, role: sess.role,
    full_name: sess.full_name, org_id: sess.org_id,
  };
  // rotate refresh token
  await client.query(`UPDATE sessions SET revoked_at = now() WHERE id = $1`, [sess.id]);
  const tokens = buildSessionTokens(user, config);
  await persistSession(client, {
    userId: user.id, orgId: user.org_id, refreshHash: tokens.refreshHash,
    ttl: config.JWT_REFRESH_TTL_SECONDS, ip, userAgent,
  });
  return {
    access: tokens.access,
    refresh: tokens.refreshToken,
    user: { id: user.id, email: user.email, role: user.role, name: user.full_name, orgId: user.org_id },
  };
}

async function revoke(client, refreshToken) {
  if (!refreshToken) return;
  const refreshHash = sha256(refreshToken);
  await client.query(
    `UPDATE sessions SET revoked_at = now() WHERE refresh_token_hash = $1 AND revoked_at IS NULL`,
    [refreshHash]
  );
}

/**
 * Provision-or-fetch helper for SAML and OIDC. The IdP is the source of
 * truth for identity; we mirror the user row locally so role/RBAC checks
 * remain fast.
 */
async function findOrProvisionFederated(client, { orgId, provider, subject, email, name, role }) {
  if (!email) throw errors.badRequest('IdP did not return an email');
  let r = await client.query(
    `SELECT * FROM users WHERE auth_provider = $1 AND external_subject = $2`,
    [provider, subject]
  );
  if (r.rows[0]) return r.rows[0];
  r = await client.query(
    `INSERT INTO users (org_id, email, full_name, role, auth_provider, external_subject, password_hash, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,NULL,TRUE)
     ON CONFLICT (org_id, email) DO UPDATE
       SET auth_provider = EXCLUDED.auth_provider,
           external_subject = EXCLUDED.external_subject,
           full_name = COALESCE(EXCLUDED.full_name, users.full_name)
     RETURNING *`,
    [orgId, email, name || null, role || 'user', provider, subject]
  );
  return r.rows[0];
}

async function issueSessionForFederatedUser(client, config, user, ctx) {
  const tokens = buildSessionTokens(user, config);
  await persistSession(client, {
    userId: user.id, orgId: user.org_id, refreshHash: tokens.refreshHash,
    ttl: config.JWT_REFRESH_TTL_SECONDS, ip: ctx.ip, userAgent: ctx.userAgent,
  });
  await audit.record(client, {
    orgId: user.org_id, userId: user.id, userEmail: user.email,
    role: user.role, ip: ctx.ip, userAgent: ctx.userAgent,
  }, { action: `auth.login.${user.auth_provider}`, entityType: 'user', entityId: user.id });
  return {
    access: tokens.access,
    refresh: tokens.refreshToken,
    user: { id: user.id, email: user.email, role: user.role, name: user.full_name, orgId: user.org_id },
  };
}

/**
 * SMART OAuth helper: authenticate a username+password and return the
 * resolved user identity, without issuing a TransTrack session JWT.
 * The caller (SMART /authorize) is responsible for issuing the SMART
 * authorization code and access token instead.
 *
 * Returns:
 *   { kind: 'ok', userId, orgId, role }
 *   { kind: 'mfa_required', userId, orgId, role, challengeId? }
 *   { kind: 'denied', reason }
 */
async function authenticatePassword({ orgHint, email, password: plaintext }) {
  const { withTransaction } = require('../db/pool');
  return withTransaction({}, async (client) => {
    const user = await findUser(client, { orgId: orgHint, email });
    if (!user || user.auth_provider !== 'local' || !user.password_hash) {
      return { kind: 'denied', reason: 'unknown_user' };
    }
    const ok = await password.verify(user.password_hash, plaintext);
    if (!ok) return { kind: 'denied', reason: 'bad_password' };
    return { kind: 'ok', userId: user.id, orgId: user.org_id, role: user.role };
  });
}

module.exports = {
  passwordLogin,
  consumeMfaChallenge,
  refresh,
  revoke,
  findOrProvisionFederated,
  issueSessionForFederatedUser,
  authenticatePassword,
};
