import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TriggerScriptPanel } from '../triggers/TriggerScriptPanel';
import type { TriggerScript, TriggerScriptState, DeviceSummary, SequenceDefinition } from '../../types';

// Sample test data
const sampleScript: TriggerScript = {
  id: 'script-1',
  name: 'Test Script',
  triggers: [
    {
      id: 'trigger-1',
      condition: { type: 'time', seconds: 5 },
      action: { type: 'setOutput', deviceId: 'device-1', enabled: true },
      repeatMode: 'once',
      debounceMs: 0,
    },
  ],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const sampleScript2: TriggerScript = {
  id: 'script-2',
  name: 'Another Script',
  triggers: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const mockDevice: DeviceSummary = {
  id: 'device-1',
  info: { id: 'device-1', type: 'power-supply', manufacturer: 'Test', model: 'PSU-1' },
  capabilities: {
    deviceClass: 'psu',
    features: {},
    modes: ['CC', 'CV'],
    modesSettable: true,
    outputs: [{ name: 'current', min: 0, max: 10, unit: 'A', decimals: 3 }],
    measurements: [{ name: 'voltage', min: 0, max: 30, unit: 'V', decimals: 3 }],
  },
  connectionStatus: 'connected',
};

const mockSequence: SequenceDefinition = {
  id: 'seq-1',
  name: 'Ramp Up',
  unit: 'V',
  waveform: { type: 'ramp', min: 0, max: 10, pointsPerCycle: 100, intervalMs: 100 },
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

// Mock data for hooks
const mockUseTriggerScript = {
  library: [] as TriggerScript[],
  isLibraryLoading: false,
  activeState: null as TriggerScriptState | null,
  isRunning: false,
  run: vi.fn(),
  stop: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  saveScript: vi.fn(),
  updateScript: vi.fn(),
  deleteScript: vi.fn(),
  error: null as string | null,
  clearError: vi.fn(),
};

const mockUseSequencer = {
  library: [mockSequence],
};

const mockUseDeviceList = {
  devices: [mockDevice],
  standardDevices: [mockDevice],
};

const mockUseDeviceNames = {
  getCustomName: () => null,
};

// Mock hooks
vi.mock('../../hooks/useTriggerScript', () => ({
  useTriggerScript: () => mockUseTriggerScript,
}));

vi.mock('../../hooks/useSequencer', () => ({
  useSequencer: () => mockUseSequencer,
}));

vi.mock('../../hooks/useDeviceList', () => ({
  useDeviceList: () => mockUseDeviceList,
}));

vi.mock('../../hooks/useDeviceNames', () => ({
  useDeviceNames: () => mockUseDeviceNames,
}));

describe('TriggerScriptPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock data
    mockUseTriggerScript.library = [];
    mockUseTriggerScript.isLibraryLoading = false;
    mockUseTriggerScript.activeState = null;
    mockUseTriggerScript.isRunning = false;
    mockUseTriggerScript.error = null;

    // Mock scrollTo for JSDOM (not implemented by default)
    Element.prototype.scrollTo = vi.fn();
  });

  describe('Loading State', () => {
    it('should show loading when isLibraryLoading is true and mode is null', () => {
      mockUseTriggerScript.isLibraryLoading = true;
      render(<TriggerScriptPanel />);

      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should start in edit mode when library is empty', async () => {
      mockUseTriggerScript.library = [];
      mockUseTriggerScript.isLibraryLoading = false;

      render(<TriggerScriptPanel />);

      // Should show edit mode header
      await waitFor(() => {
        expect(screen.getByText('New Trigger Script')).toBeInTheDocument();
      });
    });

    it('should show empty trigger message in edit mode', async () => {
      mockUseTriggerScript.library = [];
      mockUseTriggerScript.isLibraryLoading = false;

      render(<TriggerScriptPanel />);

      await waitFor(() => {
        expect(screen.getByText(/No triggers yet/)).toBeInTheDocument();
      });
    });
  });

  describe('Run Mode', () => {
    beforeEach(() => {
      mockUseTriggerScript.library = [sampleScript, sampleScript2];
      mockUseTriggerScript.isLibraryLoading = false;
    });

    it('should show script list', async () => {
      render(<TriggerScriptPanel />);

      await waitFor(() => {
        expect(screen.getByText('Test Script')).toBeInTheDocument();
        expect(screen.getByText('Another Script')).toBeInTheDocument();
      });
    });

    it('should show trigger count for each script', async () => {
      render(<TriggerScriptPanel />);

      await waitFor(() => {
        expect(screen.getByText('1 trigger')).toBeInTheDocument();
        expect(screen.getByText('0 triggers')).toBeInTheDocument();
      });
    });

    it('should select script when clicked', async () => {
      render(<TriggerScriptPanel />);

      await waitFor(() => {
        expect(screen.getByText('Test Script')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Test Script'));

      // Should show script details
      expect(screen.getByText('At t=5s')).toBeInTheDocument();
    });

    it('should show Run button when script is selected', async () => {
      render(<TriggerScriptPanel />);

      await waitFor(() => {
        expect(screen.getByText('Test Script')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Test Script'));

      expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument();
    });

    it('should disable Run button when no script is selected', async () => {
      render(<TriggerScriptPanel />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
      });
    });

    it('should call run when Run button is clicked', async () => {
      render(<TriggerScriptPanel />);

      await waitFor(() => {
        expect(screen.getByText('Test Script')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Test Script'));
      fireEvent.click(screen.getByRole('button', { name: 'Run' }));

      expect(mockUseTriggerScript.run).toHaveBeenCalledWith('script-1');
    });
  });

  describe('Edit Mode', () => {
    beforeEach(() => {
      mockUseTriggerScript.library = [sampleScript];
      mockUseTriggerScript.isLibraryLoading = false;
    });

    it('should enter edit mode when Edit button is clicked', async () => {
      render(<TriggerScriptPanel />);

      await waitFor(() => {
        expect(screen.getByText('Test Script')).toBeInTheDocument();
      });

      // Select the script first
      fireEvent.click(screen.getByText('Test Script'));

      // Click Edit button
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

      // Should show edit mode
      expect(screen.getByText('Edit Trigger Script')).toBeInTheDocument();
    });

    it('should enter new script mode when + New is clicked', async () => {
      render(<TriggerScriptPanel />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: '+ New' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: '+ New' }));

      expect(screen.getByText('New Trigger Script')).toBeInTheDocument();
    });

    it('should show script name input in edit mode', async () => {
      render(<TriggerScriptPanel />);

      await waitFor(() => {
        expect(screen.getByText('Test Script')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Test Script'));
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

      expect(screen.getByDisplayValue('Test Script')).toBeInTheDocument();
    });

    it('should show Add Trigger button in edit mode', async () => {
      render(<TriggerScriptPanel />);

      await waitFor(() => {
        expect(screen.getByText('Test Script')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Test Script'));
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

      expect(screen.getByRole('button', { name: '+ Add Trigger' })).toBeInTheDocument();
    });

    it('should save script when Save is clicked', async () => {
      render(<TriggerScriptPanel />);

      await waitFor(() => {
        expect(screen.getByText('Test Script')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Test Script'));
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(mockUseTriggerScript.updateScript).toHaveBeenCalled();
    });

    it('should call saveScript for new scripts', async () => {
      mockUseTriggerScript.library = [];
      render(<TriggerScriptPanel />);

      await waitFor(() => {
        expect(screen.getByText('New Trigger Script')).toBeInTheDocument();
      });

      // Change name and save
      const nameInput = screen.getByPlaceholderText('Enter script name...');
      fireEvent.change(nameInput, { target: { value: 'My New Script' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(mockUseTriggerScript.saveScript).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'My New Script' })
      );
    });

    it('should cancel editing when Cancel is clicked', async () => {
      render(<TriggerScriptPanel />);

      await waitFor(() => {
        expect(screen.getByText('Test Script')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Test Script'));
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

      // Should be in edit mode
      expect(screen.getByText('Edit Trigger Script')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      // Should be back in run mode
      expect(screen.getByText('Trigger Scripts')).toBeInTheDocument();
    });
  });

  describe('Execution Controls', () => {
    beforeEach(() => {
      mockUseTriggerScript.library = [sampleScript];
      mockUseTriggerScript.isLibraryLoading = false;
    });

    it('should show Pause and Stop buttons when running', async () => {
      mockUseTriggerScript.isRunning = true;
      mockUseTriggerScript.activeState = {
        scriptId: 'script-1',
        executionState: 'running',
        startedAt: Date.now(),
        elapsedMs: 1000,
        triggerStates: [],
      };

      render(<TriggerScriptPanel />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
      });
    });

    it('should show Resume button when paused', async () => {
      mockUseTriggerScript.isRunning = true;
      mockUseTriggerScript.activeState = {
        scriptId: 'script-1',
        executionState: 'paused',
        startedAt: Date.now(),
        elapsedMs: 1000,
        triggerStates: [],
      };

      render(<TriggerScriptPanel />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
      });
    });

    it('should call pause when Pause button is clicked', async () => {
      mockUseTriggerScript.isRunning = true;
      mockUseTriggerScript.activeState = {
        scriptId: 'script-1',
        executionState: 'running',
        startedAt: Date.now(),
        elapsedMs: 1000,
        triggerStates: [],
      };

      render(<TriggerScriptPanel />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));

      expect(mockUseTriggerScript.pause).toHaveBeenCalled();
    });

    it('should call resume when Resume button is clicked', async () => {
      mockUseTriggerScript.isRunning = true;
      mockUseTriggerScript.activeState = {
        scriptId: 'script-1',
        executionState: 'paused',
        startedAt: Date.now(),
        elapsedMs: 1000,
        triggerStates: [],
      };

      render(<TriggerScriptPanel />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Resume' }));

      expect(mockUseTriggerScript.resume).toHaveBeenCalled();
    });

    it('should call stop when Stop button is clicked', async () => {
      mockUseTriggerScript.isRunning = true;
      mockUseTriggerScript.activeState = {
        scriptId: 'script-1',
        executionState: 'running',
        startedAt: Date.now(),
        elapsedMs: 1000,
        triggerStates: [],
      };

      render(<TriggerScriptPanel />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

      expect(mockUseTriggerScript.stop).toHaveBeenCalled();
    });

    it('should show execution status when running', async () => {
      mockUseTriggerScript.isRunning = true;
      mockUseTriggerScript.activeState = {
        scriptId: 'script-1',
        executionState: 'running',
        startedAt: Date.now(),
        elapsedMs: 5000,
        triggerStates: [],
      };

      render(<TriggerScriptPanel />);

      // Select the script to see its details
      await waitFor(() => {
        expect(screen.getAllByText('Test Script').length).toBeGreaterThan(0);
      });

      // Click on the first instance (in the script list)
      fireEvent.click(screen.getAllByText('Test Script')[0]);

      // Should show elapsed time
      expect(screen.getByText('5.0s')).toBeInTheDocument();
      expect(screen.getByText('running')).toBeInTheDocument();
    });

    it('should disable Edit and Delete buttons when running', async () => {
      mockUseTriggerScript.isRunning = true;
      mockUseTriggerScript.activeState = {
        scriptId: 'script-1',
        executionState: 'running',
        startedAt: Date.now(),
        elapsedMs: 1000,
        triggerStates: [],
      };

      render(<TriggerScriptPanel />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
        expect(screen.getByRole('button', { name: '+ New' })).toBeDisabled();
      });
    });
  });

  describe('Error Display', () => {
    beforeEach(() => {
      mockUseTriggerScript.library = [sampleScript];
      mockUseTriggerScript.isLibraryLoading = false;
    });

    it('should show error message when error is set', async () => {
      mockUseTriggerScript.error = 'Something went wrong';

      render(<TriggerScriptPanel />);

      await waitFor(() => {
        expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      });
    });

    it('should call clearError when dismiss button is clicked', async () => {
      mockUseTriggerScript.error = 'Something went wrong';

      render(<TriggerScriptPanel />);

      await waitFor(() => {
        expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      });

      // Find and click the dismiss button (×)
      const dismissButton = screen.getByText('×');
      fireEvent.click(dismissButton);

      expect(mockUseTriggerScript.clearError).toHaveBeenCalled();
    });
  });

  describe('Delete Script', () => {
    beforeEach(() => {
      mockUseTriggerScript.library = [sampleScript];
      mockUseTriggerScript.isLibraryLoading = false;
      // Mock window.confirm
      vi.spyOn(window, 'confirm').mockImplementation(() => true);
    });

    it('should show Delete button when script is selected', async () => {
      render(<TriggerScriptPanel />);

      await waitFor(() => {
        expect(screen.getByText('Test Script')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Test Script'));

      expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    });

    it('should call deleteScript when Delete is confirmed', async () => {
      render(<TriggerScriptPanel />);

      await waitFor(() => {
        expect(screen.getByText('Test Script')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Test Script'));
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

      expect(mockUseTriggerScript.deleteScript).toHaveBeenCalledWith('script-1');
    });
  });

  describe('Trigger Fire Count Display', () => {
    beforeEach(() => {
      mockUseTriggerScript.library = [sampleScript];
      mockUseTriggerScript.isLibraryLoading = false;
    });

    it('should show fire count when script is running', async () => {
      mockUseTriggerScript.isRunning = true;
      mockUseTriggerScript.activeState = {
        scriptId: 'script-1',
        executionState: 'running',
        startedAt: Date.now(),
        elapsedMs: 5000,
        triggerStates: [
          { triggerId: 'trigger-1', firedCount: 3, lastFiredAt: Date.now(), conditionMet: true },
        ],
      };

      render(<TriggerScriptPanel />);

      await waitFor(() => {
        expect(screen.getAllByText('Test Script').length).toBeGreaterThan(0);
      });

      // Click on the first instance (in the script list)
      fireEvent.click(screen.getAllByText('Test Script')[0]);

      expect(screen.getByText('3 fires')).toBeInTheDocument();
    });
  });

  describe('Drag and Drop Reordering', () => {
    const scriptWithMultipleTriggers: TriggerScript = {
      id: 'script-multi',
      name: 'Multi-Trigger Script',
      triggers: [
        {
          id: 'trigger-1',
          condition: { type: 'time', seconds: 1 },
          action: { type: 'setOutput', deviceId: 'device-1', enabled: true },
          repeatMode: 'once',
          debounceMs: 0,
        },
        {
          id: 'trigger-2',
          condition: { type: 'time', seconds: 2 },
          action: { type: 'setOutput', deviceId: 'device-1', enabled: false },
          repeatMode: 'once',
          debounceMs: 0,
        },
        {
          id: 'trigger-3',
          condition: { type: 'time', seconds: 3 },
          action: { type: 'setValue', deviceId: 'device-1', parameter: 'current', value: 5 },
          repeatMode: 'once',
          debounceMs: 0,
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Helper to create mock DataTransfer for drag events
    const createMockDataTransfer = () => ({
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue('0'),
      effectAllowed: 'move',
      dropEffect: 'move',
    });

    beforeEach(() => {
      mockUseTriggerScript.library = [scriptWithMultipleTriggers];
      mockUseTriggerScript.isLibraryLoading = false;
    });

    it('should show draggable triggers in edit mode', async () => {
      render(<TriggerScriptPanel />);

      await waitFor(() => {
        expect(screen.getByText('Multi-Trigger Script')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Multi-Trigger Script'));
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

      // Should show all triggers
      expect(screen.getByText('At t=1s')).toBeInTheDocument();
      expect(screen.getByText('At t=2s')).toBeInTheDocument();
      expect(screen.getByText('At t=3s')).toBeInTheDocument();
    });

    it('should have draggable trigger elements', async () => {
      render(<TriggerScriptPanel />);

      await waitFor(() => {
        expect(screen.getByText('Multi-Trigger Script')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Multi-Trigger Script'));
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

      // Find the trigger items with drag handles
      const triggerItems = screen.getAllByTitle('Drag to reorder');
      expect(triggerItems.length).toBe(3);

      // Each should be associated with a draggable element
      triggerItems.forEach(item => {
        const draggableParent = item.closest('[draggable="true"]');
        expect(draggableParent).toBeInTheDocument();
      });
    });

    it('should display triggers in correct order initially', async () => {
      render(<TriggerScriptPanel />);

      await waitFor(() => {
        expect(screen.getByText('Multi-Trigger Script')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Multi-Trigger Script'));
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

      // Verify all three triggers are displayed
      const trigger1 = screen.getByText('At t=1s');
      const trigger2 = screen.getByText('At t=2s');
      const trigger3 = screen.getByText('At t=3s');

      expect(trigger1).toBeInTheDocument();
      expect(trigger2).toBeInTheDocument();
      expect(trigger3).toBeInTheDocument();
    });

    it('should save script with triggers when Save is clicked', async () => {
      render(<TriggerScriptPanel />);

      await waitFor(() => {
        expect(screen.getByText('Multi-Trigger Script')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Multi-Trigger Script'));
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

      // Click Save to verify the list is submitted
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(mockUseTriggerScript.updateScript).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'script-multi',
          triggers: expect.arrayContaining([
            expect.objectContaining({ id: 'trigger-1' }),
            expect.objectContaining({ id: 'trigger-2' }),
            expect.objectContaining({ id: 'trigger-3' }),
          ]),
        })
      );
    });

    it('should handle drag events without crashing', async () => {
      render(<TriggerScriptPanel />);

      await waitFor(() => {
        expect(screen.getByText('Multi-Trigger Script')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Multi-Trigger Script'));
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

      const triggerItems = screen.getAllByTitle('Drag to reorder');
      const draggable = triggerItems[0].closest('[draggable="true"]')!;

      // Fire drag events with proper mock DataTransfer
      fireEvent.dragStart(draggable, { dataTransfer: createMockDataTransfer() });
      fireEvent.dragOver(draggable, { dataTransfer: createMockDataTransfer() });
      fireEvent.dragEnd(draggable);

      // Component should remain functional after drag sequence
      expect(screen.getByText('At t=1s')).toBeInTheDocument();
      expect(screen.getByText('At t=2s')).toBeInTheDocument();
      expect(screen.getByText('At t=3s')).toBeInTheDocument();
    });
  });

  describe('Adding and Removing Triggers', () => {
    beforeEach(() => {
      mockUseTriggerScript.library = [sampleScript];
      mockUseTriggerScript.isLibraryLoading = false;
    });

    it('should add a new trigger when Add Trigger is clicked', async () => {
      render(<TriggerScriptPanel />);

      await waitFor(() => {
        expect(screen.getByText('Test Script')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Test Script'));
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

      // Count current triggers
      const initialTriggers = screen.getAllByText(/At t=/);
      expect(initialTriggers).toHaveLength(1);

      // Add new trigger
      fireEvent.click(screen.getByRole('button', { name: '+ Add Trigger' }));

      // Should have more triggers now (shown as "At t=0s" for new time trigger)
      await waitFor(() => {
        const updatedTriggers = screen.getAllByText(/At t=/);
        expect(updatedTriggers.length).toBeGreaterThan(initialTriggers.length);
      });
    });
  });
});
