import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { createWebSocketHandler, WebSocketHandler } from '../WebSocketHandler.js';
import type { SessionManager } from '../../sessions/SessionManager.js';
import type { DeviceSession } from '../../sessions/DeviceSession.js';
import type { SequenceManager } from '../../sequences/SequenceManager.js';
import type { ClientMessage, ServerMessage, DeviceSessionState, DeviceSummary, SequenceDefinition, SequenceState, Result } from '../../../shared/types.js';
import { Ok, Err } from '../../../shared/types.js';

// Helper to unwrap Result or throw
function unwrapResult<T>(result: Result<T, Error>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

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
      deviceClass: 'load',
      features: {},
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
    reconnectOscilloscopeSession: vi.fn(),
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
    setMode: vi.fn().mockResolvedValue(Ok()),
    setOutput: vi.fn().mockResolvedValue(Ok()),
    setValue: vi.fn().mockResolvedValue(Ok()),
    stop: vi.fn(),
    // Oscilloscope methods
    getOscilloscopeSession: (_id: string) => undefined,
    oscilloscopeRun: vi.fn().mockResolvedValue(Ok()),
    oscilloscopeStop: vi.fn().mockResolvedValue(Ok()),
    oscilloscopeSingle: vi.fn().mockResolvedValue(Ok()),
    oscilloscopeAutoSetup: vi.fn().mockResolvedValue(Ok()),
    oscilloscopeGetWaveform: vi.fn().mockResolvedValue(Ok({ channel: 'CHAN1', points: [], xIncrement: 1, xOrigin: 0, yIncrement: 1, yOrigin: 0, yReference: 0 })),
    oscilloscopeGetMeasurement: vi.fn().mockResolvedValue(Ok(1.5)),
    oscilloscopeGetScreenshot: vi.fn().mockResolvedValue(Ok(Buffer.from('test'))),
    // Oscilloscope setters
    oscilloscopeSetChannelEnabled: vi.fn().mockResolvedValue(Ok()),
    oscilloscopeSetChannelScale: vi.fn().mockResolvedValue(Ok()),
    oscilloscopeSetChannelOffset: vi.fn().mockResolvedValue(Ok()),
    oscilloscopeSetChannelCoupling: vi.fn().mockResolvedValue(Ok()),
    oscilloscopeSetChannelProbe: vi.fn().mockResolvedValue(Ok()),
    oscilloscopeSetChannelBwLimit: vi.fn().mockResolvedValue(Ok()),
    oscilloscopeSetTimebaseScale: vi.fn().mockResolvedValue(Ok()),
    oscilloscopeSetTimebaseOffset: vi.fn().mockResolvedValue(Ok()),
    oscilloscopeSetTriggerSource: vi.fn().mockResolvedValue(Ok()),
    oscilloscopeSetTriggerLevel: vi.fn().mockResolvedValue(Ok()),
    oscilloscopeSetTriggerEdge: vi.fn().mockResolvedValue(Ok()),
    oscilloscopeSetTriggerSweep: vi.fn().mockResolvedValue(Ok()),
    oscilloscopeStartStreaming: vi.fn().mockResolvedValue(Ok()),
    oscilloscopeStopStreaming: vi.fn().mockResolvedValue(Ok()),
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
      sessionManager.setMode = vi.fn().mockResolvedValue(Err(new Error('Session not found')));

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

  describe('Oscilloscope Channel Settings', () => {
    it('should forward scopeSetChannelEnabled to session manager', async () => {
      const client = wss.simulateConnection();
      client.receiveMessage({
        type: 'scopeSetChannelEnabled',
        deviceId: 'scope-1',
        channel: 'CHAN1',
        enabled: true,
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(sessionManager.oscilloscopeSetChannelEnabled).toHaveBeenCalledWith('scope-1', 'CHAN1', true);
    });

    it('should forward scopeSetChannelScale to session manager', async () => {
      const client = wss.simulateConnection();
      client.receiveMessage({
        type: 'scopeSetChannelScale',
        deviceId: 'scope-1',
        channel: 'CHAN1',
        scale: 0.5,
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(sessionManager.oscilloscopeSetChannelScale).toHaveBeenCalledWith('scope-1', 'CHAN1', 0.5);
    });

    it('should forward scopeSetChannelOffset to session manager', async () => {
      const client = wss.simulateConnection();
      client.receiveMessage({
        type: 'scopeSetChannelOffset',
        deviceId: 'scope-1',
        channel: 'CHAN2',
        offset: -1.5,
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(sessionManager.oscilloscopeSetChannelOffset).toHaveBeenCalledWith('scope-1', 'CHAN2', -1.5);
    });

    it('should forward scopeSetChannelCoupling to session manager', async () => {
      const client = wss.simulateConnection();
      client.receiveMessage({
        type: 'scopeSetChannelCoupling',
        deviceId: 'scope-1',
        channel: 'CHAN1',
        coupling: 'AC',
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(sessionManager.oscilloscopeSetChannelCoupling).toHaveBeenCalledWith('scope-1', 'CHAN1', 'AC');
    });

    it('should forward scopeSetChannelProbe to session manager', async () => {
      const client = wss.simulateConnection();
      client.receiveMessage({
        type: 'scopeSetChannelProbe',
        deviceId: 'scope-1',
        channel: 'CHAN1',
        ratio: 10,
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(sessionManager.oscilloscopeSetChannelProbe).toHaveBeenCalledWith('scope-1', 'CHAN1', 10);
    });

    it('should forward scopeSetChannelBwLimit to session manager', async () => {
      const client = wss.simulateConnection();
      client.receiveMessage({
        type: 'scopeSetChannelBwLimit',
        deviceId: 'scope-1',
        channel: 'CHAN1',
        enabled: true,
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(sessionManager.oscilloscopeSetChannelBwLimit).toHaveBeenCalledWith('scope-1', 'CHAN1', true);
    });
  });

  describe('Oscilloscope Timebase Settings', () => {
    it('should forward scopeSetTimebaseScale to session manager', async () => {
      const client = wss.simulateConnection();
      client.receiveMessage({
        type: 'scopeSetTimebaseScale',
        deviceId: 'scope-1',
        scale: 0.001,
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(sessionManager.oscilloscopeSetTimebaseScale).toHaveBeenCalledWith('scope-1', 0.001);
    });

    it('should forward scopeSetTimebaseOffset to session manager', async () => {
      const client = wss.simulateConnection();
      client.receiveMessage({
        type: 'scopeSetTimebaseOffset',
        deviceId: 'scope-1',
        offset: 0.0005,
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(sessionManager.oscilloscopeSetTimebaseOffset).toHaveBeenCalledWith('scope-1', 0.0005);
    });
  });

  describe('Oscilloscope Trigger Settings', () => {
    it('should forward scopeSetTriggerSource to session manager', async () => {
      const client = wss.simulateConnection();
      client.receiveMessage({
        type: 'scopeSetTriggerSource',
        deviceId: 'scope-1',
        source: 'CHAN2',
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(sessionManager.oscilloscopeSetTriggerSource).toHaveBeenCalledWith('scope-1', 'CHAN2');
    });

    it('should forward scopeSetTriggerLevel to session manager', async () => {
      const client = wss.simulateConnection();
      client.receiveMessage({
        type: 'scopeSetTriggerLevel',
        deviceId: 'scope-1',
        level: 1.5,
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(sessionManager.oscilloscopeSetTriggerLevel).toHaveBeenCalledWith('scope-1', 1.5);
    });

    it('should forward scopeSetTriggerEdge to session manager', async () => {
      const client = wss.simulateConnection();
      client.receiveMessage({
        type: 'scopeSetTriggerEdge',
        deviceId: 'scope-1',
        edge: 'falling',
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(sessionManager.oscilloscopeSetTriggerEdge).toHaveBeenCalledWith('scope-1', 'falling');
    });

    it('should forward scopeSetTriggerSweep to session manager', async () => {
      const client = wss.simulateConnection();
      client.receiveMessage({
        type: 'scopeSetTriggerSweep',
        deviceId: 'scope-1',
        sweep: 'normal',
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(sessionManager.oscilloscopeSetTriggerSweep).toHaveBeenCalledWith('scope-1', 'normal');
    });
  });

  describe('Oscilloscope Streaming', () => {
    it('should forward scopeStartStreaming to session manager', async () => {
      const client = wss.simulateConnection();
      client.receiveMessage({
        type: 'scopeStartStreaming',
        deviceId: 'scope-1',
        channels: ['CHAN1', 'CHAN2'],
        intervalMs: 200,
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(sessionManager.oscilloscopeStartStreaming).toHaveBeenCalledWith('scope-1', ['CHAN1', 'CHAN2'], 200, undefined);
    });

    it('should forward scopeStopStreaming to session manager', async () => {
      const client = wss.simulateConnection();
      client.receiveMessage({
        type: 'scopeStopStreaming',
        deviceId: 'scope-1',
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(sessionManager.oscilloscopeStopStreaming).toHaveBeenCalledWith('scope-1');
    });
  });
});

// ============ Sequence WebSocket Tests ============

// Create mock sequence manager
function createMockSequenceManager(): SequenceManager {
  const library: SequenceDefinition[] = [];
  const subscribers = new Set<(msg: ServerMessage) => void>();
  let idCounter = 0;

  return {
    listLibrary: vi.fn(() => library),
    saveToLibrary: vi.fn((partial) => {
      const id = `seq-${++idCounter}`;
      const def: SequenceDefinition = {
        ...partial,
        id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      library.push(def);
      return Ok(id);
    }),
    updateInLibrary: vi.fn((def) => {
      const idx = library.findIndex((s) => s.id === def.id);
      if (idx === -1) return Err(new Error('Not found'));
      library[idx] = def;
      return Ok();
    }),
    deleteFromLibrary: vi.fn((id) => {
      const idx = library.findIndex((s) => s.id === id);
      if (idx === -1) return Err(new Error('Not found'));
      library.splice(idx, 1);
      return Ok();
    }),
    getFromLibrary: vi.fn((id) => library.find((s) => s.id === id)),
    run: vi.fn().mockResolvedValue(
      Ok({
        sequenceId: 'seq-1',
        runConfig: { sequenceId: 'seq-1', deviceId: 'device-1', parameter: 'voltage', repeatMode: 'once' },
        executionState: 'running',
        currentStepIndex: 0,
        totalSteps: 5,
        currentCycle: 0,
        totalCycles: 1,
        startedAt: Date.now(),
        elapsedMs: 0,
        commandedValue: 0,
      } as SequenceState)
    ),
    abort: vi.fn().mockImplementation(async () => {}),
    getActiveState: vi.fn(),
    subscribe: vi.fn((callback) => {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    }),
    initialize: vi.fn().mockImplementation(async () => {}),
    stop: vi.fn().mockImplementation(async () => {}),
  };
}

describe('WebSocketHandler Sequence Messages', () => {
  let wss: MockWebSocketServer;
  let sessionManager: ReturnType<typeof createMockSessionManager>;
  let sequenceManager: ReturnType<typeof createMockSequenceManager>;
  let handler: WebSocketHandler;

  beforeEach(() => {
    wss = new MockWebSocketServer();
    sessionManager = createMockSessionManager();
    sequenceManager = createMockSequenceManager();
    handler = createWebSocketHandler(wss as any, sessionManager, sequenceManager);
  });

  afterEach(() => {
    handler.close();
  });

  describe('Library Messages', () => {
    it('should respond to sequenceLibraryList with library contents', () => {
      // Add a sequence first
      unwrapResult(sequenceManager.saveToLibrary({
        name: 'Test Seq',
        unit: 'V',
        waveform: { type: 'ramp', min: 0, max: 10, pointsPerCycle: 5, intervalMs: 100 },
      }));

      const client = wss.simulateConnection();
      client.receiveMessage({ type: 'sequenceLibraryList' });

      expect(client.sentMessages.length).toBe(1);
      const response = JSON.parse(client.sentMessages[0]) as ServerMessage;
      expect(response.type).toBe('sequenceLibrary');
      if (response.type === 'sequenceLibrary') {
        expect(response.sequences.length).toBe(1);
        expect(response.sequences[0].name).toBe('Test Seq');
      }
    });

    it('should save sequence and respond with ID', () => {
      const client = wss.simulateConnection();
      client.receiveMessage({
        type: 'sequenceLibrarySave',
        definition: {
          name: 'New Seq',
          unit: 'A',
          waveform: { type: 'sine', min: 0, max: 5, pointsPerCycle: 10, intervalMs: 50 },
        },
      });

      expect(sequenceManager.saveToLibrary).toHaveBeenCalled();
      expect(client.sentMessages.length).toBe(1);
      const response = JSON.parse(client.sentMessages[0]) as ServerMessage;
      expect(response.type).toBe('sequenceLibrarySaved');
      if (response.type === 'sequenceLibrarySaved') {
        expect(response.sequenceId).toMatch(/^seq-/);
      }
    });

    it('should update sequence in library', () => {
      // First save a sequence
      const id = unwrapResult(sequenceManager.saveToLibrary({
        name: 'Original',
        unit: 'V',
        waveform: { type: 'ramp', min: 0, max: 10, pointsPerCycle: 5, intervalMs: 100 },
      }));

      const client = wss.simulateConnection();
      const updated: SequenceDefinition = {
        id,
        name: 'Updated',
        unit: 'V',
        waveform: { type: 'ramp', min: 0, max: 10, pointsPerCycle: 5, intervalMs: 100 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      client.receiveMessage({
        type: 'sequenceLibraryUpdate',
        definition: updated,
      });

      expect(sequenceManager.updateInLibrary).toHaveBeenCalledWith(updated);
    });

    it('should delete sequence from library', () => {
      const id = unwrapResult(sequenceManager.saveToLibrary({
        name: 'To Delete',
        unit: 'V',
        waveform: { type: 'ramp', min: 0, max: 10, pointsPerCycle: 5, intervalMs: 100 },
      }));

      const client = wss.simulateConnection();
      client.receiveMessage({
        type: 'sequenceLibraryDelete',
        sequenceId: id,
      });

      expect(sequenceManager.deleteFromLibrary).toHaveBeenCalledWith(id);
      expect(client.sentMessages.length).toBe(1);
      const response = JSON.parse(client.sentMessages[0]) as ServerMessage;
      expect(response.type).toBe('sequenceLibraryDeleted');
      if (response.type === 'sequenceLibraryDeleted') {
        expect(response.sequenceId).toBe(id);
      }
    });
  });

  describe('Playback Messages', () => {
    it('should run sequence with config', async () => {
      const client = wss.simulateConnection();
      client.receiveMessage({
        type: 'sequenceRun',
        config: {
          sequenceId: 'seq-1',
          deviceId: 'device-1',
          parameter: 'voltage',
          repeatMode: 'once',
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(sequenceManager.run).toHaveBeenCalledWith({
        sequenceId: 'seq-1',
        deviceId: 'device-1',
        parameter: 'voltage',
        repeatMode: 'once',
      });
    });

    it('should abort sequence', async () => {
      const client = wss.simulateConnection();
      client.receiveMessage({ type: 'sequenceAbort' });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(sequenceManager.abort).toHaveBeenCalled();
    });

    it('should handle run errors', async () => {
      (sequenceManager.run as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        Err(new Error('Sequence not found'))
      );

      const client = wss.simulateConnection();
      client.receiveMessage({
        type: 'sequenceRun',
        config: {
          sequenceId: 'non-existent',
          deviceId: 'device-1',
          parameter: 'voltage',
          repeatMode: 'once',
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(client.sentMessages.length).toBe(1);
      const response = JSON.parse(client.sentMessages[0]) as ServerMessage;
      expect(response.type).toBe('error');
      if (response.type === 'error') {
        expect(response.message).toContain('Sequence not found');
      }
    });
  });

  describe('Without SequenceManager', () => {
    it('should respond with error for library list when no sequence manager', () => {
      // Create fresh mocks for this test
      const wssNoSeq = new MockWebSocketServer();
      const sessionMgrNoSeq = createMockSessionManager();
      const handlerNoSeq = createWebSocketHandler(wssNoSeq as any, sessionMgrNoSeq);
      const client = wssNoSeq.simulateConnection();

      client.receiveMessage({ type: 'sequenceLibraryList' });

      expect(client.sentMessages.length).toBe(1);
      const response = JSON.parse(client.sentMessages[0]) as ServerMessage;
      expect(response.type).toBe('error');
      if (response.type === 'error') {
        expect(response.code).toBe('SEQUENCE_NOT_AVAILABLE');
        expect(response.message).toContain('not available');
      }

      handlerNoSeq.close();
    });

    it('should respond with error for run when no sequence manager', async () => {
      // Create fresh mocks for this test
      const wssNoSeq = new MockWebSocketServer();
      const sessionMgrNoSeq = createMockSessionManager();
      const handlerNoSeq = createWebSocketHandler(wssNoSeq as any, sessionMgrNoSeq);
      const client = wssNoSeq.simulateConnection();

      client.receiveMessage({
        type: 'sequenceRun',
        config: {
          sequenceId: 'seq-1',
          deviceId: 'device-1',
          parameter: 'voltage',
          repeatMode: 'once',
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(client.sentMessages.length).toBe(1);
      const response = JSON.parse(client.sentMessages[0]) as ServerMessage;
      expect(response.type).toBe('error');
      if (response.type === 'error') {
        expect(response.code).toBe('SEQUENCE_NOT_AVAILABLE');
        expect(response.message).toContain('not available');
      }

      handlerNoSeq.close();
    });
  });
});
