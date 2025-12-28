/**
 * WebSocket TestClient - A typed client for testing WebSocket communication
 *
 * Provides utilities for:
 * - Connecting to the WebSocket server
 * - Sending typed ClientMessage objects
 * - Waiting for specific ServerMessage types
 * - Request-response patterns
 * - Message filtering
 */

import type { ClientMessage, ServerMessage } from '../../../shared/types.js';

// WebSocket readyState constants (works in both browser and Node)
const WS_OPEN = 1;

export interface TestClient {
  connect(): Promise<void>;
  close(): void;
  isConnected(): boolean;
  send(message: ClientMessage): void;
  getMessages(): ServerMessage[];
  clearMessages(): void;
  waitFor<T extends ServerMessage['type']>(
    type: T,
    timeoutMs?: number
  ): Promise<Extract<ServerMessage, { type: T }>>;
  waitForMatch(
    predicate: (msg: ServerMessage) => boolean,
    timeoutMs?: number
  ): Promise<ServerMessage>;
  request<T extends ServerMessage['type']>(
    message: ClientMessage,
    responseType: T,
    timeoutMs?: number
  ): Promise<Extract<ServerMessage, { type: T }>>;
}

const DEFAULT_TIMEOUT = 5000;

export function createTestClient(url: string): TestClient {
  let ws: WebSocket | null = null;
  const messages: ServerMessage[] = [];
  const listeners: Array<(msg: ServerMessage) => void> = [];

  function connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      ws = new WebSocket(url);

      ws.addEventListener('open', () => {
        resolve();
      });

      ws.addEventListener('error', (event) => {
        const error = (event as any).error || new Error('Connection refused');
        reject(error);
      });

      ws.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(event.data) as ServerMessage;
          messages.push(msg);
          // Notify any waiting listeners
          for (const listener of listeners) {
            listener(msg);
          }
        } catch (err) {
          console.error('Failed to parse message:', event.data);
        }
      });
    });
  }

  function close(): void {
    if (ws) {
      ws.close();
      ws = null;
    }
  }

  function isConnected(): boolean {
    return ws !== null && ws.readyState === WS_OPEN;
  }

  function send(message: ClientMessage): void {
    if (!isConnected()) {
      throw new Error('Not connected');
    }
    ws!.send(JSON.stringify(message));
  }

  function getMessages(): ServerMessage[] {
    return [...messages];
  }

  function clearMessages(): void {
    messages.length = 0;
  }

  function waitFor<T extends ServerMessage['type']>(
    type: T,
    timeoutMs = DEFAULT_TIMEOUT
  ): Promise<Extract<ServerMessage, { type: T }>> {
    return waitForMatch((msg) => msg.type === type, timeoutMs) as Promise<
      Extract<ServerMessage, { type: T }>
    >;
  }

  function waitForMatch(
    predicate: (msg: ServerMessage) => boolean,
    timeoutMs = DEFAULT_TIMEOUT
  ): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      // Check existing messages first
      const existing = messages.find(predicate);
      if (existing) {
        resolve(existing);
        return;
      }

      const timeout = setTimeout(() => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
        reject(new Error('Timeout waiting for message'));
      }, timeoutMs);

      const listener = (msg: ServerMessage) => {
        if (predicate(msg)) {
          clearTimeout(timeout);
          const idx = listeners.indexOf(listener);
          if (idx >= 0) listeners.splice(idx, 1);
          resolve(msg);
        }
      };

      listeners.push(listener);
    });
  }

  function request<T extends ServerMessage['type']>(
    message: ClientMessage,
    responseType: T,
    timeoutMs = DEFAULT_TIMEOUT
  ): Promise<Extract<ServerMessage, { type: T }>> {
    send(message);
    return waitFor(responseType, timeoutMs);
  }

  return {
    connect,
    close,
    isConnected,
    send,
    getMessages,
    clearMessages,
    waitFor,
    waitForMatch,
    request,
  };
}
