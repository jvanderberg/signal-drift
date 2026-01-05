import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration for Demo
 *
 * Runs the demo standalone (no server needed) to test the web worker simulation.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'demo.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  timeout: 60000,

  use: {
    baseURL: 'http://localhost:5174',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Start demo before running tests
  // Use preview mode for consistent testing (builds first, then serves)
  webServer: {
    command: 'cd demo && npm run build && npm run preview -- --port 5174',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env.CI,
    timeout: 90000,
  },
});
