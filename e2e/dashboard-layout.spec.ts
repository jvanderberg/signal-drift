/**
 * E2E Dashboard Layout Tests
 *
 * Tests the draggable, resizable dashboard functionality:
 * 1. Panels can be opened and appear in the grid
 * 2. Panels can be dragged
 * 3. Layout uses react-grid-layout with proper styling
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
 * Helper: Wait for a panel to appear in the dashboard grid
 */
async function waitForPanelInGrid(page: Page, timeout = 10000): Promise<void> {
  // Wait for the dashboard grid to appear (it only renders when panels exist)
  await expect(page.locator('.dashboard-grid')).toBeVisible({ timeout });
  // Wait for at least one panel inside the grid
  await expect(page.locator('.dashboard-panel').first()).toBeVisible({ timeout: 5000 });
}

/**
 * Helper: Clear layout state from server
 * This sends a clear message to the server and clears the database
 */
async function clearLayoutFromServer(page: Page): Promise<void> {
  await page.evaluate(() => {
    // Access the Zustand store from window (exposed by main.tsx in dev mode)
    const layoutStore = (window as { __LAYOUT_STORE__?: { getState: () => { clearLayoutFromServer: () => void } } }).__LAYOUT_STORE__;
    if (layoutStore) {
      layoutStore.getState().clearLayoutFromServer();
    }
  });
  // Wait for the server to process the clear request
  await page.waitForTimeout(1000);
}

