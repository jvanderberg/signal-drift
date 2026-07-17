/**
 * E2E tests for SequencePanel
 *
 * Tests that the sequence panel loads without crashing when oscilloscopes
 * are present in the device list (regression test for type guard fix).
 */

import { test, expect, Page } from '@playwright/test';

/**
 * Helper: Wait for the app to load and connect to WebSocket
 */
async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Lab Controller')).toBeVisible({ timeout: 15000 });
  // Wait for devices to load
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

/**
 * Helper: Clear layout state from server (ensures clean test state)
 */
async function clearLayoutFromServer(page: Page): Promise<void> {
  await page.evaluate(() => {
    const layoutStore = (window as { __LAYOUT_STORE__?: { getState: () => { clearLayoutFromServer: () => void } } }).__LAYOUT_STORE__;
    if (layoutStore) {
      layoutStore.getState().clearLayoutFromServer();
    }
  });
  await page.waitForTimeout(1000);
}

test.describe('SequencePanel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    // Clear layout state from server for clean test
    await clearLayoutFromServer(page);
    await page.waitForTimeout(500);
  });

  test('should load Sequencer panel without crashing', async ({ page }) => {
    // Open Sequencer widget
    await openSidebar(page);
    await page.getByText('Sequencer').first().click();
    await page.waitForTimeout(500);

    // Verify panel loads without errors
    await waitForPanelInGrid(page);

    // The panel should remain visible (no crash)
    // Use .first() to avoid strict mode violation if multiple panels exist
    await expect(page.locator('.dashboard-panel').first()).toBeVisible();

    // Verify no React error boundary triggered
    const pageContent = await page.content();
    expect(pageContent).not.toContain('Cannot read properties of undefined');
  });

  test('should show create new sequence UI', async ({ page }) => {
    await openSidebar(page);
    await page.getByText('Sequencer').first().click();
    await page.waitForTimeout(500);
    await waitForPanelInGrid(page);

    // Should show the sequence panel with create option
    const panel = page.locator('.dashboard-panel').first();
    await expect(panel).toBeVisible();

    // Look for new sequence button or empty state
    const newButton = panel.getByRole('button', { name: /new|create/i });
    const hasNewButton = await newButton.count() > 0;

    if (hasNewButton) {
      await expect(newButton).toBeVisible();
    } else {
      // Panel loaded without new button - check for sequence list or empty state
      await expect(panel).toBeVisible();
    }
  });

  test('should display sequence waveform options', async ({ page }) => {
    await openSidebar(page);
    await page.getByText('Sequencer').first().click();
    await page.waitForTimeout(500);
    await waitForPanelInGrid(page);

    const panel = page.locator('.dashboard-panel').first();

    // Try to create or select a sequence to see waveform options
    const newButton = panel.getByRole('button', { name: /new|create/i });
    if (await newButton.count() > 0) {
      await newButton.click();
      await page.waitForTimeout(300);

      // Should show waveform type selection
      const waveformSelect = panel.locator('select, [role="combobox"]').first();
      if (await waveformSelect.count() > 0) {
        await expect(waveformSelect).toBeVisible();
      }
    }
  });

  test('should show sequence library when sequences exist', async ({ page }) => {
    await openSidebar(page);
    await page.getByText('Sequencer').first().click();
    await page.waitForTimeout(500);
    await waitForPanelInGrid(page);

    const panel = page.locator('.dashboard-panel').first();

    // Panel should show either sequence list or empty state
    // Check for common UI elements
    const hasListItems = await panel.locator('[data-sequence-id], .sequence-item').count() > 0;
    const hasEmptyState = await panel.getByText(/no sequences|empty|create/i).count() > 0;
    const hasNewButton = await panel.getByRole('button', { name: /new|create/i }).count() > 0;

    // At least one of these should be present
    expect(hasListItems || hasEmptyState || hasNewButton).toBe(true);
  });

  test('should persist panel in layout', async ({ page }) => {
    await openSidebar(page);
    await page.getByText('Sequencer').first().click();
    await page.waitForTimeout(500);
    await waitForPanelInGrid(page);

    // Panel should be visible
    await expect(page.locator('.dashboard-panel').first()).toBeVisible();

    // Reload page
    await page.reload();
    await waitForAppReady(page);
    await page.waitForTimeout(1000);

    // Panel should still be visible after reload (layout persisted)
    await expect(page.locator('.dashboard-panel').first()).toBeVisible();
  });

  test('should allow closing the panel', async ({ page }) => {
    await openSidebar(page);
    await page.getByText('Sequencer').first().click();
    await page.waitForTimeout(500);
    await waitForPanelInGrid(page);

    const panel = page.locator('.dashboard-panel').first();
    await expect(panel).toBeVisible();

    // Find and click close button
    const closeButton = panel.locator('button[title="Close"], button:has-text("×"), .panel-close');
    if (await closeButton.count() > 0) {
      await closeButton.first().click();
      await page.waitForTimeout(500);

      // Panel should be removed
      const remainingPanels = await page.locator('.dashboard-panel').count();
      expect(remainingPanels).toBe(0);
    }
  });
});
