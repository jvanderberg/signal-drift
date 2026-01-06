/**
 * E2E tests for SequencePanel
 *
 * Tests that the sequence panel properly handles sequence selection
 * and device filtering without crashing.
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

test.describe('SequencePanel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForDemoReady(page);
  });

  test('should not crash when creating and selecting a sequence', async ({ page }) => {
    // Open Sequencer widget
    await openSidebar(page);
    await page.getByText('Sequencer').first().click();
    await page.waitForTimeout(500);

    // Verify Sequencer panel loads (should default to edit mode if no sequences)
    // Look for the editor UI elements
    await expect(page.locator('.dashboard-panel')).toBeVisible({ timeout: 5000 });

    // The panel should show the sequence editor since library is empty
    // Look for the "Name" input field which is part of the editor
    const nameInput = page.locator('input[placeholder*="Sequence"]').or(
      page.locator('label:has-text("Name")').locator('..').locator('input')
    );

    // If we see the name input, we're in edit mode - fill it in
    if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await nameInput.fill('Test Sequence');
    }

    // Find and click Save button if visible
    const saveButton = page.getByRole('button', { name: /save/i });
    if (await saveButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await saveButton.click();
      await page.waitForTimeout(500);
    }

    // Now we should be in run mode with the sequence in the dropdown
    // Try to select the sequence
    const sequenceSelect = page.locator('select').first();
    if (await sequenceSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Get all options
      const options = await sequenceSelect.locator('option').allTextContents();
      console.log('Sequence options:', options);

      // Select the first non-empty option if available
      const firstSequenceOption = options.find(opt => opt && !opt.includes('Select'));
      if (firstSequenceOption) {
        await sequenceSelect.selectOption({ label: firstSequenceOption });
        await page.waitForTimeout(300);
      }
    }

    // The panel should not have crashed - check for error messages
    // If the panel crashed, React would show an error boundary or the panel would disappear
    await expect(page.locator('.dashboard-panel')).toBeVisible();

    // Check that no error text about "Cannot read properties of undefined" is visible
    const pageContent = await page.content();
    expect(pageContent).not.toContain('Cannot read properties of undefined');
  });

  test('should handle sequence selection with device filtering', async ({ page }) => {
    // Open Sequencer widget
    await openSidebar(page);
    await page.getByText('Sequencer').first().click();
    await page.waitForTimeout(500);

    // Wait for panel to be visible
    await expect(page.locator('.dashboard-panel')).toBeVisible({ timeout: 5000 });

    // Create a sequence with voltage unit to test device filtering
    const nameInput = page.locator('input').first();
    if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await nameInput.clear();
      await nameInput.fill('Voltage Test Sequence');
    }

    // Look for unit selector and set to V (volts)
    const unitSelect = page.locator('label:has-text("Unit")').locator('..').locator('select');
    if (await unitSelect.isVisible({ timeout: 1000 }).catch(() => false)) {
      await unitSelect.selectOption('V');
    }

    // Save the sequence
    const saveButton = page.getByRole('button', { name: /save/i });
    if (await saveButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await saveButton.click();
      await page.waitForTimeout(500);
    }

    // Now in run mode, select the sequence
    const sequenceDropdown = page.locator('label:has-text("Sequence")').locator('..').locator('select');
    if (await sequenceDropdown.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Get options and select the first real sequence
      const options = await sequenceDropdown.locator('option').allTextContents();
      const sequenceOption = options.find(opt => opt && opt !== 'Select...');
      if (sequenceOption) {
        await sequenceDropdown.selectOption({ label: sequenceOption });
        await page.waitForTimeout(300);
      }
    }

    // The device dropdown should now show compatible devices (those with voltage outputs)
    const deviceDropdown = page.locator('label:has-text("Device")').locator('..').locator('select');
    if (await deviceDropdown.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Just verify it's visible and accessible - the filtering should work without errors
      const deviceOptions = await deviceDropdown.locator('option').allTextContents();
      console.log('Device options:', deviceOptions);

      // Should have at least the Matrix PSU which has voltage output
      expect(deviceOptions.some(opt => opt.includes('Matrix'))).toBe(true);
    }

    // Panel should still be visible (no crash)
    await expect(page.locator('.dashboard-panel')).toBeVisible();
  });
});
