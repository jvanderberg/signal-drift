/**
 * App Integration Tests
 *
 * Tests the full App component with device discovery, panel rendering,
 * sidebar interactions, and toast notifications.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ServerMessage, DeviceSummary } from '../../../../shared/types';
import {
  createMockDeviceSummary,
  createMockOscilloscopeSummary,
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

// Helper to simulate receiving a message
function simulateMessage(msg: ServerMessage): void {
  if (mockState.onMessageHandler) {
    act(() => {
      mockState.onMessageHandler!(msg);
    });
  }
}

// Import after mocking
import App from '../../App';
import { useUIStore } from '../../stores/uiStore';

describe('App Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.onMessageHandler = null;
    mockState.onStateHandler = null;
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

  describe('Initial Render', () => {
    it('should render the header and hamburger menu', () => {
      render(<App />);

      expect(screen.getByText('Lab Controller')).toBeInTheDocument();
      expect(screen.getByTitle('Open menu')).toBeInTheDocument();
    });

    it('should show empty state when no devices are open', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText(/click the menu to open devices/i)).toBeInTheDocument();
      });
    });

    it('should connect to WebSocket on mount', () => {
      render(<App />);

      expect(mockConnect).toHaveBeenCalled();
      expect(mockSend).toHaveBeenCalledWith({ type: 'getDevices' });
    });

    it('should render theme selector', () => {
      render(<App />);

      const themeSelect = screen.getByRole('combobox');
      expect(themeSelect).toBeInTheDocument();
      expect(screen.getByText('System')).toBeInTheDocument();
      expect(screen.getByText('Light')).toBeInTheDocument();
      expect(screen.getByText('Dark')).toBeInTheDocument();
    });
  });

  describe('Sidebar Interactions', () => {
    it('should open sidebar when hamburger menu is clicked', () => {
      render(<App />);

      const hamburger = screen.getByTitle('Open menu');
      fireEvent.click(hamburger);

      expect(screen.getByText('Devices & Widgets')).toBeInTheDocument();
      expect(screen.getByText('Rescan')).toBeInTheDocument();
    });

    it('should close sidebar when close button is clicked', () => {
      render(<App />);

      // Open sidebar
      fireEvent.click(screen.getByTitle('Open menu'));
      expect(screen.getByText('Devices & Widgets')).toBeInTheDocument();

      // Close sidebar
      fireEvent.click(screen.getByTitle('Close menu'));

      // Sidebar should be closed (translated off-screen)
      const sidebar = screen.getByText('Devices & Widgets').closest('div[class*="translate"]');
      expect(sidebar?.className).toContain('-translate-x-full');
    });

    it('should show no devices message when device list is empty', () => {
      render(<App />);

      fireEvent.click(screen.getByTitle('Open menu'));

      expect(screen.getByText('No devices connected.')).toBeInTheDocument();
    });

    it('should trigger scan when Rescan button is clicked', () => {
      render(<App />);

      fireEvent.click(screen.getByTitle('Open menu'));
      fireEvent.click(screen.getByText('Rescan'));

      expect(mockSend).toHaveBeenCalledWith({ type: 'scan' });
    });

    it('should show Sequencer and Trigger Scripts widgets', () => {
      render(<App />);

      fireEvent.click(screen.getByTitle('Open menu'));

      expect(screen.getByText('Sequencer')).toBeInTheDocument();
      expect(screen.getByText('Software AWG')).toBeInTheDocument();
      expect(screen.getByText('Trigger Scripts')).toBeInTheDocument();
      expect(screen.getByText('Reactive automation')).toBeInTheDocument();
    });
  });

  describe('Device List', () => {
    it('should display devices when device list is received', async () => {
      render(<App />);

      const devices: DeviceSummary[] = [
        createMockDeviceSummary({
          id: 'psu-1',
          info: { id: 'psu-1', type: 'power-supply', manufacturer: 'Rigol', model: 'DP832' },
        }),
        createMockDeviceSummary({
          id: 'load-1',
          info: { id: 'load-1', type: 'electronic-load', manufacturer: 'Siglent', model: 'SDL1020X' },
        }),
      ];

      simulateMessage({ type: 'deviceList', devices });

      // Open sidebar to see devices
      fireEvent.click(screen.getByTitle('Open menu'));

      await waitFor(() => {
        expect(screen.getByText('Rigol DP832')).toBeInTheDocument();
        expect(screen.getByText('Siglent SDL1020X')).toBeInTheDocument();
      });
    });

    it('should display oscilloscope devices with correct icon', async () => {
      render(<App />);

      const devices: DeviceSummary[] = [
        createMockOscilloscopeSummary({
          id: 'scope-1',
          info: { id: 'scope-1', type: 'oscilloscope', manufacturer: 'Rigol', model: 'DS1054Z' },
        }),
      ];

      simulateMessage({ type: 'deviceList', devices });

      fireEvent.click(screen.getByTitle('Open menu'));

      await waitFor(() => {
        expect(screen.getByText('Rigol DS1054Z')).toBeInTheDocument();
      });
    });
  });

  describe('Opening Device Panels', () => {
    it('should open PSU panel when device is clicked', async () => {
      render(<App />);

      const device = createMockDeviceSummary({
        id: 'psu-1',
        info: { id: 'psu-1', type: 'power-supply', manufacturer: 'Rigol', model: 'DP832' },
      });

      simulateMessage({ type: 'deviceList', devices: [device] });

      // Open sidebar
      fireEvent.click(screen.getByTitle('Open menu'));

      await waitFor(() => {
        expect(screen.getByText('Rigol DP832')).toBeInTheDocument();
      });

      // Click on device
      fireEvent.click(screen.getByText('Rigol DP832'));

      // Panel should appear with device header
      await waitFor(() => {
        expect(mockSend).toHaveBeenCalledWith({ type: 'subscribe', deviceId: 'psu-1' });
      });
    });

    it('should open Oscilloscope panel for scope devices', async () => {
      render(<App />);

      const device = createMockOscilloscopeSummary({
        id: 'scope-1',
        info: { id: 'scope-1', type: 'oscilloscope', manufacturer: 'Rigol', model: 'DS1054Z' },
      });

      simulateMessage({ type: 'deviceList', devices: [device] });

      fireEvent.click(screen.getByTitle('Open menu'));

      await waitFor(() => {
        expect(screen.getByText('Rigol DS1054Z')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Rigol DS1054Z'));

      await waitFor(() => {
        expect(mockSend).toHaveBeenCalledWith({ type: 'subscribe', deviceId: 'scope-1' });
      });
    });

    it('should open multiple device panels', async () => {
      render(<App />);

      const devices: DeviceSummary[] = [
        createMockDeviceSummary({
          id: 'psu-1',
          info: { id: 'psu-1', type: 'power-supply', manufacturer: 'Rigol', model: 'DP832' },
        }),
        createMockDeviceSummary({
          id: 'psu-2',
          info: { id: 'psu-2', type: 'power-supply', manufacturer: 'Siglent', model: 'SPD3303X' },
        }),
      ];

      simulateMessage({ type: 'deviceList', devices });

      // Open first device
      fireEvent.click(screen.getByTitle('Open menu'));
      fireEvent.click(screen.getByText('Rigol DP832'));

      // Open second device
      fireEvent.click(screen.getByTitle('Open menu'));
      fireEvent.click(screen.getByText('Siglent SPD3303X'));

      await waitFor(() => {
        expect(mockSend).toHaveBeenCalledWith({ type: 'subscribe', deviceId: 'psu-1' });
        expect(mockSend).toHaveBeenCalledWith({ type: 'subscribe', deviceId: 'psu-2' });
      });
    });
  });

  describe('Widget Panels', () => {
    it('should open Sequencer panel when clicked', async () => {
      render(<App />);

      fireEvent.click(screen.getByTitle('Open menu'));
      fireEvent.click(screen.getByText('Sequencer'));

      await waitFor(() => {
        expect(mockSend).toHaveBeenCalledWith({ type: 'sequenceLibraryList' });
      });
    });

    it('should open Trigger Scripts panel when clicked', async () => {
      render(<App />);

      fireEvent.click(screen.getByTitle('Open menu'));
      fireEvent.click(screen.getByText('Trigger Scripts'));

      await waitFor(() => {
        expect(mockSend).toHaveBeenCalledWith({ type: 'triggerScriptLibraryList' });
      });
    });

    it('should toggle panel closed when clicked again', async () => {
      render(<App />);

      // Open sequencer
      fireEvent.click(screen.getByTitle('Open menu'));
      fireEvent.click(screen.getByText('Sequencer'));

      // Click again to close
      fireEvent.click(screen.getByTitle('Open menu'));
      fireEvent.click(screen.getByText('Sequencer'));

      // Should show empty state
      await waitFor(() => {
        expect(screen.getByText(/click the menu to open devices/i)).toBeInTheDocument();
      });
    });
  });

  describe('Theme Selection', () => {
    it('should change theme when selected', () => {
      render(<App />);

      const themeSelect = screen.getByRole('combobox');
      fireEvent.change(themeSelect, { target: { value: 'dark' } });

      expect(useUIStore.getState().theme).toBe('dark');
    });

    it('should support light theme', () => {
      render(<App />);

      const themeSelect = screen.getByRole('combobox');
      fireEvent.change(themeSelect, { target: { value: 'light' } });

      expect(useUIStore.getState().theme).toBe('light');
    });
  });

  describe('Error Handling', () => {
    it('should handle device list errors gracefully', async () => {
      render(<App />);

      simulateMessage({
        type: 'error',
        code: 'SCAN_FAILED',
        message: 'Failed to scan devices',
      });

      // App should still be functional
      fireEvent.click(screen.getByTitle('Open menu'));
      expect(screen.getByText('Devices & Widgets')).toBeInTheDocument();
    });
  });
});
