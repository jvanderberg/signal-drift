import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTriggerScript } from '../useTriggerScript';
import type { TriggerScript, ServerMessage } from '../../../../shared/types';

// Mock the WebSocket manager
const mockSend = vi.fn();
const mockConnect = vi.fn();
const mockGetState = vi.fn().mockReturnValue('connected');
let messageHandler: ((message: ServerMessage) => void) | null = null;
let stateChangeHandler: ((state: string) => void) | null = null;

vi.mock('../../websocket', () => ({
  getWebSocketManager: () => ({
    send: mockSend,
    connect: mockConnect,
    getState: mockGetState,
    onMessage: (handler: (message: ServerMessage) => void) => {
      messageHandler = handler;
      return () => { messageHandler = null; };
    },
    onStateChange: (handler: (state: string) => void) => {
      stateChangeHandler = handler;
      return () => { stateChangeHandler = null; };
    },
  }),
  ConnectionState: {},
}));

// Helper to simulate server messages
function simulateMessage(message: ServerMessage) {
  if (messageHandler) {
    act(() => {
      messageHandler!(message);
    });
  }
}

// Helper to simulate state changes
function simulateStateChange(state: string) {
  if (stateChangeHandler) {
    act(() => {
      stateChangeHandler!(state);
    });
  }
}

