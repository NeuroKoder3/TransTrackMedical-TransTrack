/**
 * M-10 regression suite — login must be tenant-unambiguous and lockout must
 * be scoped to one (organisation, user).
 *
 * Before remediation, findUser's unscoped query ended in LIMIT 1, so a
 * duplicated email authenticated into whichever tenant the planner happened
 * to return; and setLockedUntil updated every users row matching the email,
 * so failing five logins against one tenant locked that person out of every
 * other tenant too.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadWithStubs, restoreModules, fakeClient, fakePool } from './helpers/routeHarness.mjs';

const ORG_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const SYSTEM_ORG = '00000000-0000-0000-0000-000000000000';
const EMAIL = 'shared@example.org';

const CONFIG = {
  JWT_SECRET: 'unit-test-signing-key-with-enough-length-1234567890',
  JWT_ISSUER: 'transtrack',
  JWT_AUDIENCE: 'transtrack-api',
  JWT_ACCESS_TTL_SECONDS: 3600,
  JWT_REFRESH_TTL_SECONDS: 86400,
  LOCKOUT_THRESHOLD: 5,
  LOCKOUT_WINDOW_MINUTES: 15,
  LOCKOUT_DURATION_MINUTES: 30,
  MFA_REQUIRED_FOR_ROLES_SET: new Set(),
};

function userRow(orgId, id) {
  return {
    id,
    org_id: orgId,
    email: EMAIL,
    role: 'coordinator',
    full_name: 'Shared User',
    auth_provider: 'local',
    password_hash: 'argon2-hash',
    is_active: true,
    org_name: 'Org',
  };
}

/**
 * Fake database holding one users table across two tenants plus the
 * login_attempts counter and the locked_until column.
 */
function authDb({ users, failedAttempts = {}, lockedUntil = {} }) {
  const state = { users, failedAttempts, lockedUntil, updates: [] };
  const client = fakeClient((text, values) => {
    if (/FROM users u/.test(text) && /u\.email/.test(text)) {
      const scoped = /u\.org_id = \$1/.test(text);
      const email = scoped ? values[1] : values[0];
      const orgId = scoped ? values[0] : null;
      return state.users.filter((u) => u.email === email && (!orgId || u.org_id === orgId));
    }
    if (/SELECT locked_until FROM users WHERE id = \$1/.test(text)) {
      return [{ locked_until: state.lockedUntil[values[0]] || null }];
    }
    if (/COUNT\(\*\)::int AS n/.test(text)) {
      const [email, orgId] = values;
      return [{ n: state.failedAttempts[`${email}|${orgId}`] || 0 }];
    }
    if (/UPDATE users SET locked_until/.test(text)) {
      state.updates.push({ kind: 'lock', sql: text, values });
      return [];
    }
    if (/UPDATE users SET failed_login_attempts/.test(text)) {
      state.updates.push({ kind: 'clear', sql: text, values });
      return [];
    }
    return [];
  });
  return { state, client };
}

let authService;

function load(client) {
  authService = loadWithStubs('src/services/authService.js', {
    'src/db/pool.js': fakePool(client),
    'src/auth/password.js': {
      verify: async (_hash, plaintext) => plaintext === 'correct-horse',
      hash: async (s) => `hash:${s}`,
      meetsPolicy: () => true,
    },
  });
}

afterEach(() => restoreModules());

describe('an email registered in two organisations cannot log in ambiguously', () => {
  let db;

  beforeEach(() => {
    db = authDb({ users: [userRow(ORG_A, 'user-a'), userRow(ORG_B, 'user-b')] });
    load(db.client);
  });

  it('refuses the login and asks for an organisation', async () => {
    await expect(
      authService.passwordLogin(db.client, CONFIG, {
        email: EMAIL, plaintext: 'correct-horse', ip: '10.0.0.1',
      })
    ).rejects.toMatchObject({ status: 400, code: 'organization_required' });
  });

  it('does not authenticate into an arbitrary tenant even with valid credentials', async () => {
    let result = null;
    try {
      result = await authService.passwordLogin(db.client, CONFIG, {
        email: EMAIL, plaintext: 'correct-horse',
      });
    } catch { /* expected */ }
    expect(result).toBeNull();
  });

  it('succeeds once the caller names the organisation', async () => {
    const session = await authService.passwordLogin(db.client, CONFIG, {
      orgId: ORG_B, email: EMAIL, plaintext: 'correct-horse',
    });
    expect(session.kind).toBe('session');
    expect(session.user.orgId).toBe(ORG_B);
  });

  it('applies the same rule to the SMART authorisation flow', async () => {
    await expect(
      authService.authenticateForSmart(null, CONFIG, {
        email: EMAIL, plaintext: 'correct-horse',
      })
    ).rejects.toMatchObject({ code: 'organization_required' });
  });
});

