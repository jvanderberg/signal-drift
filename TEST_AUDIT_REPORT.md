# Test Infrastructure Audit Report

**Date:** 2026-01-09
**Total Test Files Analyzed:** 52
**Total Issues Found:** 85+ (24 Critical, 45+ Major, 16+ Minor)

---

## Executive Summary

The test infrastructure has **serious systemic issues** that significantly undermine test value. The most egregious example is `DigitSpinner.test.tsx`, which copies internal component functions and tests them in isolation—never actually rendering or testing the component. This pattern of testing implementation details rather than behavior appears throughout the codebase.

### Key Findings

| Category | Files | Critical | Major | Minor |
|----------|-------|----------|-------|-------|
| Client Components | 13 | 3 | 12 | 8 |
| Client Hooks/Stores | 8 | 4 | 11 | 9 |
| Client Integration | 4 | 3 | 8 | 4 |
| Server Devices | 7 | 4 | 7 | 7 |
| Server Simulators | 4 | 6 | 4 | 3 |
| Server DB/Sessions/Triggers | 12 | 4 | 9 | 5 |
| E2E Tests | 4 | 5 | 5 | 7 |
| Shared/Misc | 5 | 1 | 3 | 4 |
| **TOTAL** | **52** | **24+** | **45+** | **47+** |

---

## Critical Issues (P0 - Must Fix)

These tests are fundamentally broken—they either test nothing or give false confidence.

### 1. DigitSpinner.test.tsx - Tests Copied Code, Not Component

**File:** `client/src/components/__tests__/DigitSpinner.test.tsx`

**The Problem:** Test file copies `formatValue()` and `digitsToDisplay()` functions from the component and tests those copies. The actual `<DigitSpinner>` component is **never imported, never rendered, never tested**.

```typescript
// WHAT THE TEST DOES (WRONG)
function formatValue(value, decimals, min, max) { /* copied logic */ }
expect(formatValue(3, 3, 0.05, 15000)).toBe('00003.000'); // Tests copied function

// WHAT IT SHOULD DO
render(<DigitSpinner value={3} onChange={vi.fn()} ... />);
fireEvent.click(screen.getByText('+')); // Test actual component
expect(onChange).toHaveBeenCalledWith(4);
```

**Impact:** If the real component's formatting logic drifts from the copied logic, tests still pass. Zero coverage of:
- Button clicks (+/-)
- onChange callbacks
- Disabled state
- Carry/borrow logic
- Visual feedback

**Fix:** Delete the test file and rewrite from scratch using `@testing-library/react`.

---

### 2. TriggerEngine.test.ts - Core Logic Never Executes

**File:** `server/triggers/__tests__/TriggerEngine.test.ts`

**The Problem:** Creates triggers with conditions like `voltage > 10` and mock devices reporting `voltage: 15`, but **never verifies triggers actually fire**. Tests only check that `state.executionState === 'idle'`.

**Missing Tests:**
- Trigger fires when condition is met
- Trigger does NOT fire when condition is false
- Action execution (setOutput, setValue)
- Debounce prevents repeated firing
- Repeat vs once modes

**Impact:** The entire trigger system could be broken and tests would pass.

---

### 3. database.test.ts - Schema Tests Only, Fake Assertions

**File:** `server/db/__tests__/database.test.ts`

**The Problem:**
- Tests verify tables exist but never INSERT/SELECT/UPDATE/DELETE
- Line 181-189 has literal `expect(true).toBe(true)` - a fake assertion
- No tests for data integrity, constraints, or actual operations

**Impact:** Database could silently corrupt data or violate constraints.

---

### 4. smoke.spec.ts - Infinite Loop, Brittle Automation

**File:** `e2e/smoke.spec.ts`

**The Problem:**
- Lines 230-253: Loop increases load until PSU enters CC mode with **NO TIMEOUT**. Test can hang indefinitely.
- Uses hardcoded button indices based on DOM structure - any UI change breaks test
- Verifies UI labels change, not actual device behavior

**Impact:** Test gives false confidence about PSU+Load integration.

---

### 5. Simulator Tests - Echo Tests, Not Behavior Tests

**Files:**
- `server/devices/simulation/__tests__/load-simulator.test.ts`
- `server/devices/simulation/__tests__/psu-simulator.test.ts`
- `server/devices/simulation/__tests__/oscilloscope-simulator.test.ts`

