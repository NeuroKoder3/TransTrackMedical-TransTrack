/**
 * TransTrack - Playwright E2E Test Configuration
 *
 * Tests the Electron application through the renderer process.
 * Requires: npm install --save-dev @playwright/test electron
 */

const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results/e2e-artifacts',
  timeout: 60000,
  // A `test.only` committed by accident silently reduces this suite to one test
  // and still exits 0 — the same shape of problem as the soft assertions in
  // finding M-23, one level up. In CI it is a failure instead.
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
});
