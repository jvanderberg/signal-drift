import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSequenceController, SequenceController } from '../SequenceController.js';
import type { DeviceSession } from '../../sessions/DeviceSession.js';
import type {
  SequenceDefinition,
  SequenceRunConfig,
  ServerMessage,
  Result,
  DeviceSessionState,
  DeviceInfo,
  DeviceCapabilities,
} from '../../../shared/types.js';
import { Ok, Err } from '../../../shared/types.js';

// Mock DeviceSession factory
function createMockSession(overrides: Partial<{
  setValueImpl: (name: string, value: number, immediate?: boolean) => Promise<Result<void, Error>>;
}> = {}): DeviceSession {
  const info: DeviceInfo = {
    id: 'test-device-1',
    type: 'power-supply',
    manufacturer: 'Test',
    model: 'PSU',
  };

  const capabilities: DeviceCapabilities = {
    deviceClass: 'psu',
    features: {},
    modes: ['CV', 'CC'],
    modesSettable: true,
    outputs: [{ name: 'voltage', unit: 'V', decimals: 2, min: 0, max: 30 }],
    measurements: [
      { name: 'voltage', unit: 'V', decimals: 2 },
      { name: 'current', unit: 'A', decimals: 3 },
    ],
  };

  return {
    getState: () => ({
      info,
      capabilities,
      connectionStatus: 'connected',
      consecutiveErrors: 0,
      mode: 'CV',
      outputEnabled: false,
      setpoints: { voltage: 0 },
      measurements: { voltage: 0, current: 0 },
      history: { timestamps: [], voltage: [], current: [], power: [] },
      lastUpdated: Date.now(),
    } as DeviceSessionState),
    getSubscriberCount: () => 0,
    hasSubscriber: () => false,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    setMode: vi.fn().mockResolvedValue(Ok()),
    setOutput: vi.fn().mockResolvedValue(Ok()),
    setValue: vi.fn().mockImplementation(async (name: string, value: number, immediate?: boolean) => {
      if (overrides.setValueImpl) {
        return overrides.setValueImpl(name, value, immediate);
      }
      return Ok();
    }),
    reconnect: vi.fn(),
    stop: vi.fn(),
  } as unknown as DeviceSession;
}