**The Problem:** Tests verify commands are echoed back correctly but don't test actual simulator behavior:

```typescript
// WHAT TESTS DO (WRONG)
load.handleCommand(':SOUR:CURR:LEV 2.5');
expect(load.handleCommand(':SOUR:CURR:LEV?')).toBe('2.5000'); // Just echo test

// WHAT THEY SHOULD DO
// Verify the load actually draws 2.5A when enabled
expect(conn.getLoadCurrent()).toBeCloseTo(2.5, 1);
```

**Missing Tests:**
- CC mode actually draws setpoint current
- CV mode regulates to setpoint voltage
- CR mode follows V/R relationship
- CP mode achieves setpoint power
- PSU transitions to CC when load exceeds limit

---

### 6. Integration Tests Mock Everything

**Files:**
- `client/src/components/__tests__/DevicePanel.integration.test.tsx`
- `client/src/components/__tests__/OscilloscopePanel.integration.test.tsx`
- `client/src/components/__tests__/App.integration.test.tsx`

**The Problem:** Tests mock WebSocket at such a low level that they verify `send()` was called but **never verify component state actually updates**.

```typescript
// Current test (WEAK)
expect(mockSend).toHaveBeenCalledWith({ type: 'subscribe', deviceId: 'device-1' });
// Missing: verify store received subscription AND UI reflects state change
```

**Impact:** Store integration bugs won't be caught. Tests verify message transmission, not actual behavior.

---

### 7. Store/Hook Tests - Mock Away Real Behavior

**Files:**
- `client/src/stores/__tests__/oscilloscopeStore.test.ts`
- `client/src/hooks/__tests__/useOscilloscopeSocket.test.ts`

**The Problem:** Tests verify that functions are called, not that state changes:

```typescript
// Line 176 - ONLY verifies send was called
it('run should send scopeRun message', () => {
  useOscilloscopeStore.getState().run('scope-1');
  expect(mockState.send).toHaveBeenCalledWith({ type: 'scopeRun', deviceId: 'scope-1' });
  // Missing: verify store state actually changed
});
```

---

### 8. Serial Timeout Tests - Explicitly Removed

**File:** `server/devices/__tests__/serial.test.ts`

**The Problem:** Lines 101-102 comment says timeout tests were removed:
```typescript
// Note: Timeout tests removed due to vitest fake timer issues with async rejections.
```

**Impact:** Critical timeout functionality has zero test coverage. Serial devices can hang indefinitely.

---

## Major Issues (P1 - Should Fix)

### Client Components

| File | Issue |
|------|-------|
| `WaveformDisplay.test.tsx` | Missing tests for trigger line dragging, Y-axis lock, resize behavior |
| `StreamingControls.test.tsx` | Fragile regex class matching (`toMatch(/live|pulse/i)`), missing FPS conditions |
| `TriggerSettings.test.tsx` | Level input Enter key/blur submission not tested |
| `TriggerScriptPanel.test.tsx` | Drag-and-drop reordering not tested, shared mock state mutations |
| `TriggerEditor.test.tsx` | Device parameter selection cascade not tested |

### Server

| File | Issue |
|------|-------|
| All device drivers | No SCPI error response handling tests |
| `rigol-oscilloscope.test.ts` | No large waveform testing (1M+ points), no timeout tests |
| `rigol-dl3021.test.ts` | Mode change verification missing, no boundary tests |
| `virtual-connection.test.ts` | Missing boundary condition tests |
| `SessionManager.test.ts` | All behavior mocked away, fake timers mask real issues |
| `DeviceSession.test.ts` | Race condition tests unreliable with fake timers |

### E2E

| File | Issue |
|------|-------|
| `sequence-panel.spec.ts` | Only tests "doesn't crash", no actual functionality |
| `demo.spec.ts` | Streaming not validated (could be stale data) |
| `dashboard-layout.spec.ts` | Pixel-coordinate-based testing, silent error swallowing |

---

## Minor Issues (P2 - Nice to Fix)

1. **Inconsistent tolerances**: Some tests use `toBeCloseTo(12, 0)` (±2 allowed), others use proper precision
2. **Brittle class assertions**: `expect(element.className).toMatch(/class-name/i)` instead of `toHaveClass()`
3. **Missing parametrized tests**: Mode tests repeat for CC, CV, CR, CP instead of using `describe.each()`
4. **No accessibility testing**: Missing ARIA label verification, keyboard navigation
5. **Console.log in tests**: `smoke.spec.ts` has debug logging
6. **Hardcoded selectors**: `getAllByRole('combobox')[3]` instead of semantic selectors

