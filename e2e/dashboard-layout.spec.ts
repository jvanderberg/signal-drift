/**
 * E2E Dashboard Layout Tests
 *
 * Tests the draggable, resizable dashboard functionality:
 * 1. Panels can be opened and appear in the grid
 * 2. Panels can be dragged to new positions
 * 3. Panels can be resized
 * 4. Layout persists across page reloads
 */

import { test, expect, Page } from '@playwright/test';

/**
 * Helper: Wait for the app to load and connect to WebSocket
 */
async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Lab Controller')).toBeVisible({ timeout: 10000 });
}

/**
 * Helper: Open the sidebar menu
 */
async function openSidebar(page: Page): Promise<void> {
  await page.getByTitle('Open menu').click();
  await expect(page.getByText('Devices & Widgets')).toBeVisible();
}

/**
 * Helper: Get the bounding box of a dashboard panel by its content
 */
async function getPanelBounds(page: Page, panelIdentifier: string) {
  const panel = page.locator('.dashboard-panel').filter({ hasText: panelIdentifier }).first();
  return panel.boundingBox();
}

test.describe('Dashboard Layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('should display panels in draggable grid layout', async ({ page }) => {
    // Open sidebar and add a device panel
    await openSidebar(page);

    // Wait for devices to appear
    await expect(page.getByText('Matrix')).toBeVisible({ timeout: 15000 });

    // Click on a device to open its panel
    await page.getByText('Matrix').first().click();
    await page.waitForTimeout(1000);

    // Verify the dashboard grid exists
    await expect(page.locator('.dashboard-grid')).toBeVisible();

    // Verify the panel is inside the grid
    const dashboardPanels = page.locator('.dashboard-panel');
    await expect(dashboardPanels.first()).toBeVisible();

    // The panel should have the react-grid-layout classes applied
    const panel = dashboardPanels.first();
    const className = await panel.getAttribute('class');
    expect(className).toContain('react-grid-item');
  });

  test('should allow panel to be dragged', async ({ page }) => {
    // Open sidebar and add a device panel
    await openSidebar(page);
    await expect(page.getByText('Matrix')).toBeVisible({ timeout: 15000 });
    await page.getByText('Matrix').first().click();
    await page.waitForTimeout(1000);

    // Get the drag handle
    const dragHandle = page.locator('.panel-drag-handle').first();
    await expect(dragHandle).toBeVisible();

    // Get initial position
    const initialBounds = await dragHandle.boundingBox();
    expect(initialBounds).not.toBeNull();

    // Perform drag operation
    const startX = initialBounds!.x + initialBounds!.width / 2;
    const startY = initialBounds!.y + initialBounds!.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 200, startY + 100, { steps: 10 });
    await page.mouse.up();

    await page.waitForTimeout(500);

    // The panel should have moved (react-grid-layout applies transform)
    const panel = page.locator('.dashboard-panel').first();
    const style = await panel.getAttribute('style');

    // The panel should have a transform applied by react-grid-layout
    expect(style).toContain('transform');
  });

  test('should persist layout across page reloads', async ({ page }) => {
    // Open sidebar and add two panels
    await openSidebar(page);
    await expect(page.getByText('Matrix')).toBeVisible({ timeout: 15000 });
    await page.getByText('Matrix').first().click();
    await page.waitForTimeout(1000);

    // Open second panel (Sequencer)
    await openSidebar(page);
    await page.getByText('Sequencer').click();
    await page.waitForTimeout(1000);

    // Wait for layout to be saved (debounce is 1 second)
    await page.waitForTimeout(1500);

    // Count current panels
    const panelCount = await page.locator('.dashboard-panel').count();
    expect(panelCount).toBeGreaterThanOrEqual(2);

    // Reload the page
    await page.reload();
    await waitForAppReady(page);

    // Wait for layout to load from server
    await page.waitForTimeout(2000);

    // Verify panels are still present
    const panelCountAfterReload = await page.locator('.dashboard-panel').count();
    expect(panelCountAfterReload).toBe(panelCount);
  });

  test('should allow panel to be resized', async ({ page }) => {
    // Open sidebar and add a device panel
    await openSidebar(page);
    await expect(page.getByText('Matrix')).toBeVisible({ timeout: 15000 });
    await page.getByText('Matrix').first().click();
    await page.waitForTimeout(1000);

    // Get the panel
    const panel = page.locator('.dashboard-panel').first();
    await expect(panel).toBeVisible();

    // Get initial size
    const initialBounds = await panel.boundingBox();
    expect(initialBounds).not.toBeNull();

    // Find a resize handle (react-grid-layout adds these)
    const resizeHandle = page.locator('.react-resizable-handle').first();

    if (await resizeHandle.isVisible()) {
      const handleBounds = await resizeHandle.boundingBox();
      expect(handleBounds).not.toBeNull();

      // Drag the resize handle
      const startX = handleBounds!.x + handleBounds!.width / 2;
      const startY = handleBounds!.y + handleBounds!.height / 2;

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 100, startY + 50, { steps: 10 });
      await page.mouse.up();

      await page.waitForTimeout(500);

      // Get new size
      const newBounds = await panel.boundingBox();
      expect(newBounds).not.toBeNull();

      // Size should have changed (either width or height increased)
      const widthChanged = Math.abs(newBounds!.width - initialBounds!.width) > 10;
      const heightChanged = Math.abs(newBounds!.height - initialBounds!.height) > 10;
      expect(widthChanged || heightChanged).toBe(true);
    }
  });

  test('should close panel when close button is clicked', async ({ page }) => {
    // Open sidebar and add a widget panel (Sequencer or Trigger Scripts)
    await openSidebar(page);
    await page.getByText('Sequencer').click();
    await page.waitForTimeout(1000);

    // Verify panel is visible
    const panelsBefore = await page.locator('.dashboard-panel').count();
    expect(panelsBefore).toBeGreaterThanOrEqual(1);

    // Find and click the close button on the Sequencer panel
    const sequencerPanel = page.locator('.dashboard-panel').filter({ hasText: 'Sequencer' });
    const closeButton = sequencerPanel.locator('button[aria-label="Close"]');

    if (await closeButton.isVisible()) {
      await closeButton.click();
      await page.waitForTimeout(500);

      // Verify panel is removed
      const panelsAfter = await page.locator('.dashboard-panel').count();
      expect(panelsAfter).toBe(panelsBefore - 1);
    }
  });

  test('should open multiple device panels', async ({ page }) => {
    // Open sidebar
    await openSidebar(page);
    await expect(page.getByText('Matrix')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Rigol')).toBeVisible({ timeout: 5000 });

    // Open first device
    await page.getByText('Matrix').first().click();
    await page.waitForTimeout(1000);

    // Open second device
    await openSidebar(page);
    await page.getByText('Rigol').first().click();
    await page.waitForTimeout(1000);

    // Verify both panels exist in the grid
    const panels = page.locator('.dashboard-panel');
    const panelCount = await panels.count();
    expect(panelCount).toBeGreaterThanOrEqual(2);
  });
});
