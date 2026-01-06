/**
 * E2E tests for SequencePanel
 *
 * Tests that the sequence panel loads without crashing when oscilloscopes
 * are present in the device list (regression test for type guard fix).
 */

import { test, expect, Page } from '@playwright/test';

/**
 * Helper: Wait for the demo app to load and worker to connect
 */
async function waitForDemoReady(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Lab Controller')).toBeVisible({ timeout: 15000 });
  // Wait for worker to be connected and devices to load
  await page.waitForTimeout(1000);
}

/**
 * Helper: Open the sidebar menu
 */
async function openSidebar(page: Page): Promise<void> {
  await page.getByTitle('Open menu').click();
  await expect(page.getByText('Devices & Widgets')).toBeVisible();
}

/**
 * Helper: Wait for a panel to appear in the dashboard grid
 */
async function waitForPanelInGrid(page: Page, timeout = 10000): Promise<void> {
  await expect(page.locator('.dashboard-grid')).toBeVisible({ timeout });
  await expect(page.locator('.dashboard-panel').first()).toBeVisible({ timeout: 5000 });
}

test.describe('SequencePanel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForDemoReady(page);
  });

  test('should load Sequencer panel without crashing', async ({ page }) => {
    // Open Sequencer widget
    await openSidebar(page);
    await page.getByText('Sequencer').first().click();
    await page.waitForTimeout(500);

    // Verify panel loads without errors
    await waitForPanelInGrid(page);

    // The panel should remain visible (no crash)
    await expect(page.locator('.dashboard-panel')).toBeVisible();

    // Verify no React error boundary triggered
    const pageContent = await page.content();
    expect(pageContent).not.toContain('Cannot read properties of undefined');
  });
});
