/**
 * DevicePanel Integration Tests
 *
 * Tests the full device flow: discovery → connection → subscription → control.
 * Covers PSU and Load device interactions including:
 * - Subscription and state updates
 * - Measurement streaming
 * - Mode changes
 * - Output control
 * - Setpoint changes
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ServerMessage, DeviceSessionState, DeviceCapabilities } from '../../../../shared/types';
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
      onMessageHandler: null as ((msg: ServerMessage) => void) | null,
      onStateHandler: null as ((state: string) => void) | null,
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
      mockState.onMessageHandler = handler;
      return () => { mockState.onMessageHandler = null; };
    },
    onStateChange: (handler: (state: string) => void) => {
      mockState.onStateHandler = handler;
      return () => { mockState.onStateHandler = null; };
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

// Helper to simulate receiving a message
function simulateMessage(msg: ServerMessage): void {
  if (mockState.onMessageHandler) {
    act(() => {
      mockState.onMessageHandler!(msg);
    });
  }
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
    mockState.onMessageHandler = null;
    mockState.onStateHandler = null;
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
    it('should display status readings after subscription', async () => {
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
        mode: 'CV',
        outputEnabled: false,
        measurements: { voltage: 12.5, current: 0.5, power: 6.25 },
        setpoints: { voltage: 12, current: 1 },
      });

      simulateMessage({
        type: 'subscribed',
        deviceId: 'psu-1',
        state: sessionState,
      });

      await waitFor(() => {
        expect(screen.getByText(/12\.5/)).toBeInTheDocument();
        expect(screen.getByText(/0\.5/)).toBeInTheDocument();
      });
    });

    it('should toggle output on/off', async () => {
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

      // Click the output button
      fireEvent.click(screen.getByText('OFF'));

      expect(mockSend).toHaveBeenCalledWith({ type: 'setOutput', deviceId: 'psu-1', enabled: true });
    });

    it('should update measurements from streaming', async () => {
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
        measurements: { voltage: 10, current: 0.5, power: 5 },
      });

      simulateMessage({
        type: 'subscribed',
        deviceId: 'psu-1',
        state: sessionState,
      });

      await waitFor(() => {
        expect(screen.getByText(/10/)).toBeInTheDocument();
      });

      // Simulate measurement update
      simulateMessage({
        type: 'measurement',
        deviceId: 'psu-1',
        update: {
          timestamp: Date.now(),
          measurements: { voltage: 12.5, current: 1.0, power: 12.5 },
        },
      });

      await waitFor(() => {
        expect(screen.getByText(/12\.5/)).toBeInTheDocument();
      });
    });

    it('should handle field updates for output state', async () => {
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

      // Simulate field update
      simulateMessage({
        type: 'field',
        deviceId: 'psu-1',
        field: 'outputEnabled',
        value: true,
      });

      await waitFor(() => {
        expect(screen.getByText('ON')).toBeInTheDocument();
      });
    });
  });

  describe('Electronic Load Control Flow', () => {
    it('should display mode selector for loads', async () => {
      const device = createMockDeviceSummary({
        id: 'load-1',
        info: { id: 'load-1', type: 'electronic-load', manufacturer: 'Siglent', model: 'SDL1020X' },
        capabilities: createMockLoadCapabilities(),
      });

      render(
        <DevicePanel
          device={device}
          onClose={mockOnClose}
          onError={mockOnError}
          onSuccess={mockOnSuccess}
        />
      );

      const sessionState = createMockSessionState({
        info: device.info,
        capabilities: device.capabilities,
        mode: 'CC',
        outputEnabled: false,
        measurements: { voltage: 0, current: 0, power: 0 },
        setpoints: { current: 1 },
      });

      simulateMessage({
        type: 'subscribed',
        deviceId: 'load-1',
        state: sessionState,
      });

      await waitFor(() => {
        expect(screen.getByText('CC')).toBeInTheDocument();
      });
    });

    it('should change mode when mode button clicked', async () => {
      const device = createMockDeviceSummary({
        id: 'load-1',
        capabilities: createMockLoadCapabilities(),
      });

      render(
        <DevicePanel
          device={device}
          onClose={mockOnClose}
          onError={mockOnError}
          onSuccess={mockOnSuccess}
        />
      );

      const sessionState = createMockSessionState({
        capabilities: device.capabilities,
        mode: 'CC',
        outputEnabled: false,
      });

      simulateMessage({
        type: 'subscribed',
        deviceId: device.id,
        state: sessionState,
      });

      await waitFor(() => {
        expect(screen.getByText('CC')).toBeInTheDocument();
      });

      // Click on CV mode
      const cvButton = screen.getByText('CV');
      fireEvent.click(cvButton);

      expect(mockSend).toHaveBeenCalledWith({ type: 'setMode', deviceId: device.id, mode: 'CV' });
    });

    it('should turn off output before mode change if enabled', async () => {
      const device = createMockDeviceSummary({
        id: 'load-1',
        capabilities: createMockLoadCapabilities(),
      });

      render(
        <DevicePanel
          device={device}
          onClose={mockOnClose}
          onError={mockOnError}
          onSuccess={mockOnSuccess}
        />
      );

      const sessionState = createMockSessionState({
        capabilities: device.capabilities,
        mode: 'CC',
        outputEnabled: true, // Output is ON
      });

      simulateMessage({
        type: 'subscribed',
        deviceId: device.id,
        state: sessionState,
      });

      await waitFor(() => {
        expect(screen.getByText('ON')).toBeInTheDocument();
      });

      mockSend.mockClear();

      // Click on CV mode
      const cvButton = screen.getByText('CV');
      fireEvent.click(cvButton);

      // Should first disable output, then change mode
      expect(mockSend).toHaveBeenCalledWith({ type: 'setOutput', deviceId: device.id, enabled: false });
      expect(mockSend).toHaveBeenCalledWith({ type: 'setMode', deviceId: device.id, mode: 'CV' });
    });
  });

  describe('Error Handling', () => {
    it('should call onError when device error is received', async () => {
      const device = createMockDeviceSummary({ id: 'psu-1' });

      render(
        <DevicePanel
          device={device}
          onClose={mockOnClose}
          onError={mockOnError}
          onSuccess={mockOnSuccess}
        />
      );

      const sessionState = createMockSessionState();

      simulateMessage({
        type: 'subscribed',
        deviceId: 'psu-1',
        state: sessionState,
      });

      simulateMessage({
        type: 'error',
        deviceId: 'psu-1',
        code: 'DEVICE_ERROR',
        message: 'Failed to communicate with device',
      });

      await waitFor(() => {
        expect(mockOnError).toHaveBeenCalledWith('Failed to communicate with device');
      });
    });

    it('should handle disconnection gracefully', async () => {
      const device = createMockDeviceSummary({ id: 'psu-1' });

      render(
        <DevicePanel
          device={device}
          onClose={mockOnClose}
          onError={mockOnError}
          onSuccess={mockOnSuccess}
        />
      );

      const sessionState = createMockSessionState();

      simulateMessage({
        type: 'subscribed',
        deviceId: 'psu-1',
        state: sessionState,
      });

      // Simulate disconnection
      simulateMessage({
        type: 'field',
        deviceId: 'psu-1',
        field: 'connectionStatus',
        value: 'disconnected',
      });

      // Component should still render without crashing
      expect(screen.getByText('Rigol DP832')).toBeInTheDocument();
    });
  });

  describe('Close Button', () => {
    it('should call onClose when close button is clicked', async () => {
      const device = createMockDeviceSummary({ id: 'psu-1' });

      render(
        <DevicePanel
          device={device}
          onClose={mockOnClose}
          onError={mockOnError}
          onSuccess={mockOnSuccess}
        />
      );

      const sessionState = createMockSessionState();

      simulateMessage({
        type: 'subscribed',
        deviceId: 'psu-1',
        state: sessionState,
      });

      // Find and click close button
      const closeButton = screen.getByTitle(/close/i);
      fireEvent.click(closeButton);

      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe('Setpoint Changes', () => {
    it('should send setValue when setpoint is changed', async () => {
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
        setpoints: { voltage: 12, current: 1 },
      });

      simulateMessage({
        type: 'subscribed',
        deviceId: 'psu-1',
        state: sessionState,
      });

      await waitFor(() => {
        // Look for the digit spinner controls
        expect(screen.getByText('V')).toBeInTheDocument();
      });

      // Find increment button for voltage
      const incrementButtons = screen.getAllByText('▲');
      // Click first increment (voltage)
      fireEvent.click(incrementButtons[0]);

      // Should send setValue with incremented value
      await waitFor(() => {
        expect(mockSend).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'setValue',
            deviceId: 'psu-1',
            name: 'voltage',
          })
        );
      });
    });
  });
});