function createTestDefinition(overrides: Partial<SequenceDefinition> = {}): SequenceDefinition {
  return {
    id: 'seq-1',
    name: 'Test Sequence',
    unit: 'V',
    waveform: {
      type: 'ramp',
      min: 0,
      max: 10,
      pointsPerCycle: 5,
      intervalMs: 100,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function createTestRunConfig(overrides: Partial<SequenceRunConfig> = {}): SequenceRunConfig {
  return {
    sequenceId: 'seq-1',
    deviceId: 'test-device-1',
    parameter: 'voltage',
    repeatMode: 'once',
    ...overrides,
  };
}

describe('SequenceController', () => {
  let controller: SequenceController;
  let session: DeviceSession;
  let messages: ServerMessage[];

  beforeEach(() => {
    vi.useFakeTimers();
    messages = [];
  });

  afterEach(() => {
    if (controller) {
      controller.destroy();
    }
    vi.useRealTimers();
  });

  describe('Initialization', () => {
    it('should start in idle state', () => {
      session = createMockSession();
      controller = createSequenceController(createTestDefinition(), createTestRunConfig(), session);

      const state = controller.getState();
      expect(state.executionState).toBe('idle');
      expect(state.currentStepIndex).toBe(0);
      expect(state.currentCycle).toBe(0);
    });

    it('should resolve steps from waveform params', () => {
      session = createMockSession();
      controller = createSequenceController(
        createTestDefinition({
          waveform: { type: 'ramp', min: 0, max: 10, pointsPerCycle: 5, intervalMs: 100 },
        }),
        createTestRunConfig(),
        session
      );

      const state = controller.getState();
      expect(state.totalSteps).toBe(5);
    });

    it('should use arbitrary steps directly', () => {
      session = createMockSession();
      controller = createSequenceController(
        createTestDefinition({
          waveform: { steps: [{ value: 1, dwellMs: 100 }, { value: 2, dwellMs: 200 }] },
        }),
        createTestRunConfig(),
        session
      );

      const state = controller.getState();
      expect(state.totalSteps).toBe(2);
    });
  });

  describe('Execution', () => {
    it('should start running when start() is called', async () => {
      session = createMockSession();
      controller = createSequenceController(createTestDefinition(), createTestRunConfig(), session);
      controller.subscribe((msg) => messages.push(msg));

      await controller.start();

      expect(controller.getState().executionState).toBe('running');
      expect(messages.some(m => m.type === 'sequenceStarted')).toBe(true);
    });

    it('should call setValue for each step', async () => {
      session = createMockSession();
      const setValueSpy = vi.spyOn(session, 'setValue');

      controller = createSequenceController(
        createTestDefinition({
          waveform: { type: 'ramp', min: 0, max: 4, pointsPerCycle: 5, intervalMs: 100 },
        }),
        createTestRunConfig(),
        session
      );

      await controller.start();

      // First step executed immediately
      expect(setValueSpy).toHaveBeenCalledWith('voltage', 0, true);

      // Advance through remaining steps
      await vi.advanceTimersByTimeAsync(100);
      expect(setValueSpy).toHaveBeenCalledWith('voltage', 1, true);

      await vi.advanceTimersByTimeAsync(100);
      expect(setValueSpy).toHaveBeenCalledWith('voltage', 2, true);

      await vi.advanceTimersByTimeAsync(100);
      expect(setValueSpy).toHaveBeenCalledWith('voltage', 3, true);

      await vi.advanceTimersByTimeAsync(100);
      expect(setValueSpy).toHaveBeenCalledWith('voltage', 4, true);

      expect(setValueSpy).toHaveBeenCalledTimes(5);
    });

    it('should complete after one cycle with repeatMode=once', async () => {
      session = createMockSession();
      controller = createSequenceController(
        createTestDefinition({
          waveform: { type: 'ramp', min: 0, max: 2, pointsPerCycle: 3, intervalMs: 100 },
        }),
        createTestRunConfig({ repeatMode: 'once' }),
        session
      );
      controller.subscribe((msg) => messages.push(msg));

      await controller.start();

      // Execute all steps
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);

      expect(controller.getState().executionState).toBe('completed');
      expect(messages.some(m => m.type === 'sequenceCompleted')).toBe(true);
    });

    it('should repeat N times with repeatMode=count', async () => {
      session = createMockSession();
      const callValues: number[] = [];
      vi.spyOn(session, 'setValue').mockImplementation(async (name, value) => {
        callValues.push(value as number);
        return { ok: true, value: undefined } as const;
      });

      controller = createSequenceController(
        createTestDefinition({
          waveform: { type: 'ramp', min: 0, max: 1, pointsPerCycle: 2, intervalMs: 100 },
        }),
        createTestRunConfig({ repeatMode: 'count', repeatCount: 2 }),
        session
      );

      await controller.start();
      // T=0: Cycle 1, step 0
      expect(callValues).toEqual([0]);

      await vi.advanceTimersByTimeAsync(100);
      // T=100: Cycle 1, step 1 - also triggers cycle wrap, schedules step 0 at T=200
      expect(callValues).toEqual([0, 1]);

      await vi.advanceTimersByTimeAsync(100);
      // T=200: Cycle 2, step 0
      expect(callValues).toEqual([0, 1, 0]);
      expect(controller.getState().currentCycle).toBe(1);

      await vi.advanceTimersByTimeAsync(100);
      // T=300: Cycle 2, step 1 - completes
      expect(callValues).toEqual([0, 1, 0, 1]);

      expect(controller.getState().executionState).toBe('completed');
      expect(controller.getState().currentCycle).toBe(2);
    });

    it('should broadcast progress on each step', async () => {
      session = createMockSession();
      controller = createSequenceController(
        createTestDefinition({
          waveform: { type: 'ramp', min: 0, max: 2, pointsPerCycle: 3, intervalMs: 100 },
        }),
        createTestRunConfig(),
        session
      );
      controller.subscribe((msg) => messages.push(msg));

      await controller.start();

      const progressMessages = messages.filter(m => m.type === 'sequenceProgress');
      expect(progressMessages.length).toBeGreaterThanOrEqual(1);
    });

    it('should play all steps of arbitrary waveform including last step when looping', async () => {
      // Simulates user's scenario: 100Ω, 50Ω, 20Ω, 10Ω with 100ms dwell each
      // When looping, the last step (10Ω) should get its full dwell time
      session = createMockSession();
      const setValueSpy = vi.spyOn(session, 'setValue');
      const callTimes: { value: number; time: number }[] = [];

      // Track when each setValue is called
      setValueSpy.mockImplementation(async (name, value) => {
        callTimes.push({ value: value as number, time: Date.now() });
        return { ok: true, value: undefined } as const;
      });

      controller = createSequenceController(
        createTestDefinition({
          waveform: {
            steps: [
              { value: 100, dwellMs: 100 },
              { value: 50, dwellMs: 100 },
              { value: 20, dwellMs: 100 },
              { value: 10, dwellMs: 100 },
            ],
          },
        }),
        createTestRunConfig({ repeatMode: 'count', repeatCount: 2 }),
        session
      );

      await controller.start();

      // Cycle 1: 100 -> 50 -> 20 -> 10
      expect(callTimes[callTimes.length - 1].value).toBe(100);
      await vi.advanceTimersByTimeAsync(100);
      expect(callTimes[callTimes.length - 1].value).toBe(50);
      await vi.advanceTimersByTimeAsync(100);
      expect(callTimes[callTimes.length - 1].value).toBe(20);
      await vi.advanceTimersByTimeAsync(100);
      expect(callTimes[callTimes.length - 1].value).toBe(10);

      // The last step (10) should dwell for its full 100ms before cycle 2 starts
      // After 50ms, we should still be on step 10, not yet on cycle 2
      await vi.advanceTimersByTimeAsync(50);
      expect(callTimes[callTimes.length - 1].value).toBe(10); // Still showing 10

      // After another 50ms (total 100ms dwell), cycle 2 should start with step 0
      await vi.advanceTimersByTimeAsync(50);
      await vi.runOnlyPendingTimersAsync();

      // Debug: check all values
      const values = callTimes.map(c => c.value);
      // Should be: [100, 50, 20, 10, 100, ...]
      expect(values.slice(0, 5)).toEqual([100, 50, 20, 10, 100]);

      // Verify the timing gap between last step of cycle 1 and first step of cycle 2
      expect(callTimes[4].time - callTimes[3].time).toBe(100); // Full dwell time
    });
  });

  describe('Pause/Resume', () => {
    it('should pause execution', async () => {
      session = createMockSession();
      controller = createSequenceController(
        createTestDefinition({
          waveform: { type: 'ramp', min: 0, max: 4, pointsPerCycle: 5, intervalMs: 100 },
        }),
        createTestRunConfig(),
        session
      );

      await controller.start();
      await vi.advanceTimersByTimeAsync(100);

      controller.pause();

      expect(controller.getState().executionState).toBe('paused');

      // Advancing time should not execute more steps
      const setValueSpy = vi.spyOn(session, 'setValue');
      setValueSpy.mockClear();

      await vi.advanceTimersByTimeAsync(500);
      expect(setValueSpy).not.toHaveBeenCalled();
    });

    it('should resume execution from where it paused', async () => {
      session = createMockSession();
      const setValueSpy = vi.spyOn(session, 'setValue');

      controller = createSequenceController(
        createTestDefinition({
          waveform: { type: 'ramp', min: 0, max: 4, pointsPerCycle: 5, intervalMs: 100 },
        }),
        createTestRunConfig(),
        session,
        { minIntervalMs: 50 }
      );

      await controller.start();
      await vi.advanceTimersByTimeAsync(100); // Step 0 done, step 1 done

      const stepBeforePause = controller.getState().currentStepIndex;
      controller.pause();

      await vi.advanceTimersByTimeAsync(500); // Time passes while paused

      controller.resume();
      expect(controller.getState().executionState).toBe('running');
      expect(controller.getState().currentStepIndex).toBe(stepBeforePause);

      // After resume, next step executes after minIntervalMs (50ms)
      await vi.advanceTimersByTimeAsync(50);
      expect(controller.getState().currentStepIndex).toBe(stepBeforePause + 1);
    });
  });

  describe('Abort', () => {
    it('should stop execution on abort', async () => {
      session = createMockSession();
      controller = createSequenceController(
        createTestDefinition({
          waveform: { type: 'ramp', min: 0, max: 4, pointsPerCycle: 5, intervalMs: 100 },
        }),
        createTestRunConfig(),
        session
      );
      controller.subscribe((msg) => messages.push(msg));

      await controller.start();
      await vi.advanceTimersByTimeAsync(100);

      await controller.abort();

      expect(controller.getState().executionState).toBe('idle');
      expect(messages.some(m => m.type === 'sequenceAborted')).toBe(true);
    });

    it('should set post value on abort if configured', async () => {
      session = createMockSession();
      const setValueSpy = vi.spyOn(session, 'setValue');

      controller = createSequenceController(
        createTestDefinition({
          waveform: { type: 'ramp', min: 0, max: 4, pointsPerCycle: 5, intervalMs: 100 },
          postValue: 0,
        }),
        createTestRunConfig(),
        session
      );

      await controller.start();
      await vi.advanceTimersByTimeAsync(100);

      await controller.abort();

      expect(setValueSpy).toHaveBeenLastCalledWith('voltage', 0, true);
    });
  });

  describe('Pre/Post Values', () => {
    it('should set pre value before starting', async () => {
      session = createMockSession();
      const setValueSpy = vi.spyOn(session, 'setValue');

      controller = createSequenceController(
        createTestDefinition({
          waveform: { type: 'ramp', min: 5, max: 10, pointsPerCycle: 2, intervalMs: 100 },
          preValue: 0,
        }),
        createTestRunConfig(),
        session
      );

      await controller.start();

      // First call should be pre value
      expect(setValueSpy).toHaveBeenNthCalledWith(1, 'voltage', 0, true);
      // Second call should be first step
      expect(setValueSpy).toHaveBeenNthCalledWith(2, 'voltage', 5, true);
    });

    it('should set post value after completing', async () => {
      session = createMockSession();
      const setValueSpy = vi.spyOn(session, 'setValue');

      controller = createSequenceController(
        createTestDefinition({
          waveform: { type: 'ramp', min: 5, max: 10, pointsPerCycle: 2, intervalMs: 100 },
          postValue: 0,
        }),
        createTestRunConfig(),
        session
      );

      await controller.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(controller.getState().executionState).toBe('completed');
      expect(setValueSpy).toHaveBeenLastCalledWith('voltage', 0, true);
    });
  });

  describe('Modifiers', () => {
    it('should apply scale modifier', async () => {
      session = createMockSession();
      const setValueSpy = vi.spyOn(session, 'setValue');

      controller = createSequenceController(
        createTestDefinition({
          waveform: { type: 'ramp', min: 0, max: 10, pointsPerCycle: 3, intervalMs: 100 },
          scale: 0.5,
        }),
        createTestRunConfig(),
        session
      );

      await controller.start();

      // Values should be scaled: 0*0.5=0, 5*0.5=2.5, 10*0.5=5
      expect(setValueSpy).toHaveBeenCalledWith('voltage', 0, true);
      await vi.advanceTimersByTimeAsync(100);
      expect(setValueSpy).toHaveBeenCalledWith('voltage', 2.5, true);
      await vi.advanceTimersByTimeAsync(100);
      expect(setValueSpy).toHaveBeenCalledWith('voltage', 5, true);
    });

    it('should apply offset modifier', async () => {
      session = createMockSession();
      const setValueSpy = vi.spyOn(session, 'setValue');

      controller = createSequenceController(
        createTestDefinition({
          waveform: { type: 'ramp', min: 0, max: 2, pointsPerCycle: 3, intervalMs: 100 },
          offset: 5,
        }),
        createTestRunConfig(),
        session
      );

      await controller.start();

      // Values should be offset: 0+5=5, 1+5=6, 2+5=7
      expect(setValueSpy).toHaveBeenCalledWith('voltage', 5, true);
      await vi.advanceTimersByTimeAsync(100);
      expect(setValueSpy).toHaveBeenCalledWith('voltage', 6, true);
      await vi.advanceTimersByTimeAsync(100);
      expect(setValueSpy).toHaveBeenCalledWith('voltage', 7, true);
    });

    it('should apply maxClamp modifier', async () => {
      session = createMockSession();
      const setValueSpy = vi.spyOn(session, 'setValue');

      controller = createSequenceController(
        createTestDefinition({
          waveform: { type: 'ramp', min: 0, max: 20, pointsPerCycle: 3, intervalMs: 100 },
          maxClamp: 10,
        }),
        createTestRunConfig(),
        session
      );

      await controller.start();

      // Values should be clamped: 0, 10 (clamped from 10), 10 (clamped from 20)
      expect(setValueSpy).toHaveBeenCalledWith('voltage', 0, true);
      await vi.advanceTimersByTimeAsync(100);
      expect(setValueSpy).toHaveBeenCalledWith('voltage', 10, true);
      await vi.advanceTimersByTimeAsync(100);
      expect(setValueSpy).toHaveBeenCalledWith('voltage', 10, true);
    });

    it('should apply modifiers in order: scale, offset, clamp', async () => {
      session = createMockSession();
      const setValueSpy = vi.spyOn(session, 'setValue');

      controller = createSequenceController(
        createTestDefinition({
          waveform: { steps: [{ value: 10, dwellMs: 100 }] },
          scale: 2,      // 10 * 2 = 20
          offset: 5,     // 20 + 5 = 25
          maxClamp: 15,  // min(25, 15) = 15
        }),
        createTestRunConfig(),
        session
      );

      await controller.start();

      expect(setValueSpy).toHaveBeenCalledWith('voltage', 15, true);
    });
  });

  describe('Error Handling', () => {
    it('should enter error state on setValue failure', async () => {
      session = createMockSession({
        setValueImpl: async () => Err(new Error('Device error')),
      });

      controller = createSequenceController(createTestDefinition(), createTestRunConfig(), session);
      controller.subscribe((msg) => messages.push(msg));

      await controller.start();

      expect(controller.getState().executionState).toBe('error');
      expect(controller.getState().error).toBe('Failed to set value: Device error');
      expect(messages.some(m => m.type === 'sequenceError')).toBe(true);
    });

    it('should throw if start called while running', async () => {
      session = createMockSession();
      controller = createSequenceController(createTestDefinition(), createTestRunConfig(), session);

      await controller.start();

      await expect(controller.start()).rejects.toThrow('Sequence already running');
    });

    it('should throw if pause called while not running', () => {
      session = createMockSession();
      controller = createSequenceController(createTestDefinition(), createTestRunConfig(), session);

      expect(() => controller.pause()).toThrow('Sequence not running');
    });

    it('should throw if resume called while not paused', async () => {
      session = createMockSession();
      controller = createSequenceController(createTestDefinition(), createTestRunConfig(), session);

      await controller.start();

      expect(() => controller.resume()).toThrow('Sequence not paused');
    });
  });

  describe('Subscribers', () => {
    it('should allow subscribing and unsubscribing', async () => {
      session = createMockSession();
      controller = createSequenceController(createTestDefinition(), createTestRunConfig(), session);

      const received: ServerMessage[] = [];
      const unsubscribe = controller.subscribe((msg) => received.push(msg));

      await controller.start();
      expect(received.length).toBeGreaterThan(0);

      received.length = 0;
      unsubscribe();

      await vi.advanceTimersByTimeAsync(100);
      expect(received.length).toBe(0);
    });

    it('should notify multiple subscribers', async () => {
      session = createMockSession();
      controller = createSequenceController(createTestDefinition(), createTestRunConfig(), session);

      const received1: ServerMessage[] = [];
      const received2: ServerMessage[] = [];

      controller.subscribe((msg) => received1.push(msg));
      controller.subscribe((msg) => received2.push(msg));

      await controller.start();

      expect(received1.length).toBeGreaterThan(0);
      expect(received2.length).toBe(received1.length);
    });
  });

  describe('Schedule Timing', () => {
    it('should skip steps when execution falls behind schedule (frame dropping)', async () => {
      // This tests the "frame dropping" behavior where steps are skipped
      // to maintain overall schedule timing when scheduling the next step
      session = createMockSession();
      const callValues: number[] = [];

      vi.spyOn(session, 'setValue').mockImplementation(async (name, value) => {
        callValues.push(value as number);
        return Ok();
      });

      controller = createSequenceController(
        createTestDefinition({
          waveform: {
            steps: [
              { value: 0, dwellMs: 100 },
              { value: 1, dwellMs: 100 },
              { value: 2, dwellMs: 100 },
              { value: 3, dwellMs: 100 },
              { value: 4, dwellMs: 100 },
            ],
          },
        }),
        createTestRunConfig(),
        session
      );

      await controller.start();
      expect(callValues).toEqual([0]); // First step executes immediately

      // Advance past multiple scheduled times at once
      // This simulates the scenario where the system was busy
      // Steps 1, 2 should be skipped because we're past their scheduled times
      await vi.advanceTimersByTimeAsync(350);

      // We should see step 0, then jump to step 3 or 4 (skipping 1, 2)
      // The exact behavior depends on how far behind we are
      const lastValue = callValues[callValues.length - 1];
      expect(lastValue).toBeGreaterThanOrEqual(3); // Should have skipped to at least step 3

      // Some steps should have been skipped
      expect(callValues.length).toBeLessThan(5); // Not all steps executed

      // Complete the sequence
      await vi.advanceTimersByTimeAsync(200);
      expect(controller.getState().executionState).toBe('completed');
    });

    it('should not accumulate drift across multiple cycles', async () => {
      // Each cycle should start at the intended time based on previous cycle end,
      // not based on when the previous cycle actually finished
      session = createMockSession();
      const callTimes: number[] = [];

      vi.spyOn(session, 'setValue').mockImplementation(async () => {
        callTimes.push(Date.now());
        return Ok();
      });

      controller = createSequenceController(
        createTestDefinition({
          waveform: {
            steps: [
              { value: 0, dwellMs: 100 },
              { value: 1, dwellMs: 100 },
            ],
          },
        }),
        createTestRunConfig({ repeatMode: 'count', repeatCount: 3 }),
        session
      );

      await controller.start();
      // T=0: Cycle 1, step 0

      await vi.advanceTimersByTimeAsync(100);
      // T=100: Cycle 1, step 1

      await vi.advanceTimersByTimeAsync(100);
      // T=200: Cycle 2, step 0

      await vi.advanceTimersByTimeAsync(100);
      // T=300: Cycle 2, step 1

      await vi.advanceTimersByTimeAsync(100);
      // T=400: Cycle 3, step 0

      await vi.advanceTimersByTimeAsync(100);
      // T=500: Cycle 3, step 1

      expect(controller.getState().executionState).toBe('completed');

      // Each cycle should be exactly 200ms apart (2 steps * 100ms)
      // Cycle 1: T=0, T=100
      // Cycle 2: T=200, T=300
      // Cycle 3: T=400, T=500
      expect(callTimes.length).toBe(6);

      // Verify cycle boundaries are at expected times
      // Allow small tolerance for timer precision
      const cycleStartTimes = [callTimes[0], callTimes[2], callTimes[4]];
      expect(cycleStartTimes[1] - cycleStartTimes[0]).toBe(200);
      expect(cycleStartTimes[2] - cycleStartTimes[1]).toBe(200);
    });

    it('should maintain schedule after pause/resume without skipping steps', async () => {
      // After resume, the schedule should be shifted forward by pause duration
      // so no steps are incorrectly skipped
      session = createMockSession();
      const callValues: number[] = [];

      vi.spyOn(session, 'setValue').mockImplementation(async (name, value) => {
        callValues.push(value as number);
        return Ok();
      });

      controller = createSequenceController(
        createTestDefinition({
          waveform: {
            steps: [
              { value: 0, dwellMs: 100 },
              { value: 1, dwellMs: 100 },
              { value: 2, dwellMs: 100 },
              { value: 3, dwellMs: 100 },
            ],
          },
        }),
        createTestRunConfig(),
        session,
        { minIntervalMs: 50 }
      );

      await controller.start();
      expect(callValues).toEqual([0]);

      await vi.advanceTimersByTimeAsync(100);
      expect(callValues).toEqual([0, 1]);

      // Pause for a long time
      controller.pause();
      await vi.advanceTimersByTimeAsync(5000);

      // Resume - schedule should shift forward
      controller.resume();

      // After minIntervalMs, should execute step 2 (not skip to end)
      await vi.advanceTimersByTimeAsync(50);
      expect(callValues).toEqual([0, 1, 2]);

      // Continue to completion - step 3 is scheduled based on shifted schedule
      // (pause shifted it forward, so need enough time to reach it)
      await vi.advanceTimersByTimeAsync(200);
      expect(callValues).toEqual([0, 1, 2, 3]);
    });
  });

  describe('Timing', () => {
    it('should respect minimum interval', async () => {
      session = createMockSession();
      const setValueSpy = vi.spyOn(session, 'setValue');

      // Try to use 10ms interval, but minIntervalMs is 50
      controller = createSequenceController(
        createTestDefinition({
          waveform: { type: 'ramp', min: 0, max: 1, pointsPerCycle: 2, intervalMs: 10 },
        }),
        createTestRunConfig(),
        session,
        { minIntervalMs: 50 }
      );

      await controller.start();

      // Should not have second call yet at 10ms
      await vi.advanceTimersByTimeAsync(10);
      expect(setValueSpy).toHaveBeenCalledTimes(1);

      // Should have second call at 50ms
      await vi.advanceTimersByTimeAsync(40);
      expect(setValueSpy).toHaveBeenCalledTimes(2);
    });

    it('should track elapsed time correctly', async () => {
      session = createMockSession();
      controller = createSequenceController(
        createTestDefinition({
          waveform: { type: 'ramp', min: 0, max: 4, pointsPerCycle: 5, intervalMs: 100 },
        }),
        createTestRunConfig(),
        session
      );

      await controller.start();
      expect(controller.getState().elapsedMs).toBe(0);

      await vi.advanceTimersByTimeAsync(250);
      expect(controller.getState().elapsedMs).toBe(250);
    });

    it('should not count pause time in elapsed', async () => {
      session = createMockSession();
      controller = createSequenceController(
        createTestDefinition({
          waveform: { type: 'ramp', min: 0, max: 4, pointsPerCycle: 5, intervalMs: 100 },
        }),
        createTestRunConfig(),
        session
      );

      await controller.start();
      await vi.advanceTimersByTimeAsync(100);

      const elapsedBeforePause = controller.getState().elapsedMs;
      controller.pause();

      await vi.advanceTimersByTimeAsync(500); // Paused for 500ms

      controller.resume();

      // Elapsed should be approximately same as before pause (not +500)
      expect(controller.getState().elapsedMs).toBeCloseTo(elapsedBeforePause, -1);
    });
  });

  describe('Random Walk', () => {
    it('should execute random walk steps', async () => {
      session = createMockSession();
      const callValues: number[] = [];
      vi.spyOn(session, 'setValue').mockImplementation(async (name, value) => {
        callValues.push(value as number);
        return Ok();
      });

      controller = createSequenceController(
        createTestDefinition({
          waveform: {
            type: 'random',
            startValue: 5,
            maxStepSize: 1,
            min: 0,
            max: 10,
            pointsPerCycle: 5,
            intervalMs: 100,
          },
        }),
        createTestRunConfig(),
        session
      );

      await controller.start();

      // Execute all steps
      for (let i = 0; i < 4; i++) {
        await vi.advanceTimersByTimeAsync(100);
      }

      expect(callValues).toHaveLength(5);

      // All values should be within bounds
      for (const value of callValues) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(10);
      }

      // Each step should be within maxStepSize of the previous
      for (let i = 1; i < callValues.length; i++) {
        const diff = Math.abs(callValues[i] - callValues[i - 1]);
        expect(diff).toBeLessThanOrEqual(1);
      }
    });

    it('should regenerate steps for each cycle using last commanded value', async () => {
      session = createMockSession();
      const callValues: number[] = [];
      vi.spyOn(session, 'setValue').mockImplementation(async (name, value) => {
        callValues.push(value as number);
        return Ok();
      });

      controller = createSequenceController(
        createTestDefinition({
          waveform: {
            type: 'random',
            startValue: 5,
            maxStepSize: 0.5,
            min: 0,
            max: 10,
            pointsPerCycle: 3,
            intervalMs: 100,
          },
        }),
        createTestRunConfig({ repeatMode: 'count', repeatCount: 2 }),
        session
      );

      await controller.start();

      // Execute cycle 1 (3 steps)
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);

      // Execute cycle 2 (3 steps)
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);

      expect(controller.getState().executionState).toBe('completed');
      expect(callValues).toHaveLength(6);

      // The first step of cycle 2 (index 3) should be within maxStepSize of
      // the last step of cycle 1 (index 2) - proving continuity
      const lastOfCycle1 = callValues[2];
      const firstOfCycle2 = callValues[3];
      const diff = Math.abs(firstOfCycle2 - lastOfCycle1);
      expect(diff).toBeLessThanOrEqual(0.5);
    });

    it('should use startValue for first cycle only', async () => {
      session = createMockSession();
      const callValues: number[] = [];
      vi.spyOn(session, 'setValue').mockImplementation(async (name, value) => {
        callValues.push(value as number);
        return Ok();
      });

      controller = createSequenceController(
        createTestDefinition({
          waveform: {
            type: 'random',
            startValue: 5,
            maxStepSize: 0.1,
            min: 0,
            max: 10,
            pointsPerCycle: 2,
            intervalMs: 100,
          },
        }),
        createTestRunConfig({ repeatMode: 'count', repeatCount: 2 }),
        session
      );

      await controller.start();

      // First step should be within maxStepSize of startValue (5)
      expect(Math.abs(callValues[0] - 5)).toBeLessThanOrEqual(0.1);

      // Complete both cycles
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);

      expect(callValues).toHaveLength(4);
    });
  });
});
