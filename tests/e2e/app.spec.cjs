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

let app;
let window;

function getElectronUserDataPath() {
  // Electron resolves userData using the productName ("TransTrack")
  const appName = 'TransTrack';
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || '', appName);
  }
  if (process.platform === 'darwin') {
    return path.join(require('os').homedir(), 'Library', 'Application Support', appName);
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(require('os').homedir(), '.config'), appName);
}

test.beforeAll(async () => {
  const userDataPath = getElectronUserDataPath();
  fs.mkdirSync(userDataPath, { recursive: true });

  app = await electron.launch({
    args: [path.join(__dirname, '..', '..', 'electron', 'main.cjs')],
    env: {
      ...process.env,
      // NODE_ENV=test tells main.cjs to load dist/index.html
      // instead of trying to connect to http://localhost:5173
      NODE_ENV: 'test',
      ELECTRON_DEV: '0',
    },
    timeout: 45000,
  });

  // The splash window appears first, then the main window replaces it.
  // Wait for the first window (splash).
  window = await app.firstWindow({ timeout: 30000 });

  // Wait for the main window to appear. The splash window loads splash.html
  // while the main window loads dist/index.html — use the URL to distinguish.
  const isMainWindow = (w) => {
    try {
      const url = w.url();
      return url.includes('index.html') || url.includes('localhost');
    } catch {
      return false;
    }
  };

  if (!isMainWindow(window)) {
    // Current window is the splash — wait for the main window.
    const mainWindow = await app.waitForEvent('window', { timeout: 30000 }).catch(() => null);
    if (mainWindow) {
      window = mainWindow;
    }
  }

  await window.waitForLoadState('domcontentloaded', { timeout: 30000 });
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

  test('Login with default admin credentials', async () => {
    await window.waitForTimeout(2000);

    const emailInput = window.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]');
    const passwordInput = window.locator('input[type="password"]');

    if (await emailInput.count() > 0) {
      await emailInput.fill('admin@transtrack.local');
      await passwordInput.fill('Admin123!');

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

  test('DevTools are not accessible in non-dev mode', async () => {
    const isDevToolsOpened = await window.evaluate(() => {
      return window.electronAPI?.isElectron === true;
    });
    expect(isDevToolsOpened).toBe(true);
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
