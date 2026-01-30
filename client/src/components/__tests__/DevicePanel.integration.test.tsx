/**
 * DevicePanel Integration Tests
 *
 * Tests the full device flow: discovery → connection → subscription → control.
 * Covers PSU and Load device interactions including:
 * - Subscription lifecycle
 * - Output control
 * - Responsive breakpoints (column-based)
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import type { ServerMessage, DashboardLayoutItem } from '../../../../shared/types';
import {
  createMockDeviceSummary,
  createMockSessionState,
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

// Mock ResizeObserver (still needed for chart and other components)
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
import { useDeviceStore, cleanupDeviceStore } from '../../stores/deviceStore';
import { DashboardLayoutProvider } from '../../contexts/DashboardLayoutContext';

// Helper to create layout items for testing
function createLayoutItem(deviceId: string, w: number, h: number = 12): DashboardLayoutItem {
  return {
    i: `device-${deviceId}`,
    x: 0,
    y: 0,
    w,
    h,
    minW: 3,
    minH: 4,
  };
}

// Wrapper component that provides layout context
interface TestWrapperProps {
  children: React.ReactNode;
  deviceId: string;
  columnCount: number;
}

function TestWrapper({ children, deviceId, columnCount }: TestWrapperProps) {
  const items = [createLayoutItem(deviceId, columnCount)];
  return (
    <DashboardLayoutProvider items={items} cols={12}>
      {children}
    </DashboardLayoutProvider>
  );
}

describe('DevicePanel Integration', () => {
  const mockOnClose = vi.fn();
  const mockOnError = vi.fn();
  const mockOnSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockState.onMessageHandlers = [];
    mockState.onStateHandlers = [];
    mockState.connectionState = 'connected';

    // Cleanup and reset device store
    cleanupDeviceStore();
    useDeviceStore.setState({
      connectionState: 'connected',
      devices: [],
      isLoadingDevices: false,
      deviceListError: null,
      deviceStates: {},
    });

    // Initialize store with fresh WebSocket handlers
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

  describe('Responsive Breakpoints (Column-Based)', () => {
    // Column breakpoints: large >= 4, medium >= 3, narrow >= 2, very-narrow < 2

    describe('Large Panels (>= 4 columns)', () => {
      it('should show chart and setters when panel has 4+ columns', async () => {
        const device = createMockDeviceSummary({ id: 'psu-1' });

        const { container } = render(
          <TestWrapper deviceId="psu-1" columnCount={4}>
            <DevicePanel
              device={device}
              onClose={mockOnClose}
              onError={mockOnError}
              onSuccess={mockOnSuccess}
            />
          </TestWrapper>
        );

        const sessionState = createMockSessionState({
          measurements: { voltage: 12.0, current: 1.0, power: 12.0 },
          setpoints: { voltage: 12.0, current: 1.0 },
        });

        simulateMessage({
          type: 'subscribed',
          deviceId: 'psu-1',
          state: sessionState,
        });

        await waitFor(() => {
          // Setters should be visible - look for the + buttons from DigitSpinner
          const plusButtons = screen.getAllByText('+');
          expect(plusButtons.length).toBeGreaterThan(0);
        });

        // Chart section should be present (canvas element)
        const canvas = container.querySelector('canvas');
        expect(canvas).toBeInTheDocument();
      });

      it('should show chart at exactly 4 columns (boundary test)', async () => {
        const device = createMockDeviceSummary({ id: 'psu-1' });

        const { container } = render(
          <TestWrapper deviceId="psu-1" columnCount={4}>
            <DevicePanel
              device={device}
              onClose={mockOnClose}
              onError={mockOnError}
              onSuccess={mockOnSuccess}
            />
          </TestWrapper>
        );

        const sessionState = createMockSessionState({
          setpoints: { voltage: 12.0, current: 1.0 },
        });

        simulateMessage({
          type: 'subscribed',
          deviceId: 'psu-1',
          state: sessionState,
        });

        await waitFor(() => {
          const plusButtons = screen.getAllByText('+');
          expect(plusButtons.length).toBeGreaterThan(0);
        });

        // Chart should be visible at 4 columns
        const canvas = container.querySelector('canvas');
        expect(canvas).toBeInTheDocument();
      });
    });

    describe('Medium Panels (3 columns)', () => {
      it('should show setters but no chart when panel has 3 columns', async () => {
        const device = createMockDeviceSummary({ id: 'psu-1' });

        const { container } = render(
          <TestWrapper deviceId="psu-1" columnCount={3}>
            <DevicePanel
              device={device}
              onClose={mockOnClose}
              onError={mockOnError}
              onSuccess={mockOnSuccess}
            />
          </TestWrapper>
        );

        const sessionState = createMockSessionState({
          setpoints: { voltage: 12.0, current: 1.0 },
        });

        simulateMessage({
          type: 'subscribed',
          deviceId: 'psu-1',
          state: sessionState,
        });

        await waitFor(() => {
          // Setters should still be visible
          const plusButtons = screen.getAllByText('+');
          expect(plusButtons.length).toBeGreaterThan(0);
        });

        // Chart section should NOT be present (no canvas for chart)
        const canvas = container.querySelector('canvas');
        expect(canvas).not.toBeInTheDocument();
      });

      it('should show horizontal StatusReadings in medium width', async () => {
        const device = createMockDeviceSummary({ id: 'psu-1' });

        const { container } = render(
          <TestWrapper deviceId="psu-1" columnCount={3}>
            <DevicePanel
              device={device}
              onClose={mockOnClose}
              onError={mockOnError}
              onSuccess={mockOnSuccess}
            />
          </TestWrapper>
        );

        const sessionState = createMockSessionState({
          measurements: { voltage: 12.0, current: 1.0, power: 12.0 },
        });

        simulateMessage({
          type: 'subscribed',
          deviceId: 'psu-1',
          state: sessionState,
        });

        await waitFor(() => {
          // Should have StatusReadings with horizontal layout
          const flexContainers = container.querySelectorAll('.flex.flex-wrap');
          expect(flexContainers.length).toBeGreaterThan(0);
        });
      });
    });

    describe('Narrow Panels (2 columns)', () => {
      it('should hide setters when panel has 2 columns', async () => {
        const device = createMockDeviceSummary({ id: 'psu-1' });

        render(
          <TestWrapper deviceId="psu-1" columnCount={2}>
            <DevicePanel
              device={device}
              onClose={mockOnClose}
              onError={mockOnError}
              onSuccess={mockOnSuccess}
            />
          </TestWrapper>
        );

        const sessionState = createMockSessionState({
          setpoints: { voltage: 12.0, current: 1.0 },
        });

        simulateMessage({
          type: 'subscribed',
          deviceId: 'psu-1',
          state: sessionState,
        });

        await waitFor(() => {
          // Output control should still be visible
          expect(screen.getByText('OFF')).toBeInTheDocument();
        });

        // Setters should be hidden - no + buttons visible
        const plusButtons = screen.queryAllByText('+');
        expect(plusButtons.length).toBe(0);
      });

      it('should show only output toggle and horizontal readings', async () => {
        const device = createMockDeviceSummary({ id: 'psu-1' });

        const { container } = render(
          <TestWrapper deviceId="psu-1" columnCount={2}>
            <DevicePanel
              device={device}
              onClose={mockOnClose}
              onError={mockOnError}
              onSuccess={mockOnSuccess}
            />
          </TestWrapper>
        );

        const sessionState = createMockSessionState({
          measurements: { voltage: 12.0, current: 1.0, power: 12.0 },
        });

        simulateMessage({
          type: 'subscribed',
          deviceId: 'psu-1',
          state: sessionState,
        });

        await waitFor(() => {
          // Output toggle should be visible
          expect(screen.getByText('OFF')).toBeInTheDocument();
          // Readings should be in horizontal flex layout
          const flexContainers = container.querySelectorAll('.flex.flex-wrap');
          expect(flexContainers.length).toBeGreaterThan(0);
        });
      });
    });

    describe('Very Narrow Panels (< 2 columns)', () => {
      it('should hide setters when panel has < 2 columns', async () => {
        const device = createMockDeviceSummary({ id: 'psu-1' });

        render(
          <TestWrapper deviceId="psu-1" columnCount={1}>
            <DevicePanel
              device={device}
              onClose={mockOnClose}
              onError={mockOnError}
              onSuccess={mockOnSuccess}
            />
          </TestWrapper>
        );

        const sessionState = createMockSessionState({
          setpoints: { voltage: 12.0, current: 1.0 },
        });

        simulateMessage({
          type: 'subscribed',
          deviceId: 'psu-1',
          state: sessionState,
        });

        await waitFor(() => {
          // Output control should still be visible
          expect(screen.getByText('OFF')).toBeInTheDocument();
        });

        // Setters should be hidden
        const plusButtons = screen.queryAllByText('+');
        expect(plusButtons.length).toBe(0);
      });

      it('should wrap readings in horizontal layout', async () => {
        const device = createMockDeviceSummary({ id: 'psu-1' });

        const { container } = render(
          <TestWrapper deviceId="psu-1" columnCount={1}>
            <DevicePanel
              device={device}
              onClose={mockOnClose}
              onError={mockOnError}
              onSuccess={mockOnSuccess}
            />
          </TestWrapper>
        );

        const sessionState = createMockSessionState({
          measurements: { voltage: 12.0, current: 1.0, power: 12.0 },
        });

        simulateMessage({
          type: 'subscribed',
          deviceId: 'psu-1',
          state: sessionState,
        });

        await waitFor(() => {
          // Should have flex-wrap for readings to wrap
          const flexContainers = container.querySelectorAll('.flex-wrap');
          expect(flexContainers.length).toBeGreaterThan(0);
        });
      });
    });

    describe('Fallback Behavior', () => {
      it('should default to large breakpoint when not in grid context', async () => {
        // Render without TestWrapper (no DashboardLayoutProvider)
        const device = createMockDeviceSummary({ id: 'psu-1' });

        const { container } = render(
          <DevicePanel
            device={device}
            onClose={mockOnClose}
            onError={mockOnError}
            onSuccess={mockOnSuccess}
          />
        );

        const sessionState = createMockSessionState({
          setpoints: { voltage: 12.0, current: 1.0 },
        });

        simulateMessage({
          type: 'subscribed',
          deviceId: 'psu-1',
          state: sessionState,
        });

        await waitFor(() => {
          // Should show chart (large breakpoint default)
          const canvas = container.querySelector('canvas');
          expect(canvas).toBeInTheDocument();
          // Setters should be visible
          const plusButtons = screen.getAllByText('+');
          expect(plusButtons.length).toBeGreaterThan(0);
        });
      });
    });

    describe('Load Device Responsive Behavior', () => {
      const loadCapabilities = {
        deviceClass: 'load' as const,
        features: {},
        modes: ['CC', 'CV', 'CR', 'CP'],
        modesSettable: true,
        outputs: [
          { name: 'current', unit: 'A', decimals: 3, min: 0, max: 10 },
        ],
        measurements: [
          { name: 'voltage', unit: 'V', decimals: 3 },
          { name: 'current', unit: 'A', decimals: 3 },
        ],
      };

      it('should hide mode selector when panel is narrow (2 columns)', async () => {
        const device = createMockDeviceSummary({
          id: 'load-1',
          capabilities: loadCapabilities,
        });

        render(
          <TestWrapper deviceId="load-1" columnCount={2}>
            <DevicePanel
              device={device}
              onClose={mockOnClose}
              onError={mockOnError}
              onSuccess={mockOnSuccess}
            />
          </TestWrapper>
        );

        const sessionState = createMockSessionState({
          mode: 'CC',
          capabilities: loadCapabilities,
          setpoints: { current: 1.0 },
        });

        simulateMessage({
          type: 'subscribed',
          deviceId: 'load-1',
          state: sessionState,
        });

        await waitFor(() => {
          expect(screen.getByText('OFF')).toBeInTheDocument();
        });

        // Mode selector should be hidden (it's part of setters)
        expect(screen.queryByText('Mode:')).not.toBeInTheDocument();
      });

      it('should show mode selector when panel is medium or larger (3+ columns)', async () => {
        const device = createMockDeviceSummary({
          id: 'load-1',
          capabilities: loadCapabilities,
        });

        render(
          <TestWrapper deviceId="load-1" columnCount={3}>
            <DevicePanel
              device={device}
              onClose={mockOnClose}
              onError={mockOnError}
              onSuccess={mockOnSuccess}
            />
          </TestWrapper>
        );

        const sessionState = createMockSessionState({
          mode: 'CC',
          capabilities: loadCapabilities,
          setpoints: { current: 1.0 },
        });

        simulateMessage({
          type: 'subscribed',
          deviceId: 'load-1',
          state: sessionState,
        });

        await waitFor(() => {
          // Mode selector should be visible
          expect(screen.getByText('Mode:')).toBeInTheDocument();
        });
      });
    });
  });

});