// Sample test data
const sampleScript: TriggerScript = {
  id: 'script-1',
  name: 'Test Script',
  triggers: [
    {
      id: 'trigger-1',
      condition: { type: 'time', seconds: 5 },
      action: { type: 'setOutput', deviceId: 'device-1', enabled: true },
      repeatMode: 'once',
      debounceMs: 0,
    },
  ],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

describe('useTriggerScript', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetState.mockReturnValue('connected');
    messageHandler = null;
    stateChangeHandler = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should request library on mount when connected', () => {
      renderHook(() => useTriggerScript());

      expect(mockConnect).toHaveBeenCalled();
      expect(mockSend).toHaveBeenCalledWith({ type: 'triggerScriptLibraryList' });
    });

    it('should start with loading state', () => {
      const { result } = renderHook(() => useTriggerScript());

      expect(result.current.isLibraryLoading).toBe(true);
      expect(result.current.library).toEqual([]);
    });

    it('should start with no active state', () => {
      const { result } = renderHook(() => useTriggerScript());

      expect(result.current.activeState).toBeNull();
      expect(result.current.isRunning).toBe(false);
    });

    it('should start with no error', () => {
      const { result } = renderHook(() => useTriggerScript());

      expect(result.current.error).toBeNull();
    });
  });

  describe('Library Operations', () => {
    it('should update library when receiving triggerScriptLibrary message', async () => {
      const { result } = renderHook(() => useTriggerScript());

      simulateMessage({
        type: 'triggerScriptLibrary',
        scripts: [sampleScript],
      });

      await waitFor(() => {
        expect(result.current.library).toEqual([sampleScript]);
        expect(result.current.isLibraryLoading).toBe(false);
      });
    });

    it('should send save message when saveScript is called', () => {
      const { result } = renderHook(() => useTriggerScript());

      const newScript = {
        name: 'New Script',
        triggers: [],
      };

      act(() => {
        result.current.saveScript(newScript);
      });

      expect(mockSend).toHaveBeenCalledWith({
        type: 'triggerScriptLibrarySave',
        script: newScript,
      });
    });

    it('should refresh library when triggerScriptLibrarySaved is received', () => {
      renderHook(() => useTriggerScript());

      // Clear the initial call
      mockSend.mockClear();

      simulateMessage({
        type: 'triggerScriptLibrarySaved',
        scriptId: 'new-script-id',
      });

      expect(mockSend).toHaveBeenCalledWith({ type: 'triggerScriptLibraryList' });
    });

    it('should send update message and optimistically update state', async () => {
      const { result } = renderHook(() => useTriggerScript());

      // First set up library
      simulateMessage({
        type: 'triggerScriptLibrary',
        scripts: [sampleScript],
      });

      const updatedScript = { ...sampleScript, name: 'Updated Name' };

      act(() => {
        result.current.updateScript(updatedScript);
      });

      expect(mockSend).toHaveBeenCalledWith({
        type: 'triggerScriptLibraryUpdate',
        script: updatedScript,
      });

      await waitFor(() => {
        expect(result.current.library[0].name).toBe('Updated Name');
      });
    });

    it('should send delete message when deleteScript is called', () => {
      const { result } = renderHook(() => useTriggerScript());

      act(() => {
        result.current.deleteScript('script-1');
      });

      expect(mockSend).toHaveBeenCalledWith({
        type: 'triggerScriptLibraryDelete',
        scriptId: 'script-1',
      });
    });

    it('should remove script from library when triggerScriptLibraryDeleted is received', async () => {
      const { result } = renderHook(() => useTriggerScript());

      // First set up library
      simulateMessage({
        type: 'triggerScriptLibrary',
        scripts: [sampleScript],
      });

      simulateMessage({
        type: 'triggerScriptLibraryDeleted',
        scriptId: 'script-1',
      });

      await waitFor(() => {
        expect(result.current.library).toEqual([]);
      });
    });

    it('should refresh library when refreshLibrary is called', () => {
      const { result } = renderHook(() => useTriggerScript());

      mockSend.mockClear();

      act(() => {
        result.current.refreshLibrary();
      });

      expect(mockSend).toHaveBeenCalledWith({ type: 'triggerScriptLibraryList' });
      expect(result.current.isLibraryLoading).toBe(true);
    });
  });

  describe('Execution Control', () => {
    it('should send run message when run is called', () => {
      const { result } = renderHook(() => useTriggerScript());

      act(() => {
        result.current.run('script-1');
      });

      expect(mockSend).toHaveBeenCalledWith({
        type: 'triggerScriptRun',
        scriptId: 'script-1',
      });
    });

    it('should send stop message when stop is called', () => {
      const { result } = renderHook(() => useTriggerScript());

      act(() => {
        result.current.stop();
      });

      expect(mockSend).toHaveBeenCalledWith({ type: 'triggerScriptStop' });
    });

    it('should send pause message when pause is called', () => {
      const { result } = renderHook(() => useTriggerScript());

      act(() => {
        result.current.pause();
      });

      expect(mockSend).toHaveBeenCalledWith({ type: 'triggerScriptPause' });
    });

    it('should send resume message when resume is called', () => {
      const { result } = renderHook(() => useTriggerScript());

      act(() => {
        result.current.resume();
      });

      expect(mockSend).toHaveBeenCalledWith({ type: 'triggerScriptResume' });
    });

    it('should update activeState when triggerScriptStarted is received', async () => {
      const { result } = renderHook(() => useTriggerScript());

      const state = {
        scriptId: 'script-1',
        executionState: 'running' as const,
        startedAt: Date.now(),
        elapsedMs: 0,
        triggerStates: [],
      };

      simulateMessage({
        type: 'triggerScriptStarted',
        state,
      });

      await waitFor(() => {
        expect(result.current.activeState).toEqual(state);
        expect(result.current.isRunning).toBe(true);
      });
    });

    it('should update activeState when triggerScriptProgress is received', async () => {
      const { result } = renderHook(() => useTriggerScript());

      const state = {
        scriptId: 'script-1',
        executionState: 'running' as const,
        startedAt: Date.now(),
        elapsedMs: 1000,
        triggerStates: [],
      };

      simulateMessage({
        type: 'triggerScriptProgress',
        state,
      });

      await waitFor(() => {
        expect(result.current.activeState).toEqual(state);
      });
    });

    it('should set executionState to idle when triggerScriptStopped is received', async () => {
      const { result } = renderHook(() => useTriggerScript());

      // First start a script
      simulateMessage({
        type: 'triggerScriptStarted',
        state: {
          scriptId: 'script-1',
          executionState: 'running',
          startedAt: Date.now(),
          elapsedMs: 0,
          triggerStates: [],
        },
      });

      // Then stop it
      simulateMessage({
        type: 'triggerScriptStopped',
        scriptId: 'script-1',
      });

      await waitFor(() => {
        expect(result.current.activeState?.executionState).toBe('idle');
        expect(result.current.isRunning).toBe(false);
      });
    });

    it('should set executionState to paused when triggerScriptPaused is received', async () => {
      const { result } = renderHook(() => useTriggerScript());

      // First start a script
      simulateMessage({
        type: 'triggerScriptStarted',
        state: {
          scriptId: 'script-1',
          executionState: 'running',
          startedAt: Date.now(),
          elapsedMs: 0,
          triggerStates: [],
        },
      });

      // Then pause it
      simulateMessage({
        type: 'triggerScriptPaused',
        scriptId: 'script-1',
      });

      await waitFor(() => {
        expect(result.current.activeState?.executionState).toBe('paused');
        expect(result.current.isRunning).toBe(true); // Still running when paused
      });
    });

    it('should set executionState to running when triggerScriptResumed is received', async () => {
      const { result } = renderHook(() => useTriggerScript());

      // First start and pause a script
      simulateMessage({
        type: 'triggerScriptStarted',
        state: {
          scriptId: 'script-1',
          executionState: 'paused',
          startedAt: Date.now(),
          elapsedMs: 1000,
          triggerStates: [],
        },
      });

      // Then resume it
      simulateMessage({
        type: 'triggerScriptResumed',
        scriptId: 'script-1',
      });

      await waitFor(() => {
        expect(result.current.activeState?.executionState).toBe('running');
      });
    });
  });

  describe('Trigger State Updates', () => {
    it('should update trigger state when triggerFired is received', async () => {
      const { result } = renderHook(() => useTriggerScript());

      // First start a script
      simulateMessage({
        type: 'triggerScriptStarted',
        state: {
          scriptId: 'script-1',
          executionState: 'running',
          startedAt: Date.now(),
          elapsedMs: 0,
          triggerStates: [
            { triggerId: 'trigger-1', firedCount: 0, lastFiredAt: null, conditionMet: false },
          ],
        },
      });

      // Then fire a trigger
      simulateMessage({
        type: 'triggerFired',
        scriptId: 'script-1',
        triggerId: 'trigger-1',
        triggerState: { triggerId: 'trigger-1', firedCount: 1, lastFiredAt: Date.now(), conditionMet: true },
      });

      await waitFor(() => {
        expect(result.current.activeState?.triggerStates[0].firedCount).toBe(1);
      });
    });
  });

  describe('Error Handling', () => {
    it('should set error when triggerScriptError is received', async () => {
      const { result } = renderHook(() => useTriggerScript());

      // First start a script
      simulateMessage({
        type: 'triggerScriptStarted',
        state: {
          scriptId: 'script-1',
          executionState: 'running',
          startedAt: Date.now(),
          elapsedMs: 0,
          triggerStates: [],
        },
      });

      // Then receive an error
      simulateMessage({
        type: 'triggerScriptError',
        scriptId: 'script-1',
        error: 'Something went wrong',
      });

      await waitFor(() => {
        expect(result.current.error).toBe('Something went wrong');
        expect(result.current.activeState?.executionState).toBe('error');
      });
    });

    it('should set error when triggerActionFailed is received', async () => {
      const { result } = renderHook(() => useTriggerScript());

      simulateMessage({
        type: 'triggerActionFailed',
        scriptId: 'script-1',
        triggerId: 'trigger-1',
        actionType: 'setOutput',
        error: 'Device not responding',
      });

      await waitFor(() => {
        expect(result.current.error).toBe('Action failed: Device not responding');
      });
    });

    it('should clear error when clearError is called', async () => {
      const { result } = renderHook(() => useTriggerScript());

      // First set an error
      simulateMessage({
        type: 'triggerActionFailed',
        scriptId: 'script-1',
        triggerId: 'trigger-1',
        actionType: 'setOutput',
        error: 'Some error',
      });

      await waitFor(() => {
        expect(result.current.error).not.toBeNull();
      });

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
    });

    it('should set error on general error message if trigger-related', async () => {
      const { result } = renderHook(() => useTriggerScript());

      simulateMessage({
        type: 'error',
        code: 'TRIGGER_SCRIPT_NOT_FOUND',
        message: 'Trigger script not found',
      });

      await waitFor(() => {
        expect(result.current.error).toBe('Trigger script not found');
      });
    });
  });

  describe('Connection State', () => {
    it('should request library when connection is restored', () => {
      mockGetState.mockReturnValue('disconnected');
      renderHook(() => useTriggerScript());

      mockSend.mockClear();

      // Simulate reconnection
      simulateStateChange('connected');

      expect(mockSend).toHaveBeenCalledWith({ type: 'triggerScriptLibraryList' });
    });

    it('should track connection state changes', async () => {
      const { result } = renderHook(() => useTriggerScript());

      simulateStateChange('disconnected');

      await waitFor(() => {
        expect(result.current.connectionState).toBe('disconnected');
      });

      simulateStateChange('connected');

      await waitFor(() => {
        expect(result.current.connectionState).toBe('connected');
      });
    });
  });
});
