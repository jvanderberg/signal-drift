/**
 * OscilloscopePanel Integration Tests
 *
 * Tests the full oscilloscope flow: subscription → streaming → waveform display.
 * Covers:
 * - Subscription lifecycle
 * - Auto-streaming after connection
 * - Run/Stop controls
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ServerMessage, OscilloscopeCapabilities } from '../../../../shared/types';
import {
  createMockOscilloscopeSummary,
  createMockOscilloscopeCapabilities,
  createMockOscilloscopeStatus,
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

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock ResizeObserver
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal('ResizeObserver', MockResizeObserver);

// Helper to simulate receiving a message
function simulateMessage(msg: ServerMessage): void {
  act(() => {
    mockState.onMessageHandlers.forEach(handler => handler(msg));
  });
}

// Import after mocking
import { OscilloscopePanel } from '../OscilloscopePanel';
import { useOscilloscopeStore } from '../../stores/oscilloscopeStore';

describe('OscilloscopePanel Integration', () => {
  const mockOnClose = vi.fn();
  const mockOnError = vi.fn();
  const mockOnSuccess = vi.fn();

  const createOscilloscopeSessionState = (overrides?: Partial<{
    status: ReturnType<typeof createMockOscilloscopeStatus>;
    capabilities: OscilloscopeCapabilities;
  }>) => {
    const capabilities = overrides?.capabilities ?? createMockOscilloscopeCapabilities();
    const status = overrides?.status ?? createMockOscilloscopeStatus();

    return {
      info: { id: 'scope-1', type: 'oscilloscope' as const, manufacturer: 'Rigol', model: 'DS1054Z' },
      capabilities,
      connectionStatus: 'connected' as const,
      consecutiveErrors: 0,
      status,
      lastUpdated: Date.now(),
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockState.onMessageHandlers = [];
    mockState.onStateHandlers = [];
    mockState.connectionState = 'connected';
    localStorageMock.getItem.mockReturnValue(null);

    // Reset oscilloscope store
    useOscilloscopeStore.setState({
      connectionState: 'connected',
      oscilloscopeStates: {},
    });

    // Initialize store
    useOscilloscopeStore.getState()._initializeWebSocket();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Subscription Flow', () => {
    it('should subscribe to oscilloscope on mount', () => {
      const device = createMockOscilloscopeSummary({ id: 'scope-1' });

      render(
        <OscilloscopePanel
          device={device}
          onClose={mockOnClose}
          onError={mockOnError}
          onSuccess={mockOnSuccess}
        />
      );

      expect(mockSend).toHaveBeenCalledWith({ type: 'subscribe', deviceId: 'scope-1' });
    });

    it('should unsubscribe on unmount', () => {
      const device = createMockOscilloscopeSummary({ id: 'scope-1' });

      const { unmount } = render(
        <OscilloscopePanel
          device={device}
          onClose={mockOnClose}
          onError={mockOnError}
          onSuccess={mockOnSuccess}
        />
      );

      mockSend.mockClear();
      unmount();

      expect(mockSend).toHaveBeenCalledWith({ type: 'unsubscribe', deviceId: 'scope-1' });
    });

    it('should call onSuccess when subscribed', async () => {
      const device = createMockOscilloscopeSummary({ id: 'scope-1' });

      render(
        <OscilloscopePanel
          device={device}
          onClose={mockOnClose}
          onError={mockOnError}
          onSuccess={mockOnSuccess}
        />
      );

      const sessionState = createOscilloscopeSessionState();

      simulateMessage({
        type: 'subscribed',
        deviceId: 'scope-1',
        state: sessionState as unknown as import('../../../../shared/types').DeviceSessionState,
      });

      await waitFor(() => {
        expect(mockOnSuccess).toHaveBeenCalledWith('Connected');
      });
    });
  });

  describe('Streaming Controls', () => {
    it('should auto-start streaming after subscription', async () => {
      const device = createMockOscilloscopeSummary({ id: 'scope-1' });

      render(
        <OscilloscopePanel
          device={device}
          onClose={mockOnClose}
          onError={mockOnError}
          onSuccess={mockOnSuccess}
        />
      );

      const sessionState = createOscilloscopeSessionState();

      simulateMessage({
        type: 'subscribed',
        deviceId: 'scope-1',
        state: sessionState as unknown as import('../../../../shared/types').DeviceSessionState,
      });

      await waitFor(() => {
        expect(mockSend).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'scopeStartStreaming',
            deviceId: 'scope-1',
          })
        );
      });
    });
  });

  describe('Waveform Display', () => {
    it('should render waveform display container', async () => {
      const device = createMockOscilloscopeSummary({ id: 'scope-1' });

      render(
        <OscilloscopePanel
          device={device}
          onClose={mockOnClose}
          onError={mockOnError}
          onSuccess={mockOnSuccess}
        />
      );

      const sessionState = createOscilloscopeSessionState();

      simulateMessage({
        type: 'subscribed',
        deviceId: 'scope-1',
        state: sessionState as unknown as import('../../../../shared/types').DeviceSessionState,
      });

      await waitFor(() => {
        // Check for waveform container by class or the SVG element
        const svg = document.querySelector('svg');
        expect(svg).toBeInTheDocument();
      });
    });
  });

  describe('Screenshot', () => {
    it('should request screenshot when button clicked', async () => {
      const device = createMockOscilloscopeSummary({ id: 'scope-1' });

      render(
        <OscilloscopePanel
          device={device}
          onClose={mockOnClose}
          onError={mockOnError}
          onSuccess={mockOnSuccess}
        />
      );

      const sessionState = createOscilloscopeSessionState();

      simulateMessage({
        type: 'subscribed',
        deviceId: 'scope-1',
        state: sessionState as unknown as import('../../../../shared/types').DeviceSessionState,
      });

      await waitFor(() => {
        expect(screen.getByText('Capture Screenshot')).toBeInTheDocument();
      });

      mockSend.mockClear();
      fireEvent.click(screen.getByText('Capture Screenshot'));

      expect(mockSend).toHaveBeenCalledWith({ type: 'scopeGetScreenshot', deviceId: 'scope-1' });

      // Should show loading state
      await waitFor(() => {
        expect(screen.getByText('Loading...')).toBeInTheDocument();
      });
    });

    it('should display screenshot when received', async () => {
      const device = createMockOscilloscopeSummary({ id: 'scope-1' });

      render(
        <OscilloscopePanel
          device={device}
          onClose={mockOnClose}
          onError={mockOnError}
          onSuccess={mockOnSuccess}
        />
      );

      const sessionState = createOscilloscopeSessionState();

      simulateMessage({
        type: 'subscribed',
        deviceId: 'scope-1',
        state: sessionState as unknown as import('../../../../shared/types').DeviceSessionState,
      });

      // Request screenshot
      await waitFor(() => {
        expect(screen.getByText('Capture Screenshot')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Capture Screenshot'));

      // Simulate screenshot response
      simulateMessage({
        type: 'scopeScreenshot',
        deviceId: 'scope-1',
        data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      });

      await waitFor(() => {
        const img = screen.getByAltText('Oscilloscope screenshot');
        expect(img).toBeInTheDocument();
        expect(img).toHaveAttribute('src', expect.stringContaining('data:image/png;base64,'));
      });
    });
  });

  describe('Error Handling', () => {
    it('should call onError when device error is received', async () => {
      const device = createMockOscilloscopeSummary({ id: 'scope-1' });

      render(
        <OscilloscopePanel
          device={device}
          onClose={mockOnClose}
          onError={mockOnError}
          onSuccess={mockOnSuccess}
        />
      );

      const sessionState = createOscilloscopeSessionState();

      simulateMessage({
        type: 'subscribed',
        deviceId: 'scope-1',
        state: sessionState as unknown as import('../../../../shared/types').DeviceSessionState,
      });

      await waitFor(() => {
        expect(mockOnSuccess).toHaveBeenCalled();
      });

      simulateMessage({
        type: 'error',
        deviceId: 'scope-1',
        code: 'DEVICE_ERROR',
        message: 'Oscilloscope communication failed',
      });

      await waitFor(() => {
        expect(mockOnError).toHaveBeenCalledWith('Oscilloscope communication failed');
      });
    });
  });
});
