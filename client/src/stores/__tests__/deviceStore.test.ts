import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from 'vitest';
import { act } from '@testing-library/react';

// Mock state needs to be declared before vi.mock due to hoisting
const mockState = {
  send: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  getState: vi.fn(() => 'disconnected'),
  messageHandlers: [] as ((msg: unknown) => void)[],
  stateHandlers: [] as ((state: string) => void)[],
};

vi.mock('../../websocket', () => ({
  getWebSocketManager: () => ({
    send: (...args: unknown[]) => mockState.send(...args),
    connect: () => mockState.connect(),
    disconnect: () => mockState.disconnect(),
    getState: () => mockState.getState(),
    onMessage: (handler: (msg: unknown) => void) => {
      mockState.messageHandlers.push(handler);
      return () => {
        mockState.messageHandlers = mockState.messageHandlers.filter(h => h !== handler);
      };
    },
    onStateChange: (handler: (state: string) => void) => {
      mockState.stateHandlers.push(handler);
      return () => {
        mockState.stateHandlers = mockState.stateHandlers.filter(h => h !== handler);
      };
    },
  }),
}));

// Import after mock is set up
import { useDeviceStore, selectDevice, selectDeviceState, selectIsSubscribed } from '../deviceStore';

// Helper to simulate WebSocket messages
function simulateMessage(msg: unknown) {
  mockState.messageHandlers.forEach(h => h(msg));
}

// Helper to simulate connection state changes
function simulateStateChange(state: string) {
  mockState.stateHandlers.forEach(h => h(state));
}

