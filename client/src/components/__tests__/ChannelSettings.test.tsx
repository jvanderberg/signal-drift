import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChannelSettings } from '../ChannelSettings';

describe('ChannelSettings', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<ChannelSettings channel="CHAN1" />);
      expect(screen.getByTestId('channel-settings')).toBeInTheDocument();
    });

    it('should show channel name in header', () => {
      render(<ChannelSettings channel="CHAN1" />);
      // Header shows "CH 1 Settings"
      expect(screen.getByText(/CH\s*1/i)).toBeInTheDocument();
    });

    it('should show all settings sections', () => {
      render(<ChannelSettings channel="CHAN1" />);
      expect(screen.getByTestId('channel-scale-select')).toBeInTheDocument();
      expect(screen.getByTestId('channel-offset-input')).toBeInTheDocument();
      expect(screen.getByTestId('channel-coupling-select')).toBeInTheDocument();
      expect(screen.getByTestId('channel-probe-select')).toBeInTheDocument();
    });
  });

  describe('Scale selector', () => {
    it('should show scale options from 1mV to 10V per division', () => {
      render(<ChannelSettings channel="CHAN1" />);
      const select = screen.getByTestId('channel-scale-select');
      const options = select.querySelectorAll('option');

      // Should have multiple scale options
      expect(options.length).toBeGreaterThan(5);

      // Should include common values
      const values = Array.from(options).map(o => o.textContent?.toLowerCase());
      expect(values.some(v => v?.includes('mv'))).toBe(true);
      expect(values.some(v => v?.includes('v'))).toBe(true);
    });

    it('should select current scale', () => {
      render(<ChannelSettings channel="CHAN1" currentScale={0.5} />);
      const select = screen.getByTestId('channel-scale-select') as HTMLSelectElement;
      expect(parseFloat(select.value)).toBeCloseTo(0.5);
    });

    it('should call onScaleChange when scale is changed', () => {
      const onChange = vi.fn();
      render(
        <ChannelSettings
          channel="CHAN1"
          currentScale={1}
          onScaleChange={onChange}
        />
      );

      const select = screen.getByTestId('channel-scale-select');
      fireEvent.change(select, { target: { value: '0.5' } });
      expect(onChange).toHaveBeenCalledWith(0.5);
    });
  });

  describe('Offset input', () => {
    it('should show current offset value', () => {
      render(<ChannelSettings channel="CHAN1" currentOffset={1.5} />);
      const input = screen.getByTestId('channel-offset-input') as HTMLInputElement;
      expect(parseFloat(input.value)).toBeCloseTo(1.5);
    });

    it('should call onOffsetChange when offset is changed', () => {
      const onChange = vi.fn();
      render(
        <ChannelSettings
          channel="CHAN1"
          currentOffset={0}
          onOffsetChange={onChange}
        />
      );

      const input = screen.getByTestId('channel-offset-input');
      fireEvent.change(input, { target: { value: '-2.5' } });
      expect(onChange).toHaveBeenCalledWith(-2.5);
    });

    it('should accept negative offset values', () => {
      const onChange = vi.fn();
      render(<ChannelSettings channel="CHAN1" onOffsetChange={onChange} />);

      const input = screen.getByTestId('channel-offset-input');
      fireEvent.change(input, { target: { value: '-10' } });
      expect(onChange).toHaveBeenCalledWith(-10);
    });
  });

  describe('Coupling selector', () => {
    it('should show coupling options (AC, DC, GND)', () => {
      render(<ChannelSettings channel="CHAN1" />);
      const select = screen.getByTestId('channel-coupling-select');

      const options = select.querySelectorAll('option');
      const values = Array.from(options).map(o => o.value);
      expect(values).toContain('AC');
      expect(values).toContain('DC');
      expect(values).toContain('GND');
    });

    it('should select current coupling', () => {
      render(<ChannelSettings channel="CHAN1" currentCoupling="AC" />);
      const select = screen.getByTestId('channel-coupling-select') as HTMLSelectElement;
      expect(select.value).toBe('AC');
    });

    it('should call onCouplingChange when coupling is changed', () => {
      const onChange = vi.fn();
      render(
        <ChannelSettings
          channel="CHAN1"
          currentCoupling="DC"
          onCouplingChange={onChange}
        />
      );

      const select = screen.getByTestId('channel-coupling-select');
      fireEvent.change(select, { target: { value: 'AC' } });
      expect(onChange).toHaveBeenCalledWith('AC');
    });
  });

  describe('Probe ratio selector', () => {
    it('should show probe ratio options (1x, 10x, 100x)', () => {
      render(<ChannelSettings channel="CHAN1" />);
      const select = screen.getByTestId('channel-probe-select');

      const options = select.querySelectorAll('option');
      const values = Array.from(options).map(o => parseFloat(o.value));
      expect(values).toContain(1);
      expect(values).toContain(10);
      expect(values).toContain(100);
    });

    it('should select current probe ratio', () => {
      render(<ChannelSettings channel="CHAN1" currentProbeRatio={10} />);
      const select = screen.getByTestId('channel-probe-select') as HTMLSelectElement;
      expect(parseFloat(select.value)).toBe(10);
    });

    it('should call onProbeRatioChange when probe ratio is changed', () => {
      const onChange = vi.fn();
      render(
        <ChannelSettings
          channel="CHAN1"
          currentProbeRatio={1}
          onProbeRatioChange={onChange}
        />
      );

      const select = screen.getByTestId('channel-probe-select');
      fireEvent.change(select, { target: { value: '10' } });
      expect(onChange).toHaveBeenCalledWith(10);
    });
  });

  describe('BW Limit toggle', () => {
    it('should show bandwidth limit toggle', () => {
      render(<ChannelSettings channel="CHAN1" />);
      expect(screen.getByTestId('channel-bwlimit-toggle')).toBeInTheDocument();
    });

    it('should show current BW limit state', () => {
      render(<ChannelSettings channel="CHAN1" currentBwLimit={true} />);
      const toggle = screen.getByTestId('channel-bwlimit-toggle') as HTMLInputElement;
      expect(toggle.checked).toBe(true);
    });

    it('should call onBwLimitChange when toggled', () => {
      const onChange = vi.fn();
      render(
        <ChannelSettings
          channel="CHAN1"
          currentBwLimit={false}
          onBwLimitChange={onChange}
        />
      );

      const toggle = screen.getByTestId('channel-bwlimit-toggle');
      fireEvent.click(toggle);
      expect(onChange).toHaveBeenCalledWith(true);
    });
  });

  describe('Close functionality', () => {
    it('should have a close button', () => {
      render(<ChannelSettings channel="CHAN1" />);
      expect(screen.getByTestId('channel-settings-close')).toBeInTheDocument();
    });

    it('should call onClose when close button is clicked', () => {
      const onClose = vi.fn();
      render(<ChannelSettings channel="CHAN1" onClose={onClose} />);

      fireEvent.click(screen.getByTestId('channel-settings-close'));
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('Channel color', () => {
    it('should apply channel-specific color styling', () => {
      render(<ChannelSettings channel="CHAN1" />);
      const container = screen.getByTestId('channel-settings');
      // Should have channel-specific styling (border, accent, etc.)
      expect(container.className).toMatch(/channel|chan1/i);
    });
  });

  describe('Disabled state', () => {
    it('should disable all controls when disabled', () => {
      render(<ChannelSettings channel="CHAN1" disabled />);

      expect(screen.getByTestId('channel-scale-select')).toBeDisabled();
      expect(screen.getByTestId('channel-offset-input')).toBeDisabled();
      expect(screen.getByTestId('channel-coupling-select')).toBeDisabled();
      expect(screen.getByTestId('channel-probe-select')).toBeDisabled();
      expect(screen.getByTestId('channel-bwlimit-toggle')).toBeDisabled();
    });
  });

  describe('Labels', () => {
    it('should show labels for all controls', () => {
      render(<ChannelSettings channel="CHAN1" />);
      expect(screen.getByText(/scale/i)).toBeInTheDocument();
      expect(screen.getByText(/offset/i)).toBeInTheDocument();
      expect(screen.getByText(/coupling/i)).toBeInTheDocument();
      expect(screen.getByText(/probe/i)).toBeInTheDocument();
    });
  });
});
