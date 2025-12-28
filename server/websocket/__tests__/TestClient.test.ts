/**
 * Tests for WebSocket TestClient utility
 *
 * This test client provides a typed interface for testing WebSocket communication
 * with the lab controller server.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestClient, TestClient } from './TestClient.js';
import type { ClientMessage, ServerMessage } from '../../../shared/types.js';

// Mock WebSocket for unit testing the client itself
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;
  sentMessages: string[] = [];
  private eventListeners = new Map<string, Array<(event: any) => void>>();

  constructor(url: string) {
    this.url = url;
    // Simulate connection after a tick
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.dispatchEvent('open', {});
    }, 0);
  }

  addEventListener(type: string, callback: (event: any) => void): void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    this.eventListeners.get(type)!.push(callback);
  }

  removeEventListener(type: string, callback: (event: any) => void): void {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      const idx = listeners.indexOf(callback);
      if (idx >= 0) listeners.splice(idx, 1);
    }
  }

  private dispatchEvent(type: string, event: any): void {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      for (const listener of listeners) {
        listener(event);
      }
    }
  }

  send(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent('close', {});
  }

  // Simulate receiving a message from server
  receiveMessage(msg: ServerMessage): void {
    this.dispatchEvent('message', { data: JSON.stringify(msg) });
  }

  // Simulate error
  emitError(error: Error): void {
    this.dispatchEvent('error', { error });
  }
}

// Mock the WebSocket constructor globally for these tests
const originalWebSocket = globalThis.WebSocket;

describe('TestClient', () => {
  let mockWs: MockWebSocket;
  let wsConstructorSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    wsConstructorSpy = vi.fn((url: string) => {
      mockWs = new MockWebSocket(url);
      return mockWs;
    });
    (globalThis as any).WebSocket = wsConstructorSpy;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  describe('Connection', () => {
    it('should connect to the specified URL', async () => {
      const client = createTestClient('ws://localhost:3001/ws');
      await client.connect();

      expect(wsConstructorSpy).toHaveBeenCalledWith('ws://localhost:3001/ws');
      client.close();
    });

    it('should be connected after connect() resolves', async () => {
      const client = createTestClient('ws://localhost:3001/ws');
      expect(client.isConnected()).toBe(false);

      await client.connect();

      expect(client.isConnected()).toBe(true);
      client.close();
    });

    it('should not be connected after close()', async () => {
      const client = createTestClient('ws://localhost:3001/ws');
      await client.connect();
      expect(client.isConnected()).toBe(true);

      client.close();
      expect(client.isConnected()).toBe(false);
    });

    it('should reject connect() on connection error', async () => {
      // Create a custom mock that doesn't auto-open
      class FailingMockWebSocket {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSED = 3;
        readyState = FailingMockWebSocket.CONNECTING;
        private eventListeners = new Map<string, Array<(event: any) => void>>();

        constructor(_url: string) {
          // Emit error instead of open
          setTimeout(() => {
            this.readyState = FailingMockWebSocket.CLOSED;
            const listeners = this.eventListeners.get('error');
            if (listeners) {
              for (const listener of listeners) {
                listener({ error: new Error('Connection refused') });
              }
            }
          }, 0);
        }

        addEventListener(type: string, callback: (event: any) => void): void {
          if (!this.eventListeners.has(type)) {
            this.eventListeners.set(type, []);
          }
          this.eventListeners.get(type)!.push(callback);
        }

        close(): void {
          this.readyState = FailingMockWebSocket.CLOSED;
        }
      }

      (globalThis as any).WebSocket = FailingMockWebSocket;

      const client = createTestClient('ws://localhost:3001/ws');
      await expect(client.connect()).rejects.toThrow('Connection refused');
    });
  });

  describe('Sending Messages', () => {
    it('should send typed ClientMessage as JSON', async () => {
      const client = createTestClient('ws://localhost:3001/ws');
      await client.connect();

      const message: ClientMessage = { type: 'getDevices' };
      client.send(message);

      expect(mockWs.sentMessages).toHaveLength(1);
      expect(JSON.parse(mockWs.sentMessages[0])).toEqual({ type: 'getDevices' });
      client.close();
    });

    it('should throw if sending when not connected', () => {
      const client = createTestClient('ws://localhost:3001/ws');

      expect(() => client.send({ type: 'getDevices' })).toThrow('Not connected');
    });
  });

  describe('Receiving Messages', () => {
    it('should collect all received messages', async () => {
      const client = createTestClient('ws://localhost:3001/ws');
      await client.connect();

      mockWs.receiveMessage({ type: 'deviceList', devices: [] });
      mockWs.receiveMessage({ type: 'error', code: 'TEST', message: 'test' });

      expect(client.getMessages()).toHaveLength(2);
      expect(client.getMessages()[0]).toEqual({ type: 'deviceList', devices: [] });
      client.close();
    });

    it('should wait for a specific message type', async () => {
      const client = createTestClient('ws://localhost:3001/ws');
      await client.connect();

      // Send message after a delay
      setTimeout(() => {
        mockWs.receiveMessage({ type: 'deviceList', devices: [] });
      }, 10);

      const message = await client.waitFor('deviceList');
      expect(message.type).toBe('deviceList');
      client.close();
    });

    it('should timeout if message not received', async () => {
      const client = createTestClient('ws://localhost:3001/ws');
      await client.connect();

      await expect(client.waitFor('deviceList', 50)).rejects.toThrow('Timeout');
      client.close();
    });

    it('should return immediately if message already in buffer', async () => {
      const client = createTestClient('ws://localhost:3001/ws');
      await client.connect();

      mockWs.receiveMessage({ type: 'deviceList', devices: [] });
      mockWs.receiveMessage({ type: 'error', code: 'TEST', message: 'test' });

      const message = await client.waitFor('error');
      expect(message.type).toBe('error');
      client.close();
    });
  });

  describe('Request-Response Pattern', () => {
    it('should send and wait for response', async () => {
      const client = createTestClient('ws://localhost:3001/ws');
      await client.connect();

      // Simulate server response
      setTimeout(() => {
        mockWs.receiveMessage({ type: 'deviceList', devices: [] });
      }, 10);

      const response = await client.request({ type: 'getDevices' }, 'deviceList');
      expect(response.type).toBe('deviceList');
      client.close();
    });
  });

  describe('Filtering Messages', () => {
    it('should wait for message matching predicate', async () => {
      const client = createTestClient('ws://localhost:3001/ws');
      await client.connect();

      setTimeout(() => {
        mockWs.receiveMessage({ type: 'error', code: 'OTHER', message: 'other' });
        mockWs.receiveMessage({ type: 'error', code: 'TARGET', message: 'target' });
      }, 10);

      const message = await client.waitForMatch(
        (msg) => msg.type === 'error' && msg.code === 'TARGET'
      );
      expect(message.type).toBe('error');
      if (message.type === 'error') {
        expect(message.code).toBe('TARGET');
      }
      client.close();
    });
  });

  describe('Clear Messages', () => {
    it('should clear message buffer', async () => {
      const client = createTestClient('ws://localhost:3001/ws');
      await client.connect();

      mockWs.receiveMessage({ type: 'deviceList', devices: [] });
      expect(client.getMessages()).toHaveLength(1);

      client.clearMessages();
      expect(client.getMessages()).toHaveLength(0);
      client.close();
    });
  });
});
