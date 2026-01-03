import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TriggerEditor } from '../triggers/TriggerEditor';
import type { Trigger, DeviceSummary, SequenceDefinition } from '../../types';

// Mock useDeviceNames hook
vi.mock('../../hooks/useDeviceNames', () => ({
  useDeviceNames: () => ({
    getCustomName: () => null,
  }),
}));

// Sample test data
const mockDevices: DeviceSummary[] = [
  {
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
  },
  {
    id: 'device-2',
    info: { id: 'device-2', type: 'electronic-load', manufacturer: 'Test', model: 'Load-1' },
    capabilities: {
      deviceClass: 'load',
      features: {},
      modes: ['CC', 'CV', 'CR'],
      modesSettable: true,
      outputs: [{ name: 'resistance', min: 0, max: 1000, unit: 'Ω', decimals: 2 }],
      measurements: [{ name: 'power', min: 0, max: 100, unit: 'W', decimals: 2 }],
    },
    connectionStatus: 'connected',
  },
];

const mockSequences: SequenceDefinition[] = [
  { id: 'seq-1', name: 'Ramp Up', unit: 'V', waveform: { type: 'ramp', min: 0, max: 10, pointsPerCycle: 100, intervalMs: 100 }, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'seq-2', name: 'Pulse', unit: 'A', waveform: { type: 'square', min: 0, max: 5, pointsPerCycle: 50, intervalMs: 100 }, createdAt: Date.now(), updatedAt: Date.now() },
];

const createTimeTrigger = (): Trigger => ({
  id: 'trigger-1',
  condition: { type: 'time', seconds: 5 },
  action: { type: 'setOutput', deviceId: 'device-1', enabled: true },
  repeatMode: 'once',
  debounceMs: 0,
});

const createValueTrigger = (): Trigger => ({
  id: 'trigger-2',
  condition: {
    type: 'value',
    deviceId: 'device-1',
    parameter: 'voltage',
    operator: '>',
    value: 10,
  },
  action: { type: 'setValue', deviceId: 'device-1', parameter: 'current', value: 5 },
  repeatMode: 'once',
  debounceMs: 100,
});

const defaultProps = {
  index: 0,
  devices: mockDevices,
  sequences: mockSequences,
  onChange: vi.fn(),
  onDelete: vi.fn(),
  onDragStart: vi.fn(),
  onDragOver: vi.fn(),
  onDragEnd: vi.fn(),
  isDragTarget: false,
  isDragging: false,
};

