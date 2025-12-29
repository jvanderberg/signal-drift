import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TriggerSlider } from '../TriggerSlider';

describe('TriggerSlider', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<TriggerSlider />);
      expect(screen.getByTestId('trigger-slider')).toBeInTheDocument();
    });

    it('should render a range input for trigger level', () => {
      render(<TriggerSlider />);
      const slider = screen.getByTestId('trigger-level-input');
      expect(slider).toBeInTheDocument();
      expect(slider.tagName.toLowerCase()).toBe('input');
      expect(slider).toHaveAttribute('type', 'range');
    });

    it('should render vertical slider (via CSS transform or orient)', () => {
      render(<TriggerSlider />);
      const container = screen.getByTestId('trigger-slider');
      // Vertical slider should have styling for vertical orientation
      expect(container.className).toMatch(/vertical|rotate/i);
    });
  });

  describe('Voltage range', () => {
    it('should use provided min/max voltage range', () => {
      render(<TriggerSlider minVoltage={-5} maxVoltage={5} />);
      const slider = screen.getByTestId('trigger-level-input') as HTMLInputElement;
      expect(parseFloat(slider.min)).toBe(-5);
      expect(parseFloat(slider.max)).toBe(5);
    });

    it('should have sensible default range', () => {
      render(<TriggerSlider />);
      const slider = screen.getByTestId('trigger-level-input') as HTMLInputElement;
      expect(parseFloat(slider.min)).toBeLessThan(0);
      expect(parseFloat(slider.max)).toBeGreaterThan(0);
    });

    it('should set slider value to current trigger level', () => {
      render(<TriggerSlider triggerLevel={2.5} minVoltage={-5} maxVoltage={5} />);
      const slider = screen.getByTestId('trigger-level-input') as HTMLInputElement;
      expect(parseFloat(slider.value)).toBeCloseTo(2.5);
    });
  });

  describe('Interaction', () => {
    it('should call onTriggerLevelChange when slider is moved', () => {
      const onChange = vi.fn();
      render(
        <TriggerSlider
          triggerLevel={0}
          minVoltage={-5}
          maxVoltage={5}
          onTriggerLevelChange={onChange}
        />
      );

      const slider = screen.getByTestId('trigger-level-input');
      fireEvent.change(slider, { target: { value: '2.5' } });
      expect(onChange).toHaveBeenCalledWith(2.5);
    });

    it('should call onTriggerLevelChange with correct value type', () => {
      const onChange = vi.fn();
      render(
        <TriggerSlider
          triggerLevel={0}
          onTriggerLevelChange={onChange}
        />
      );

      const slider = screen.getByTestId('trigger-level-input');
      fireEvent.change(slider, { target: { value: '-1.5' } });
      expect(typeof onChange.mock.calls[0][0]).toBe('number');
      expect(onChange.mock.calls[0][0]).toBeCloseTo(-1.5);
    });
  });

  describe('Value display', () => {
    it('should display current trigger level value', () => {
      render(<TriggerSlider triggerLevel={1.23} />);
      expect(screen.getByTestId('trigger-level-value')).toBeInTheDocument();
      expect(screen.getByTestId('trigger-level-value').textContent).toMatch(/1\.23/);
    });

    it('should show unit (V) with the value', () => {
      render(<TriggerSlider triggerLevel={1.5} />);
      const value = screen.getByTestId('trigger-level-value');
      expect(value.textContent).toMatch(/V/);
    });

    it('should format small values with mV', () => {
      render(<TriggerSlider triggerLevel={0.025} />);
      const value = screen.getByTestId('trigger-level-value');
      expect(value.textContent).toMatch(/25\s*mV|0\.025\s*V/i);
    });
  });

  describe('Edge indicator', () => {
    it('should show rising edge indicator when edge is rising', () => {
      render(<TriggerSlider triggerEdge="rising" />);
      const indicator = screen.getByTestId('trigger-edge-indicator');
      expect(indicator).toBeInTheDocument();
      expect(indicator.textContent).toMatch(/↑|rising/i);
    });

    it('should show falling edge indicator when edge is falling', () => {
      render(<TriggerSlider triggerEdge="falling" />);
      const indicator = screen.getByTestId('trigger-edge-indicator');
      expect(indicator.textContent).toMatch(/↓|falling/i);
    });

    it('should show either edge indicator when edge is either', () => {
      render(<TriggerSlider triggerEdge="either" />);
      const indicator = screen.getByTestId('trigger-edge-indicator');
      expect(indicator.textContent).toMatch(/↕|either|both/i);
    });
  });

  describe('Settings cog', () => {
    it('should render a settings/cog button', () => {
      render(<TriggerSlider />);
      const cogButton = screen.getByTestId('trigger-settings-button');
      expect(cogButton).toBeInTheDocument();
    });

    it('should call onSettingsClick when cog is clicked', () => {
      const onSettingsClick = vi.fn();
      render(<TriggerSlider onSettingsClick={onSettingsClick} />);

      const cogButton = screen.getByTestId('trigger-settings-button');
      fireEvent.click(cogButton);
      expect(onSettingsClick).toHaveBeenCalled();
    });
  });

  describe('Disabled state', () => {
    it('should disable slider when disabled prop is true', () => {
      render(<TriggerSlider disabled />);
      const slider = screen.getByTestId('trigger-level-input');
      expect(slider).toBeDisabled();
    });

    it('should show disabled styling when disabled', () => {
      render(<TriggerSlider disabled />);
      const container = screen.getByTestId('trigger-slider');
      expect(container.className).toMatch(/disabled|opacity/i);
    });
  });

  describe('Step precision', () => {
    it('should have fine-grained step for precision', () => {
      render(<TriggerSlider minVoltage={-10} maxVoltage={10} />);
      const slider = screen.getByTestId('trigger-level-input') as HTMLInputElement;
      // Step should be small enough for fine control (at least 0.1V or better)
      expect(parseFloat(slider.step)).toBeLessThanOrEqual(0.1);
    });
  });
});