---

## Recommendations by Priority

### Immediate (P0 - This Week)

1. **Rewrite DigitSpinner.test.tsx** - Current tests are useless
   - Import and render actual component
   - Test button clicks, onChange, disabled state
   - Test carry/borrow logic

2. **Fix TriggerEngine.test.ts** - Add actual trigger execution tests
   - Verify triggers fire when conditions met
   - Verify actions execute
   - Test debounce and repeat modes

3. **Restore serial timeout tests** - Critical functionality with zero coverage

4. **Fix smoke.spec.ts** - Add timeout to infinite loop, verify actual device state

5. **Fix database.test.ts** - Remove fake assertion, add real CRUD tests

### High Priority (P1 - This Month)

6. **Add behavior tests to simulator tests** - Verify actual physics, not just echo
7. **Fix integration test mocking** - Test store state changes, not just message sending
8. **Add error recovery tests** - All driver and session tests
9. **Add concurrent access tests** - Database and session tests
10. **Add boundary tests** - PSU/Load setpoint limits

### Medium Priority (P2 - This Quarter)

11. **Improve assertion quality** - Use `toHaveClass()` instead of regex
12. **Add missing interaction tests** - WaveformDisplay drag, TriggerScriptPanel drag-and-drop
13. **Add parametrized tests** - Reduce duplication
14. **Add accessibility tests** - ARIA labels, keyboard navigation
15. **Add performance tests** - Large datasets, long streaming sessions

---

## Test Categories Summary

### Good Tests (Use as Examples)

- `StatusReadings.test.tsx` - Properly renders component, tests edge cases
- `ModeSelector.test.tsx` - Comprehensive, tests actual behavior
- `scpi-parser.test.ts` - Tests real protocol parsing
- `deviceStore.test.ts` - Good store testing patterns (though could verify state more)

### Tests Needing Rewrite

- `DigitSpinner.test.tsx` - Complete rewrite
- `TriggerEngine.test.ts` - Add execution tests
- `database.test.ts` - Add real CRUD tests
- `smoke.spec.ts` - Remove infinite loop, test behavior

### Tests Needing Enhancement

- All simulator tests - Add behavior verification
- All integration tests - Verify state changes
- All driver tests - Add error handling
- E2E tests - Add actual workflow tests

---

## Metrics to Track

After fixes, aim for:

| Metric | Current | Target |
|--------|---------|--------|
| Tests actually testing behavior | ~40% | 90%+ |
| Error scenario coverage | ~10% | 70%+ |
| Concurrent operation tests | ~5% | 50%+ |
| Boundary condition tests | ~15% | 80%+ |
| Tests with fake assertions | 3+ | 0 |

---

## Appendix: File-by-File Status

### Client Components (13 files)

| File | Status | Key Issue |
|------|--------|-----------|
| DigitSpinner.test.tsx | 🔴 CRITICAL | Tests copied code, not component |
| StatsBar.test.tsx | 🟢 GOOD | Minor edge cases missing |
| OutputControl.test.tsx | 🟢 GOOD | Solid coverage |
| StatusReadings.test.tsx | 🟢 GOOD | Minor edge cases missing |
| ModeSelector.test.tsx | 🟢 GOOD | Comprehensive |
| WaveformDisplay.test.tsx | 🟡 MAJOR | Missing interaction tests |
| StreamingControls.test.tsx | 🟡 MAJOR | Fragile class matching |
| TriggerEditor.test.tsx | 🟡 MAJOR | Device cascade untested |
| ChannelSettings.test.tsx | 🟡 MAJOR | One weak assertion |
| TriggerSettings.test.tsx | 🔴 CRITICAL | Key input behavior untested |
| TriggerScriptPanel.test.tsx | 🔴 CRITICAL | Drag-drop missing, bad mocks |
| TimebaseControls.test.tsx | 🟢 GOOD | Missing edge cases |

### Client Integration (4 files)

| File | Status | Key Issue |
|------|--------|-----------|
| DevicePanel.integration.test.tsx | 🔴 CRITICAL | Mocks undermine integration |
| SequencePanel.integration.test.tsx | 🟡 MAJOR | Fragile selectors |
| App.integration.test.tsx | 🔴 CRITICAL | Nearly empty |
| OscilloscopePanel.integration.test.tsx | 🔴 CRITICAL | Missing all controls |

