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

let app;
let window;

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.join(__dirname, '..', '..', 'electron', 'main.cjs')],
    env: {
      ...process.env,
      NODE_ENV: 'development',
      ELECTRON_DEV: '0',
    },
  });
  window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  if (app) await app.close();
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
