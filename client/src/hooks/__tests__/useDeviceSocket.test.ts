import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ServerMessage, DeviceSessionState } from '../../../../shared/types';

// Create mock device state
function createMockState(deviceId: string): DeviceSessionState {
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

// Mock the websocket manager
const mockSend = vi.fn();
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
let mockOnMessageHandler: ((msg: ServerMessage) => void) | null = null;
let mockOnStateHandler: ((state: string) => void) | null = null;
let mockState = 'disconnected';

vi.mock('../../websocket', () => ({
  getWebSocketManager: () => ({
    connect: mockConnect,
    disconnect: mockDisconnect,
    send: mockSend,
    getState: () => mockState,
    onMessage: (handler: (msg: ServerMessage) => void) => {
      mockOnMessageHandler = handler;
      return () => { mockOnMessageHandler = null; };
    },
    onStateChange: (handler: (state: string) => void) => {
      mockOnStateHandler = handler;
      return () => { mockOnStateHandler = null; };
    },
  }),
  resetWebSocketManager: vi.fn(),
}));

// Helper to simulate receiving a message
function simulateMessage(msg: ServerMessage): void {
  if (mockOnMessageHandler) {
    mockOnMessageHandler(msg);
  }
}

// Helper to simulate connection state change
function simulateConnectionChange(state: string): void {
  mockState = state;
  if (mockOnStateHandler) {
    mockOnStateHandler(state);
  }
}

describe('useDeviceSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOnMessageHandler = null;
    mockOnStateHandler = null;
    mockState = 'disconnected';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Import the hook after mocking
  async function getHook() {
    const { useDeviceSocket } = await import('../useDeviceSocket');
    return useDeviceSocket;
  }

  describe('Initial State', () => {
    it('should start with null state', async () => {
      const useDeviceSocket = await getHook();
      const { result } = renderHook(() => useDeviceSocket('device-1'));

      expect(result.current.state).toBeNull();
      expect(result.current.isSubscribed).toBe(false);
    });

    it('should connect on mount', async () => {
      const useDeviceSocket = await getHook();
      renderHook(() => useDeviceSocket('device-1'));

      expect(mockConnect).toHaveBeenCalled();
    });
  });

  describe('Subscription', () => {
    it('should send subscribe message when subscribe is called', async () => {
      const useDeviceSocket = await getHook();
      const { result } = renderHook(() => useDeviceSocket('device-1'));

      act(() => {
        result.current.subscribe();
      });

      expect(mockSend).toHaveBeenCalledWith({
        type: 'subscribe',
        deviceId: 'device-1',
      });
    });

    it('should update state when subscribed message is received', async () => {
      const useDeviceSocket = await getHook();
      const { result } = renderHook(() => useDeviceSocket('device-1'));

      const mockState = createMockState('device-1');

      act(() => {
        simulateMessage({
          type: 'subscribed',
          deviceId: 'device-1',
          state: mockState,
        });
      });

      expect(result.current.state).not.toBeNull();
      expect(result.current.state?.info.id).toBe('device-1');
      expect(result.current.isSubscribed).toBe(true);
    });

    it('should ignore subscribed messages for other devices', async () => {
      const useDeviceSocket = await getHook();
      const { result } = renderHook(() => useDeviceSocket('device-1'));

      act(() => {
        simulateMessage({
          type: 'subscribed',
          deviceId: 'device-2',
          state: createMockState('device-2'),
        });
      });

      expect(result.current.state).toBeNull();
      expect(result.current.isSubscribed).toBe(false);
    });
  });

  describe('Unsubscription', () => {
    it('should send unsubscribe message', async () => {
      const useDeviceSocket = await getHook();
      const { result } = renderHook(() => useDeviceSocket('device-1'));

      act(() => {
        result.current.unsubscribe();
      });

      expect(mockSend).toHaveBeenCalledWith({
        type: 'unsubscribe',
        deviceId: 'device-1',
      });
    });

    it('should update isSubscribed when unsubscribed', async () => {
      const useDeviceSocket = await getHook();
      const { result } = renderHook(() => useDeviceSocket('device-1'));

      // First subscribe
      act(() => {
        simulateMessage({
          type: 'subscribed',
          deviceId: 'device-1',
          state: createMockState('device-1'),
        });
      });

      expect(result.current.isSubscribed).toBe(true);

      // Then unsubscribe
      act(() => {
        result.current.unsubscribe();
      });

      expect(result.current.isSubscribed).toBe(false);
    });
  });

  describe('Measurement Updates', () => {
    it('should update measurements when measurement message is received', async () => {
      const useDeviceSocket = await getHook();
      const { result } = renderHook(() => useDeviceSocket('device-1'));

      // First subscribe
      act(() => {
        simulateMessage({
          type: 'subscribed',
          deviceId: 'device-1',
          state: createMockState('device-1'),
        });
      });

      const initialVoltage = result.current.state?.measurements.voltage;

      // Receive measurement update
      act(() => {
        simulateMessage({
          type: 'measurement',
          deviceId: 'device-1',
          update: {
            timestamp: Date.now(),
            measurements: { voltage: 15.0, current: 1.2, power: 18.0 },
          },
        });
      });

      expect(result.current.state?.measurements.voltage).toBe(15.0);
      expect(result.current.state?.measurements.voltage).not.toBe(initialVoltage);
    });

    it('should append to history when measurement is received', async () => {
      const useDeviceSocket = await getHook();
      const { result } = renderHook(() => useDeviceSocket('device-1'));

      // Subscribe first
      act(() => {
        simulateMessage({
          type: 'subscribed',
          deviceId: 'device-1',
          state: createMockState('device-1'),
        });
      });

      const initialHistoryLength = result.current.state?.history.timestamps.length;

      // Receive measurement
      act(() => {
        simulateMessage({
          type: 'measurement',
          deviceId: 'device-1',
          update: {
            timestamp: Date.now(),
            measurements: { voltage: 15.0, current: 1.2, power: 18.0 },
          },
        });
      });

      expect(result.current.state?.history.timestamps.length).toBe((initialHistoryLength ?? 0) + 1);
    });
  });

  describe('Field Updates', () => {
    it('should update mode when field message is received', async () => {
      const useDeviceSocket = await getHook();
      const { result } = renderHook(() => useDeviceSocket('device-1'));

      act(() => {
        simulateMessage({
          type: 'subscribed',
          deviceId: 'device-1',
          state: createMockState('device-1'),
        });
      });

      expect(result.current.state?.mode).toBe('CC');

      act(() => {
        simulateMessage({
          type: 'field',
          deviceId: 'device-1',
          field: 'mode',
          value: 'CV',
        });
      });

      expect(result.current.state?.mode).toBe('CV');
    });

    it('should update outputEnabled when field message is received', async () => {
      const useDeviceSocket = await getHook();
      const { result } = renderHook(() => useDeviceSocket('device-1'));

      act(() => {
        simulateMessage({
          type: 'subscribed',
          deviceId: 'device-1',
          state: createMockState('device-1'),
        });
      });

      expect(result.current.state?.outputEnabled).toBe(false);

      act(() => {
        simulateMessage({
          type: 'field',
          deviceId: 'device-1',
          field: 'outputEnabled',
          value: true,
        });
      });

      expect(result.current.state?.outputEnabled).toBe(true);
    });

    it('should update connectionStatus when field message is received', async () => {
      const useDeviceSocket = await getHook();
      const { result } = renderHook(() => useDeviceSocket('device-1'));

      act(() => {
        simulateMessage({
          type: 'subscribed',
          deviceId: 'device-1',
          state: createMockState('device-1'),
        });
      });

      act(() => {
        simulateMessage({
          type: 'field',
          deviceId: 'device-1',
          field: 'connectionStatus',
          value: 'error',
        });
      });

      expect(result.current.state?.connectionStatus).toBe('error');
    });
  });

  describe('Actions', () => {
    it('should send setMode message', async () => {
      const useDeviceSocket = await getHook();
      const { result } = renderHook(() => useDeviceSocket('device-1'));

      act(() => {
        result.current.setMode('CV');
      });

      expect(mockSend).toHaveBeenCalledWith({
        type: 'setMode',
        deviceId: 'device-1',
        mode: 'CV',
      });
    });

    it('should send setOutput message', async () => {
      const useDeviceSocket = await getHook();
      const { result } = renderHook(() => useDeviceSocket('device-1'));

      act(() => {
        result.current.setOutput(true);
      });

      expect(mockSend).toHaveBeenCalledWith({
        type: 'setOutput',
        deviceId: 'device-1',
        enabled: true,
      });
    });

    it('should send setValue message with default immediate=false', async () => {
      const useDeviceSocket = await getHook();
      const { result } = renderHook(() => useDeviceSocket('device-1'));

      act(() => {
        result.current.setValue('current', 2.5);
      });

      expect(mockSend).toHaveBeenCalledWith({
        type: 'setValue',
        deviceId: 'device-1',
        name: 'current',
        value: 2.5,
        immediate: false,
      });
    });

    it('should send setValue message with immediate=true when specified', async () => {
      const useDeviceSocket = await getHook();
      const { result } = renderHook(() => useDeviceSocket('device-1'));

      act(() => {
        result.current.setValue('current', 2.5, true);
      });

      expect(mockSend).toHaveBeenCalledWith({
        type: 'setValue',
        deviceId: 'device-1',
        name: 'current',
        value: 2.5,
        immediate: true,
      });
    });
  });

  describe('Error Handling', () => {
    it('should set error when error message is received for this device', async () => {
      const useDeviceSocket = await getHook();
      const { result } = renderHook(() => useDeviceSocket('device-1'));

      act(() => {
        simulateMessage({
          type: 'error',
          deviceId: 'device-1',
          code: 'DEVICE_NOT_FOUND',
          message: 'Device not found',
        });
      });

      expect(result.current.error).toBe('Device not found');
    });

    it('should set error when error message has no deviceId', async () => {
      const useDeviceSocket = await getHook();
      const { result } = renderHook(() => useDeviceSocket('device-1'));

      act(() => {
        simulateMessage({
          type: 'error',
          code: 'CONNECTION_ERROR',
          message: 'Connection lost',
        });
      });

      expect(result.current.error).toBe('Connection lost');
    });

    it('should not set error for other devices', async () => {
      const useDeviceSocket = await getHook();
      const { result } = renderHook(() => useDeviceSocket('device-1'));

      act(() => {
        simulateMessage({
          type: 'error',
          deviceId: 'device-2',
          code: 'DEVICE_NOT_FOUND',
          message: 'Device not found',
        });
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe('Connection State', () => {
    it('should update connection state when it changes', async () => {
      const useDeviceSocket = await getHook();
      const { result } = renderHook(() => useDeviceSocket('device-1'));

      expect(result.current.connectionState).toBe('disconnected');

      act(() => {
        simulateConnectionChange('connected');
      });

      expect(result.current.connectionState).toBe('connected');
    });
  });
});
