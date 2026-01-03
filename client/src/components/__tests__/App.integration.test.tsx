/**
 * App Integration Tests
 *
 * Tests the full App component with device discovery, panel rendering,
 * sidebar interactions, and toast notifications.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ServerMessage } from '../../../../shared/types';

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

// Mock window.matchMedia for theme
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
import App from '../../App';
import { useUIStore } from '../../stores/uiStore';

describe('App Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.onMessageHandlers = [];
    mockState.onStateHandlers = [];
    mockState.connectionState = 'connected';

    // Reset UI store
    useUIStore.setState({
      toasts: [],
      _toastId: 0,
      theme: 'system',
      resolvedTheme: 'dark',
      deviceNames: {},
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Helper to render App and wait for initial ready state
  const renderApp = async () => {
    render(<App />);

    // Wait for getDevices request
    await waitFor(() => {
      expect(mockSend).toHaveBeenCalledWith({ type: 'getDevices' });
    });

    // Simulate empty device list response
    simulateMessage({ type: 'deviceList', devices: [] });

    // Small wait for processing
    await new Promise(resolve => setTimeout(resolve, 50));
  };

  describe('Initial Render', () => {
    it('should render the header and hamburger menu', async () => {
      await renderApp();

      expect(screen.getByText('Lab Controller')).toBeInTheDocument();
      expect(screen.getByTitle('Open menu')).toBeInTheDocument();
    });

    it('should show empty state when no devices are open', async () => {
      await renderApp();

      await waitFor(() => {
        expect(screen.getByText(/click the menu to open devices/i)).toBeInTheDocument();
      });
    });

    it('should connect to WebSocket on mount', async () => {
      await renderApp();

      expect(mockConnect).toHaveBeenCalled();
      expect(mockSend).toHaveBeenCalledWith({ type: 'getDevices' });
    });

    it('should render theme selector', async () => {
      await renderApp();

      const themeSelect = screen.getByRole('combobox');
      expect(themeSelect).toBeInTheDocument();
      expect(screen.getByText('System')).toBeInTheDocument();
      expect(screen.getByText('Light')).toBeInTheDocument();
      expect(screen.getByText('Dark')).toBeInTheDocument();
    });
  });

  describe('Sidebar Interactions', () => {
    it('should open sidebar when hamburger menu is clicked', async () => {
      await renderApp();

      const hamburger = screen.getByTitle('Open menu');
      fireEvent.click(hamburger);

      expect(screen.getByText('Devices & Widgets')).toBeInTheDocument();
      expect(screen.getByText('Rescan')).toBeInTheDocument();
    });

    it('should close sidebar when close button is clicked', async () => {
      await renderApp();

      // Open sidebar
      fireEvent.click(screen.getByTitle('Open menu'));
      expect(screen.getByText('Devices & Widgets')).toBeInTheDocument();

      // Close sidebar
      fireEvent.click(screen.getByTitle('Close menu'));

      // Sidebar should be closed (translated off-screen)
      const sidebar = screen.getByText('Devices & Widgets').closest('div[class*="translate"]');
      expect(sidebar?.className).toContain('-translate-x-full');
    });

    it('should show no devices message when device list is empty', async () => {
      await renderApp();

      fireEvent.click(screen.getByTitle('Open menu'));

      expect(screen.getByText('No devices connected.')).toBeInTheDocument();
    });

    it('should trigger scan when Rescan button is clicked', async () => {
      await renderApp();

      fireEvent.click(screen.getByTitle('Open menu'));

      mockSend.mockClear();
      fireEvent.click(screen.getByText('Rescan'));

      expect(mockSend).toHaveBeenCalledWith({ type: 'scan' });
    });

    it('should show Sequencer and Trigger Scripts widgets', async () => {
      await renderApp();

      fireEvent.click(screen.getByTitle('Open menu'));

      expect(screen.getByText('Sequencer')).toBeInTheDocument();
      expect(screen.getByText('Software AWG')).toBeInTheDocument();
      expect(screen.getByText('Trigger Scripts')).toBeInTheDocument();
      expect(screen.getByText('Reactive automation')).toBeInTheDocument();
    });
  });


  describe('Widget Panels', () => {
    it('should open Sequencer panel when clicked', async () => {
      await renderApp();

      fireEvent.click(screen.getByTitle('Open menu'));

      mockSend.mockClear();
      fireEvent.click(screen.getByText('Sequencer'));

      await waitFor(() => {
        expect(mockSend).toHaveBeenCalledWith({ type: 'sequenceLibraryList' });
      });
    });

    it('should open Trigger Scripts panel when clicked', async () => {
      await renderApp();

      fireEvent.click(screen.getByTitle('Open menu'));

      mockSend.mockClear();
      fireEvent.click(screen.getByText('Trigger Scripts'));

      await waitFor(() => {
        expect(mockSend).toHaveBeenCalledWith({ type: 'triggerScriptLibraryList' });
      });
    });
  });

  describe('Theme Selection', () => {
    it('should change theme when selected', async () => {
      await renderApp();

      const themeSelect = screen.getByRole('combobox');
      fireEvent.change(themeSelect, { target: { value: 'dark' } });

      expect(useUIStore.getState().theme).toBe('dark');
    });

    it('should support light theme', async () => {
      await renderApp();

      const themeSelect = screen.getByRole('combobox');
      fireEvent.change(themeSelect, { target: { value: 'light' } });

      expect(useUIStore.getState().theme).toBe('light');
    });
  });
});
