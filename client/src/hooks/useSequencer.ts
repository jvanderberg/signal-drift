/**
 * useSequencer - React hook for sequence library and playback via WebSocket
 *
 * Manages:
 * - Library CRUD (list, save, update, delete sequences)
 * - Playback control (run, abort)
 * - Active sequence state (progress, completion, errors)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getWebSocketManager, ConnectionState } from '../websocket';
import type {
  SequenceDefinition,
  SequenceState,
  SequenceRunConfig,
  ServerMessage,
  RepeatMode,
} from '../../../shared/types';

export interface UseSequencerResult {
  // Connection state
  connectionState: ConnectionState;

  // Library
  library: SequenceDefinition[];
  isLibraryLoading: boolean;
  refreshLibrary: () => void;
  saveSequence: (definition: Omit<SequenceDefinition, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateSequence: (definition: SequenceDefinition) => void;
  deleteSequence: (sequenceId: string) => void;

  // Playback
  activeState: SequenceState | null;
  isRunning: boolean;
  run: (config: {
    sequenceId: string;
    deviceId: string;
    parameter: string;
    repeatMode: RepeatMode;
    repeatCount?: number;
  }) => void;
  abort: () => void;

  // Errors
  error: string | null;
  clearError: () => void;
}

export function useSequencer(): UseSequencerResult {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [library, setLibrary] = useState<SequenceDefinition[]>([]);
  const [isLibraryLoading, setIsLibraryLoading] = useState(true); // Start true until first load
  const [activeState, setActiveState] = useState<SequenceState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wsManager = useRef(getWebSocketManager());

  // Handle incoming messages
  useEffect(() => {
    const manager = wsManager.current;

    // Track connection state
    const unsubscribeState = manager.onStateChange((newState) => {
      setConnectionState(newState);
      // Request library when connection is restored
      if (newState === 'connected') {
        manager.send({ type: 'sequenceLibraryList' });
        setIsLibraryLoading(true);
      }
    });

    // Set initial connection state
    setConnectionState(manager.getState());

    // Connect the WebSocket (might already be connected from other hooks)
    manager.connect();

    // Request library on mount if already connected
    if (manager.getState() === 'connected') {
      manager.send({ type: 'sequenceLibraryList' });
      setIsLibraryLoading(true);
    }

    // Handle sequence-related messages
    const unsubscribeMessage = manager.onMessage((message: ServerMessage) => {
      switch (message.type) {
        // Library responses
        case 'sequenceLibrary':
          setLibrary(message.sequences);
          setIsLibraryLoading(false);
          break;

        case 'sequenceLibrarySaved':
          // Refresh library to get the saved sequence with full data
          manager.send({ type: 'sequenceLibraryList' });
          break;

        case 'sequenceLibraryDeleted':
          // Remove from local state
          setLibrary((prev) => prev.filter((s) => s.id !== message.sequenceId));
          break;

        // Playback responses
        case 'sequenceStarted':
          setActiveState(message.state);
          setError(null);
          break;

        case 'sequenceProgress':
          setActiveState(message.state);
          break;

        case 'sequenceCompleted':
          setActiveState((prev) => {
            if (!prev || prev.sequenceId !== message.sequenceId) return prev;
            return { ...prev, executionState: 'completed' };
          });
          break;

        case 'sequenceAborted':
          setActiveState((prev) => {
            if (!prev || prev.sequenceId !== message.sequenceId) return prev;
            return { ...prev, executionState: 'idle' };
          });
          break;

        case 'sequenceError':
          setActiveState((prev) => {
            if (!prev || prev.sequenceId !== message.sequenceId) return prev;
            return { ...prev, executionState: 'error', error: message.error };
          });
          setError(message.error);
          break;

        // General error (might be sequence-related)
        case 'error':
          if (message.message.toLowerCase().includes('sequence')) {
            setError(message.message);
          }
          break;
      }
    });

    return () => {
      unsubscribeState();
      unsubscribeMessage();
    };
  }, []);

  // Library operations
  const refreshLibrary = useCallback(() => {
    setIsLibraryLoading(true);
    wsManager.current.send({ type: 'sequenceLibraryList' });
  }, []);

  const saveSequence = useCallback(
    (definition: Omit<SequenceDefinition, 'id' | 'createdAt' | 'updatedAt'>) => {
      wsManager.current.send({ type: 'sequenceLibrarySave', definition });
    },
    []
  );

  const updateSequence = useCallback((definition: SequenceDefinition) => {
    wsManager.current.send({ type: 'sequenceLibraryUpdate', definition });
    // Optimistically update local state
    setLibrary((prev) => prev.map((s) => (s.id === definition.id ? definition : s)));
  }, []);

  const deleteSequence = useCallback((sequenceId: string) => {
    wsManager.current.send({ type: 'sequenceLibraryDelete', sequenceId });
  }, []);

  // Playback operations
  const run = useCallback(
    (config: {
      sequenceId: string;
      deviceId: string;
      parameter: string;
      repeatMode: RepeatMode;
      repeatCount?: number;
    }) => {
      const runConfig: SequenceRunConfig = {
        sequenceId: config.sequenceId,
        deviceId: config.deviceId,
        parameter: config.parameter,
        repeatMode: config.repeatMode,
        repeatCount: config.repeatCount,
      };
      wsManager.current.send({ type: 'sequenceRun', config: runConfig });
    },
    []
  );

  const abort = useCallback(() => {
    wsManager.current.send({ type: 'sequenceAbort' });
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const isRunning = activeState?.executionState === 'running' || activeState?.executionState === 'paused';

  return {
    connectionState,
    library,
    isLibraryLoading,
    refreshLibrary,
    saveSequence,
    updateSequence,
    deleteSequence,
    activeState,
    isRunning,
    run,
    abort,
    error,
    clearError,
  };
}