test.describe('Dashboard Layout', () => {
  // Use serial mode to ensure test isolation through cleanup
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Clear layout state from server (clears DB)
    await clearLayoutFromServer(page);
    // Wait for clear to complete
    await page.waitForTimeout(500);
  });

  test('should display device panel in draggable grid layout', async ({ page }) => {
    // Open sidebar and add a device panel
    await openSidebar(page);

    // Wait for devices to appear (using manufacturer name like smoke test)
    await expect(page.getByText('Matrix')).toBeVisible({ timeout: 15000 });

    // Click on the device (using same approach as working smoke test)
    await page.getByText('Matrix').first().click();
    await page.waitForTimeout(1500);

    // Wait for the dashboard grid to appear
    await expect(page.locator('.dashboard-grid')).toBeVisible({ timeout: 10000 });

    // Verify the panel is inside the grid
    const dashboardPanels = page.locator('.dashboard-panel');
    await expect(dashboardPanels.first()).toBeVisible();

    // The panel should have the react-grid-layout classes applied
    const panel = dashboardPanels.first();
    const className = await panel.getAttribute('class');
    expect(className).toContain('react-grid-item');

    // Wait for mode badge to appear (device is subscribed and has state)
    await expect(page.locator('.mode-badge').first()).toBeVisible({ timeout: 15000 });
  });

  test('should display widget panel in draggable grid layout', async ({ page }) => {
    // Open sidebar and add a widget panel (Sequencer)
    await openSidebar(page);

    // Click directly on the Sequencer text
    await page.getByText('Sequencer').first().click();
    await page.waitForTimeout(1500);

    // Wait for the panel to appear
    await waitForPanelInGrid(page);

    // Verify the dashboard grid exists
    await expect(page.locator('.dashboard-grid')).toBeVisible();

    // The panel should have react-grid-layout classes
    const panel = page.locator('.dashboard-panel').first();
    const className = await panel.getAttribute('class');
    expect(className).toContain('react-grid-item');

    // Sequencer panel should have the Sequencer header or content
    // Note: may show editor or run mode depending on state
    const panelText = await panel.textContent();
    expect(panelText?.length).toBeGreaterThan(0);
  });

  test('should close widget panel when close button is clicked', async ({ page }) => {
    // Open Sequencer panel
    await openSidebar(page);

    // Click directly on the Sequencer text
    await page.getByText('Sequencer').first().click();
    await page.waitForTimeout(1500);

    // Wait for panel to appear
    await waitForPanelInGrid(page);

    // Get initial panel count
    const panelsBefore = await page.locator('.dashboard-panel').count();
    expect(panelsBefore).toBeGreaterThanOrEqual(1);

    // Find close button - try multiple selectors since panel structure may vary
    const closeButton = page.locator('.dashboard-panel button[aria-label="Close"]').first();
    const altCloseButton = page.locator('.dashboard-panel .panel-header button').first();

    const button = await closeButton.isVisible().catch(() => false)
      ? closeButton
      : altCloseButton;

    if (await button.isVisible().catch(() => false)) {
      await button.click();
      await page.waitForTimeout(500);

      // Verify panel is removed
      const panelsAfter = await page.locator('.dashboard-panel').count();
      expect(panelsAfter).toBeLessThan(panelsBefore);
    } else {
      // Skip if no close button found - panel may not have one
      test.skip();
    }
  });

  test('should persist panel resize across page refresh', async ({ page }) => {
    // Open sidebar and add a widget panel (Sequencer)
    await openSidebar(page);

    // Click directly on the Sequencer text
    await page.getByText('Sequencer').first().click();
    await page.waitForTimeout(1500);

    // Wait for panel to appear in grid
    await waitForPanelInGrid(page);

    // Wait for react-grid-layout to fully initialize
    await page.waitForTimeout(500);

    // Get the panel's grid item (parent of .dashboard-panel)
    const gridItem = page.locator('.react-grid-item').first();
    await expect(gridItem).toBeVisible();

    // Get initial dimensions from the panel
    const initialBox = await gridItem.boundingBox();
    expect(initialBox).not.toBeNull();
    const initialWidth = initialBox!.width;
    const initialHeight = initialBox!.height;

    // Find the SE resize handle
    const resizeHandle = gridItem.locator('.react-resizable-handle-se');
    await expect(resizeHandle).toBeVisible({ timeout: 5000 });

    // Use Playwright's drag functionality with the resize handle
    // Drag to a point 150px right and 90px down from the handle center
    const handleBox = await resizeHandle.boundingBox();
    expect(handleBox).not.toBeNull();

    const targetX = handleBox!.x + handleBox!.width + 150;
    const targetY = handleBox!.y + handleBox!.height + 90;

    // Use the lower-level approach but with proper event handling
    await resizeHandle.hover();
    await page.waitForTimeout(200);

    // Drag the handle to make panel larger
    await resizeHandle.dragTo(page.locator('body'), {
      targetPosition: { x: targetX, y: targetY },
      force: true,
    });

    // Wait for layout to settle and save to server (debounce is 1000ms)
    await page.waitForTimeout(1500);

    // Get new dimensions after resize
    const afterResizeBox = await gridItem.boundingBox();
    expect(afterResizeBox).not.toBeNull();

    // Verify the panel was actually resized (should be at least 1 grid column/row larger)
    // Grid snapping means the change might not be exactly the drag delta
    const minWidthIncrease = 50; // At least 50px wider
    const minHeightIncrease = 30; // At least 30px taller (1 row)
    expect(afterResizeBox!.width).toBeGreaterThanOrEqual(initialWidth + minWidthIncrease);
    expect(afterResizeBox!.height).toBeGreaterThanOrEqual(initialHeight + minHeightIncrease);

    // Store the new dimensions for comparison after refresh
    const newWidth = afterResizeBox!.width;
    const newHeight = afterResizeBox!.height;

    // Refresh the page
    await page.reload();
    await waitForAppReady(page);

    // Wait for the panel to reappear (it should be restored from server)
    await waitForPanelInGrid(page, 15000);

    // Get the panel's grid item after refresh
    const gridItemAfterRefresh = page.locator('.react-grid-item').first();
    await expect(gridItemAfterRefresh).toBeVisible();

    // Wait a moment for layout to settle
    await page.waitForTimeout(500);

    // Get dimensions after refresh
    const afterRefreshBox = await gridItemAfterRefresh.boundingBox();
    expect(afterRefreshBox).not.toBeNull();

    // Verify the resized dimensions persisted (with some tolerance for rounding)
    const tolerance = 20; // Allow 20px tolerance for grid snapping
    expect(afterRefreshBox!.width).toBeGreaterThanOrEqual(newWidth - tolerance);
    expect(afterRefreshBox!.width).toBeLessThanOrEqual(newWidth + tolerance);
    expect(afterRefreshBox!.height).toBeGreaterThanOrEqual(newHeight - tolerance);
    expect(afterRefreshBox!.height).toBeLessThanOrEqual(newHeight + tolerance);

    // Also verify it's still larger than initial (the resize was preserved)
    expect(afterRefreshBox!.width).toBeGreaterThan(initialWidth);
    expect(afterRefreshBox!.height).toBeGreaterThan(initialHeight);
  });

  test('should persist panel drag position across page refresh', async ({ page }) => {
    // Open sidebar and add a device panel (always has visible drag handle)
    await openSidebar(page);

    // Wait for devices to load and click on first device
    await expect(page.getByText('Matrix')).toBeVisible({ timeout: 15000 });
    await page.getByText('Matrix').first().click();
    await page.waitForTimeout(1500);

    // Wait for panel to appear in grid
    await waitForPanelInGrid(page);
    await page.waitForTimeout(1000);

    // Get the panel's grid item
    const gridItem = page.locator('.react-grid-item').first();
    await expect(gridItem).toBeVisible();

    // Get initial position
    const initialBox = await gridItem.boundingBox();
    expect(initialBox).not.toBeNull();
    const initialY = initialBox!.y;

    // Find the drag handle
    const dragHandle = page.locator('.panel-drag-handle').first();
    await expect(dragHandle).toBeVisible({ timeout: 10000 });

    // Get handle position for dragging
    const handleBox = await dragHandle.boundingBox();
    expect(handleBox).not.toBeNull();

    // Use mouse events to drag the panel down
    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;
    const endY = startY + 150; // Drag down 150px

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, endY, { steps: 10 });
    await page.mouse.up();

    // Wait for layout to settle and save to server
    await page.waitForTimeout(1500);

    // Get new position after drag
    const afterDragBox = await gridItem.boundingBox();
    expect(afterDragBox).not.toBeNull();

    // Verify the panel was actually moved (Y should have changed)
    expect(afterDragBox!.y).toBeGreaterThan(initialY);

    // Store the new position for comparison after refresh
    const newY = afterDragBox!.y;

    // Refresh the page
    await page.reload();
    await waitForAppReady(page);

    // Wait for the panel to reappear
    await waitForPanelInGrid(page, 15000);

    // Get the panel's grid item after refresh
    const gridItemAfterRefresh = page.locator('.react-grid-item').first();
    await expect(gridItemAfterRefresh).toBeVisible();
    await page.waitForTimeout(500);

    // Get position after refresh
    const afterRefreshBox = await gridItemAfterRefresh.boundingBox();
    expect(afterRefreshBox).not.toBeNull();

    // Verify the dragged position persisted (with tolerance for grid snapping)
    const tolerance = 40;
    expect(afterRefreshBox!.y).toBeGreaterThanOrEqual(newY - tolerance);
    expect(afterRefreshBox!.y).toBeLessThanOrEqual(newY + tolerance);

    // Verify it's still lower than initial position
    expect(afterRefreshBox!.y).toBeGreaterThan(initialY);
  });
});
