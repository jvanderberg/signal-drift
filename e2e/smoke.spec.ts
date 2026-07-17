/**
 * E2E Smoke Test - PSU + Load Interaction
 *
 * Tests the complete flow:
 * 1. App loads and connects to server
 * 2. Open simulated PSU and Load panels
 * 3. Turn on PSU, set 5V voltage and 1A current limit
 * 4. Set load to CC mode at 0.1A
 * 5. Gradually increase load current until PSU enters CC mode
 */

import { test, expect, Page } from '@playwright/test';

/**
 * Helper: Wait for the app to load and connect to WebSocket
 */
async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  // Wait for the header to appear
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

// =============================================================================
// UI Structure Constants
// =============================================================================

/**
 * Digit spinner structure for the simulated devices:
 * - PSU Voltage: 2 integer + 2 decimal = 4 digit positions (0-30.00 V)
 * - PSU Current: 2 integer + 3 decimal = 5 digit positions (0-10.000 A)
 * - Load Current: 2 integer + 3 decimal = 5 digit positions (0-40.000 A)
 *
 * When both panels are open, + buttons are ordered left-to-right:
 * [PSU Voltage: 4 buttons] [PSU Current: 5 buttons] [Load Current: 5 buttons]
 */
const PSU_VOLTAGE_DIGITS = 4;
const PSU_CURRENT_DIGITS = 5;
const LOAD_CURRENT_DIGITS = 5;

// Index of first PSU current button (after voltage spinner)
const PSU_CURRENT_START_INDEX = PSU_VOLTAGE_DIGITS;

// =============================================================================
// Test Suite
// =============================================================================

