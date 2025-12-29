import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { createWebSocketHandler, WebSocketHandler } from '../WebSocketHandler.js';
import type { SessionManager } from '../../sessions/SessionManager.js';
import type { DeviceSession } from '../../sessions/DeviceSession.js';
import type { ClientMessage, ServerMessage, DeviceSessionState, DeviceSummary } from '../../../shared/types.js';

// Mock WebSocket class that emits events like the real one
class MockWebSocket extends EventEmitter {
  readyState = 1; // OPEN
  sentMessages: string[] = [];

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = 3; // CLOSED
    this.emit('close');
  }

  // Simulate receiving a message
  receiveMessage(msg: ClientMessage): void {
    this.emit('message', JSON.stringify(msg));
  }
}

// Mock WebSocket.Server
class MockWebSocketServer extends EventEmitter {
  clients = new Set<MockWebSocket>();

  simulateConnection(): MockWebSocket {
    const client = new MockWebSocket();
    this.clients.add(client);
    this.emit('connection', client);
    return client;
  }

  close(): void {
    this.emit('close');
  }
}

// Create mock session state
function createMockSessionState(deviceId: string): DeviceSessionState {
  return {
    info: {
      id: deviceId,
      type: 'electronic-load',
      manufacturer: 'Test',
      model: 'Device',
    },
    capabilities: {
      modes: ['CC', 'CV'],
      modesSettable: true,
      outputs: [],
      measurements: [],
    },
    connectionStatus: 'connected',
    consecutiveErrors: 0,
    mode: 'CC',
    outputEnabled: false,
    setpoints: { current: 1.0 },
    measurements: { voltage: 12.5, current: 0.98, power: 12.25 },
    history: {
      timestamps: [Date.now()],
      voltage: [12.5],
      current: [0.98],
      power: [12.25],
    },
    lastUpdated: Date.now(),
  };
}

// Create mock session
function createMockSession(deviceId: string): DeviceSession {
  const subscribers = new Map<string, (msg: ServerMessage) => void>();

  return {
    getState: () => createMockSessionState(deviceId),
    getSubscriberCount: () => subscribers.size,
    hasSubscriber: (clientId: string) => subscribers.has(clientId),
    subscribe: vi.fn((clientId: string, callback: (msg: ServerMessage) => void) => {
      subscribers.set(clientId, callback);
    }),
    unsubscribe: vi.fn((clientId: string) => {
      subscribers.delete(clientId);
    }),
    setMode: vi.fn(),
    setOutput: vi.fn(),
    setValue: vi.fn(),
    reconnect: vi.fn(),
    stop: vi.fn(),
  };
}

// Create mock session manager
function createMockSessionManager(): SessionManager & {
  sessions: Map<string, DeviceSession>;
  subscribedClients: Map<string, Set<string>>;
} {
  const sessions = new Map<string, DeviceSession>();
  const subscribedClients = new Map<string, Set<string>>(); // deviceId -> Set<clientId>

  return {
    sessions,
    subscribedClients,
    syncDevices: vi.fn(),
    hasSession: (id: string) => sessions.has(id),
    isSessionDisconnected: (id: string) => {
      const session = sessions.get(id);
      return session ? session.getState().connectionStatus === 'disconnected' : false;
    },
    reconnectSession: vi.fn(),
    getSession: (id: string) => sessions.get(id),
    getSessionCount: () => sessions.size,
    getDeviceSummaries: (): DeviceSummary[] => {
      const summaries: DeviceSummary[] = [];
      for (const session of sessions.values()) {
        const state = session.getState();
        summaries.push({
          id: state.info.id,
          info: state.info,
          capabilities: state.capabilities,
          connectionStatus: state.connectionStatus,
        });
      }
      return summaries;
    },
    subscribe: vi.fn((deviceId: string, clientId: string, callback: (msg: ServerMessage) => void) => {
      const session = sessions.get(deviceId);
      if (!session) return false;
      session.subscribe(clientId, callback);

      if (!subscribedClients.has(deviceId)) {
        subscribedClients.set(deviceId, new Set());
      }
      subscribedClients.get(deviceId)!.add(clientId);
      return true;
    }),
    unsubscribe: vi.fn((deviceId: string, clientId: string) => {
      const session = sessions.get(deviceId);
      if (session) {
        session.unsubscribe(clientId);
      }
      subscribedClients.get(deviceId)?.delete(clientId);
    }),
    unsubscribeAll: vi.fn((clientId: string) => {
      for (const [deviceId, session] of sessions) {
        session.unsubscribe(clientId);
        subscribedClients.get(deviceId)?.delete(clientId);
      }
    }),
    isSubscribed: (deviceId: string, clientId: string) => {
      const session = sessions.get(deviceId);
      return session ? session.hasSubscriber(clientId) : false;
    },
    setMode: vi.fn(),
    setOutput: vi.fn(),
    setValue: vi.fn(),
    stop: vi.fn(),
    // Oscilloscope methods
    getOscilloscopeSession: (_id: string) => undefined,
    oscilloscopeRun: vi.fn(),
    oscilloscopeStop: vi.fn(),
    oscilloscopeSingle: vi.fn(),
    oscilloscopeAutoSetup: vi.fn(),
    oscilloscopeGetWaveform: vi.fn(),
    oscilloscopeGetMeasurement: vi.fn(),
    oscilloscopeGetScreenshot: vi.fn(),
  };
}

