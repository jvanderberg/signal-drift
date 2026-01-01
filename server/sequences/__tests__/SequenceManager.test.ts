import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSequenceManager, SequenceManager } from '../SequenceManager.js';
import type { SessionManager } from '../../sessions/SessionManager.js';
import type { DeviceSession } from '../../sessions/DeviceSession.js';
import type {
  SequenceDefinition,
  SequenceRunConfig,
  DeviceSessionState,
  ServerMessage,
  Result,
} from '../../../shared/types.js';
import { Ok } from '../../../shared/types.js';

// Mock the SequenceStore module
vi.mock('../SequenceStore.js', () => ({
  createSequenceStore: () => ({
    load: vi.fn().mockResolvedValue(Ok([])),
    save: vi.fn().mockResolvedValue(Ok()),
    getStoragePath: vi.fn().mockReturnValue('/mock/path/sequences.json'),
  }),
}));

// Helper to unwrap Result in tests (throws on error, which fails the test)
function unwrapResult<T>(result: Result<T, Error>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

// Create mock device session state
function createMockSessionState(): DeviceSessionState {
  return {
    info: {
      id: 'test-device',
      type: 'power-supply',
      manufacturer: 'Test',
      model: 'PSU-100',
    },
    capabilities: {
      deviceClass: 'psu',
      features: {},
      modes: ['CV'],
      modesSettable: false,
      outputs: [
        { name: 'voltage', unit: 'V', min: 0, max: 30, decimals: 3 },
        { name: 'current', unit: 'A', min: 0, max: 10, decimals: 3 },
      ],
      measurements: [],
    },
    connectionStatus: 'connected',
    consecutiveErrors: 0,
    mode: 'CV',
    outputEnabled: true,
    setpoints: { voltage: 5, current: 1 },
    measurements: { voltage: 5, current: 0.5, power: 2.5 },
    history: { timestamps: [], voltage: [], current: [], power: [] },
    lastUpdated: Date.now(),
  };
}

// Create mock device session
function createMockSession(): DeviceSession {
  return {
    getState: vi.fn(() => createMockSessionState()),
    getSubscriberCount: vi.fn(() => 0),
    hasSubscriber: vi.fn(() => false),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    setMode: vi.fn(),
    setOutput: vi.fn(),
    setValue: vi.fn().mockResolvedValue(Ok()),
    reconnect: vi.fn(),
    stop: vi.fn(),
  };
}

// Create mock session manager
function createMockSessionManager(session?: DeviceSession): SessionManager {
  const mockSession = session ?? createMockSession();
  return {
    syncDevices: vi.fn(),
    getSessionCount: vi.fn(() => 1),
    getSession: vi.fn((deviceId: string) => (deviceId === 'test-device' ? mockSession : undefined)),
    stop: vi.fn(),
  } as unknown as SessionManager;
}

describe('SequenceManager', () => {
  let manager: SequenceManager;
  let sessionManager: SessionManager;
  let mockSession: DeviceSession;

  beforeEach(() => {
    vi.useFakeTimers();
    mockSession = createMockSession();
    sessionManager = createMockSessionManager(mockSession);
    manager = createSequenceManager(sessionManager);
  });

  afterEach(() => {
    manager.stop();
    vi.useRealTimers();
  });

  describe('Library CRUD', () => {
    it('should start with empty library', () => {
      expect(manager.listLibrary()).toEqual([]);
    });

    it('should save a sequence to library', () => {
      const result = manager.saveToLibrary({
        name: 'Test Sequence',
        unit: 'V',
        waveform: { type: 'ramp', min: 0, max: 10, pointsPerCycle: 5, intervalMs: 100 },
      });

      expect(result.ok).toBe(true);
      const id = unwrapResult(result);
      expect(id).toMatch(/^seq-/);
      const library = manager.listLibrary();
      expect(library).toHaveLength(1);
      expect(library[0].name).toBe('Test Sequence');
      expect(library[0].unit).toBe('V');
    });

    it('should get sequence from library by id', () => {
      const id = unwrapResult(manager.saveToLibrary({
        name: 'Lookup Test',
        unit: 'A',
        waveform: { type: 'sine', min: 0, max: 5, pointsPerCycle: 10, intervalMs: 50 },
      }));

      const seq = manager.getFromLibrary(id);
      expect(seq).toBeDefined();
      expect(seq?.name).toBe('Lookup Test');
    });

    it('should return undefined for non-existent sequence', () => {
      expect(manager.getFromLibrary('non-existent')).toBeUndefined();
    });

    it('should update sequence in library', () => {
      const id = unwrapResult(manager.saveToLibrary({
        name: 'Original',
        unit: 'V',
        waveform: { type: 'ramp', min: 0, max: 5, pointsPerCycle: 5, intervalMs: 100 },
      }));

      const original = manager.getFromLibrary(id)!;
      const result = manager.updateInLibrary({
        ...original,
        name: 'Updated',
      });

      expect(result.ok).toBe(true);
      expect(manager.getFromLibrary(id)?.name).toBe('Updated');
    });

    it('should fail to update non-existent sequence', () => {
      const result = manager.updateInLibrary({
        id: 'non-existent',
        name: 'Test',
        unit: 'V',
        waveform: { type: 'ramp', min: 0, max: 5, pointsPerCycle: 5, intervalMs: 100 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('not found');
      }
    });

    it('should delete sequence from library', () => {
      const id = unwrapResult(manager.saveToLibrary({
        name: 'To Delete',
        unit: 'V',
        waveform: { type: 'ramp', min: 0, max: 5, pointsPerCycle: 5, intervalMs: 100 },
      }));

      expect(manager.listLibrary()).toHaveLength(1);
      const result = manager.deleteFromLibrary(id);
      expect(result.ok).toBe(true);
      expect(manager.listLibrary()).toHaveLength(0);
    });

    it('should fail to delete non-existent sequence', () => {
      const result = manager.deleteFromLibrary('non-existent');
      expect(result.ok).toBe(false);
    });

    it('should maintain multiple sequences in library', () => {
      unwrapResult(manager.saveToLibrary({
        name: 'Seq 1',
        unit: 'V',
        waveform: { type: 'ramp', min: 0, max: 5, pointsPerCycle: 5, intervalMs: 100 },
      }));
      unwrapResult(manager.saveToLibrary({
        name: 'Seq 2',
        unit: 'A',
        waveform: { type: 'sine', min: 0, max: 3, pointsPerCycle: 10, intervalMs: 50 },
      }));
      unwrapResult(manager.saveToLibrary({
        name: 'Seq 3',
        unit: 'V',
        waveform: { steps: [{ value: 1, dwellMs: 100 }, { value: 2, dwellMs: 100 }] },
      }));

      expect(manager.listLibrary()).toHaveLength(3);
    });
  });

  describe('Playback', () => {
    let sequenceId: string;

    beforeEach(() => {
      sequenceId = unwrapResult(manager.saveToLibrary({
        name: 'Test Ramp',
        unit: 'V',
        waveform: { type: 'ramp', min: 0, max: 10, pointsPerCycle: 5, intervalMs: 100 },
      }));
    });

    it('should run a sequence', async () => {
      const config: SequenceRunConfig = {
        sequenceId,
        deviceId: 'test-device',
        parameter: 'voltage',
        repeatMode: 'once',
      };

      const result = await manager.run(config);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.executionState).toBe('running');
        expect(result.value.sequenceId).toBe(sequenceId);
      }
    });

    it('should fail to run with non-existent sequence', async () => {
      const config: SequenceRunConfig = {
        sequenceId: 'non-existent',
        deviceId: 'test-device',
        parameter: 'voltage',
        repeatMode: 'once',
      };

      const result = await manager.run(config);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('not found');
      }
    });

    it('should fail to run with non-existent device', async () => {
      const config: SequenceRunConfig = {
        sequenceId,
        deviceId: 'unknown-device',
        parameter: 'voltage',
        repeatMode: 'once',
      };

      const result = await manager.run(config);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('session not found');
      }
    });

    it('should fail to run with non-existent parameter', async () => {
      const config: SequenceRunConfig = {
        sequenceId,
        deviceId: 'test-device',
        parameter: 'power', // Not in capabilities
        repeatMode: 'once',
      };

      const result = await manager.run(config);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Parameter not found');
      }
    });

    it('should fail to run with unit mismatch', async () => {
      const config: SequenceRunConfig = {
        sequenceId,
        deviceId: 'test-device',
        parameter: 'current', // Unit is 'A', sequence is 'V'
        repeatMode: 'once',
      };

      const result = await manager.run(config);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Unit mismatch');
      }
    });

    it('should track active state during playback', async () => {
      expect(manager.getActiveState()).toBeUndefined();

      const config: SequenceRunConfig = {
        sequenceId,
        deviceId: 'test-device',
        parameter: 'voltage',
        repeatMode: 'once',
      };

      await manager.run(config);
      expect(manager.getActiveState()).toBeDefined();
      expect(manager.getActiveState()?.executionState).toBe('running');
    });

    it('should abort running sequence', async () => {
      const config: SequenceRunConfig = {
        sequenceId,
        deviceId: 'test-device',
        parameter: 'voltage',
        repeatMode: 'once',
      };

      await manager.run(config);
      await manager.abort();

      // After abort, active state should be cleared
      // (controller cleanup happens after broadcast)
      expect(manager.getActiveState()).toBeUndefined();
    });

    it('should call setValue on device session', async () => {
      const config: SequenceRunConfig = {
        sequenceId,
        deviceId: 'test-device',
        parameter: 'voltage',
        repeatMode: 'once',
      };

      await manager.run(config);

      // First step should have been executed
      expect(mockSession.setValue).toHaveBeenCalled();
      expect(mockSession.setValue).toHaveBeenCalledWith('voltage', expect.any(Number), true);
    });

    it('should complete sequence after all steps', async () => {
      const receivedMessages: ServerMessage[] = [];
      manager.subscribe((msg) => receivedMessages.push(msg));

      const config: SequenceRunConfig = {
        sequenceId,
        deviceId: 'test-device',
        parameter: 'voltage',
        repeatMode: 'once',
      };

      await manager.run(config);

      // Advance through all steps (5 steps * 100ms each)
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(100);
      }

      // Check for completion message
      const completedMsg = receivedMessages.find((m) => m.type === 'sequenceCompleted');
      expect(completedMsg).toBeDefined();
    });
  });

  describe('Subscriptions', () => {
    it('should broadcast to subscribers', async () => {
      const receivedMessages: ServerMessage[] = [];
      const unsubscribe = manager.subscribe((msg) => receivedMessages.push(msg));

      const sequenceId = unwrapResult(manager.saveToLibrary({
        name: 'Broadcast Test',
        unit: 'V',
        waveform: { type: 'ramp', min: 0, max: 5, pointsPerCycle: 3, intervalMs: 50 },
      }));

      await manager.run({
        sequenceId,
        deviceId: 'test-device',
        parameter: 'voltage',
        repeatMode: 'once',
      });

      // Should have received sequenceStarted
      const startedMsg = receivedMessages.find((m) => m.type === 'sequenceStarted');
      expect(startedMsg).toBeDefined();

      unsubscribe();
    });

    it('should allow multiple subscribers', async () => {
      const messages1: ServerMessage[] = [];
      const messages2: ServerMessage[] = [];

      const unsub1 = manager.subscribe((msg) => messages1.push(msg));
      const unsub2 = manager.subscribe((msg) => messages2.push(msg));

      const sequenceId = unwrapResult(manager.saveToLibrary({
        name: 'Multi-Sub Test',
        unit: 'V',
        waveform: { steps: [{ value: 1, dwellMs: 100 }] },
      }));

      await manager.run({
        sequenceId,
        deviceId: 'test-device',
        parameter: 'voltage',
        repeatMode: 'once',
      });

      expect(messages1.length).toBeGreaterThan(0);
      expect(messages2.length).toBeGreaterThan(0);
      expect(messages1.length).toBe(messages2.length);

      unsub1();
      unsub2();
    });

    it('should stop broadcasting after unsubscribe', async () => {
      const messages: ServerMessage[] = [];
      const unsubscribe = manager.subscribe((msg) => messages.push(msg));

      const sequenceId = unwrapResult(manager.saveToLibrary({
        name: 'Unsub Test',
        unit: 'V',
        waveform: { type: 'ramp', min: 0, max: 5, pointsPerCycle: 3, intervalMs: 50 },
      }));

      unsubscribe(); // Unsubscribe before running

      await manager.run({
        sequenceId,
        deviceId: 'test-device',
        parameter: 'voltage',
        repeatMode: 'once',
      });

      // Should not have received any messages
      expect(messages).toHaveLength(0);
    });

    it('should handle subscriber errors gracefully', async () => {
      const goodMessages: ServerMessage[] = [];

      // Bad subscriber that throws
      manager.subscribe(() => {
        throw new Error('Subscriber error');
      });

      // Good subscriber
      manager.subscribe((msg) => goodMessages.push(msg));

      const sequenceId = unwrapResult(manager.saveToLibrary({
        name: 'Error Test',
        unit: 'V',
        waveform: { steps: [{ value: 1, dwellMs: 100 }] },
      }));

      // Should not throw despite bad subscriber
      await expect(
        manager.run({
          sequenceId,
          deviceId: 'test-device',
          parameter: 'voltage',
          repeatMode: 'once',
        })
      ).resolves.toBeDefined();

      // Good subscriber should still receive messages
      expect(goodMessages.length).toBeGreaterThan(0);
    });
  });

  describe('Repeat Modes', () => {
    let sequenceId: string;

    beforeEach(() => {
      sequenceId = unwrapResult(manager.saveToLibrary({
        name: 'Repeat Test',
        unit: 'V',
        waveform: { steps: [{ value: 1, dwellMs: 50 }, { value: 2, dwellMs: 50 }] },
      }));
    });

    it('should run once and complete', async () => {
      const messages: ServerMessage[] = [];
      manager.subscribe((msg) => messages.push(msg));

      await manager.run({
        sequenceId,
        deviceId: 'test-device',
        parameter: 'voltage',
        repeatMode: 'once',
      });

      // Advance through both steps
      await vi.advanceTimersByTimeAsync(50);
      await vi.advanceTimersByTimeAsync(50);

      const completed = messages.find((m) => m.type === 'sequenceCompleted');
      expect(completed).toBeDefined();
    });

    it('should run multiple times with count mode', async () => {
      const messages: ServerMessage[] = [];
      manager.subscribe((msg) => messages.push(msg));

      await manager.run({
        sequenceId,
        deviceId: 'test-device',
        parameter: 'voltage',
        repeatMode: 'count',
        repeatCount: 2,
      });

      // Advance through 2 complete cycles (2 steps * 2 cycles * 50ms)
      for (let i = 0; i < 4; i++) {
        await vi.advanceTimersByTimeAsync(50);
      }

      const completed = messages.find((m) => m.type === 'sequenceCompleted');
      expect(completed).toBeDefined();

      // Check progress messages show correct cycle count
      const progressMsgs = messages.filter((m) => m.type === 'sequenceProgress') as Array<{
        type: 'sequenceProgress';
        state: { currentCycle: number; totalCycles: number | null };
      }>;
      expect(progressMsgs.some((m) => m.state.totalCycles === 2)).toBe(true);
    });

    it('should run continuously until aborted', async () => {
      const messages: ServerMessage[] = [];
      manager.subscribe((msg) => messages.push(msg));

      await manager.run({
        sequenceId,
        deviceId: 'test-device',
        parameter: 'voltage',
        repeatMode: 'continuous',
      });

      // Advance through several cycles
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(50);
      }

      // Should still be running (no completed message)
      const completed = messages.find((m) => m.type === 'sequenceCompleted');
      expect(completed).toBeUndefined();

      // Abort
      await manager.abort();

      const aborted = messages.find((m) => m.type === 'sequenceAborted');
      expect(aborted).toBeDefined();
    });
  });

  describe('Modifiers', () => {
    it('should apply scale and offset to values', async () => {
      const sequenceId = unwrapResult(manager.saveToLibrary({
        name: 'Modified',
        unit: 'V',
        waveform: { steps: [{ value: 1, dwellMs: 100 }] },
        scale: 2,
        offset: 5,
      }));

      await manager.run({
        sequenceId,
        deviceId: 'test-device',
        parameter: 'voltage',
        repeatMode: 'once',
      });

      // Value should be 1 * 2 + 5 = 7
      expect(mockSession.setValue).toHaveBeenCalledWith('voltage', 7, true);
    });

    it('should apply maxClamp to values', async () => {
      const sequenceId = unwrapResult(manager.saveToLibrary({
        name: 'Clamped',
        unit: 'V',
        waveform: { steps: [{ value: 100, dwellMs: 100 }] },
        maxClamp: 25,
      }));

      await manager.run({
        sequenceId,
        deviceId: 'test-device',
        parameter: 'voltage',
        repeatMode: 'once',
      });

      // Value should be clamped to 25
      expect(mockSession.setValue).toHaveBeenCalledWith('voltage', 25, true);
    });

    it('should set preValue before sequence starts', async () => {
      const sequenceId = unwrapResult(manager.saveToLibrary({
        name: 'PreValue',
        unit: 'V',
        waveform: { steps: [{ value: 5, dwellMs: 100 }] },
        preValue: 0,
      }));

      await manager.run({
        sequenceId,
        deviceId: 'test-device',
        parameter: 'voltage',
        repeatMode: 'once',
      });

      // First call should be preValue
      expect(mockSession.setValue).toHaveBeenNthCalledWith(1, 'voltage', 0, true);
      // Second call should be first step
      expect(mockSession.setValue).toHaveBeenNthCalledWith(2, 'voltage', 5, true);
    });

    it('should set postValue after sequence completes', async () => {
      const sequenceId = unwrapResult(manager.saveToLibrary({
        name: 'PostValue',
        unit: 'V',
        waveform: { steps: [{ value: 5, dwellMs: 50 }] },
        postValue: 0,
      }));

      await manager.run({
        sequenceId,
        deviceId: 'test-device',
        parameter: 'voltage',
        repeatMode: 'once',
      });

      // Advance to completion
      await vi.advanceTimersByTimeAsync(100);

      // Last call should be postValue
      const calls = (mockSession.setValue as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall).toEqual(['voltage', 0, true]);
    });
  });

  describe('Lifecycle', () => {
    it('should clean up on stop()', async () => {
      const sequenceId = unwrapResult(manager.saveToLibrary({
        name: 'Stop Test',
        unit: 'V',
        waveform: { type: 'ramp', min: 0, max: 10, pointsPerCycle: 100, intervalMs: 10 },
      }));

      await manager.run({
        sequenceId,
        deviceId: 'test-device',
        parameter: 'voltage',
        repeatMode: 'continuous',
      });

      expect(manager.getActiveState()).toBeDefined();

      await manager.stop();

      // State should be cleared
      expect(manager.getActiveState()).toBeUndefined();
    });

    it('should abort previous sequence when starting new one', async () => {
      const messages: ServerMessage[] = [];
      manager.subscribe((msg) => messages.push(msg));

      const seq1 = unwrapResult(manager.saveToLibrary({
        name: 'Seq 1',
        unit: 'V',
        waveform: { type: 'ramp', min: 0, max: 10, pointsPerCycle: 100, intervalMs: 10 },
      }));

      const seq2 = unwrapResult(manager.saveToLibrary({
        name: 'Seq 2',
        unit: 'V',
        waveform: { type: 'sine', min: 0, max: 5, pointsPerCycle: 50, intervalMs: 20 },
      }));

      await manager.run({
        sequenceId: seq1,
        deviceId: 'test-device',
        parameter: 'voltage',
        repeatMode: 'continuous',
      });

      // Start second sequence
      await manager.run({
        sequenceId: seq2,
        deviceId: 'test-device',
        parameter: 'voltage',
        repeatMode: 'once',
      });

      // Should have aborted first and started second
      const aborted = messages.find((m) => m.type === 'sequenceAborted');
      expect(aborted).toBeDefined();

      const started = messages.filter((m) => m.type === 'sequenceStarted') as Array<{
        type: 'sequenceStarted';
        state: { sequenceId: string };
      }>;
      expect(started).toHaveLength(2);
      expect(started[1].state.sequenceId).toBe(seq2);
    });
  });
});
