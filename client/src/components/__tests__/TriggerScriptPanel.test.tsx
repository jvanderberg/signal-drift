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
  info: { manufacturer: 'Test', model: 'PSU-1' },
  status: { mode: 'CC', output: false, setpoints: {}, readings: {}, connectionStatus: 'connected' },
  capabilities: {
    modes: ['CC', 'CV'],
    modesSettable: true,
    outputs: [{ name: 'current', min: 0, max: 10, resolution: 0.001 }],
    measurements: [{ name: 'voltage', min: 0, max: 30, resolution: 0.001 }],
  },
};

const mockSequence: SequenceDefinition = {
  id: 'seq-1',
  name: 'Ramp Up',
  type: 'ramp',
  steps: [],
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
        elapsedMs: 5000,
        triggerStates: [],
      };

      render(<TriggerScriptPanel />);

      // Select the script to see its details
      await waitFor(() => {
        expect(screen.getByText('Test Script')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Test Script'));

      // Should show elapsed time
      expect(screen.getByText('5.0s')).toBeInTheDocument();
      expect(screen.getByText('running')).toBeInTheDocument();
    });

    it('should disable Edit and Delete buttons when running', async () => {
      mockUseTriggerScript.isRunning = true;
      mockUseTriggerScript.activeState = {
        scriptId: 'script-1',
        executionState: 'running',
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
        elapsedMs: 5000,
        triggerStates: [
          { triggerId: 'trigger-1', firedCount: 3, lastFiredAt: Date.now() },
        ],
      };

      render(<TriggerScriptPanel />);

      await waitFor(() => {
        expect(screen.getByText('Test Script')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Test Script'));

      expect(screen.getByText('3 fires')).toBeInTheDocument();
    });
  });
});
