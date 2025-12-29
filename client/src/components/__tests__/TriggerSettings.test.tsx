import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TriggerSettings } from '../TriggerSettings';

describe('TriggerSettings', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<TriggerSettings />);
      expect(screen.getByTestId('trigger-settings')).toBeInTheDocument();
    });

    it('should show all trigger settings sections', () => {
      render(<TriggerSettings />);
      expect(screen.getByTestId('trigger-source-select')).toBeInTheDocument();
      expect(screen.getByTestId('trigger-edge-select')).toBeInTheDocument();
      expect(screen.getByTestId('trigger-sweep-select')).toBeInTheDocument();
    });
  });

  describe('Source selector', () => {
    it('should show available trigger sources', () => {
      render(<TriggerSettings sources={['CHAN1', 'CHAN2', 'EXT']} />);
      const select = screen.getByTestId('trigger-source-select') as HTMLSelectElement;

      expect(select.querySelectorAll('option').length).toBe(3);
      expect(screen.getByText('CHAN1')).toBeInTheDocument();
      expect(screen.getByText('CHAN2')).toBeInTheDocument();
      expect(screen.getByText('EXT')).toBeInTheDocument();
    });

    it('should select current source', () => {
      render(<TriggerSettings sources={['CHAN1', 'CHAN2']} currentSource="CHAN2" />);
      const select = screen.getByTestId('trigger-source-select') as HTMLSelectElement;
      expect(select.value).toBe('CHAN2');
    });

    it('should call onSourceChange when source is changed', () => {
      const onChange = vi.fn();
      render(
        <TriggerSettings
          sources={['CHAN1', 'CHAN2']}
          currentSource="CHAN1"
          onSourceChange={onChange}
        />
      );

      const select = screen.getByTestId('trigger-source-select');
      fireEvent.change(select, { target: { value: 'CHAN2' } });
      expect(onChange).toHaveBeenCalledWith('CHAN2');
    });
  });

  describe('Edge selector', () => {
    it('should show edge options (rising, falling)', () => {
      render(<TriggerSettings />);
      const select = screen.getByTestId('trigger-edge-select');

      const options = select.querySelectorAll('option');
      const values = Array.from(options).map(o => o.value);
      expect(values).toContain('rising');
      expect(values).toContain('falling');
    });

    it('should select current edge', () => {
      render(<TriggerSettings currentEdge="falling" />);
      const select = screen.getByTestId('trigger-edge-select') as HTMLSelectElement;
      expect(select.value).toBe('falling');
    });

    it('should call onEdgeChange when edge is changed', () => {
      const onChange = vi.fn();
      render(<TriggerSettings currentEdge="rising" onEdgeChange={onChange} />);

      const select = screen.getByTestId('trigger-edge-select');
      fireEvent.change(select, { target: { value: 'falling' } });
      expect(onChange).toHaveBeenCalledWith('falling');
    });
  });

  describe('Sweep mode selector', () => {
    it('should show sweep mode options (auto, normal, single)', () => {
      render(<TriggerSettings />);
      const select = screen.getByTestId('trigger-sweep-select');

      const options = select.querySelectorAll('option');
      const values = Array.from(options).map(o => o.value);
      expect(values).toContain('auto');
      expect(values).toContain('normal');
      expect(values).toContain('single');
    });

    it('should select current sweep mode', () => {
      render(<TriggerSettings currentSweep="normal" />);
      const select = screen.getByTestId('trigger-sweep-select') as HTMLSelectElement;
      expect(select.value).toBe('normal');
    });

    it('should call onSweepChange when sweep is changed', () => {
      const onChange = vi.fn();
      render(<TriggerSettings currentSweep="auto" onSweepChange={onChange} />);

      const select = screen.getByTestId('trigger-sweep-select');
      fireEvent.change(select, { target: { value: 'single' } });
      expect(onChange).toHaveBeenCalledWith('single');
    });
  });

  describe('Labels', () => {
    it('should show label for source selector', () => {
      render(<TriggerSettings />);
      expect(screen.getByText(/source/i)).toBeInTheDocument();
    });

    it('should show label for edge selector', () => {
      render(<TriggerSettings />);
      expect(screen.getByText(/edge/i)).toBeInTheDocument();
    });

    it('should show label for sweep selector', () => {
      render(<TriggerSettings />);
      expect(screen.getByText(/sweep|mode/i)).toBeInTheDocument();
    });
  });

  describe('Close functionality', () => {
    it('should have a close button', () => {
      render(<TriggerSettings />);
      expect(screen.getByTestId('trigger-settings-close')).toBeInTheDocument();
    });

    it('should call onClose when close button is clicked', () => {
      const onClose = vi.fn();
      render(<TriggerSettings onClose={onClose} />);

      fireEvent.click(screen.getByTestId('trigger-settings-close'));
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('Compact layout', () => {
    it('should have compact styling for popover display', () => {
      render(<TriggerSettings />);
      const container = screen.getByTestId('trigger-settings');
      // Should be compact/popover styled
      expect(container.className).toMatch(/popover|compact|settings/i);
    });
  });

  describe('Disabled state', () => {
    it('should disable all selects when disabled', () => {
      render(<TriggerSettings disabled />);

      expect(screen.getByTestId('trigger-source-select')).toBeDisabled();
      expect(screen.getByTestId('trigger-edge-select')).toBeDisabled();
      expect(screen.getByTestId('trigger-sweep-select')).toBeDisabled();
    });
  });
});