### Client Stores (4 files)

| File | Status | Key Issue |
|------|--------|-----------|
| deviceStore.test.ts | 🟢 GOOD | Good patterns |
| oscilloscopeStore.test.ts | 🔴 CRITICAL | Tests send(), not state |
| layoutStore.test.ts | 🟡 MAJOR | Missing concurrent tests |
| uiStore.test.ts | 🟡 MAJOR | Missing persistence tests |

### Client Hooks (4 files)

| File | Status | Key Issue |
|------|--------|-----------|
| useDeviceSocket.test.ts | 🟢 GOOD | Good patterns |
| useOscilloscopeSocket.test.ts | 🔴 CRITICAL | Tests mocked store |
| useTriggerScript.test.ts | 🟡 MAJOR | Missing error recovery |
| useDeviceList.test.ts | 🟡 MAJOR | Missing validation |

### Server Devices (7 files)

| File | Status | Key Issue |
|------|--------|-----------|
| registry.test.ts | 🟡 MAJOR | No concurrent tests |
| scpi-parser.test.ts | 🟢 GOOD | Excellent |
| rigol-oscilloscope.test.ts | 🟡 MAJOR | No error handling |
| rigol-dl3021.test.ts | 🟡 MAJOR | No mode verification |
| usbtmc.test.ts | 🟢 GOOD | Minor gaps |
| serial.test.ts | 🔴 CRITICAL | Timeout tests removed |
| matrix-wps300s.test.ts | 🟡 MAJOR | No threshold tests |

### Server Simulators (4 files)

| File | Status | Key Issue |
|------|--------|-----------|
| load-simulator.test.ts | 🔴 CRITICAL | Echo tests only |
| psu-simulator.test.ts | 🔴 CRITICAL | Echo tests only |
| oscilloscope-simulator.test.ts | 🔴 CRITICAL | Echo tests only |
| virtual-connection.test.ts | 🟡 MAJOR | Missing boundaries |

### Server DB/Sessions/Triggers (12 files)

| File | Status | Key Issue |
|------|--------|-----------|
| database.test.ts | 🔴 CRITICAL | Fake assertions |
| SettingsExportImport.test.ts | 🟢 GOOD | Missing failure cases |
| DashboardLayoutStore.test.ts | 🟢 GOOD | Missing concurrent |
| SequenceStoreSqlite.test.ts | 🟢 GOOD | Missing concurrent |
| DeviceAliasStore.test.ts | 🟢 GOOD | Minor gaps |
| TriggerScriptStoreSqlite.test.ts | 🟢 GOOD | Minor gaps |
| SessionManager.test.ts | 🔴 CRITICAL | All mocked |
| DeviceSession.test.ts | 🟡 MAJOR | Fake timers |
| OscilloscopeSession.streaming.test.ts | 🟡 MAJOR | Fragile timing |
| TriggerScriptManager.test.ts | 🟡 MAJOR | No execution tests |
| TriggerScriptStore.test.ts | 🟢 GOOD | Minor gaps |
| TriggerEngine.test.ts | 🔴 CRITICAL | Logic never runs |

### E2E Tests (4 files)

| File | Status | Key Issue |
|------|--------|-----------|
| smoke.spec.ts | 🔴 CRITICAL | Infinite loop |
| demo.spec.ts | 🟡 MAJOR | Streaming not validated |
| sequence-panel.spec.ts | 🔴 CRITICAL | No functionality tests |
| dashboard-layout.spec.ts | 🟡 MAJOR | Pixel coordinates |

### Other (5 files)

| File | Status | Key Issue |
|------|--------|-----------|
| WebSocketHandler.test.ts | 🟡 MAJOR | Mock too simple |
| WaveformGenerator.test.ts | 🟡 MAJOR | Math not validated |
| SequenceStore.test.ts | 🟢 GOOD | Minor gaps |
| SequenceController.test.ts | 🟡 MAJOR | Timing fragile |
| SequenceManager.test.ts | 🟢 GOOD | Missing error cases |
| waveform.test.ts | 🟢 GOOD | Format only |

---

**Legend:**
- 🔴 CRITICAL - Tests are broken or test nothing
- 🟡 MAJOR - Missing important coverage
- 🟢 GOOD - Acceptable with minor improvements
