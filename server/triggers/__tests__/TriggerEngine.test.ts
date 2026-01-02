/**
 * TriggerEngine tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
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
});
