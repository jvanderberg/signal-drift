/**
 * DevicePanel Integration Tests
 *
 * Tests the full device flow: discovery → connection → subscription → control.
 * Covers PSU and Load device interactions including:
 * - Subscription lifecycle
 * - Output control
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ServerMessage } from '../../../../shared/types';
import {
  createMockDeviceSummary,
  createMockSessionState,
  createMockLoadCapabilities,
} from '../../test/testUtils';

// Use vi.hoisted to define mocks before vi.mock hoisting
const { mockSend, mockConnect, mockDisconnect, mockState } = vi.hoisted(() => {
  return {
    mockSend: vi.fn(),
    mockConnect: vi.fn(),
    mockDisconnect: vi.fn(),
    mockState: {
      onMessageHandlers: [] as ((msg: ServerMessage) => void)[],
      onStateHandlers: [] as ((state: string) => void)[],
      connectionState: 'connected' as string,
    },
  };
});

// Mock the websocket module
vi.mock('../../websocket', () => ({
  getWebSocketManager: () => ({
    connect: mockConnect,
    disconnect: mockDisconnect,
    send: mockSend,
    getState: () => mockState.connectionState,
    onMessage: (handler: (msg: ServerMessage) => void) => {
      mockState.onMessageHandlers.push(handler);
      return () => {
        mockState.onMessageHandlers = mockState.onMessageHandlers.filter(h => h !== handler);
      };
    },
    onStateChange: (handler: (state: string) => void) => {
      mockState.onStateHandlers.push(handler);
      return () => {
        mockState.onStateHandlers = mockState.onStateHandlers.filter(h => h !== handler);
      };
    },
  }),
}));

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal('ResizeObserver', MockResizeObserver);

// Mock canvas context for Chart.js
HTMLCanvasElement.prototype.getContext = vi.fn(() => null);

// Helper to simulate receiving a message
function simulateMessage(msg: ServerMessage): void {
  act(() => {
    mockState.onMessageHandlers.forEach(handler => handler(msg));
  });
}

// Import after mocking
import { DevicePanel } from '../DevicePanel';
import { useDeviceStore } from '../../stores/deviceStore';

describe('DevicePanel Integration', () => {
  const mockOnClose = vi.fn();
  const mockOnError = vi.fn();
  const mockOnSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockState.onMessageHandlers = [];
    mockState.onStateHandlers = [];
    mockState.connectionState = 'connected';

    // Reset device store
    useDeviceStore.setState({
      connectionState: 'connected',
      devices: [],
      isLoadingDevices: false,
      deviceListError: null,
      deviceStates: {},
    });

    // Initialize store handlers
    useDeviceStore.getState().connect();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Subscription Flow', () => {
    it('should subscribe to device on mount', () => {
      const device = createMockDeviceSummary({ id: 'psu-1' });

      render(
        <DevicePanel
          device={device}
          onClose={mockOnClose}
          onError={mockOnError}
          onSuccess={mockOnSuccess}
        />
      );

      expect(mockSend).toHaveBeenCalledWith({ type: 'subscribe', deviceId: 'psu-1' });
    });

    it('should unsubscribe on unmount', () => {
      const device = createMockDeviceSummary({ id: 'psu-1' });

      const { unmount } = render(
        <DevicePanel
          device={device}
          onClose={mockOnClose}
          onError={mockOnError}
          onSuccess={mockOnSuccess}
        />
      );

      mockSend.mockClear();
      unmount();

      expect(mockSend).toHaveBeenCalledWith({ type: 'unsubscribe', deviceId: 'psu-1' });
    });

    it('should call onSuccess when subscribed', async () => {
      const device = createMockDeviceSummary({ id: 'psu-1' });

      render(
        <DevicePanel
          device={device}
          onClose={mockOnClose}
          onError={mockOnError}
          onSuccess={mockOnSuccess}
        />
      );

      const sessionState = createMockSessionState({ info: device.info });

      simulateMessage({
        type: 'subscribed',
        deviceId: 'psu-1',
        state: sessionState,
      });

      await waitFor(() => {
        expect(mockOnSuccess).toHaveBeenCalledWith('Connected');
      });
    });

    it('should display device header with connection status', async () => {
      const device = createMockDeviceSummary({
        id: 'psu-1',
        info: { id: 'psu-1', type: 'power-supply', manufacturer: 'Rigol', model: 'DP832' },
      });

      render(
        <DevicePanel
          device={device}
          onClose={mockOnClose}
          onError={mockOnError}
          onSuccess={mockOnSuccess}
        />
      );

      expect(screen.getByText('Rigol DP832')).toBeInTheDocument();
    });
  });

  describe('PSU Control Flow', () => {
    it('should display OFF button when output is disabled', async () => {
      const device = createMockDeviceSummary({ id: 'psu-1' });

      render(
        <DevicePanel
          device={device}
          onClose={mockOnClose}
          onError={mockOnError}
          onSuccess={mockOnSuccess}
        />
      );

      const sessionState = createMockSessionState({
        outputEnabled: false,
      });

      simulateMessage({
        type: 'subscribed',
        deviceId: 'psu-1',
        state: sessionState,
      });

      await waitFor(() => {
        expect(screen.getByText('OFF')).toBeInTheDocument();
      });
    });

    it('should display ON button when output is enabled', async () => {
      const device = createMockDeviceSummary({ id: 'psu-1' });

      render(
        <DevicePanel
          device={device}
          onClose={mockOnClose}
          onError={mockOnError}
          onSuccess={mockOnSuccess}
        />
      );

      const sessionState = createMockSessionState({
        outputEnabled: true,
      });

      simulateMessage({
        type: 'subscribed',
        deviceId: 'psu-1',
        state: sessionState,
      });

      await waitFor(() => {
        expect(screen.getByText('ON')).toBeInTheDocument();
      });
    });
  });

});
