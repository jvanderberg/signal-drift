import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration
 *
 * Runs the server with simulated devices and client for full integration tests.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Run tests serially since they share simulated devices
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker since tests share state
  reporter: 'html',
  timeout: 60000, // 60 second timeout for longer simulated device interactions

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Start both server and client before running tests
  webServer: [
    {
      command: 'USE_SIMULATED_DEVICES=true npm run dev',
      url: 'http://localhost:3001/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
    {
      command: 'cd client && npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
});
