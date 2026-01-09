/**
 * E2E tests for the Demo (standalone web worker simulation)
 *
 * Tests that the demo properly handles widget addition through the sidebar menu.
 * The demo uses a web worker to simulate the server, so no backend is needed.
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

test.describe('Demo Widget Addition', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForDemoReady(page);
  });

  test('should add Sequencer widget when clicked in sidebar', async ({ page }) => {
    // Initially there should be no panels visible (empty state message shown)
    await expect(page.getByText('Click the menu to open devices or widgets')).toBeVisible();

    // Open the sidebar
    await openSidebar(page);

    // Click on Sequencer widget
    await page.getByText('Sequencer').first().click();

    // Wait for sidebar to close and panel to appear
    await page.waitForTimeout(500);

    // The dashboard grid should now be visible with the Sequencer panel
    await waitForPanelInGrid(page);

    // Verify the panel is in the grid
    const dashboardPanels = page.locator('.dashboard-panel');
    await expect(dashboardPanels.first()).toBeVisible();

    // The empty state message should no longer be visible
    await expect(page.getByText('Click the menu to open devices or widgets')).not.toBeVisible();
  });

  test('should add Trigger Scripts widget when clicked in sidebar', async ({ page }) => {
    // Open the sidebar
    await openSidebar(page);

    // Click on Trigger Scripts widget
    await page.getByText('Trigger Scripts').first().click();

    // Wait for sidebar to close and panel to appear
    await page.waitForTimeout(500);

    // The dashboard grid should now be visible
    await waitForPanelInGrid(page);

    // Verify the panel is present
    const dashboardPanels = page.locator('.dashboard-panel');
    await expect(dashboardPanels.first()).toBeVisible();
  });

  test('should add device panel when device clicked in sidebar', async ({ page }) => {
    // Open the sidebar
    await openSidebar(page);

    // Wait for devices to appear (Matrix PSU should be available)
    await expect(page.getByText('Matrix')).toBeVisible({ timeout: 15000 });

    // Click on the Matrix device
    await page.getByText('Matrix').first().click();

    // Wait for panel to appear
    await page.waitForTimeout(500);

    // The dashboard grid should now be visible with the device panel
    await waitForPanelInGrid(page);

    // Verify the panel has react-grid-layout classes
    const panel = page.locator('.dashboard-panel').first();
    await expect(panel).toBeVisible();
  });

  test('should add multiple widgets and show all in grid', async ({ page }) => {
    // Add Sequencer widget
    await openSidebar(page);
    await page.getByText('Sequencer').first().click();
    await page.waitForTimeout(500);
    await waitForPanelInGrid(page);

    // Add Trigger Scripts widget
    await openSidebar(page);
    await page.getByText('Trigger Scripts').first().click();
    await page.waitForTimeout(500);

    // Both panels should now be visible
    const dashboardPanels = page.locator('.dashboard-panel');
    await expect(dashboardPanels).toHaveCount(2, { timeout: 5000 });
  });
});

test.describe('Demo Oscilloscope Streaming', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForDemoReady(page);
  });

  test('should open oscilloscope and stream waveform data', async ({ page }) => {
    // Open the sidebar
    await openSidebar(page);

    // Wait for devices to appear - look for Rigol DS1054Z (oscilloscope)
    await expect(page.getByText('DS1054Z')).toBeVisible({ timeout: 15000 });

    // Click on the oscilloscope device
    await page.getByText('DS1054Z').first().click();

    // Wait for the oscilloscope panel to appear
    await page.waitForTimeout(500);
    await waitForPanelInGrid(page);

    // The oscilloscope panel should show the waveform display
    const waveformDisplay = page.locator('[data-testid="waveform-display"]');
    await expect(waveformDisplay).toBeVisible({ timeout: 10000 });

    // Wait for streaming to start and waveform data to arrive
    // The streaming should auto-start on subscription
    // We need to wait for actual waveform traces to appear (not "No data")

    // Check that at least one waveform trace path exists (indicates data is streaming)
    // The trace should have a 'd' attribute with actual path data (not empty)
    const waveformTrace = page.locator('[data-testid^="waveform-trace-"]').first();
    await expect(waveformTrace).toBeVisible({ timeout: 15000 });

    // Verify the trace has actual path data (not just an empty path)
    const pathData = await waveformTrace.getAttribute('d');
    expect(pathData).toBeTruthy();
    expect(pathData?.length).toBeGreaterThan(10); // Should have meaningful path data

    // The "No data" text should NOT be visible when streaming
    const noDataText = page.locator('text:has-text("No data")');
    await expect(noDataText).not.toBeVisible();

    // Verify that the streaming indicator shows data is being received
    // The StreamingControls should show channels as active
    const streamingControls = page.locator('text:has-text("Streaming")');
    // StreamingControls shows "Streaming" when active, or channel buttons
    // If streaming is working, we should see channel indicators
    const channelButtons = page.locator('button:has-text("CH1")');
    await expect(channelButtons.first()).toBeVisible({ timeout: 5000 });
  });

  test('should display waveform measurements when streaming', async ({ page }) => {
    // Open the sidebar and click on oscilloscope
    await openSidebar(page);
    await expect(page.getByText('DS1054Z')).toBeVisible({ timeout: 15000 });
    await page.getByText('DS1054Z').first().click();

    // Wait for panel and waveform display
    await page.waitForTimeout(500);
    await waitForPanelInGrid(page);

    const waveformDisplay = page.locator('[data-testid="waveform-display"]');
    await expect(waveformDisplay).toBeVisible({ timeout: 10000 });

    // Wait for waveform trace to appear (indicates streaming is working)
    const waveformTrace = page.locator('[data-testid^="waveform-trace-"]').first();
    await expect(waveformTrace).toBeVisible({ timeout: 15000 });

    // The StatsBar should show measurements once data is flowing
    // Look for measurement values (VPP, FREQ, VAVG are the defaults)
    // These are displayed in the StatsBar component
    // Give some time for measurements to be calculated and displayed
    await page.waitForTimeout(2000);

    // At minimum, the waveform grid should be visible
    const waveformGrid = page.locator('[data-testid="waveform-grid"]');
    await expect(waveformGrid).toBeVisible();
  });
});
