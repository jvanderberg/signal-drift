import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { DeviceSessionState } from '../../../../shared/types';

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

// Mock store state and actions
const mockStoreState = {
  connectionState: 'disconnected' as string,
  deviceStates: {} as Record<string, { sessionState: DeviceSessionState | null; isSubscribed: boolean; error: string | null }>,
  connect: vi.fn(),
  subscribeDevice: vi.fn(),
  unsubscribeDevice: vi.fn(),
  setMode: vi.fn(),
  setOutput: vi.fn(),
  setValue: vi.fn(),
  clearDeviceError: vi.fn(),
};

// Mock the stores module
vi.mock('../../stores', () => ({
  useDeviceStore: (selector: (state: typeof mockStoreState) => unknown) => {
    if (typeof selector === 'function') {
      return selector(mockStoreState);
    }
    return mockStoreState;
  },
  selectDeviceState: (deviceId: string) => (state: typeof mockStoreState) =>
    state.deviceStates[deviceId]?.sessionState ?? null,
  selectIsSubscribed: (deviceId: string) => (state: typeof mockStoreState) =>
    state.deviceStates[deviceId]?.isSubscribed ?? false,
  selectDeviceError: (deviceId: string) => (state: typeof mockStoreState) =>
    state.deviceStates[deviceId]?.error ?? null,
}));

describe('useDeviceSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreState.connectionState = 'disconnected';
    mockStoreState.deviceStates = {};
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
    it('should start with null state when device not in store', async () => {
      const useDeviceSocket = await getHook();
      const { result } = renderHook(() => useDeviceSocket('device-1'));

      expect(result.current.state).toBeNull();
      expect(result.current.isSubscribed).toBe(false);
    });

    it('should call connect on mount', async () => {
      const useDeviceSocket = await getHook();
      renderHook(() => useDeviceSocket('device-1'));

      expect(mockStoreState.connect).toHaveBeenCalled();
    });

    it('should return connection state from store', async () => {
      mockStoreState.connectionState = 'connected';
      const useDeviceSocket = await getHook();
      const { result } = renderHook(() => useDeviceSocket('device-1'));

      expect(result.current.connectionState).toBe('connected');
    });
  });

  describe('Store State Integration', () => {
    it('should return device state from store', async () => {
      const mockState = createMockState('device-1');
      mockStoreState.deviceStates['device-1'] = {
        sessionState: mockState,
        isSubscribed: true,
        error: null,
      };

      const useDeviceSocket = await getHook();
      const { result } = renderHook(() => useDeviceSocket('device-1'));

      expect(result.current.state).toEqual(mockState);
      expect(result.current.isSubscribed).toBe(true);
    });

    it('should return error from store', async () => {
      mockStoreState.deviceStates['device-1'] = {
        sessionState: null,
        isSubscribed: false,
        error: 'Device not found',
      };

      const useDeviceSocket = await getHook();
      const { result } = renderHook(() => useDeviceSocket('device-1'));

      expect(result.current.error).toBe('Device not found');
    });
  });

  describe('Actions', () => {
    it('should call subscribeDevice when subscribe is called', async () => {
      const useDeviceSocket = await getHook();
      const { result } = renderHook(() => useDeviceSocket('device-1'));

      act(() => {
        result.current.subscribe();
      });

      expect(mockStoreState.subscribeDevice).toHaveBeenCalledWith('device-1');
    });

    it('should call unsubscribeDevice when unsubscribe is called', async () => {
      const useDeviceSocket = await getHook();
      const { result } = renderHook(() => useDeviceSocket('device-1'));

      act(() => {
        result.current.unsubscribe();
      });

      expect(mockStoreState.unsubscribeDevice).toHaveBeenCalledWith('device-1');
    });

    it('should call setMode with deviceId and mode', async () => {
      const useDeviceSocket = await getHook();
      const { result } = renderHook(() => useDeviceSocket('device-1'));

      act(() => {
        result.current.setMode('CV');
      });

      expect(mockStoreState.setMode).toHaveBeenCalledWith('device-1', 'CV');
    });

    it('should call setOutput with deviceId and enabled', async () => {
      const useDeviceSocket = await getHook();
      const { result } = renderHook(() => useDeviceSocket('device-1'));

      act(() => {
        result.current.setOutput(true);
      });

      expect(mockStoreState.setOutput).toHaveBeenCalledWith('device-1', true);
    });

    it('should call setValue with deviceId, name, value, and immediate', async () => {
      const useDeviceSocket = await getHook();
      const { result } = renderHook(() => useDeviceSocket('device-1'));

      act(() => {
        result.current.setValue('current', 2.5);
      });

      expect(mockStoreState.setValue).toHaveBeenCalledWith('device-1', 'current', 2.5, false);
    });

    it('should call setValue with immediate=true when specified', async () => {
      const useDeviceSocket = await getHook();
      const { result } = renderHook(() => useDeviceSocket('device-1'));

      act(() => {
        result.current.setValue('current', 2.5, true);
      });

      expect(mockStoreState.setValue).toHaveBeenCalledWith('device-1', 'current', 2.5, true);
    });

    it('should call clearDeviceError when clearError is called', async () => {
      const useDeviceSocket = await getHook();
      const { result } = renderHook(() => useDeviceSocket('device-1'));

      act(() => {
        result.current.clearError();
      });

      expect(mockStoreState.clearDeviceError).toHaveBeenCalledWith('device-1');
    });
  });

  describe('Device ID Changes', () => {
    it('should use correct deviceId for different devices', async () => {
      const useDeviceSocket = await getHook();

      const { result: result1 } = renderHook(() => useDeviceSocket('device-1'));
      const { result: result2 } = renderHook(() => useDeviceSocket('device-2'));

      act(() => {
        result1.current.subscribe();
        result2.current.subscribe();
      });

      expect(mockStoreState.subscribeDevice).toHaveBeenCalledWith('device-1');
      expect(mockStoreState.subscribeDevice).toHaveBeenCalledWith('device-2');
    });
  });
});