describe('lockout is scoped to one organisation and user', () => {
  it('locks by user id, never by email across tenants', async () => {
    const db = authDb({
      users: [userRow(ORG_A, 'user-a')],
      failedAttempts: { [`${EMAIL}|${ORG_A}`]: 5 },
    });
    load(db.client);
    await expect(
      authService.passwordLogin(db.client, CONFIG, {
        orgId: ORG_A, email: EMAIL, plaintext: 'correct-horse',
      })
    ).rejects.toMatchObject({ status: 429 });

    const lock = db.state.updates.find((u) => u.kind === 'lock');
    expect(lock.sql).toMatch(/WHERE id = \$2/);
    expect(lock.sql).not.toMatch(/WHERE email/);
    expect(lock.values[1]).toBe('user-a');
  });

  it('counts failures only within the account organisation', async () => {
    // Five failures were recorded against org A. The org B account, which is
    // a different person who happens to share the address, is unaffected.
    const db = authDb({
      users: [userRow(ORG_B, 'user-b')],
      failedAttempts: { [`${EMAIL}|${ORG_A}`]: 99, [`${EMAIL}|${ORG_B}`]: 0 },
    });
    load(db.client);
    const session = await authService.passwordLogin(db.client, CONFIG, {
      orgId: ORG_B, email: EMAIL, plaintext: 'correct-horse',
    });
    expect(session.kind).toBe('session');
  });

  it('honours an explicit locked_until on the resolved user', async () => {
    const db = authDb({
      users: [userRow(ORG_A, 'user-a')],
      lockedUntil: { 'user-a': new Date(Date.now() + 60_000).toISOString() },
    });
    load(db.client);
    await expect(
      authService.passwordLogin(db.client, CONFIG, {
        orgId: ORG_A, email: EMAIL, plaintext: 'correct-horse',
      })
    ).rejects.toMatchObject({ status: 429 });
  });

  it('clears the failure state for the authenticated user only', async () => {
    const db = authDb({ users: [userRow(ORG_A, 'user-a')] });
    load(db.client);
    await authService.passwordLogin(db.client, CONFIG, {
      orgId: ORG_A, email: EMAIL, plaintext: 'correct-horse',
    });
    const clear = db.state.updates.find((u) => u.kind === 'clear');
    expect(clear.sql).toMatch(/WHERE id = \$1/);
    expect(clear.values).toEqual(['user-a']);
  });

  it('still refuses a wrong password with a generic 401', async () => {
    const db = authDb({ users: [userRow(ORG_A, 'user-a')] });
    load(db.client);
    await expect(
      authService.passwordLogin(db.client, CONFIG, {
        orgId: ORG_A, email: EMAIL, plaintext: 'wrong',
      })
    ).rejects.toMatchObject({ status: 401 });
  });

  it('refuses an unknown email with the same generic 401', async () => {
    const db = authDb({ users: [] });
    load(db.client);
    await expect(
      authService.passwordLogin(db.client, CONFIG, {
        email: 'nobody@example.org', plaintext: 'correct-horse',
      })
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe('the reserved quarantine organisation cannot be signed in to (M-27)', () => {
  it('refuses a login that resolves to the system org', async () => {
    const db = authDb({ users: [userRow(SYSTEM_ORG, 'system-user')] });
    load(db.client);
    await expect(
      authService.passwordLogin(db.client, CONFIG, {
        orgId: SYSTEM_ORG, email: EMAIL, plaintext: 'correct-horse',
      })
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('the MFA enrolment token is bound to its own audience (M-26)', () => {
  it('signs the enrolment token with a dedicated audience', async () => {
    const db = authDb({ users: [{ ...userRow(ORG_A, 'user-a'), role: 'admin' }] });
    load(db.client);
    const config = { ...CONFIG, MFA_REQUIRED_FOR_ROLES_SET: new Set(['admin']) };
    const result = await authService.passwordLogin(db.client, config, {
      orgId: ORG_A, email: EMAIL, plaintext: 'correct-horse',
    });
    expect(result.mustEnroll).toBe(true);
    const claims = JSON.parse(
      Buffer.from(result.enrollmentToken.split('.')[1], 'base64url').toString('utf8')
    );
    expect(claims.aud).toBe('transtrack-api:mfa-enroll');
    expect(claims.aud).not.toBe(config.JWT_AUDIENCE);
    expect(claims.purpose).toBe('mfa_enroll');
  });
});
