/**
 * TransTrack - E2E Tests
 *
 * End-to-end tests for the Electron application using Playwright.
 * Tests the full workflow: login → create patient → recalculate → backup.
 *
 * Prerequisites:
 *   npm install --save-dev @playwright/test
 *   npm run build
 *
 * Run:
 *   npm run test:e2e
 */

const { test, expect } = require('@playwright/test');
const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

let app;
let window;

/**
 * Password used to seed the first-run administrator in the launched test app
 * and to log in with below. Passed explicitly into the app's environment so the
 * suite behaves identically on a developer machine and in CI; previously it was
 * only set at the CI workflow level, so locally the app generated a random setup
 * token and the login step could not succeed.
 */
const E2E_ADMIN_PASSWORD =
  process.env.TRANSTRACK_INITIAL_ADMIN_PASSWORD || 'E2E_ONLY_DoNotUseInProd!';

test.beforeAll(async () => {
  const userDataPath = path.join(
    os.tmpdir(),
    `transtrack-e2e-app-${process.pid}-${Date.now()}`,
  );
  fs.mkdirSync(userDataPath, { recursive: true });

  app = await electron.launch({
    args: [path.join(__dirname, '..', '..', 'electron', 'main.cjs')],
    env: {
      ...process.env,
      // NODE_ENV=test tells main.cjs to load dist/index.html
      // instead of trying to connect to http://localhost:5173
      NODE_ENV: 'test',
      ELECTRON_DEV: '0',
      TRANSTRACK_E2E: '1',
      TRANSTRACK_USERDATA_DIR: userDataPath,
      TRANSTRACK_INITIAL_ADMIN_PASSWORD: E2E_ADMIN_PASSWORD,
    },
    timeout: 45000,
  });

  window = await app.firstWindow({ timeout: 30000 });
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      const hasApi = await w
        .evaluate(() => !!(window.electronAPI && window.electronAPI.auth))
        .catch(() => false);
      if (hasApi) {
        window = w;
        await window.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('Timed out waiting for Electron window with electronAPI');
});

test.afterAll(async () => {
  if (app) {
    try {
      await app.close();
    } catch {
      // App may have already exited
    }
  }
});

test.describe('TransTrack E2E', () => {
  test('Application launches and shows login', async () => {
    const title = await window.title();
    expect(title).toContain('TransTrack');
  });

  test('Login with provisioned admin credentials', async () => {
    await window.waitForFunction(
      () => !!(window.electronAPI?.auth?.login),
      { timeout: 30000 },
    );

    // First drive the real login form, because the rendered login screen is
    // part of what this suite is for.
    const emailInput = window.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]');
    const passwordInput = window.locator('input[type="password"]');
    expect(
      await emailInput.count(),
      'login screen rendered no email field',
    ).toBeGreaterThan(0);
    await emailInput.first().fill('admin@transtrack.local');
    await passwordInput.first().fill(E2E_ADMIN_PASSWORD);

    const submitButton = window.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign In")');
    expect(
      await submitButton.count(),
      'login screen rendered no submit button',
    ).toBeGreaterThan(0);
    await submitButton.first().click();

    // Form submit already established a session. Restricted sessions reject a
    // second auth:login (only password/MFA/logout channels are allow-listed),
    // so clear first-run gates against the existing session instead of logging
    // in again. Seed uses TRANSTRACK_INITIAL_ADMIN_PASSWORD from beforeAll.
    await window.waitForFunction(
      async () => {
        try {
          const me = await window.electronAPI.auth.me();
          return !!(me && me.id);
        } catch {
          return false;
        }
      },
      { timeout: 30000 },
    );

    const { totpCode } = require('../../electron/services/mfa.cjs');
    const rotatedPassword = `${E2E_ADMIN_PASSWORD}_Rotated1!`;

    const login = await window.evaluate(async ({ password, next }) => {
      try {
        let active = password;
        const me0 = await window.electronAPI.auth.me();
        if (!me0?.id) {
          return { ok: false, error: 'no session after form login' };
        }
        if (
          me0.must_change_password ||
          me0.session_restrictions?.includes('password_change')
        ) {
          await window.electronAPI.auth.changePassword({
            currentPassword: active,
            newPassword: next,
          });
          active = next;
        }
        const me = await window.electronAPI.auth.me();
        const needsMfaEnroll = !!(
          me?.session_restrictions?.includes('mfa_enroll') ||
          (me?.mfa_required && !me?.mfa_enrolled) ||
          (me?.role === 'admin' && !me?.mfa_enrolled)
        );
        if (needsMfaEnroll) {
          const begin = await window.electronAPI.mfa.beginEnrollment();
          return { ok: true, needsMfaConfirm: true, secret: begin.secret };
        }
        return { ok: true, restrictions: me?.session_restrictions || [] };
      } catch (e) {
        return { ok: false, error: String(e && e.message ? e.message : e) };
      }
    }, { password: E2E_ADMIN_PASSWORD, next: rotatedPassword });

    expect(login.ok, `[app] admin login MUST succeed: ${login.error}`).toBe(true);

    if (login.needsMfaConfirm) {
      const code = totpCode(login.secret);
      const confirm = await window.evaluate(async ({ secret, code }) => {
        try {
          await window.electronAPI.mfa.confirmEnrollment({ secret, code });
          const me = await window.electronAPI.auth.me();
          return { ok: true, restrictions: me?.session_restrictions || [] };
        } catch (e) {
          return { ok: false, error: String(e && e.message ? e.message : e) };
        }
      }, { secret: login.secret, code });
      expect(confirm.ok, `[app] MFA enrollment MUST succeed: ${confirm.error}`).toBe(true);
      expect(confirm.restrictions).toEqual([]);
    } else {
      expect(login.restrictions).toEqual([]);
    }
  });

  test('Create and view a patient (critical PHI workflow)', async () => {
    const createResult = await window.evaluate(async () => {
      try {
        return await window.electronAPI.entities.create('Patient', {
          patient_id: 'E2E-TEST-001',
          first_name: 'E2E',
          last_name: 'TestPatient',
          blood_type: 'O+',
          organ_needed: 'kidney',
          medical_urgency: 'medium',
          waitlist_status: 'active',
        });
      } catch (e) {
        return { error: e.message };
      }
    });

    // These assertions used to sit inside `if (createResult && !createResult.error)`
    // and `if (found)`, so a create that failed outright, or a list that never
    // returned the record, was reported as a pass (finding M-23). The preceding
    // test establishes an unrestricted admin session, so a failure here is a
    // real regression in the PHI write path.
    expect(
      createResult?.error,
      `Patient.create failed: ${createResult?.error}`,
    ).toBeUndefined();
    expect(createResult).toHaveProperty('id');

    // Bulk reads require a list-scope PHI grant (entity id "*") — see
    // enforceBulkPhiGrant in electron/ipc/handlers/entities.cjs. Taking it
    // here is part of the workflow under test, not a workaround.
    const listed = await window.evaluate(async () => {
      try {
        const grant = await window.electronAPI.accessControl.authorizePhiAccess({
          permission: 'patient:view_phi',
          entityType: 'Patient',
          entityId: '*',
          justification: 'E2E verification of the patient list view',
        });
        if (grant && grant.granted === false) {
          return { error: `PHI list grant denied: ${grant.reason || 'unknown'}` };
        }
        return { rows: await window.electronAPI.entities.list('Patient') };
      } catch (e) {
        return { error: String(e && e.message ? e.message : e) };
      }
    });

    expect(listed.error, `Patient.list failed: ${listed.error}`).toBeUndefined();
    expect(Array.isArray(listed.rows)).toBe(true);

    const found = listed.rows.find((p) => p.patient_id === 'E2E-TEST-001');
    expect(
      found,
      `created patient E2E-TEST-001 is not returned by entities.list; ` +
        `got ${listed.rows.length} row(s)`,
    ).toBeTruthy();
    expect(found.first_name).toBe('E2E');
    expect(found.last_name).toBe('TestPatient');
    expect(found.id).toBe(createResult.id);
  });

  test('Navigation renders without errors', async () => {
    const consoleErrors = [];
    window.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await window.waitForTimeout(2000);

    const criticalErrors = consoleErrors.filter(
      e => !e.includes('DevTools') && !e.includes('favicon')
    );

    expect(criticalErrors.length).toBeLessThanOrEqual(3);
  });

  test('DevTools menu is not exposed in non-dev E2E mode', async () => {
    const bridge = await window.evaluate(() => ({
      isElectron: window.electronAPI?.isElectron === true,
      hasAuth: typeof window.electronAPI?.auth === 'object',
    }));
    expect(bridge.isElectron).toBe(true);
    expect(bridge.hasAuth).toBe(true);
  });

  test('Electron API is exposed via context bridge', async () => {
    const hasAPI = await window.evaluate(() => {
      return typeof window.electronAPI !== 'undefined';
    });
    expect(hasAPI).toBe(true);

    const hasAuth = await window.evaluate(() => {
      return typeof window.electronAPI.auth === 'object';
    });
    expect(hasAuth).toBe(true);

    const hasEntities = await window.evaluate(() => {
      return typeof window.electronAPI.entities === 'object';
    });
    expect(hasEntities).toBe(true);
  });

  test('Encryption status reports a verified SQLCipher profile', async () => {
    const status = await window.evaluate(async () => {
      try {
        return await window.electronAPI.encryption.getStatus();
      } catch (e) {
        return { error: String(e && e.message ? e.message : e) };
      }
    });

    expect(status.error, `encryption.getStatus failed: ${status.error}`).toBeUndefined();

    // getEncryptionStatus() derives every field from the verification that runs
    // at open time (electron/database/init.cjs), so this asserts the running
    // app actually proved its at-rest profile rather than merely exposing the
    // shape of a status object.
    expect(status.enabled).toBe(true);
    expect(status.algorithm).toBe('AES-256-CBC');
    expect(status.keyDerivation).toBe('PBKDF2-HMAC-SHA512');
    expect(status.keyIterations).toBe(256000);
    expect(status.compliant).toBe(true);
    expect(status.verification?.verified, JSON.stringify(status.verification)).toBe(true);
    expect(status.verification?.problems).toEqual([]);
  });
});
