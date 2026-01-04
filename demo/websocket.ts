/**
 * Demo WebSocket Module
 * This module replaces client/src/websocket.ts for the demo build
 * It exports the mock WebSocket manager that communicates with the Web Worker
 */

import type { ClientMessage, ServerMessage } from '../shared/types';
import SimulationWorker from './simulation/worker?worker';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

type MessageHandler = (message: ServerMessage) => void;
type StateHandler = (state: ConnectionState) => void;

export interface WebSocketManager {
  connect(): void;
  disconnect(): void;
  send(message: ClientMessage): void;
  getState(): ConnectionState;
  onMessage(handler: MessageHandler): () => void;
  onStateChange(handler: StateHandler): () => void;
}

let instance: WebSocketManager | null = null;

function createMockWebSocketManager(): WebSocketManager {
  let worker: Worker | null = null;
  let state: ConnectionState = 'disconnected';

  const messageHandlers = new Set<MessageHandler>();
  const stateHandlers = new Set<StateHandler>();
  const messageQueue: ClientMessage[] = [];

  function setState(newState: ConnectionState): void {
    if (state !== newState) {
      state = newState;
      for (const handler of stateHandlers) {
        try {
          handler(newState);
        } catch (err) {
          console.error('State handler error:', err);
        }
      }
    }
  }

  function flushQueue(): void {
    while (messageQueue.length > 0 && worker && state === 'connected') {
      const msg = messageQueue.shift();
      if (msg) {
        worker.postMessage(msg);
      }
    }
  }

  function handleWorkerMessage(event: MessageEvent): void {
    const message = event.data;

    // Handle worker ready signal
    if (message.type === 'workerReady') {
      setState('connected');
      flushQueue();
      return;
    }

    // Forward to message handlers
    for (const handler of messageHandlers) {
      try {
        handler(message as ServerMessage);
      } catch (err) {
        console.error('Message handler error:', err);
      }
    }
  }

  function connect(): void {
    if (worker) return;

    setState('connecting');

    try {
      // Create worker using Vite's worker import
      worker = new SimulationWorker();

      worker.onmessage = handleWorkerMessage;

      worker.onerror = (error) => {
        console.error('Worker error:', error);
        setState('disconnected');
      };
    } catch (err) {
      console.error('Failed to create worker:', err);
      setState('disconnected');
    }
  }

  function disconnect(): void {
    if (worker) {
      worker.terminate();
      worker = null;
    }
    setState('disconnected');
    messageQueue.length = 0;
  }

  function send(message: ClientMessage): void {
    if (worker && state === 'connected') {
      worker.postMessage(message);
    } else {
      // Queue message for when connected
      messageQueue.push(message);
      // Start connecting if not already
      if (state === 'disconnected') {
        connect();
      }
    }
  }

  function getState(): ConnectionState {
    return state;
  }

  function onMessage(handler: MessageHandler): () => void {
    messageHandlers.add(handler);
    return () => messageHandlers.delete(handler);
  }

  function onStateChange(handler: StateHandler): () => void {
    stateHandlers.add(handler);
    return () => stateHandlers.delete(handler);
  }

  return {
    connect,
    disconnect,
    send,
    getState,
    onMessage,
    onStateChange,
  };
}

// Singleton accessor
export function getWebSocketManager(): WebSocketManager {
  if (!instance) {
    instance = createMockWebSocketManager();
  }
  return instance;
}

// For testing - reset the singleton
export function resetWebSocketManager(): void {
  if (instance) {
    instance.disconnect();
    instance = null;
  }
}

// Also export as default for compatibility
export default {
  getWebSocketManager,
  resetWebSocketManager,
};
