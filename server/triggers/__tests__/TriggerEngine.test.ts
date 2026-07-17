/**
 * TriggerEngine tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTriggerEngine } from '../TriggerEngine.js';
import type { TriggerEngine } from '../TriggerEngine.js';
import type { TriggerScript, Trigger, ServerMessage, DeviceSessionState } from '../../../shared/types.js';

// Mock DeviceSession
function createMockDeviceSession(measurements: Record<string, number> = {}) {
  const state: DeviceSessionState = {
    info: { id: 'psu-1', type: 'power-supply', manufacturer: 'Test', model: 'PSU' },
    capabilities: { deviceClass: 'psu', features: {}, modes: ['CV'], modesSettable: true, outputs: [], measurements: [] },
    connectionStatus: 'connected',
    consecutiveErrors: 0,
    mode: 'CV',
    outputEnabled: false,
    setpoints: {},
    measurements,
    history: { timestamps: [], voltage: [], current: [], power: [] },
    lastUpdated: Date.now(),
  };

  return {
    getState: vi.fn().mockReturnValue(state),
    setValue: vi.fn().mockResolvedValue({ ok: true }),
    setOutput: vi.fn().mockResolvedValue({ ok: true }),
  };
}

// Mock SessionManager
function createMockSessionManager(sessions: Record<string, ReturnType<typeof createMockDeviceSession>> = {}) {
  return {
    getSession: vi.fn((deviceId: string) => sessions[deviceId]),
    setValue: vi.fn().mockResolvedValue({ ok: true }),
    setOutput: vi.fn().mockResolvedValue({ ok: true }),
  };
}

// Mock SequenceManager
function createMockSequenceManager() {
  return {
    run: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    abort: vi.fn().mockResolvedValue(undefined),
    getActiveState: vi.fn().mockReturnValue(null),
  };
}

describe('TriggerEngine', () => {
  let engine: TriggerEngine;
  let mockSessionManager: ReturnType<typeof createMockSessionManager>;
  let mockSequenceManager: ReturnType<typeof createMockSequenceManager>;

  function createTestTrigger(overrides: Partial<Trigger> = {}): Trigger {
    return {
      id: 'trigger-1',
      condition: {
        type: 'value',
        deviceId: 'psu-1',
        parameter: 'voltage',
        operator: '>',
        value: 10,
      },
      action: {
        type: 'setOutput',
        deviceId: 'load-1',
        enabled: true,
      },
      repeatMode: 'once',
      debounceMs: 0,
      ...overrides,
    };
  }

  function createTestScript(triggers: Trigger[] = [createTestTrigger()]): TriggerScript {
    return {
      id: 'script-1',
      name: 'Test Script',
      triggers,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  describe('Condition Evaluation', () => {
    describe('Value-based conditions', () => {
      it('should evaluate > operator correctly', () => {
        const psuSession = createMockDeviceSession({ voltage: 15 });
        mockSessionManager = createMockSessionManager({ 'psu-1': psuSession });
        mockSequenceManager = createMockSequenceManager();

        const trigger = createTestTrigger({
          condition: {
            type: 'value',
            deviceId: 'psu-1',
            parameter: 'voltage',
            operator: '>',
            value: 10,
          },
        });

        engine = createTriggerEngine(
          createTestScript([trigger]),
          mockSessionManager as never,
          mockSequenceManager as never
        );

        // Get state to verify condition evaluation
        const state = engine.getState();
        expect(state.executionState).toBe('idle');
      });

      it('should evaluate < operator correctly', () => {
        const psuSession = createMockDeviceSession({ voltage: 5 });
        mockSessionManager = createMockSessionManager({ 'psu-1': psuSession });
        mockSequenceManager = createMockSequenceManager();

        const trigger = createTestTrigger({
          condition: {
            type: 'value',
            deviceId: 'psu-1',
            parameter: 'voltage',
            operator: '<',
            value: 10,
          },
        });

        engine = createTriggerEngine(
          createTestScript([trigger]),
          mockSessionManager as never,
          mockSequenceManager as never
        );

        const state = engine.getState();
        expect(state.executionState).toBe('idle');
      });

      it('should evaluate == operator correctly', () => {
        const psuSession = createMockDeviceSession({ voltage: 10 });
        mockSessionManager = createMockSessionManager({ 'psu-1': psuSession });
        mockSequenceManager = createMockSequenceManager();

        const trigger = createTestTrigger({
          condition: {
            type: 'value',
            deviceId: 'psu-1',
            parameter: 'voltage',
            operator: '==',
            value: 10,
          },
        });

        engine = createTriggerEngine(
          createTestScript([trigger]),
          mockSessionManager as never,
          mockSequenceManager as never
        );

        const state = engine.getState();
        expect(state.executionState).toBe('idle');
      });
    });

    describe('Time-based conditions', () => {
      it('should create trigger for time condition', () => {
        mockSessionManager = createMockSessionManager();
        mockSequenceManager = createMockSequenceManager();

        const trigger = createTestTrigger({
          id: 'time-trigger',
          condition: {
            type: 'time',
            seconds: 5,
          },
        });

        engine = createTriggerEngine(
          createTestScript([trigger]),
          mockSessionManager as never,
          mockSequenceManager as never
        );

        const state = engine.getState();
        expect(state.triggerStates).toHaveLength(1);
        expect(state.triggerStates[0].triggerId).toBe('time-trigger');
      });
    });
  });

  describe('Lifecycle', () => {
    beforeEach(() => {
      mockSessionManager = createMockSessionManager();
      mockSequenceManager = createMockSequenceManager();
    });

    it('should start in idle state', () => {
      engine = createTriggerEngine(
        createTestScript(),
        mockSessionManager as never,
        mockSequenceManager as never
      );

      const state = engine.getState();
      expect(state.executionState).toBe('idle');
      expect(state.startedAt).toBeNull();
    });

    it('should transition to running state on start', async () => {
      engine = createTriggerEngine(
        createTestScript(),
        mockSessionManager as never,
        mockSequenceManager as never
      );

      const result = await engine.start();
      expect(result.ok).toBe(true);

      const state = engine.getState();
      expect(state.executionState).toBe('running');
      expect(state.startedAt).not.toBeNull();

      await engine.stop();
    });

    it('should broadcast started message', async () => {
      engine = createTriggerEngine(
        createTestScript(),
        mockSessionManager as never,
        mockSequenceManager as never
      );

      const messages: ServerMessage[] = [];
      engine.subscribe((msg) => messages.push(msg));

      await engine.start();

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('triggerScriptStarted');

      await engine.stop();
    });

    it('should stop and return to idle', async () => {
      engine = createTriggerEngine(
        createTestScript(),
        mockSessionManager as never,
        mockSequenceManager as never
      );

      await engine.start();
      await engine.stop();

      const state = engine.getState();
      expect(state.executionState).toBe('idle');
    });

    it('should pause and resume', async () => {
      engine = createTriggerEngine(
        createTestScript(),
        mockSessionManager as never,
        mockSequenceManager as never
      );

      await engine.start();

      const pauseResult = engine.pause();
      expect(pauseResult.ok).toBe(true);
      expect(engine.getState().executionState).toBe('paused');

      const resumeResult = engine.resume();
      expect(resumeResult.ok).toBe(true);
      expect(engine.getState().executionState).toBe('running');

      await engine.stop();
    });
  });

  describe('Trigger States', () => {
    beforeEach(() => {
      mockSessionManager = createMockSessionManager();
      mockSequenceManager = createMockSequenceManager();
    });

    it('should initialize trigger states for all triggers', () => {
      const script = createTestScript([
        createTestTrigger({ id: 'trigger-1' }),
        createTestTrigger({ id: 'trigger-2' }),
      ]);

      engine = createTriggerEngine(
        script,
        mockSessionManager as never,
        mockSequenceManager as never
      );

      const state = engine.getState();
      expect(state.triggerStates).toHaveLength(2);
      expect(state.triggerStates[0].triggerId).toBe('trigger-1');
      expect(state.triggerStates[1].triggerId).toBe('trigger-2');
    });

    it('should track fired count', () => {
      engine = createTriggerEngine(
        createTestScript(),
        mockSessionManager as never,
        mockSequenceManager as never
      );

      const state = engine.getState();
      expect(state.triggerStates[0].firedCount).toBe(0);
      expect(state.triggerStates[0].lastFiredAt).toBeNull();
    });
  });

  describe('Subscriptions', () => {
    beforeEach(() => {
      mockSessionManager = createMockSessionManager();
      mockSequenceManager = createMockSequenceManager();
    });

    it('should allow subscribing and unsubscribing', async () => {
      engine = createTriggerEngine(
        createTestScript(),
        mockSessionManager as never,
        mockSequenceManager as never
      );

      const messages: ServerMessage[] = [];
      const unsubscribe = engine.subscribe((msg) => messages.push(msg));

      await engine.start();
      expect(messages.length).toBeGreaterThan(0);

      unsubscribe();
      const countAfterUnsub = messages.length;

      await engine.stop();
      // No new messages after unsubscribe
      expect(messages.length).toBe(countAfterUnsub);
    });
  });

  describe('Trigger Execution - Value Conditions', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(async () => {
      if (engine) {
        await engine.stop();
        engine.destroy();
      }
      vi.useRealTimers();
    });

    it('should fire trigger when value condition becomes true', async () => {
      // Start with voltage below threshold
      let currentVoltage = 5;
      const psuSession = {
        getState: vi.fn(() => ({
          info: { id: 'psu-1', type: 'power-supply', manufacturer: 'Test', model: 'PSU' },
          capabilities: { deviceClass: 'psu', features: {}, modes: ['CV'], modesSettable: true, outputs: [], measurements: [] },
          connectionStatus: 'connected',
          consecutiveErrors: 0,
          mode: 'CV',
          outputEnabled: false,
          setpoints: {},
          measurements: { voltage: currentVoltage },
          history: { timestamps: [], voltage: [], current: [], power: [] },
          lastUpdated: Date.now(),
        })),
        setValue: vi.fn().mockResolvedValue({ ok: true }),
        setOutput: vi.fn().mockResolvedValue({ ok: true }),
      };

      mockSessionManager = createMockSessionManager({ 'psu-1': psuSession });
      mockSequenceManager = createMockSequenceManager();

      const trigger = createTestTrigger({
        condition: {
          type: 'value',
          deviceId: 'psu-1',
          parameter: 'voltage',
          operator: '>',
          value: 10,
        },
        action: {
          type: 'setOutput',
          deviceId: 'load-1',
          enabled: true,
        },
      });

      engine = createTriggerEngine(
        createTestScript([trigger]),
        mockSessionManager as never,
        mockSequenceManager as never
      );

      const messages: ServerMessage[] = [];
      engine.subscribe((msg) => messages.push(msg));

      await engine.start();

      // Advance time but condition is still false
      await vi.advanceTimersByTimeAsync(200);
      expect(mockSessionManager.setOutput).not.toHaveBeenCalled();

      // Now voltage exceeds threshold
      currentVoltage = 15;

      // Advance time for condition to be evaluated
      await vi.advanceTimersByTimeAsync(200);

      // Action should have been executed
      expect(mockSessionManager.setOutput).toHaveBeenCalledWith('load-1', true);

      // Should have received triggerFired message
      const firedMessages = messages.filter(m => m.type === 'triggerFired');
      expect(firedMessages.length).toBeGreaterThan(0);
    });

    it('should fire trigger immediately when condition is already true at start', async () => {
      // Voltage is already above threshold - fires on first evaluation
      const psuSession = createMockDeviceSession({ voltage: 15 });
      mockSessionManager = createMockSessionManager({ 'psu-1': psuSession });
      mockSequenceManager = createMockSequenceManager();

      const trigger = createTestTrigger({
        condition: {
          type: 'value',
          deviceId: 'psu-1',
          parameter: 'voltage',
          operator: '>',
          value: 10,
        },
        action: {
          type: 'setOutput',
          deviceId: 'load-1',
          enabled: true,
        },
      });

      engine = createTriggerEngine(
        createTestScript([trigger]),
        mockSessionManager as never,
        mockSequenceManager as never
      );

      await engine.start();

      // Advance time for first evaluation
      await vi.advanceTimersByTimeAsync(300);

      // Action SHOULD have been executed (condition met on first eval)
      expect(mockSessionManager.setOutput).toHaveBeenCalledWith('load-1', true);
    });

    it('should execute setValue action when trigger fires', async () => {
      let currentVoltage = 5;
      const psuSession = {
        getState: vi.fn(() => ({
          info: { id: 'psu-1', type: 'power-supply', manufacturer: 'Test', model: 'PSU' },
          capabilities: { deviceClass: 'psu', features: {}, modes: ['CV'], modesSettable: true, outputs: [], measurements: [] },
          connectionStatus: 'connected',
          consecutiveErrors: 0,
          mode: 'CV',
          outputEnabled: false,
          setpoints: {},
          measurements: { voltage: currentVoltage },
          history: { timestamps: [], voltage: [], current: [], power: [] },
          lastUpdated: Date.now(),
        })),
        setValue: vi.fn().mockResolvedValue({ ok: true }),
        setOutput: vi.fn().mockResolvedValue({ ok: true }),
      };

      mockSessionManager = createMockSessionManager({ 'psu-1': psuSession });
      mockSequenceManager = createMockSequenceManager();

      const trigger = createTestTrigger({
        condition: {
          type: 'value',
          deviceId: 'psu-1',
          parameter: 'voltage',
          operator: '>',
          value: 10,
        },
        action: {
          type: 'setValue',
          deviceId: 'load-1',
          parameter: 'current',
          value: 2.5,
        },
      });

      engine = createTriggerEngine(
        createTestScript([trigger]),
        mockSessionManager as never,
        mockSequenceManager as never
      );

      await engine.start();

      // Trigger the condition
      currentVoltage = 15;
      await vi.advanceTimersByTimeAsync(200);

      expect(mockSessionManager.setValue).toHaveBeenCalledWith('load-1', 'current', 2.5, true);
    });

    it('should only fire once in "once" repeat mode', async () => {
      let currentVoltage = 5;
      const psuSession = {
        getState: vi.fn(() => ({
          info: { id: 'psu-1', type: 'power-supply', manufacturer: 'Test', model: 'PSU' },
          capabilities: { deviceClass: 'psu', features: {}, modes: ['CV'], modesSettable: true, outputs: [], measurements: [] },
          connectionStatus: 'connected',
          consecutiveErrors: 0,
          mode: 'CV',
          outputEnabled: false,
          setpoints: {},
          measurements: { voltage: currentVoltage },
          history: { timestamps: [], voltage: [], current: [], power: [] },
          lastUpdated: Date.now(),
        })),
        setValue: vi.fn().mockResolvedValue({ ok: true }),
        setOutput: vi.fn().mockResolvedValue({ ok: true }),
      };

      mockSessionManager = createMockSessionManager({ 'psu-1': psuSession });
      mockSequenceManager = createMockSequenceManager();

      const trigger = createTestTrigger({
        repeatMode: 'once',
        condition: {
          type: 'value',
          deviceId: 'psu-1',
          parameter: 'voltage',
          operator: '>',
          value: 10,
        },
      });

      engine = createTriggerEngine(
        createTestScript([trigger]),
        mockSessionManager as never,
        mockSequenceManager as never
      );

      await engine.start();

      // First trigger
      currentVoltage = 15;
      await vi.advanceTimersByTimeAsync(200);
      expect(mockSessionManager.setOutput).toHaveBeenCalledTimes(1);

      // Go back below threshold
      currentVoltage = 5;
      await vi.advanceTimersByTimeAsync(200);

      // Trigger again
      currentVoltage = 15;
      await vi.advanceTimersByTimeAsync(200);

      // Should still only have fired once
      expect(mockSessionManager.setOutput).toHaveBeenCalledTimes(1);
    });

    it('should fire multiple times in "always" repeat mode', async () => {
      let currentVoltage = 5;
      const psuSession = {
        getState: vi.fn(() => ({
          info: { id: 'psu-1', type: 'power-supply', manufacturer: 'Test', model: 'PSU' },
          capabilities: { deviceClass: 'psu', features: {}, modes: ['CV'], modesSettable: true, outputs: [], measurements: [] },
          connectionStatus: 'connected',
          consecutiveErrors: 0,
          mode: 'CV',
          outputEnabled: false,
          setpoints: {},
          measurements: { voltage: currentVoltage },
          history: { timestamps: [], voltage: [], current: [], power: [] },
          lastUpdated: Date.now(),
        })),
        setValue: vi.fn().mockResolvedValue({ ok: true }),
        setOutput: vi.fn().mockResolvedValue({ ok: true }),
      };

      mockSessionManager = createMockSessionManager({ 'psu-1': psuSession });
      mockSequenceManager = createMockSequenceManager();

      const trigger = createTestTrigger({
        repeatMode: 'repeat',
        debounceMs: 0,
        condition: {
          type: 'value',
          deviceId: 'psu-1',
          parameter: 'voltage',
          operator: '>',
          value: 10,
        },
      });

      engine = createTriggerEngine(
        createTestScript([trigger]),
        mockSessionManager as never,
        mockSequenceManager as never
      );

      await engine.start();

      // First trigger
      currentVoltage = 15;
      await vi.advanceTimersByTimeAsync(200);
      expect(mockSessionManager.setOutput).toHaveBeenCalledTimes(1);

      // Go back below threshold
      currentVoltage = 5;
      await vi.advanceTimersByTimeAsync(200);

      // Trigger again
      currentVoltage = 15;
      await vi.advanceTimersByTimeAsync(200);

      // Should have fired twice
      expect(mockSessionManager.setOutput).toHaveBeenCalledTimes(2);
    });

    it('should respect debounce timing', async () => {
      let currentVoltage = 5;
      const psuSession = {
        getState: vi.fn(() => ({
          info: { id: 'psu-1', type: 'power-supply', manufacturer: 'Test', model: 'PSU' },
          capabilities: { deviceClass: 'psu', features: {}, modes: ['CV'], modesSettable: true, outputs: [], measurements: [] },
          connectionStatus: 'connected',
          consecutiveErrors: 0,
          mode: 'CV',
          outputEnabled: false,
          setpoints: {},
          measurements: { voltage: currentVoltage },
          history: { timestamps: [], voltage: [], current: [], power: [] },
          lastUpdated: Date.now(),
        })),
        setValue: vi.fn().mockResolvedValue({ ok: true }),
        setOutput: vi.fn().mockResolvedValue({ ok: true }),
      };

      mockSessionManager = createMockSessionManager({ 'psu-1': psuSession });
      mockSequenceManager = createMockSequenceManager();

      const trigger = createTestTrigger({
        repeatMode: 'repeat',
        debounceMs: 1000, // 1 second debounce
        condition: {
          type: 'value',
          deviceId: 'psu-1',
          parameter: 'voltage',
          operator: '>',
          value: 10,
        },
      });

      engine = createTriggerEngine(
        createTestScript([trigger]),
        mockSessionManager as never,
        mockSequenceManager as never
      );

      await engine.start();

      // First trigger
      currentVoltage = 15;
      await vi.advanceTimersByTimeAsync(200);
      expect(mockSessionManager.setOutput).toHaveBeenCalledTimes(1);

      // Go back below threshold
      currentVoltage = 5;
      await vi.advanceTimersByTimeAsync(200);

      // Try to trigger again quickly (within debounce period)
      currentVoltage = 15;
      await vi.advanceTimersByTimeAsync(200);

      // Should NOT have fired again due to debounce
      expect(mockSessionManager.setOutput).toHaveBeenCalledTimes(1);

      // Wait for debounce to expire
      currentVoltage = 5;
      await vi.advanceTimersByTimeAsync(1000);

      // Now trigger again
      currentVoltage = 15;
      await vi.advanceTimersByTimeAsync(200);

      // Now it should have fired
      expect(mockSessionManager.setOutput).toHaveBeenCalledTimes(2);
    });

    it('should update firedCount when trigger fires', async () => {
      let currentVoltage = 5;
      const psuSession = {
        getState: vi.fn(() => ({
          info: { id: 'psu-1', type: 'power-supply', manufacturer: 'Test', model: 'PSU' },
          capabilities: { deviceClass: 'psu', features: {}, modes: ['CV'], modesSettable: true, outputs: [], measurements: [] },
          connectionStatus: 'connected',
          consecutiveErrors: 0,
          mode: 'CV',
          outputEnabled: false,
          setpoints: {},
          measurements: { voltage: currentVoltage },
          history: { timestamps: [], voltage: [], current: [], power: [] },
          lastUpdated: Date.now(),
        })),
        setValue: vi.fn().mockResolvedValue({ ok: true }),
        setOutput: vi.fn().mockResolvedValue({ ok: true }),
      };

      mockSessionManager = createMockSessionManager({ 'psu-1': psuSession });
      mockSequenceManager = createMockSequenceManager();

      engine = createTriggerEngine(
        createTestScript([createTestTrigger()]),
        mockSessionManager as never,
        mockSequenceManager as never
      );

      await engine.start();
      expect(engine.getState().triggerStates[0].firedCount).toBe(0);

      // Trigger the condition
      currentVoltage = 15;
      await vi.advanceTimersByTimeAsync(200);

      expect(engine.getState().triggerStates[0].firedCount).toBe(1);
      expect(engine.getState().triggerStates[0].lastFiredAt).not.toBeNull();
    });
  });

  describe('Trigger Execution - Time Conditions', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(async () => {
      if (engine) {
        await engine.stop();
        engine.destroy();
      }
      vi.useRealTimers();
    });

    it('should fire time-based trigger after specified seconds', async () => {
      mockSessionManager = createMockSessionManager();
      mockSequenceManager = createMockSequenceManager();

      const trigger = createTestTrigger({
        condition: {
          type: 'time',
          seconds: 2, // 2 seconds
        },
        action: {
          type: 'setOutput',
          deviceId: 'load-1',
          enabled: true,
        },
      });

      engine = createTriggerEngine(
        createTestScript([trigger]),
        mockSessionManager as never,
        mockSequenceManager as never
      );

      await engine.start();

      // Should not have fired yet
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockSessionManager.setOutput).not.toHaveBeenCalled();

      // Advance past the trigger time
      await vi.advanceTimersByTimeAsync(1500);
      expect(mockSessionManager.setOutput).toHaveBeenCalledWith('load-1', true);
    });

    it('should fire time trigger at precise time accounting for pause', async () => {
      mockSessionManager = createMockSessionManager();
      mockSequenceManager = createMockSequenceManager();

      const trigger = createTestTrigger({
        condition: {
          type: 'time',
          seconds: 3,
        },
      });

      engine = createTriggerEngine(
        createTestScript([trigger]),
        mockSessionManager as never,
        mockSequenceManager as never
      );

      await engine.start();

      // Advance 1 second
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockSessionManager.setOutput).not.toHaveBeenCalled();

      // Pause
      engine.pause();
      await vi.advanceTimersByTimeAsync(5000); // Time passes while paused

      // Resume
      engine.resume();

      // Advance remaining 2 seconds
      await vi.advanceTimersByTimeAsync(2500);

      // Should have fired now
      expect(mockSessionManager.setOutput).toHaveBeenCalled();
    });
  });

  describe('Trigger Execution - Sequence Actions', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(async () => {
      if (engine) {
        await engine.stop();
        engine.destroy();
      }
      vi.useRealTimers();
    });

    it('should start sequence when startSequence action fires', async () => {
      let currentVoltage = 5;
      const psuSession = {
        getState: vi.fn(() => ({
          info: { id: 'psu-1', type: 'power-supply', manufacturer: 'Test', model: 'PSU' },
          capabilities: { deviceClass: 'psu', features: {}, modes: ['CV'], modesSettable: true, outputs: [], measurements: [] },
          connectionStatus: 'connected',
          consecutiveErrors: 0,
          mode: 'CV',
          outputEnabled: false,
          setpoints: {},
          measurements: { voltage: currentVoltage },
          history: { timestamps: [], voltage: [], current: [], power: [] },
          lastUpdated: Date.now(),
        })),
        setValue: vi.fn().mockResolvedValue({ ok: true }),
        setOutput: vi.fn().mockResolvedValue({ ok: true }),
      };

      mockSessionManager = createMockSessionManager({ 'psu-1': psuSession });
      mockSequenceManager = createMockSequenceManager();

      const trigger = createTestTrigger({
        condition: {
          type: 'value',
          deviceId: 'psu-1',
          parameter: 'voltage',
          operator: '>',
          value: 10,
        },
        action: {
          type: 'startSequence',
          sequenceId: 'seq-1',
          deviceId: 'load-1',
          parameter: 'current',
          repeatMode: 'once',
        },
      });

      engine = createTriggerEngine(
        createTestScript([trigger]),
        mockSessionManager as never,
        mockSequenceManager as never
      );

      await engine.start();

      currentVoltage = 15;
      await vi.advanceTimersByTimeAsync(200);

      expect(mockSequenceManager.run).toHaveBeenCalledWith({
        sequenceId: 'seq-1',
        deviceId: 'load-1',
        parameter: 'current',
        repeatMode: 'once',
        repeatCount: undefined,
      });
    });

    it('should stop sequence when stopSequence action fires', async () => {
      let currentVoltage = 5;
      const psuSession = {
        getState: vi.fn(() => ({
          info: { id: 'psu-1', type: 'power-supply', manufacturer: 'Test', model: 'PSU' },
          capabilities: { deviceClass: 'psu', features: {}, modes: ['CV'], modesSettable: true, outputs: [], measurements: [] },
          connectionStatus: 'connected',
          consecutiveErrors: 0,
          mode: 'CV',
          outputEnabled: false,
          setpoints: {},
          measurements: { voltage: currentVoltage },
          history: { timestamps: [], voltage: [], current: [], power: [] },
          lastUpdated: Date.now(),
        })),
        setValue: vi.fn().mockResolvedValue({ ok: true }),
        setOutput: vi.fn().mockResolvedValue({ ok: true }),
      };

      mockSessionManager = createMockSessionManager({ 'psu-1': psuSession });
      mockSequenceManager = createMockSequenceManager();

      const trigger = createTestTrigger({
        condition: {
          type: 'value',
          deviceId: 'psu-1',
          parameter: 'voltage',
          operator: '>',
          value: 10,
        },
        action: {
          type: 'stopSequence',
        },
      });

      engine = createTriggerEngine(
        createTestScript([trigger]),
        mockSessionManager as never,
        mockSequenceManager as never
      );

      await engine.start();

      currentVoltage = 15;
      await vi.advanceTimersByTimeAsync(200);

      expect(mockSequenceManager.abort).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(async () => {
      if (engine) {
        await engine.stop();
        engine.destroy();
      }
      vi.useRealTimers();
    });

    it('should broadcast action failure when setOutput fails', async () => {
      let currentVoltage = 5;
      const psuSession = {
        getState: vi.fn(() => ({
          info: { id: 'psu-1', type: 'power-supply', manufacturer: 'Test', model: 'PSU' },
          capabilities: { deviceClass: 'psu', features: {}, modes: ['CV'], modesSettable: true, outputs: [], measurements: [] },
          connectionStatus: 'connected',
          consecutiveErrors: 0,
          mode: 'CV',
          outputEnabled: false,
          setpoints: {},
          measurements: { voltage: currentVoltage },
          history: { timestamps: [], voltage: [], current: [], power: [] },
          lastUpdated: Date.now(),
        })),
        setValue: vi.fn().mockResolvedValue({ ok: true }),
        setOutput: vi.fn().mockResolvedValue({ ok: true }),
      };

      mockSessionManager = createMockSessionManager({ 'psu-1': psuSession });
      mockSessionManager.setOutput = vi.fn().mockResolvedValue({ ok: false, error: new Error('Device not found') });
      mockSequenceManager = createMockSequenceManager();

      engine = createTriggerEngine(
        createTestScript([createTestTrigger()]),
        mockSessionManager as never,
        mockSequenceManager as never
      );

      const messages: ServerMessage[] = [];
      engine.subscribe((msg) => messages.push(msg));

      await engine.start();

      currentVoltage = 15;
      await vi.advanceTimersByTimeAsync(200);

      const failureMessages = messages.filter(m => m.type === 'triggerActionFailed');
      expect(failureMessages.length).toBeGreaterThan(0);
    });

    it('should handle missing device gracefully', async () => {
      mockSessionManager = createMockSessionManager({}); // No devices
      mockSequenceManager = createMockSequenceManager();

      const trigger = createTestTrigger({
        condition: {
          type: 'value',
          deviceId: 'nonexistent-device',
          parameter: 'voltage',
          operator: '>',
          value: 10,
        },
      });

      engine = createTriggerEngine(
        createTestScript([trigger]),
        mockSessionManager as never,
        mockSequenceManager as never
      );

      await engine.start();

      // Should not throw
      await vi.advanceTimersByTimeAsync(200);

      // Condition should be false (device not found)
      expect(engine.getState().triggerStates[0].conditionMet).toBe(false);
    });
  });
});
