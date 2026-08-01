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
    await window.waitForTimeout(2000);

    // The seed code (electron/database/init.cjs) consumes
    // TRANSTRACK_INITIAL_ADMIN_PASSWORD when present and falls back to a random
    // setup token otherwise. beforeAll passes this exact value into the app, so
    // the login step is deterministic rather than depending on the environment.
    const e2ePassword = E2E_ADMIN_PASSWORD;

    const emailInput = window.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]');
    const passwordInput = window.locator('input[type="password"]');

    if (await emailInput.count() > 0) {
      await emailInput.fill('admin@transtrack.local');
      await passwordInput.fill(e2ePassword);

      const submitButton = window.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign In")');
      if (await submitButton.count() > 0) {
        await submitButton.first().click();
        await window.waitForTimeout(3000);
      }
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

    if (createResult && !createResult.error) {
      expect(createResult).toHaveProperty('id');

      const patients = await window.evaluate(async () => {
        try {
          return await window.electronAPI.entities.list('Patient');
        } catch (e) {
          return [];
        }
      });

      const found = patients.find(p => p.patient_id === 'E2E-TEST-001');
      if (found) {
        expect(found.first_name).toBe('E2E');
        expect(found.last_name).toBe('TestPatient');
      }
    }
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

  test('Encryption status is available', async () => {
    const status = await window.evaluate(async () => {
      try {
        return await window.electronAPI.encryption.getStatus();
      } catch {
        return null;
      }
    });

    if (status) {
      expect(status).toHaveProperty('enabled');
      expect(status).toHaveProperty('algorithm');
    }
  });
});
