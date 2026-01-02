/**
 * useTriggerScript - React hook for trigger script library and execution via WebSocket
 *
 * Manages:
 * - Library CRUD (list, save, update, delete trigger scripts)
 * - Execution control (run, stop, pause, resume)
 * - Active trigger script state (trigger states, progress)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getWebSocketManager, ConnectionState } from '../websocket';
import type {
  TriggerScript,
  TriggerScriptState,
  ServerMessage,
} from '../../../shared/types';

export interface UseTriggerScriptResult {
  // Connection state
  connectionState: ConnectionState;

  // Library
  library: TriggerScript[];
  isLibraryLoading: boolean;
  refreshLibrary: () => void;
  saveScript: (script: Omit<TriggerScript, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateScript: (script: TriggerScript) => void;
  deleteScript: (scriptId: string) => void;

  // Execution
  activeState: TriggerScriptState | null;
  isRunning: boolean;
  run: (scriptId: string) => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;

  // Errors
  error: string | null;
  clearError: () => void;
}

export function useTriggerScript(): UseTriggerScriptResult {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [library, setLibrary] = useState<TriggerScript[]>([]);
  const [isLibraryLoading, setIsLibraryLoading] = useState(true);
  const [activeState, setActiveState] = useState<TriggerScriptState | null>(null);
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
        manager.send({ type: 'triggerScriptLibraryList' });
        setIsLibraryLoading(true);
      }
    });

    // Set initial connection state
    setConnectionState(manager.getState());

    // Connect the WebSocket (might already be connected from other hooks)
    manager.connect();

    // Request library on mount if already connected
    if (manager.getState() === 'connected') {
      manager.send({ type: 'triggerScriptLibraryList' });
      setIsLibraryLoading(true);
    }

    // Handle trigger script related messages
    const unsubscribeMessage = manager.onMessage((message: ServerMessage) => {
      switch (message.type) {
        // Library responses
        case 'triggerScriptLibrary':
          setLibrary(message.scripts);
          setIsLibraryLoading(false);
          break;

        case 'triggerScriptLibrarySaved':
          // Refresh library to get the saved script with full data
          manager.send({ type: 'triggerScriptLibraryList' });
          break;

        case 'triggerScriptLibraryDeleted':
          // Remove from local state
          setLibrary((prev) => prev.filter((s) => s.id !== message.scriptId));
          break;

        // Execution responses
        case 'triggerScriptStarted':
          setActiveState(message.state);
          setError(null);
          break;

        case 'triggerScriptProgress':
          setActiveState(message.state);
          break;

        case 'triggerScriptStopped':
          setActiveState((prev) => {
            if (!prev || prev.scriptId !== message.scriptId) return prev;
            return { ...prev, executionState: 'idle' };
          });
          break;

        case 'triggerScriptPaused':
          setActiveState((prev) => {
            if (!prev || prev.scriptId !== message.scriptId) return prev;
            return { ...prev, executionState: 'paused' };
          });
          break;

        case 'triggerScriptResumed':
          setActiveState((prev) => {
            if (!prev || prev.scriptId !== message.scriptId) return prev;
            return { ...prev, executionState: 'running' };
          });
          break;

        case 'triggerScriptError':
          setActiveState((prev) => {
            if (!prev || prev.scriptId !== message.scriptId) return prev;
            return { ...prev, executionState: 'error', error: message.error };
          });
          setError(message.error);
          break;

        case 'triggerFired':
          // Update the specific trigger's state
          setActiveState((prev) => {
            if (!prev || prev.scriptId !== message.scriptId) return prev;
            return {
              ...prev,
              triggerStates: prev.triggerStates.map((ts) =>
                ts.triggerId === message.triggerId ? message.triggerState : ts
              ),
            };
          });
          break;

        // General error (might be trigger script related)
        case 'error':
          if (message.message.toLowerCase().includes('trigger')) {
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
    wsManager.current.send({ type: 'triggerScriptLibraryList' });
  }, []);

  const saveScript = useCallback(
    (script: Omit<TriggerScript, 'id' | 'createdAt' | 'updatedAt'>) => {
      wsManager.current.send({ type: 'triggerScriptLibrarySave', script });
    },
    []
  );

  const updateScript = useCallback((script: TriggerScript) => {
    wsManager.current.send({ type: 'triggerScriptLibraryUpdate', script });
    // Optimistically update local state
    setLibrary((prev) => prev.map((s) => (s.id === script.id ? script : s)));
  }, []);

  const deleteScript = useCallback((scriptId: string) => {
    wsManager.current.send({ type: 'triggerScriptLibraryDelete', scriptId });
  }, []);

  // Execution operations
  const run = useCallback((scriptId: string) => {
    wsManager.current.send({ type: 'triggerScriptRun', scriptId });
  }, []);

  const stop = useCallback(() => {
    wsManager.current.send({ type: 'triggerScriptStop' });
  }, []);

  const pause = useCallback(() => {
    wsManager.current.send({ type: 'triggerScriptPause' });
  }, []);

  const resume = useCallback(() => {
    wsManager.current.send({ type: 'triggerScriptResume' });
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const isRunning =
    activeState?.executionState === 'running' ||
    activeState?.executionState === 'paused';

  return {
    connectionState,
    library,
    isLibraryLoading,
    refreshLibrary,
    saveScript,
    updateScript,
    deleteScript,
    activeState,
    isRunning,
    run,
    stop,
    pause,
    resume,
    error,
    clearError,
  };
}
