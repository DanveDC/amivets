// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * AmiVets — Playwright E2E config.
 *
 * IMPORTANT: this suite is hard-wired to the local Docker stack. It must
 * NEVER be pointed at Render (production) or at a real Supabase project.
 * `BASE_URL` can only be overridden to another localhost/127.0.0.1 address;
 * see the guard in `e2e/helpers.js`.
 */
const BASE_URL = process.env.BASE_URL || 'http://localhost';

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // shared backend state (DB, Supabase) — avoid cross-test races
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