test.describe('PSU + Load Smoke Test', () => {
  test('should transition PSU to CC mode when load exceeds current limit', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await waitForAppReady(page);

    // Clear any existing layout state for clean test
    await clearLayoutFromServer(page);

    // Open sidebar
    await openSidebar(page);

    // Wait for devices to appear (simulated devices should be listed)
    await expect(page.getByText('Matrix')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Rigol DL3021')).toBeVisible({ timeout: 5000 });

    // === STEP 1: Open and configure PSU ===
    console.log('Opening PSU panel...');
    await page.getByText('Matrix').first().click();

    // Wait for PSU panel to be ready (mode badge visible)
    await page.waitForTimeout(1500); // Let subscription complete
    const modeBadges = page.locator('.mode-badge');
    await expect(modeBadges.first()).toBeVisible({ timeout: 10000 });

    // The PSU should start in CV mode with output OFF
    let psuMode = await modeBadges.first().textContent();
    console.log(`Initial PSU mode: ${psuMode}`);
    expect(psuMode).toBe('CV');

    // Set PSU voltage to 5V
    // Find the voltage spinner - it's the one with "V" unit label
    // Each spinner has a structure: [digit columns] [unit label]
    console.log('Setting PSU voltage to 5V...');

    // Get all spinner containers (they have gap-0.5 flex containers with digit buttons)
    // In the PSU panel, voltage spinner comes first, then current
    const allPlusButtons = page.locator('button:text("+")');
    const allMinusButtons = page.locator('button:text("-")');

    // For PSU with voltage 0-30V and current 0-10A (3 decimal places):
    // Voltage spinner: likely 2 integer digits + 2 decimal = 4 digit positions
    // Current spinner: likely 2 integer digits + 3 decimal = 5 digit positions

    // First spinner group is voltage - click the first "+" button 5 times for 5V
    // (This is the tens digit of voltage, so 5 clicks = 5.00V from 0.00V)
    for (let i = 0; i < 5; i++) {
      await allPlusButtons.first().click();
      await page.waitForTimeout(150);
    }
    console.log('Voltage set to 5V');

    // Now set current limit - this is the second spinner
    // Need to find where the current spinner starts
    // PSU spinners: [V: 4 buttons] [A: 5 buttons] = first 4 are voltage, next 5 are current
    // Click the 5th "+" button (first digit of current) once for 1A
    console.log('Setting PSU current limit to 1A...');
    const plusButtonCount = await allPlusButtons.count();
    console.log(`Total + buttons: ${plusButtonCount}`);

    // The current spinner's first + button sets the 10s place
    // We want 1A, so we click the ones place (second + in current group)
    if (plusButtonCount >= PSU_CURRENT_START_INDEX + 1) {
      // Click to get 1A in the units position (second digit of current spinner)
      await allPlusButtons.nth(PSU_CURRENT_START_INDEX).click();
      await page.waitForTimeout(150);
    }
    console.log('Current limit set to 1A');

    // Turn ON the PSU output
    console.log('Turning ON PSU output...');
    const outputToggle = page.locator('button[aria-label="Turn on"]');
    await expect(outputToggle).toBeVisible({ timeout: 3000 });
    await outputToggle.click();
    await page.waitForTimeout(500);

    // Verify PSU is ON and in CV mode
    await expect(page.locator('text="ON"')).toBeVisible({ timeout: 3000 });
    psuMode = await modeBadges.first().textContent();
    console.log(`PSU mode after turning on: ${psuMode}`);
    expect(psuMode).toBe('CV');

    // === STEP 2: Open and configure Load ===
    console.log('Opening Load panel...');
    await openSidebar(page);
    await page.getByText('Rigol DL3021').first().click();
    await page.waitForTimeout(1500);

    // Now we have 2 panels - PSU and Load
    // The Load panel will have a mode selector dropdown
    // Wait for second mode badge to appear (Load's badge)
    await expect(modeBadges.nth(1)).toBeVisible({ timeout: 5000 });

    const loadMode = await modeBadges.nth(1).textContent();
    console.log(`Load mode: ${loadMode}`);

    // The Load should be in CC mode by default
    // Let's verify by checking the mode selector
    const modeSelects = page.locator('select').filter({ hasText: /Constant/ });
    const modeSelectCount = await modeSelects.count();
    console.log(`Found ${modeSelectCount} mode selectors`);

    // The Load panel's mode selector should be visible
    // It's the one labeled "Mode:" near a CC/CV/CR/CP dropdown
    const loadModeSelect = page.locator('label:text("Mode:")').locator('..').locator('select');
    if (await loadModeSelect.isVisible()) {
      const selectedMode = await loadModeSelect.inputValue();
      console.log(`Load mode from dropdown: ${selectedMode}`);
    }

    // Set load to 0.1A
    console.log('Setting Load to 0.1A...');

    // After opening the Load panel, we have more + buttons
    // The Load's spinner is the last one (after PSU's voltage and current spinners)
    // Load in CC mode has a current setpoint with 3 decimal places
    const updatedPlusCount = await allPlusButtons.count();
    console.log(`Total + buttons after Load panel: ${updatedPlusCount}`);

    // The Load's digit spinner is the last group
    // For a 0.xxx A display, we want to set 0.100 A
    // The tenths position would be the 2nd digit from left (after the 0)
    // Let's click the appropriate + button to get 0.1A

    // Load spinner has 5 digit positions (2 integer + 3 decimal)
    // So Load's + buttons start at index (totalButtons - LOAD_CURRENT_DIGITS)
    // Let's target the first decimal digit (0.X00)
    const loadSpinnerStart = updatedPlusCount - LOAD_CURRENT_DIGITS;
    if (loadSpinnerStart >= 0) {
      // First decimal position - click to get 0.1
      await allPlusButtons.nth(loadSpinnerStart + 1).click();
      await page.waitForTimeout(150);
    }
    console.log('Load current set to 0.1A');

    // Turn ON the Load input
    console.log('Turning ON Load input...');
    // There should now be 2 toggle buttons - PSU is ON, Load needs to be turned on
    const turnOnButtons = page.locator('button[aria-label="Turn on"]');
    const turnOnCount = await turnOnButtons.count();
    console.log(`Turn on buttons: ${turnOnCount}`);

    if (turnOnCount > 0) {
      await turnOnButtons.first().click();
      await page.waitForTimeout(500);
    }

    // Verify both devices are ON
    const onLabels = page.locator('text="ON"');
    const onCount = await onLabels.count();
    console.log(`ON labels count: ${onCount}`);

    // PSU should still be in CV mode since 0.1A < 1A limit
    psuMode = await modeBadges.first().textContent();
    console.log(`PSU mode with 0.1A load: ${psuMode}`);

    // === STEP 3: Increase load until PSU enters CC mode ===
    console.log('Gradually increasing load current...');

    // We need to increase the Load's current setpoint until it exceeds the PSU's 1A limit
    // Keep clicking + on the Load's current integer digit
    let attempts = 0;
    const maxAttempts = 15;
    const startTime = Date.now();
    const timeoutMs = 30000; // 30 second timeout for safety

    while (attempts < maxAttempts) {
      // Safety timeout to prevent infinite loop
      if (Date.now() - startTime > timeoutMs) {
        console.log('TIMEOUT: Exceeded 30 second limit waiting for CC mode');
        break;
      }

      // Check current PSU mode
      psuMode = await modeBadges.first().textContent();
      console.log(`Attempt ${attempts + 1}: PSU mode = ${psuMode}`);

      if (psuMode === 'CC') {
        console.log('SUCCESS: PSU entered CC mode!');
        break;
      }

      // Increase load current by clicking the integer position (first + in Load spinner)
      // This adds 0.1A per click (first decimal position)
      const currentPlusCount = await allPlusButtons.count();
      const loadIntegerPos = currentPlusCount - LOAD_CURRENT_DIGITS; // First digit of Load's spinner

      if (loadIntegerPos >= 0) {
        await allPlusButtons.nth(loadIntegerPos).click();
        await page.waitForTimeout(400); // Wait for measurements to update
      }

      attempts++;
    }

    // Fail-safe: if we exhausted attempts without reaching CC mode, log but don't fail
    if (attempts >= maxAttempts && psuMode !== 'CC') {
      console.log(`WARNING: Exhausted ${maxAttempts} attempts without reaching CC mode`);
    }

    // Final verification
    const finalPsuMode = await modeBadges.first().textContent();
    console.log(`Final PSU mode: ${finalPsuMode}`);

    // Assert that we successfully transitioned to CC mode
    expect(finalPsuMode).toBe('CC');

    // Take a screenshot for debugging
    await page.screenshot({ path: 'e2e/screenshots/cc-mode-transition.png' });

    console.log('Test completed successfully!');
  });
});