describe('TriggerEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render collapsed state by default', () => {
      render(<TriggerEditor trigger={createTimeTrigger()} {...defaultProps} />);

      // Should show summary
      expect(screen.getByText(/At t=5s/)).toBeInTheDocument();
    });

    it('should render time condition summary correctly', () => {
      render(<TriggerEditor trigger={createTimeTrigger()} {...defaultProps} />);

      expect(screen.getByText(/At t=5s/)).toBeInTheDocument();
    });

    it('should render value condition summary correctly', () => {
      render(<TriggerEditor trigger={createValueTrigger()} {...defaultProps} />);

      expect(screen.getByText(/When PSU-1 voltage > 10/)).toBeInTheDocument();
    });

    it('should render action summary for setOutput', () => {
      render(<TriggerEditor trigger={createTimeTrigger()} {...defaultProps} />);

      expect(screen.getByText(/PSU-1 output ON/)).toBeInTheDocument();
    });

    it('should render action summary for setValue', () => {
      render(<TriggerEditor trigger={createValueTrigger()} {...defaultProps} />);

      expect(screen.getByText(/PSU-1 current = 5/)).toBeInTheDocument();
    });

    it('should expand when clicked', () => {
      render(<TriggerEditor trigger={createTimeTrigger()} {...defaultProps} defaultExpanded={false} />);

      // Click to expand
      const header = screen.getByText(/At t=5s/).closest('div');
      fireEvent.click(header!);

      // Should show WHEN and THEN labels
      expect(screen.getByText('WHEN')).toBeInTheDocument();
      expect(screen.getByText('THEN')).toBeInTheDocument();
    });

    it('should render expanded by default when defaultExpanded is true', () => {
      render(<TriggerEditor trigger={createTimeTrigger()} {...defaultProps} defaultExpanded={true} />);

      expect(screen.getByText('WHEN')).toBeInTheDocument();
      expect(screen.getByText('THEN')).toBeInTheDocument();
    });

    it('should show drag target indicator when isDragTarget is true', () => {
      const { container } = render(
        <TriggerEditor trigger={createTimeTrigger()} {...defaultProps} isDragTarget={true} />
      );

      // Look for the drop indicator element
      const indicator = container.querySelector('.bg-blue-500');
      expect(indicator).toBeInTheDocument();
    });

    it('should apply opacity when isDragging is true', () => {
      const { container } = render(
        <TriggerEditor trigger={createTimeTrigger()} {...defaultProps} isDragging={true} />
      );

      const card = container.querySelector('.opacity-40');
      expect(card).toBeInTheDocument();
    });
  });

  describe('Condition Type Selection', () => {
    it('should show Value and Time buttons when expanded', () => {
      render(<TriggerEditor trigger={createTimeTrigger()} {...defaultProps} defaultExpanded={true} />);

      expect(screen.getByRole('button', { name: 'Value' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Time' })).toBeInTheDocument();
    });

    it('should switch from time to value condition', () => {
      const onChange = vi.fn();
      render(
        <TriggerEditor
          trigger={createTimeTrigger()}
          {...defaultProps}
          onChange={onChange}
          defaultExpanded={true}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Value' }));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          condition: expect.objectContaining({ type: 'value' }),
        })
      );
    });

    it('should switch from value to time condition', () => {
      const onChange = vi.fn();
      render(
        <TriggerEditor
          trigger={createValueTrigger()}
          {...defaultProps}
          onChange={onChange}
          defaultExpanded={true}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Time' }));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          condition: expect.objectContaining({ type: 'time', seconds: 5 }),
        })
      );
    });
  });

  describe('Time Condition Editing', () => {
    it('should render seconds input for time condition', () => {
      render(<TriggerEditor trigger={createTimeTrigger()} {...defaultProps} defaultExpanded={true} />);

      const input = screen.getByDisplayValue('5');
      expect(input).toBeInTheDocument();
    });

    it('should update seconds value', () => {
      const onChange = vi.fn();
      render(
        <TriggerEditor
          trigger={createTimeTrigger()}
          {...defaultProps}
          onChange={onChange}
          defaultExpanded={true}
        />
      );

      const input = screen.getByDisplayValue('5');
      fireEvent.change(input, { target: { value: '10' } });

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          condition: expect.objectContaining({ seconds: 10 }),
        })
      );
    });
  });

  describe('Value Condition Editing', () => {
    it('should render device selector for value condition', () => {
      render(<TriggerEditor trigger={createValueTrigger()} {...defaultProps} defaultExpanded={true} />);

      // Should have device selector with options
      const selects = screen.getAllByRole('combobox');
      expect(selects.length).toBeGreaterThan(0);
    });

    it('should render operator selector', () => {
      render(<TriggerEditor trigger={createValueTrigger()} {...defaultProps} defaultExpanded={true} />);

      // Find the operator dropdown by its value
      const operatorSelect = screen.getByDisplayValue('>');
      expect(operatorSelect).toBeInTheDocument();
    });

    it('should render value input', () => {
      render(<TriggerEditor trigger={createValueTrigger()} {...defaultProps} defaultExpanded={true} />);

      const valueInput = screen.getByDisplayValue('10');
      expect(valueInput).toBeInTheDocument();
    });
  });

  describe('Action Type Selection', () => {
    it('should show action type buttons when expanded', () => {
      render(<TriggerEditor trigger={createTimeTrigger()} {...defaultProps} defaultExpanded={true} />);

      expect(screen.getByRole('button', { name: 'Set Value' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Output' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Set Mode' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Start Seq' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Stop Seq' })).toBeInTheDocument();
    });

    it('should switch action type to setValue', () => {
      const onChange = vi.fn();
      render(
        <TriggerEditor
          trigger={createTimeTrigger()}
          {...defaultProps}
          onChange={onChange}
          defaultExpanded={true}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Set Value' }));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          action: expect.objectContaining({ type: 'setValue' }),
        })
      );
    });

    it('should switch action type to setMode', () => {
      const onChange = vi.fn();
      render(
        <TriggerEditor
          trigger={createTimeTrigger()}
          {...defaultProps}
          onChange={onChange}
          defaultExpanded={true}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Set Mode' }));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          action: expect.objectContaining({ type: 'setMode' }),
        })
      );
    });

    it('should switch action type to startSequence', () => {
      const onChange = vi.fn();
      render(
        <TriggerEditor
          trigger={createTimeTrigger()}
          {...defaultProps}
          onChange={onChange}
          defaultExpanded={true}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Start Seq' }));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          action: expect.objectContaining({ type: 'startSequence' }),
        })
      );
    });

    it('should switch action type to stopSequence', () => {
      const onChange = vi.fn();
      render(
        <TriggerEditor
          trigger={createTimeTrigger()}
          {...defaultProps}
          onChange={onChange}
          defaultExpanded={true}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Stop Seq' }));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          action: expect.objectContaining({ type: 'stopSequence' }),
        })
      );
    });
  });

  describe('Output Action Editing', () => {
    it('should render ON/OFF selector for setOutput action', () => {
      render(<TriggerEditor trigger={createTimeTrigger()} {...defaultProps} defaultExpanded={true} />);

      // The output selector should have ON and OFF options
      expect(screen.getByRole('option', { name: 'ON' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'OFF' })).toBeInTheDocument();
    });

    it('should toggle output state', () => {
      const onChange = vi.fn();
      render(
        <TriggerEditor
          trigger={createTimeTrigger()}
          {...defaultProps}
          onChange={onChange}
          defaultExpanded={true}
        />
      );

      // Find the select that contains ON/OFF options
      const outputSelect = screen.getByRole('option', { name: 'ON' }).closest('select')!;
      fireEvent.change(outputSelect, { target: { value: 'off' } });

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          action: expect.objectContaining({ enabled: false }),
        })
      );
    });
  });

  describe('Modifiers (Value Condition Only)', () => {
    it('should show mode selector for value-based triggers', () => {
      render(<TriggerEditor trigger={createValueTrigger()} {...defaultProps} defaultExpanded={true} />);

      expect(screen.getByText('Mode:')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Once')).toBeInTheDocument();
    });

    it('should show debounce input for value-based triggers', () => {
      render(<TriggerEditor trigger={createValueTrigger()} {...defaultProps} defaultExpanded={true} />);

      expect(screen.getByText('Debounce:')).toBeInTheDocument();
      expect(screen.getByDisplayValue('100')).toBeInTheDocument();
    });

    it('should NOT show modifiers for time-based triggers', () => {
      render(<TriggerEditor trigger={createTimeTrigger()} {...defaultProps} defaultExpanded={true} />);

      expect(screen.queryByText('Mode:')).not.toBeInTheDocument();
      expect(screen.queryByText('Debounce:')).not.toBeInTheDocument();
    });

    it('should update repeat mode', () => {
      const onChange = vi.fn();
      render(
        <TriggerEditor
          trigger={createValueTrigger()}
          {...defaultProps}
          onChange={onChange}
          defaultExpanded={true}
        />
      );

      const modeSelect = screen.getByDisplayValue('Once');
      fireEvent.change(modeSelect, { target: { value: 'repeat' } });

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ repeatMode: 'repeat' })
      );
    });

    it('should update debounce value', () => {
      const onChange = vi.fn();
      render(
        <TriggerEditor
          trigger={createValueTrigger()}
          {...defaultProps}
          onChange={onChange}
          defaultExpanded={true}
        />
      );

      const debounceInput = screen.getByDisplayValue('100');
      fireEvent.change(debounceInput, { target: { value: '500' } });

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ debounceMs: 500 })
      );
    });
  });

  describe('Delete Functionality', () => {
    it('should show delete button', () => {
      render(<TriggerEditor trigger={createTimeTrigger()} {...defaultProps} />);

      expect(screen.getByTitle('Delete trigger')).toBeInTheDocument();
    });

    it('should show confirmation when delete is clicked', () => {
      render(<TriggerEditor trigger={createTimeTrigger()} {...defaultProps} />);

      fireEvent.click(screen.getByTitle('Delete trigger'));

      expect(screen.getByText('Delete this trigger?')).toBeInTheDocument();
      expect(screen.getByText('Cancel')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    it('should cancel delete confirmation', () => {
      render(<TriggerEditor trigger={createTimeTrigger()} {...defaultProps} />);

      fireEvent.click(screen.getByTitle('Delete trigger'));
      fireEvent.click(screen.getByText('Cancel'));

      expect(screen.queryByText('Delete this trigger?')).not.toBeInTheDocument();
    });

    it('should call onDelete when confirmed', () => {
      const onDelete = vi.fn();
      render(<TriggerEditor trigger={createTimeTrigger()} {...defaultProps} onDelete={onDelete} />);

      fireEvent.click(screen.getByTitle('Delete trigger'));
      fireEvent.click(screen.getByText('Delete'));

      expect(onDelete).toHaveBeenCalled();
    });
  });

  describe('Drag and Drop', () => {
    it('should call onDragStart when dragging begins', () => {
      const onDragStart = vi.fn();
      render(
        <TriggerEditor trigger={createTimeTrigger()} {...defaultProps} onDragStart={onDragStart} />
      );

      const dragHandle = screen.getByTitle('Drag to reorder');
      const draggableElement = dragHandle.closest('[draggable="true"]');

      fireEvent.dragStart(draggableElement!, {
        dataTransfer: { setData: vi.fn(), effectAllowed: '' },
      });

      expect(onDragStart).toHaveBeenCalledWith(0);
    });

    it('should call onDragEnd when dragging ends', () => {
      const onDragEnd = vi.fn();
      render(
        <TriggerEditor trigger={createTimeTrigger()} {...defaultProps} onDragEnd={onDragEnd} />
      );

      const dragHandle = screen.getByTitle('Drag to reorder');
      const draggableElement = dragHandle.closest('[draggable="true"]');

      fireEvent.dragEnd(draggableElement!);

      expect(onDragEnd).toHaveBeenCalled();
    });
  });
});