describe('WebSocketHandler', () => {
  let wss: MockWebSocketServer;
  let sessionManager: ReturnType<typeof createMockSessionManager>;
  let handler: WebSocketHandler;

  beforeEach(() => {
    wss = new MockWebSocketServer();
    sessionManager = createMockSessionManager();
    handler = createWebSocketHandler(wss as any, sessionManager);
  });

  afterEach(() => {
    handler.close();
  });

  describe('Connection Management', () => {
    it('should track connected clients', () => {
      expect(handler.getClientCount()).toBe(0);

      wss.simulateConnection();
      expect(handler.getClientCount()).toBe(1);

      wss.simulateConnection();
      expect(handler.getClientCount()).toBe(2);
    });

    it('should cleanup on client disconnect', () => {
      const client = wss.simulateConnection();
      expect(handler.getClientCount()).toBe(1);

      client.close();
      expect(handler.getClientCount()).toBe(0);
    });

    it('should unsubscribe from all devices on disconnect', () => {
      // Add a session
      const session = createMockSession('device-1');
      sessionManager.sessions.set('device-1', session);

      const client = wss.simulateConnection();

      // Subscribe to device
      client.receiveMessage({ type: 'subscribe', deviceId: 'device-1' });

      // Close connection
      client.close();

      // Should have called unsubscribeAll
      expect(sessionManager.unsubscribeAll).toHaveBeenCalled();
    });
  });

  describe('getDevices Message', () => {
    it('should respond with device list', () => {
      const session = createMockSession('device-1');
      sessionManager.sessions.set('device-1', session);

      const client = wss.simulateConnection();
      client.receiveMessage({ type: 'getDevices' });

      expect(client.sentMessages.length).toBe(1);
      const response = JSON.parse(client.sentMessages[0]) as ServerMessage;
      expect(response.type).toBe('deviceList');
      if (response.type === 'deviceList') {
        expect(response.devices.length).toBe(1);
        expect(response.devices[0].id).toBe('device-1');
      }
    });
  });

  describe('scan Message', () => {
    it('should trigger sync and respond with device list', () => {
      const client = wss.simulateConnection();
      client.receiveMessage({ type: 'scan' });

      expect(sessionManager.syncDevices).toHaveBeenCalled();
      expect(client.sentMessages.length).toBe(1);
      const response = JSON.parse(client.sentMessages[0]) as ServerMessage;
      expect(response.type).toBe('deviceList');
    });
  });

  describe('subscribe Message', () => {
    it('should subscribe to device and send current state', () => {
      const session = createMockSession('device-1');
      sessionManager.sessions.set('device-1', session);

      const client = wss.simulateConnection();
      client.receiveMessage({ type: 'subscribe', deviceId: 'device-1' });

      expect(sessionManager.subscribe).toHaveBeenCalled();
      expect(client.sentMessages.length).toBe(1);

      const response = JSON.parse(client.sentMessages[0]) as ServerMessage;
      expect(response.type).toBe('subscribed');
      if (response.type === 'subscribed') {
        expect(response.deviceId).toBe('device-1');
        expect(response.state.info.id).toBe('device-1');
      }
    });

    it('should send error for unknown device', () => {
      const client = wss.simulateConnection();
      client.receiveMessage({ type: 'subscribe', deviceId: 'unknown' });

      expect(client.sentMessages.length).toBe(1);
      const response = JSON.parse(client.sentMessages[0]) as ServerMessage;
      expect(response.type).toBe('error');
      if (response.type === 'error') {
        expect(response.deviceId).toBe('unknown');
        expect(response.code).toBe('DEVICE_NOT_FOUND');
      }
    });
  });

  describe('unsubscribe Message', () => {
    it('should unsubscribe from device', () => {
      const session = createMockSession('device-1');
      sessionManager.sessions.set('device-1', session);

      const client = wss.simulateConnection();
      client.receiveMessage({ type: 'subscribe', deviceId: 'device-1' });
      client.receiveMessage({ type: 'unsubscribe', deviceId: 'device-1' });

      expect(sessionManager.unsubscribe).toHaveBeenCalled();

      // Should receive 'unsubscribed' confirmation
      const responses = client.sentMessages.map(m => JSON.parse(m) as ServerMessage);
      const unsubscribedMsg = responses.find(r => r.type === 'unsubscribed');
      expect(unsubscribedMsg).toBeDefined();
    });
  });

  describe('setMode Message', () => {
    it('should forward setMode to session manager', async () => {
      const session = createMockSession('device-1');
      sessionManager.sessions.set('device-1', session);

      const client = wss.simulateConnection();
      client.receiveMessage({ type: 'setMode', deviceId: 'device-1', mode: 'CV' });

      // Wait for async operation
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(sessionManager.setMode).toHaveBeenCalledWith('device-1', 'CV');
    });

    it('should send error for unknown device', async () => {
      const client = wss.simulateConnection();
      sessionManager.setMode = vi.fn().mockRejectedValue(new Error('Session not found'));

      client.receiveMessage({ type: 'setMode', deviceId: 'unknown', mode: 'CV' });

      await new Promise(resolve => setTimeout(resolve, 10));

      const responses = client.sentMessages.map(m => JSON.parse(m) as ServerMessage);
      const errorMsg = responses.find(r => r.type === 'error');
      expect(errorMsg).toBeDefined();
    });
  });

  describe('setOutput Message', () => {
    it('should forward setOutput to session manager', async () => {
      const session = createMockSession('device-1');
      sessionManager.sessions.set('device-1', session);

      const client = wss.simulateConnection();
      client.receiveMessage({ type: 'setOutput', deviceId: 'device-1', enabled: true });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(sessionManager.setOutput).toHaveBeenCalledWith('device-1', true);
    });
  });

  describe('setValue Message', () => {
    it('should forward setValue to session manager', async () => {
      const session = createMockSession('device-1');
      sessionManager.sessions.set('device-1', session);

      const client = wss.simulateConnection();
      client.receiveMessage({
        type: 'setValue',
        deviceId: 'device-1',
        name: 'current',
        value: 2.5,
        immediate: true,
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(sessionManager.setValue).toHaveBeenCalledWith('device-1', 'current', 2.5, true);
    });

    it('should default immediate to false', async () => {
      const session = createMockSession('device-1');
      sessionManager.sessions.set('device-1', session);

      const client = wss.simulateConnection();
      client.receiveMessage({
        type: 'setValue',
        deviceId: 'device-1',
        name: 'current',
        value: 2.5,
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(sessionManager.setValue).toHaveBeenCalledWith('device-1', 'current', 2.5, false);
    });
  });

  describe('Multiple Clients', () => {
    it('should handle multiple clients independently', () => {
      const session = createMockSession('device-1');
      sessionManager.sessions.set('device-1', session);

      const client1 = wss.simulateConnection();
      const client2 = wss.simulateConnection();

      client1.receiveMessage({ type: 'getDevices' });
      expect(client1.sentMessages.length).toBe(1);
      expect(client2.sentMessages.length).toBe(0);

      client2.receiveMessage({ type: 'getDevices' });
      expect(client2.sentMessages.length).toBe(1);
    });

    it('should clean up only disconnected client', () => {
      const client1 = wss.simulateConnection();
      const client2 = wss.simulateConnection();

      expect(handler.getClientCount()).toBe(2);

      client1.close();
      expect(handler.getClientCount()).toBe(1);

      // client2 should still be connected
      client2.receiveMessage({ type: 'getDevices' });
      expect(client2.sentMessages.length).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid JSON gracefully', () => {
      const client = wss.simulateConnection();

      // Send invalid JSON
      client.emit('message', 'not valid json');

      const response = JSON.parse(client.sentMessages[0]) as ServerMessage;
      expect(response.type).toBe('error');
      if (response.type === 'error') {
        expect(response.code).toBe('INVALID_MESSAGE');
      }
    });

    it('should handle unknown message type', () => {
      const client = wss.simulateConnection();

      client.emit('message', JSON.stringify({ type: 'unknownType' }));

      const response = JSON.parse(client.sentMessages[0]) as ServerMessage;
      expect(response.type).toBe('error');
      if (response.type === 'error') {
        expect(response.code).toBe('UNKNOWN_MESSAGE_TYPE');
      }
    });
  });

  describe('Broadcast', () => {
    it('should broadcast device list to all clients', () => {
      const client1 = wss.simulateConnection();
      const client2 = wss.simulateConnection();

      handler.broadcastDeviceList();

      expect(client1.sentMessages.length).toBe(1);
      expect(client2.sentMessages.length).toBe(1);

      const response1 = JSON.parse(client1.sentMessages[0]) as ServerMessage;
      const response2 = JSON.parse(client2.sentMessages[0]) as ServerMessage;
      expect(response1.type).toBe('deviceList');
      expect(response2.type).toBe('deviceList');
    });
  });
});
