/**
 * SequencePanel Integration Tests
 *
 * Tests the full sequence flow: library → configuration → playback.
 * Covers:
 * - Library loading and display
 * - Sequence selection and configuration
 * - Playback control (start, abort)
 * - Progress updates
 * - Error handling
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import type { ServerMessage, SequenceDefinition, SequenceState, DeviceSummary } from '../../../../shared/types';
import {
  createMockSequenceDefinition,
  createMockDeviceSummary,
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

// Mock window.confirm
vi.stubGlobal('confirm', vi.fn(() => true));

// Helper to simulate receiving a message
function simulateMessage(msg: ServerMessage): void {
  act(() => {
    mockState.onMessageHandlers.forEach(handler => handler(msg));
  });
}

// Import after mocking
import { SequencePanel } from '../sequencer';

// Helper to get selects by their position in run mode
// Order: [0] Sequence, [1] Device, [2] Parameter, [3] Repeat
function getSequenceSelect() {
  return screen.getAllByRole('combobox')[0];
}

function getDeviceSelect() {
  return screen.getAllByRole('combobox')[1];
}

function getRepeatSelect() {
  return screen.getAllByRole('combobox')[3];
}

describe('SequencePanel Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.onMessageHandlers = [];
    mockState.onStateHandlers = [];
    mockState.connectionState = 'connected';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Helper to set up with library loaded and in run mode
  const setupWithLibrary = async (sequences: SequenceDefinition[], devices: DeviceSummary[] = []) => {
    render(<SequencePanel />);

    // Wait for both library and device list requests
    await waitFor(() => {
      expect(mockSend).toHaveBeenCalledWith({ type: 'sequenceLibraryList' });
      expect(mockSend).toHaveBeenCalledWith({ type: 'getDevices' });
    });

    // Provide device list first (so it's available when library loads)
    simulateMessage({ type: 'deviceList', devices });

    // Then provide library data
    simulateMessage({ type: 'sequenceLibrary', sequences });

    // Wait for component to switch to run mode (only if sequences exist)
    if (sequences.length > 0) {
      await waitFor(() => {
        expect(screen.getByText('Sequencer')).toBeInTheDocument();
      });
    }
  };

  describe('Library Loading', () => {
    it('should request library on mount', async () => {
      render(<SequencePanel />);

      await waitFor(() => {
        expect(mockSend).toHaveBeenCalledWith({ type: 'sequenceLibraryList' });
      });
    });

    it('should show loading state initially', () => {
      render(<SequencePanel />);

      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('should display run mode after library loads with sequences', async () => {
      const sequences = [
        createMockSequenceDefinition({ id: 'seq-1', name: 'Voltage Ramp', unit: 'V' }),
        createMockSequenceDefinition({ id: 'seq-2', name: 'Current Sweep', unit: 'A' }),
      ];

      await setupWithLibrary(sequences);

      await waitFor(() => {
        expect(screen.getByText('Sequencer')).toBeInTheDocument();
      });
    });

    it('should show edit mode when no sequences exist', async () => {
      render(<SequencePanel />);

      await waitFor(() => {
        expect(mockSend).toHaveBeenCalledWith({ type: 'sequenceLibraryList' });
      });

      // Provide empty library
      simulateMessage({ type: 'sequenceLibrary', sequences: [] });

      // Component defaults to edit mode when library is empty
      await waitFor(() => {
        expect(screen.getByText('New Sequence')).toBeInTheDocument();
      });
    });

    it('should show Cancel button in edit mode', async () => {
      render(<SequencePanel />);

      await waitFor(() => {
        expect(mockSend).toHaveBeenCalledWith({ type: 'sequenceLibraryList' });
      });

      simulateMessage({ type: 'sequenceLibrary', sequences: [] });

      await waitFor(() => {
        expect(screen.getByText(/Cancel/)).toBeInTheDocument();
      });
    });
  });

  describe('Sequence Selection', () => {
    it('should allow selecting a sequence from dropdown', async () => {
      const sequences = [
        createMockSequenceDefinition({ id: 'seq-1', name: 'Voltage Ramp', unit: 'V' }),
      ];

      await setupWithLibrary(sequences);

      const sequenceSelect = getSequenceSelect() as HTMLSelectElement;
      fireEvent.change(sequenceSelect, { target: { value: 'seq-1' } });

      expect(sequenceSelect.value).toBe('seq-1');
    });

    it('should show chart preview when sequence is selected', async () => {
      const sequences = [
        createMockSequenceDefinition({ id: 'seq-1', name: 'Voltage Ramp', unit: 'V' }),
      ];

      await setupWithLibrary(sequences);

      // Initially shows placeholder
      expect(screen.getByText(/Select a sequence to preview/)).toBeInTheDocument();

      // Select the sequence
      fireEvent.change(getSequenceSelect(), { target: { value: 'seq-1' } });

      // Chart placeholder should be gone
      await waitFor(() => {
        expect(screen.queryByText(/Select a sequence to preview/)).not.toBeInTheDocument();
      });
    });
  });

  describe('Device and Parameter Selection', () => {
    it('should enable device selector after sequence is selected', async () => {
      const sequences = [
        createMockSequenceDefinition({ id: 'seq-1', name: 'Voltage Ramp', unit: 'V' }),
      ];

      const devices: DeviceSummary[] = [
        createMockDeviceSummary({
          id: 'psu-1',
          info: { id: 'psu-1', type: 'power-supply', manufacturer: 'Rigol', model: 'DP832' },
        }),
      ];

      await setupWithLibrary(sequences, devices);

      // Device selector should be disabled before sequence selection
      expect(getDeviceSelect()).toBeDisabled();

      // Select sequence first
      fireEvent.change(getSequenceSelect(), { target: { value: 'seq-1' } });

      // Device select should now be enabled
      await waitFor(() => {
        expect(getDeviceSelect()).not.toBeDisabled();
      });
    });

    it('should allow selecting a device after sequence', async () => {
      const sequences = [
        createMockSequenceDefinition({ id: 'seq-1', name: 'Voltage Ramp', unit: 'V' }),
      ];

      const devices: DeviceSummary[] = [
        createMockDeviceSummary({ id: 'psu-1' }),
      ];

      await setupWithLibrary(sequences, devices);

      // Select sequence
      fireEvent.change(getSequenceSelect(), { target: { value: 'seq-1' } });

      // Wait for device selector to be enabled
      await waitFor(() => {
        expect(getDeviceSelect()).not.toBeDisabled();
      });

      // Select device
      const deviceSelect = getDeviceSelect() as HTMLSelectElement;
      fireEvent.change(deviceSelect, { target: { value: 'psu-1' } });
      expect(deviceSelect.value).toBe('psu-1');
    });

    it('should show no devices message when none are compatible', async () => {
      const sequences = [
        createMockSequenceDefinition({ id: 'seq-1', name: 'Resistance Sweep', unit: 'Ω' }),
      ];

      // PSU has V and A outputs, not Ω
      const devices: DeviceSummary[] = [
        createMockDeviceSummary({ id: 'psu-1' }),
      ];

      await setupWithLibrary(sequences, devices);

      // Select the sequence
      fireEvent.change(getSequenceSelect(), { target: { value: 'seq-1' } });

      await waitFor(() => {
        expect(screen.getByText(/No devices with Ω outputs/)).toBeInTheDocument();
      });
    });
  });

  describe('Playback Controls', () => {
    const setupForPlayback = async () => {
      const sequences = [
        createMockSequenceDefinition({ id: 'seq-1', name: 'Voltage Ramp', unit: 'V' }),
      ];

      const devices: DeviceSummary[] = [
        createMockDeviceSummary({ id: 'psu-1' }),
      ];

      await setupWithLibrary(sequences, devices);

      // Select sequence
      fireEvent.change(getSequenceSelect(), { target: { value: 'seq-1' } });

      // Wait for device selector to be enabled
      await waitFor(() => {
        expect(getDeviceSelect()).not.toBeDisabled();
      });

      // Select device
      fireEvent.change(getDeviceSelect(), { target: { value: 'psu-1' } });
    };

    it('should enable Start button when all selections are made', async () => {
      await setupForPlayback();

      await waitFor(() => {
        const startButton = screen.getByText('Start');
        expect(startButton).not.toBeDisabled();
      });
    });

    it('should send sequenceRun when Start is clicked', async () => {
      await setupForPlayback();

      await waitFor(() => {
        expect(screen.getByText('Start')).not.toBeDisabled();
      });

      mockSend.mockClear();
      fireEvent.click(screen.getByText('Start'));

      await waitFor(() => {
        expect(mockSend).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'sequenceRun',
            config: expect.objectContaining({
              sequenceId: 'seq-1',
              deviceId: 'psu-1',
              parameter: 'voltage',
              repeatMode: 'once',
            }),
          })
        );
      });
    });

    it('should show Abort button during playback', async () => {
      await setupForPlayback();

      await waitFor(() => {
        expect(screen.getByText('Start')).not.toBeDisabled();
      });

      fireEvent.click(screen.getByText('Start'));

      // Simulate sequence started
      const sequenceState: SequenceState = {
        sequenceId: 'seq-1',
        runConfig: {
          sequenceId: 'seq-1',
          deviceId: 'psu-1',
          parameter: 'voltage',
          repeatMode: 'once',
        },
        executionState: 'running',
        currentStepIndex: 0,
        totalSteps: 100,
        currentCycle: 0,
        totalCycles: 1,
        startedAt: Date.now(),
        elapsedMs: 0,
        commandedValue: 5.0,
      };

      simulateMessage({ type: 'sequenceStarted', state: sequenceState });

      await waitFor(() => {
        expect(screen.getByText('Abort')).toBeInTheDocument();
      });
    });

    it('should send sequenceAbort when Abort is clicked', async () => {
      await setupForPlayback();

      await waitFor(() => {
        expect(screen.getByText('Start')).not.toBeDisabled();
      });

      fireEvent.click(screen.getByText('Start'));

      const sequenceState: SequenceState = {
        sequenceId: 'seq-1',
        runConfig: {
          sequenceId: 'seq-1',
          deviceId: 'psu-1',
          parameter: 'voltage',
          repeatMode: 'once',
        },
        executionState: 'running',
        currentStepIndex: 0,
        totalSteps: 100,
        currentCycle: 0,
        totalCycles: 1,
        startedAt: Date.now(),
        elapsedMs: 0,
        commandedValue: 5.0,
      };

      simulateMessage({ type: 'sequenceStarted', state: sequenceState });

      await waitFor(() => {
        expect(screen.getByText('Abort')).toBeInTheDocument();
      });

      mockSend.mockClear();
      fireEvent.click(screen.getByText('Abort'));

      expect(mockSend).toHaveBeenCalledWith({ type: 'sequenceAbort' });
    });

    it('should display progress during playback', async () => {
      await setupForPlayback();

      await waitFor(() => {
        expect(screen.getByText('Start')).not.toBeDisabled();
      });

      fireEvent.click(screen.getByText('Start'));

      const sequenceState: SequenceState = {
        sequenceId: 'seq-1',
        runConfig: {
          sequenceId: 'seq-1',
          deviceId: 'psu-1',
          parameter: 'voltage',
          repeatMode: 'once',
        },
        executionState: 'running',
        currentStepIndex: 50,
        totalSteps: 100,
        currentCycle: 0,
        totalCycles: 1,
        startedAt: Date.now(),
        elapsedMs: 5000,
        commandedValue: 7.5,
      };

      simulateMessage({ type: 'sequenceStarted', state: sequenceState });

      await waitFor(() => {
        expect(screen.getByText(/Step 51\/100/)).toBeInTheDocument();
        expect(screen.getByText(/7\.500/)).toBeInTheDocument();
      });
    });

    it('should update progress as sequence runs', async () => {
      await setupForPlayback();

      await waitFor(() => {
        expect(screen.getByText('Start')).not.toBeDisabled();
      });

      fireEvent.click(screen.getByText('Start'));

      // Initial state
      const initialState: SequenceState = {
        sequenceId: 'seq-1',
        runConfig: {
          sequenceId: 'seq-1',
          deviceId: 'psu-1',
          parameter: 'voltage',
          repeatMode: 'once',
        },
        executionState: 'running',
        currentStepIndex: 0,
        totalSteps: 100,
        currentCycle: 0,
        totalCycles: 1,
        startedAt: Date.now(),
        elapsedMs: 0,
        commandedValue: 5.0,
      };

      simulateMessage({ type: 'sequenceStarted', state: initialState });

      // Progress update
      const progressState: SequenceState = {
        ...initialState,
        currentStepIndex: 75,
        elapsedMs: 7500,
        commandedValue: 8.75,
      };

      simulateMessage({ type: 'sequenceProgress', state: progressState });

      await waitFor(() => {
        expect(screen.getByText(/Step 76\/100/)).toBeInTheDocument();
        expect(screen.getByText(/8\.750/)).toBeInTheDocument();
      });
    });
  });

  describe('Repeat Mode', () => {
    it('should allow selecting repeat mode', async () => {
      const sequences = [
        createMockSequenceDefinition({ id: 'seq-1', name: 'Voltage Ramp', unit: 'V' }),
      ];

      await setupWithLibrary(sequences);

      const repeatSelect = getRepeatSelect();
      expect(repeatSelect).toBeInTheDocument();

      // Change to N times
      fireEvent.change(repeatSelect, { target: { value: 'count' } });

      // Should show count input
      await waitFor(() => {
        const countInput = screen.getByRole('spinbutton');
        expect(countInput).toBeInTheDocument();
      });
    });

    it('should include repeat count in run config when mode is count', async () => {
      const sequences = [
        createMockSequenceDefinition({ id: 'seq-1', name: 'Voltage Ramp', unit: 'V' }),
      ];

      const devices: DeviceSummary[] = [
        createMockDeviceSummary({ id: 'psu-1' }),
      ];

      await setupWithLibrary(sequences, devices);

      // Select sequence
      fireEvent.change(getSequenceSelect(), { target: { value: 'seq-1' } });

      // Wait for device selector and select device
      await waitFor(() => {
        expect(getDeviceSelect()).not.toBeDisabled();
      });
      fireEvent.change(getDeviceSelect(), { target: { value: 'psu-1' } });

      // Set repeat mode to count
      fireEvent.change(getRepeatSelect(), { target: { value: 'count' } });

      // Set count to 5
      await waitFor(() => {
        const countInput = screen.getByRole('spinbutton');
        fireEvent.change(countInput, { target: { value: '5' } });
      });

      // Wait for Start to be enabled
      await waitFor(() => {
        expect(screen.getByText('Start')).not.toBeDisabled();
      });

      mockSend.mockClear();
      fireEvent.click(screen.getByText('Start'));

      await waitFor(() => {
        expect(mockSend).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'sequenceRun',
            config: expect.objectContaining({
              repeatMode: 'count',
              repeatCount: 5,
            }),
          })
        );
      });
    });
  });

  describe('Sequence CRUD Operations', () => {
    it('should open editor when New button is clicked', async () => {
      const sequences = [
        createMockSequenceDefinition({ id: 'seq-1', name: 'Voltage Ramp', unit: 'V' }),
      ];

      await setupWithLibrary(sequences);

      await waitFor(() => {
        expect(screen.getByText('+ New')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('+ New'));

      await waitFor(() => {
        expect(screen.getByText(/Cancel/)).toBeInTheDocument();
        expect(screen.getByText('New Sequence')).toBeInTheDocument();
      });
    });

    it('should open editor with sequence when Edit is clicked', async () => {
      const sequences = [
        createMockSequenceDefinition({ id: 'seq-1', name: 'Voltage Ramp', unit: 'V' }),
      ];

      await setupWithLibrary(sequences);

      // Select a sequence first
      fireEvent.change(getSequenceSelect(), { target: { value: 'seq-1' } });

      // Click edit - wait for it to be enabled (not disabled when sequence selected)
      await waitFor(() => {
        const editButton = screen.getByText('✎ Edit');
        expect(editButton).not.toBeDisabled();
      });

      fireEvent.click(screen.getByText('✎ Edit'));

      await waitFor(() => {
        expect(screen.getByText(/Cancel/)).toBeInTheDocument();
      });
    });

    it('should send delete request when Delete is clicked', async () => {
      const sequences = [
        createMockSequenceDefinition({ id: 'seq-1', name: 'Voltage Ramp', unit: 'V' }),
      ];

      await setupWithLibrary(sequences);

      // Select a sequence
      fireEvent.change(getSequenceSelect(), { target: { value: 'seq-1' } });

      await waitFor(() => {
        expect(screen.getByText('✗ Delete')).toBeInTheDocument();
      });

      mockSend.mockClear();
      fireEvent.click(screen.getByText('✗ Delete'));

      expect(mockSend).toHaveBeenCalledWith({ type: 'sequenceLibraryDelete', sequenceId: 'seq-1' });
    });
  });

  describe('Error Handling', () => {
    it('should display error message when sequence error occurs', async () => {
      const sequences = [
        createMockSequenceDefinition({ id: 'seq-1', name: 'Voltage Ramp', unit: 'V' }),
      ];

      const devices: DeviceSummary[] = [
        createMockDeviceSummary({ id: 'psu-1' }),
      ];

      await setupWithLibrary(sequences, devices);

      // Simulate error
      simulateMessage({
        type: 'sequenceError',
        sequenceId: 'seq-1',
        error: 'Device communication failed',
      });

      await waitFor(() => {
        expect(screen.getByText('Device communication failed')).toBeInTheDocument();
      });
    });

    it('should clear error when dismiss is clicked', async () => {
      const sequences = [
        createMockSequenceDefinition({ id: 'seq-1', name: 'Voltage Ramp', unit: 'V' }),
      ];

      const devices: DeviceSummary[] = [
        createMockDeviceSummary({ id: 'psu-1' }),
      ];

      await setupWithLibrary(sequences, devices);

      // Trigger error
      simulateMessage({
        type: 'sequenceError',
        sequenceId: 'seq-1',
        error: 'Test error',
      });

      await waitFor(() => {
        expect(screen.getByText('Test error')).toBeInTheDocument();
      });

      // Click dismiss button
      const dismissButton = screen.getByText('×');
      fireEvent.click(dismissButton);

      await waitFor(() => {
        expect(screen.queryByText('Test error')).not.toBeInTheDocument();
      });
    });
  });

  describe('Sequence Completion', () => {
    it('should update state when sequence completes', async () => {
      const sequences = [
        createMockSequenceDefinition({ id: 'seq-1', name: 'Voltage Ramp', unit: 'V' }),
      ];

      const devices: DeviceSummary[] = [
        createMockDeviceSummary({ id: 'psu-1' }),
      ];

      await setupWithLibrary(sequences, devices);

      // Select sequence
      fireEvent.change(getSequenceSelect(), { target: { value: 'seq-1' } });

      // Wait for device selector and select device
      await waitFor(() => {
        expect(getDeviceSelect()).not.toBeDisabled();
      });
      fireEvent.change(getDeviceSelect(), { target: { value: 'psu-1' } });

      // Start sequence
      await waitFor(() => {
        expect(screen.getByText('Start')).not.toBeDisabled();
      });

      fireEvent.click(screen.getByText('Start'));

      // Running state
      const runningState: SequenceState = {
        sequenceId: 'seq-1',
        runConfig: {
          sequenceId: 'seq-1',
          deviceId: 'psu-1',
          parameter: 'voltage',
          repeatMode: 'once',
        },
        executionState: 'running',
        currentStepIndex: 50,
        totalSteps: 100,
        currentCycle: 0,
        totalCycles: 1,
        startedAt: Date.now(),
        elapsedMs: 5000,
        commandedValue: 7.5,
      };

      simulateMessage({ type: 'sequenceStarted', state: runningState });

      await waitFor(() => {
        expect(screen.getByText('Abort')).toBeInTheDocument();
      });

      // Complete sequence
      simulateMessage({ type: 'sequenceCompleted', sequenceId: 'seq-1' });

      await waitFor(() => {
        // Should show completed state
        expect(screen.getByText(/completed/i)).toBeInTheDocument();
      });
    });
  });
});
