/**
 * TransTrack - Playwright E2E Test Configuration
 *
 * Tests the Electron application through the renderer process.
 * Requires: npm install --save-dev @playwright/test electron
 */

const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  retries: 1,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'test-results/e2e-report' }],
  ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
});
