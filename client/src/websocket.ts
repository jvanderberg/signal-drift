/**
 * WebSocket Manager - Singleton managing websocket connection
 *
 * - Connect/disconnect
 * - Reconnection with exponential backoff (1s, 2s, 4s... max 30s)
 * - Message queuing during reconnection
 * - Observable connection state
 * - Stale message filtering after tab sleep/background
 * - Tab keep-alive to prevent browser throttling
 */

import type { ClientMessage, ServerMessage } from '../../shared/types';
import { getVisibilityTracker } from './hooks/usePageVisibility';
import { getTabKeepAlive } from './tabKeepAlive';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

type MessageHandler = (message: ServerMessage) => void;
type StateHandler = (state: ConnectionState) => void;

interface WebSocketManagerOptions {
  url?: string;
  maxReconnectDelay?: number;
  initialReconnectDelay?: number;
  /** Max age of messages to process after waking from sleep (ms). Default: 2000 */
  staleMessageThresholdMs?: number;
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
  staleMessageThresholdMs: 2000,
};

// High-frequency message types that can be filtered (but not critical state changes)
const FILTERABLE_MESSAGE_TYPES: Set<string> = new Set(['scopeWaveform', 'measurement']);

// Critical field names that should never be filtered, even if stale
const CRITICAL_FIELDS: Set<string> = new Set(['mode', 'outputEnabled', 'connectionStatus', 'listRunning']);

// Extract timestamp from messages that have it, using proper type guard
function getMessageTimestamp(message: ServerMessage): number | undefined {
  if ('timestamp' in message && typeof message.timestamp === 'number') {
    return message.timestamp;
  }
  return undefined;
}

// Check if a message is safe to filter (high-frequency, non-critical)
function isFilterableMessage(message: ServerMessage): boolean {
  if (FILTERABLE_MESSAGE_TYPES.has(message.type)) {
    return true;
  }
  // Field messages are filterable only if they're not critical state changes
  if (message.type === 'field' && 'field' in message) {
    const fieldName = message.field;
    return typeof fieldName === 'string' && !CRITICAL_FIELDS.has(fieldName);
  }
  return false;
}

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

  // Visibility and stale message tracking
  const visibilityTracker = getVisibilityTracker();
  const tabKeepAlive = getTabKeepAlive();
  let discardStaleUntil: number | null = null;
  let staleMessagesDiscarded = 0;

  // When visibility changes, set up stale message filtering
  visibilityTracker.onVisibilityChange((isVisible, hiddenDuration) => {
    if (isVisible && hiddenDuration !== null && hiddenDuration > 1000) {
      // Page was hidden for more than 1 second - enable stale filtering
      discardStaleUntil = Date.now() + 500; // Filter for next 500ms
      staleMessagesDiscarded = 0;
      console.debug(`[WebSocket] Woke after ${hiddenDuration}ms, filtering stale messages`);
    }
  });

  function setState(newState: ConnectionState): void {
    if (state !== newState) {
      state = newState;

      // Manage tab keep-alive based on connection state
      if (newState === 'connected') {
        tabKeepAlive.start();
      } else if (newState === 'disconnected') {
        tabKeepAlive.stop();
      }

      for (const handler of stateHandlers) {
        try {
          handler(newState);
        } catch (err) {
          console.error('State handler error:', err);
        }
      }
    }
  }

  function shouldDiscardMessage(message: ServerMessage): boolean {
    // Only filter during the post-wake window
    if (!discardStaleUntil || Date.now() > discardStaleUntil) {
      if (discardStaleUntil && staleMessagesDiscarded > 0) {
        console.debug(`[WebSocket] Stale filtering complete, discarded ${staleMessagesDiscarded} messages`);
        discardStaleUntil = null;
        staleMessagesDiscarded = 0;
      }
      return false;
    }

    // Only filter high-frequency, non-critical messages
    if (!isFilterableMessage(message)) {
      return false;
    }

    const timestamp = getMessageTimestamp(message);
    if (timestamp === undefined) {
      // Non-timestamped messages always pass through
      return false;
    }

    const age = Date.now() - timestamp;
    if (age > opts.staleMessageThresholdMs) {
      staleMessagesDiscarded++;
      return true;
    }

    return false;
  }

  function handleMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(event.data) as ServerMessage;

      // Filter stale messages after waking from sleep
      if (shouldDiscardMessage(message)) {
        return;
      }

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
