import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ServerMessage, DeviceSummary } from '../../../../shared/types';

// Mock device summaries
const mockDevices: DeviceSummary[] = [
  {
    id: 'device-1',
    type: 'electronic-load',
    manufacturer: 'Test',
    model: 'Load 1',
    connectionStatus: 'connected',
  },
  {
    id: 'device-2',
    type: 'power-supply',
    manufacturer: 'Test',
    model: 'PSU 1',
    connectionStatus: 'connected',
  },
];

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

describe('useDeviceList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOnMessageHandler = null;
    mockOnStateHandler = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Import the hook after mocking
  async function getHook() {
    const { useDeviceList } = await import('../useDeviceList');
    return useDeviceList;
  }

  describe('Initial State', () => {
    it('should start with empty devices array', async () => {
      const useDeviceList = await getHook();
      const { result } = renderHook(() => useDeviceList());

      expect(result.current.devices).toEqual([]);
    });

    it('should start with isLoading true', async () => {
      const useDeviceList = await getHook();
      const { result } = renderHook(() => useDeviceList());

      expect(result.current.isLoading).toBe(true);
    });

    it('should start with no error', async () => {
      const useDeviceList = await getHook();
      const { result } = renderHook(() => useDeviceList());

      expect(result.current.error).toBeNull();
    });
  });

  describe('Connection', () => {
    it('should connect on mount', async () => {
      const useDeviceList = await getHook();
      renderHook(() => useDeviceList());

      expect(mockConnect).toHaveBeenCalled();
    });

    it('should request device list on mount', async () => {
      const useDeviceList = await getHook();
      renderHook(() => useDeviceList());

      expect(mockSend).toHaveBeenCalledWith({ type: 'getDevices' });
    });
  });

  describe('Device List Updates', () => {
    it('should update devices when deviceList message is received', async () => {
      const useDeviceList = await getHook();
      const { result } = renderHook(() => useDeviceList());

      act(() => {
        simulateMessage({
          type: 'deviceList',
          devices: mockDevices,
        });
      });

      expect(result.current.devices).toEqual(mockDevices);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should handle empty device list', async () => {
      const useDeviceList = await getHook();
      const { result } = renderHook(() => useDeviceList());

      act(() => {
        simulateMessage({
          type: 'deviceList',
          devices: [],
        });
      });

      expect(result.current.devices).toEqual([]);
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should set error when error message is received without deviceId', async () => {
      const useDeviceList = await getHook();
      const { result } = renderHook(() => useDeviceList());

      act(() => {
        simulateMessage({
          type: 'error',
          code: 'CONNECTION_ERROR',
          message: 'Failed to get devices',
        });
      });

      expect(result.current.error).toBe('Failed to get devices');
      expect(result.current.isLoading).toBe(false);
    });

    it('should not set error for device-specific errors', async () => {
      const useDeviceList = await getHook();
      const { result } = renderHook(() => useDeviceList());

      act(() => {
        simulateMessage({
          type: 'error',
          deviceId: 'device-1',
          code: 'DEVICE_ERROR',
          message: 'Device error',
        });
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe('Refresh', () => {
    it('should send getDevices request when refresh is called', async () => {
      const useDeviceList = await getHook();
      const { result } = renderHook(() => useDeviceList());

      mockSend.mockClear();

      act(() => {
        result.current.refresh();
      });

      expect(mockSend).toHaveBeenCalledWith({ type: 'getDevices' });
    });

    it('should set isLoading to true when refresh is called', async () => {
      const useDeviceList = await getHook();
      const { result } = renderHook(() => useDeviceList());

      // First get devices to set isLoading to false
      act(() => {
        simulateMessage({
          type: 'deviceList',
          devices: mockDevices,
        });
      });

      expect(result.current.isLoading).toBe(false);

      act(() => {
        result.current.refresh();
      });

      expect(result.current.isLoading).toBe(true);
    });
  });

  describe('Scan', () => {
    it('should send scan request when scan is called', async () => {
      const useDeviceList = await getHook();
      const { result } = renderHook(() => useDeviceList());

      mockSend.mockClear();

      act(() => {
        result.current.scan();
      });

      expect(mockSend).toHaveBeenCalledWith({ type: 'scan' });
    });

    it('should set isLoading to true when scan is called', async () => {
      const useDeviceList = await getHook();
      const { result } = renderHook(() => useDeviceList());

      // First get devices to set isLoading to false
      act(() => {
        simulateMessage({
          type: 'deviceList',
          devices: mockDevices,
        });
      });

      act(() => {
        result.current.scan();
      });

      expect(result.current.isLoading).toBe(true);
    });
  });

  describe('Reconnection', () => {
    it('should request devices when connection is restored', async () => {
      const useDeviceList = await getHook();
      renderHook(() => useDeviceList());

      mockSend.mockClear();

      act(() => {
        simulateConnectionChange('connected');
      });

      expect(mockSend).toHaveBeenCalledWith({ type: 'getDevices' });
    });

    it('should not request devices on other state changes', async () => {
      const useDeviceList = await getHook();
      renderHook(() => useDeviceList());

      mockSend.mockClear();

      act(() => {
        simulateConnectionChange('disconnected');
      });

      expect(mockSend).not.toHaveBeenCalled();

      act(() => {
        simulateConnectionChange('reconnecting');
      });

      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('Return Value Stability', () => {
    it('should return stable refresh callback', async () => {
      const useDeviceList = await getHook();
      const { result, rerender } = renderHook(() => useDeviceList());

      const firstRefresh = result.current.refresh;
      rerender();

      expect(result.current.refresh).toBe(firstRefresh);
    });

    it('should return stable scan callback', async () => {
      const useDeviceList = await getHook();
      const { result, rerender } = renderHook(() => useDeviceList());

      const firstScan = result.current.scan;
      rerender();

      expect(result.current.scan).toBe(firstScan);
    });
  });
});