describe('deviceStore', () => {
  // Initialize store handlers once before all tests
  beforeAll(() => {
    // Trigger store initialization by calling connect
    useDeviceStore.getState().connect();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store state but keep handlers registered
    useDeviceStore.setState({
      connectionState: 'disconnected',
      devices: [],
      isLoadingDevices: true,
      deviceListError: null,
      deviceStates: {},
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Initial state', () => {
    it('should have correct initial state', () => {
      const state = useDeviceStore.getState();
      expect(state.connectionState).toBe('disconnected');
      expect(state.devices).toEqual([]);
      expect(state.isLoadingDevices).toBe(true);
      expect(state.deviceListError).toBeNull();
      expect(state.deviceStates).toEqual({});
    });
  });

  describe('Connection actions', () => {
    it('connect should call websocket connect and request devices', () => {
      act(() => {
        useDeviceStore.getState().connect();
      });

      expect(mockState.connect).toHaveBeenCalled();
      expect(mockState.send).toHaveBeenCalledWith({ type: 'getDevices' });
    });

    it('disconnect should call websocket disconnect', () => {
      act(() => {
        useDeviceStore.getState().disconnect();
      });

      expect(mockState.disconnect).toHaveBeenCalled();
    });
  });

  describe('Device list actions', () => {
    it('refreshDevices should set loading and request devices', () => {
      useDeviceStore.setState({ isLoadingDevices: false });

      act(() => {
        useDeviceStore.getState().refreshDevices();
      });

      expect(useDeviceStore.getState().isLoadingDevices).toBe(true);
      expect(mockState.send).toHaveBeenCalledWith({ type: 'getDevices' });
    });

    it('scanDevices should set loading and request scan', () => {
      useDeviceStore.setState({ isLoadingDevices: false });

      act(() => {
        useDeviceStore.getState().scanDevices();
      });

      expect(useDeviceStore.getState().isLoadingDevices).toBe(true);
      expect(mockState.send).toHaveBeenCalledWith({ type: 'scan' });
    });
  });

  describe('Device subscription actions', () => {
    it('subscribeDevice should send subscribe message', () => {
      act(() => {
        useDeviceStore.getState().subscribeDevice('device-1');
      });

      expect(mockState.send).toHaveBeenCalledWith({ type: 'subscribe', deviceId: 'device-1' });
    });

    it('unsubscribeDevice should send unsubscribe and update state', () => {
      // First set up a subscribed device
      useDeviceStore.setState({
        deviceStates: {
          'device-1': {
            sessionState: null,
            isSubscribed: true,
            error: null,
          },
        },
      });

      act(() => {
        useDeviceStore.getState().unsubscribeDevice('device-1');
      });

      expect(mockState.send).toHaveBeenCalledWith({ type: 'unsubscribe', deviceId: 'device-1' });
      expect(useDeviceStore.getState().deviceStates['device-1'].isSubscribed).toBe(false);
    });
  });

  describe('Device control actions', () => {
    it('setMode should send setMode message', () => {
      act(() => {
        useDeviceStore.getState().setMode('device-1', 'CV');
      });

      expect(mockState.send).toHaveBeenCalledWith({ type: 'setMode', deviceId: 'device-1', mode: 'CV' });
    });

    it('setOutput should send setOutput message', () => {
      act(() => {
        useDeviceStore.getState().setOutput('device-1', true);
      });

      expect(mockState.send).toHaveBeenCalledWith({ type: 'setOutput', deviceId: 'device-1', enabled: true });
    });

    it('setValue should send setValue message', () => {
      act(() => {
        useDeviceStore.getState().setValue('device-1', 'voltage', 12.5, true);
      });

      expect(mockState.send).toHaveBeenCalledWith({
        type: 'setValue',
        deviceId: 'device-1',
        name: 'voltage',
        value: 12.5,
        immediate: true,
      });
    });
  });

  describe('Message handling', () => {
    // Handlers are already set up from beforeAll

    describe('deviceList message', () => {
      it('should update devices and loading state', () => {
        const mockDevices = [
          { id: 'device-1', info: { manufacturer: 'Rigol', model: 'DP832' } },
          { id: 'device-2', info: { manufacturer: 'Siglent', model: 'SPD3303X' } },
        ];

        act(() => {
          simulateMessage({ type: 'deviceList', devices: mockDevices });
        });

        const state = useDeviceStore.getState();
        expect(state.devices).toEqual(mockDevices);
        expect(state.isLoadingDevices).toBe(false);
        expect(state.deviceListError).toBeNull();
      });
    });

    describe('subscribed message', () => {
      it('should update device state on subscription', () => {
        const mockState = {
          info: { id: 'device-1', type: 'power-supply' },
          mode: 'CV',
          outputEnabled: false,
          measurements: { voltage: 0, current: 0, power: 0 },
          setpoints: { voltage: 12, current: 1 },
          history: { timestamps: [], voltage: [], current: [], power: [] },
        };

        act(() => {
          simulateMessage({
            type: 'subscribed',
            deviceId: 'device-1',
            state: mockState,
          });
        });

        const deviceState = useDeviceStore.getState().deviceStates['device-1'];
        expect(deviceState.isSubscribed).toBe(true);
        expect(deviceState.sessionState).toEqual(mockState);
        expect(deviceState.error).toBeNull();
      });

      it('should ignore oscilloscope subscriptions (has capabilities)', () => {
        const mockOscilloscopeState = {
          info: { id: 'scope-1', type: 'oscilloscope' },
          capabilities: { channels: 4, bandwidth: 100 },
        };

        act(() => {
          simulateMessage({
            type: 'subscribed',
            deviceId: 'scope-1',
            state: mockOscilloscopeState,
          });
        });

        // Should not be in device store (oscilloscopes go to oscilloscopeStore)
        expect(useDeviceStore.getState().deviceStates['scope-1']).toBeUndefined();
      });
    });

    describe('unsubscribed message', () => {
      it('should mark device as unsubscribed', () => {
        // Set up initial state
        useDeviceStore.setState({
          deviceStates: {
            'device-1': { sessionState: null, isSubscribed: true, error: null },
          },
        });

        act(() => {
          simulateMessage({ type: 'unsubscribed', deviceId: 'device-1' });
        });

        expect(useDeviceStore.getState().deviceStates['device-1'].isSubscribed).toBe(false);
      });
    });

    describe('measurement message', () => {
      it('should update measurements and history', () => {
        // Set up initial state with a device
        useDeviceStore.setState({
          deviceStates: {
            'device-1': {
              sessionState: {
                measurements: { voltage: 0, current: 0, power: 0 },
                history: { timestamps: [], voltage: [], current: [], power: [] },
              },
              isSubscribed: true,
              error: null,
            },
          },
        });

        act(() => {
          simulateMessage({
            type: 'measurement',
            deviceId: 'device-1',
            update: {
              timestamp: 1000,
              measurements: { voltage: 12.5, current: 1.2, power: 15 },
            },
          });
        });

        const state = useDeviceStore.getState().deviceStates['device-1'].sessionState;
        expect(state.measurements).toEqual({ voltage: 12.5, current: 1.2, power: 15 });
        expect(state.history.timestamps).toEqual([1000]);
        expect(state.history.voltage).toEqual([12.5]);
        expect(state.history.current).toEqual([1.2]);
        expect(state.history.power).toEqual([15]);
      });
    });

    describe('field message', () => {
      it('should update mode field', () => {
        useDeviceStore.setState({
          deviceStates: {
            'device-1': {
              sessionState: { mode: 'CV' },
              isSubscribed: true,
              error: null,
            },
          },
        });

        act(() => {
          simulateMessage({ type: 'field', deviceId: 'device-1', field: 'mode', value: 'CC' });
        });

        expect(useDeviceStore.getState().deviceStates['device-1'].sessionState.mode).toBe('CC');
      });

      it('should update outputEnabled field', () => {
        useDeviceStore.setState({
          deviceStates: {
            'device-1': {
              sessionState: { outputEnabled: false },
              isSubscribed: true,
              error: null,
            },
          },
        });

        act(() => {
          simulateMessage({ type: 'field', deviceId: 'device-1', field: 'outputEnabled', value: true });
        });

        expect(useDeviceStore.getState().deviceStates['device-1'].sessionState.outputEnabled).toBe(true);
      });
    });

    describe('error message', () => {
      it('should set device-specific error', () => {
        useDeviceStore.setState({
          deviceStates: {
            'device-1': { sessionState: null, isSubscribed: true, error: null },
          },
        });

        act(() => {
          simulateMessage({ type: 'error', deviceId: 'device-1', message: 'Connection lost' });
        });

        expect(useDeviceStore.getState().deviceStates['device-1'].error).toBe('Connection lost');
      });

      it('should set global error for non-device errors', () => {
        act(() => {
          simulateMessage({ type: 'error', message: 'Server error' });
        });

        expect(useDeviceStore.getState().deviceListError).toBe('Server error');
        expect(useDeviceStore.getState().isLoadingDevices).toBe(false);
      });
    });
  });

  describe('Selectors', () => {
    it('selectDevice should return device state or default', () => {
      useDeviceStore.setState({
        deviceStates: {
          'device-1': { sessionState: { mode: 'CV' }, isSubscribed: true, error: null },
        },
      });

      const existing = selectDevice('device-1')(useDeviceStore.getState());
      expect(existing.isSubscribed).toBe(true);

      const nonExisting = selectDevice('device-999')(useDeviceStore.getState());
      expect(nonExisting).toEqual({ sessionState: null, isSubscribed: false, error: null });
    });

    it('selectDeviceState should return session state or null', () => {
      useDeviceStore.setState({
        deviceStates: {
          'device-1': { sessionState: { mode: 'CV' }, isSubscribed: true, error: null },
        },
      });

      expect(selectDeviceState('device-1')(useDeviceStore.getState())).toEqual({ mode: 'CV' });
      expect(selectDeviceState('device-999')(useDeviceStore.getState())).toBeNull();
    });

    it('selectIsSubscribed should return subscription status', () => {
      useDeviceStore.setState({
        deviceStates: {
          'device-1': { sessionState: null, isSubscribed: true, error: null },
        },
      });

      expect(selectIsSubscribed('device-1')(useDeviceStore.getState())).toBe(true);
      expect(selectIsSubscribed('device-999')(useDeviceStore.getState())).toBe(false);
    });
  });

  describe('Error handling', () => {
    it('clearDeviceError should clear device error', () => {
      useDeviceStore.setState({
        deviceStates: {
          'device-1': { sessionState: null, isSubscribed: true, error: 'Some error' },
        },
      });

      act(() => {
        useDeviceStore.getState().clearDeviceError('device-1');
      });

      expect(useDeviceStore.getState().deviceStates['device-1'].error).toBeNull();
    });
  });
});
