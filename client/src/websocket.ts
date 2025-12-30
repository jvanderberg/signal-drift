/**
 * WebSocket Manager - Singleton managing websocket connection
 *
 * - Connect/disconnect
 * - Reconnection with exponential backoff (1s, 2s, 4s... max 30s)
 * - Message queuing during reconnection
 * - Observable connection state
 */

import type { ClientMessage, ServerMessage } from '../../shared/types';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

type MessageHandler = (message: ServerMessage) => void;
type StateHandler = (state: ConnectionState) => void;

interface WebSocketManagerOptions {
  url?: string;
  maxReconnectDelay?: number;
  initialReconnectDelay?: number;
}

export interface WebSocketManager {
  connect(): void;
  disconnect(): void;
  send(message: ClientMessage): void;
  getState(): ConnectionState;
  onMessage(handler: MessageHandler): () => void;
  onStateChange(handler: StateHandler): () => void;
}

// Detect if running in Electron production (file:// protocol)
function getWebSocketUrl(): string {
  const isElectronProd = window.location.protocol === 'file:';
  if (isElectronProd) {
    // Electron production: connect directly to server
    return 'ws://localhost:3001/ws';
  }
  // Web or Electron dev: use relative URL through proxy
  return `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
}

const DEFAULT_OPTIONS: Required<WebSocketManagerOptions> = {
  url: getWebSocketUrl(),
  maxReconnectDelay: 30000,
  initialReconnectDelay: 1000,
};

let instance: WebSocketManager | null = null;

export function createWebSocketManager(options: WebSocketManagerOptions = {}): WebSocketManager {
  const opts: Required<WebSocketManagerOptions> = { ...DEFAULT_OPTIONS, ...options };

  let ws: WebSocket | null = null;
  let state: ConnectionState = 'disconnected';
  let reconnectDelay = opts.initialReconnectDelay;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let shouldReconnect = false;

  // Message queue for messages sent while disconnected
  const messageQueue: ClientMessage[] = [];

  // Event handlers
  const messageHandlers = new Set<MessageHandler>();
  const stateHandlers = new Set<StateHandler>();

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

  function handleMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(event.data) as ServerMessage;
      for (const handler of messageHandlers) {
        try {
          handler(message);
        } catch (err) {
          console.error('Message handler error:', err);
        }
      }
    } catch (err) {
      console.error('Failed to parse WebSocket message:', err);
    }
  }

  function flushMessageQueue(): void {
    while (messageQueue.length > 0 && ws?.readyState === WebSocket.OPEN) {
      const message = messageQueue.shift();
      if (message) {
        ws.send(JSON.stringify(message));
      }
    }
  }

  function scheduleReconnect(): void {
    if (!shouldReconnect) return;

    setState('reconnecting');

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();

      // Exponential backoff
      reconnectDelay = Math.min(reconnectDelay * 2, opts.maxReconnectDelay);
    }, reconnectDelay);
  }

  function connect(): void {
    if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    shouldReconnect = true;
    setState('connecting');

    try {
      ws = new WebSocket(opts.url);

      ws.onopen = () => {
        setState('connected');
        reconnectDelay = opts.initialReconnectDelay; // Reset backoff
        flushMessageQueue();
      };

      ws.onmessage = handleMessage;

      ws.onclose = () => {
        ws = null;
        if (shouldReconnect) {
          scheduleReconnect();
        } else {
          setState('disconnected');
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        // onclose will be called after onerror
      };
    } catch (err) {
      console.error('Failed to create WebSocket:', err);
      scheduleReconnect();
    }
  }

  function disconnect(): void {
    shouldReconnect = false;

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (ws) {
      ws.close();
      ws = null;
    }

    setState('disconnected');
    messageQueue.length = 0;
  }

  function send(message: ClientMessage): void {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    } else {
      // Queue message for when connection is restored
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
    instance = createWebSocketManager();
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
