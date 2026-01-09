/**
 * DevicePanel Integration Tests
 *
 * Tests the full device flow: discovery → connection → subscription → control.
 * Covers PSU and Load device interactions including:
 * - Subscription lifecycle
 * - Output control
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import type { ServerMessage } from '../../../../shared/types';
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

// Mock ResizeObserver with width simulation capability
let resizeObserverCallback: ResizeObserverCallback | null = null;
let mockContainerWidth = 800; // Default to large

class MockResizeObserver {
  callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    resizeObserverCallback = callback;
  }

  observe = vi.fn((element: Element) => {
    // Trigger initial callback with current mock width
    const entries: ResizeObserverEntry[] = [{
      target: element,
      contentRect: { width: mockContainerWidth, height: 400, x: 0, y: 0, top: 0, left: 0, bottom: 400, right: mockContainerWidth, toJSON: () => ({}) } as DOMRectReadOnly,
      borderBoxSize: [],
      contentBoxSize: [],
      devicePixelContentBoxSize: [],
    }];
    this.callback(entries, this);
  });

  unobserve = vi.fn();
  disconnect = vi.fn();
}

function setMockContainerWidth(width: number) {
  mockContainerWidth = width;
}

function triggerResize(width: number) {
  mockContainerWidth = width;
  if (resizeObserverCallback) {
    const entries: ResizeObserverEntry[] = [{
      target: document.createElement('div'),
      contentRect: { width, height: 400, x: 0, y: 0, top: 0, left: 0, bottom: 400, right: width, toJSON: () => ({}) } as DOMRectReadOnly,
      borderBoxSize: [],
      contentBoxSize: [],
      devicePixelContentBoxSize: [],
    }];
    act(() => {
      resizeObserverCallback!(entries, new MockResizeObserver(resizeObserverCallback!));
    });
  }
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

describe('DevicePanel Integration', () => {
  const mockOnClose = vi.fn();
  const mockOnError = vi.fn();
  const mockOnSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockState.onMessageHandlers = [];
    mockState.onStateHandlers = [];
    mockState.connectionState = 'connected';
    resizeObserverCallback = null;
    setMockContainerWidth(800); // Reset to large

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

  describe('Responsive Breakpoints', () => {
    describe('Large Containers (>=600px)', () => {
      beforeEach(() => {
        setMockContainerWidth(800);
      });

      it('should show horizontal StatusReadings on large viewports', async () => {
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

      it('should show setters when container width >= 600px', async () => {
        setMockContainerWidth(600);
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
      });
    });

    describe('Medium Containers (400-599px)', () => {
      beforeEach(() => {
        setMockContainerWidth(500);
      });

      it('should show setters when container width is 400-599px', async () => {
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
      });

      it('should show horizontal StatusReadings in medium width', async () => {
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

    describe('Narrow Containers (300-399px)', () => {
      beforeEach(() => {
        setMockContainerWidth(350);
      });

      it('should hide setters when container width is 300-399px', async () => {
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
          <DevicePanel
            device={device}
            onClose={mockOnClose}
            onError={mockOnError}
            onSuccess={mockOnSuccess}
          />
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

    describe('Very Narrow Containers (<300px)', () => {
      beforeEach(() => {
        setMockContainerWidth(250);
      });

      it('should hide setters when container width < 300px', async () => {
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
          <DevicePanel
            device={device}
            onClose={mockOnClose}
            onError={mockOnError}
            onSuccess={mockOnSuccess}
          />
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

    describe('Container Resize', () => {
      it('should update layout when container is resized from large to narrow', async () => {
        setMockContainerWidth(800);
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
          setpoints: { voltage: 12.0, current: 1.0 },
        });

        simulateMessage({
          type: 'subscribed',
          deviceId: 'psu-1',
          state: sessionState,
        });

        // Initially at large width, setters should be visible
        await waitFor(() => {
          const plusButtons = screen.getAllByText('+');
          expect(plusButtons.length).toBeGreaterThan(0);
        });

        // Resize to narrow
        triggerResize(350);

        // Setters should now be hidden
        await waitFor(() => {
          const plusButtons = screen.queryAllByText('+');
          expect(plusButtons.length).toBe(0);
        });
      });

      it('should update layout when container is resized from narrow to large', async () => {
        setMockContainerWidth(350);
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
          setpoints: { voltage: 12.0, current: 1.0 },
        });

        simulateMessage({
          type: 'subscribed',
          deviceId: 'psu-1',
          state: sessionState,
        });

        // Initially at narrow width, setters should be hidden
        await waitFor(() => {
          expect(screen.getByText('OFF')).toBeInTheDocument();
        });

        let plusButtons = screen.queryAllByText('+');
        expect(plusButtons.length).toBe(0);

        // Resize to large
        triggerResize(800);

        // Setters should now be visible
        await waitFor(() => {
          plusButtons = screen.getAllByText('+');
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

      it('should hide mode selector when container is narrow', async () => {
        setMockContainerWidth(350);
        const device = createMockDeviceSummary({
          id: 'load-1',
          capabilities: loadCapabilities,
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

        // Mode selector should be hidden
        expect(screen.queryByText('Mode:')).not.toBeInTheDocument();
      });

      it('should show mode selector when container is medium or larger', async () => {
        setMockContainerWidth(500);
        const device = createMockDeviceSummary({
          id: 'load-1',
          capabilities: loadCapabilities,
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
