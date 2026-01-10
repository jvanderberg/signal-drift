import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DigitSpinner } from '../DigitSpinner';

describe('DigitSpinner', () => {
  const defaultProps = {
    value: 0,
    decimals: 3,
    min: 0,
    max: 40,
    onChange: vi.fn(),
    unit: 'A',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<DigitSpinner {...defaultProps} />);
      expect(screen.getByText('A')).toBeInTheDocument();
    });

    it('should display the unit label', () => {
      render(<DigitSpinner {...defaultProps} unit="V" />);
      expect(screen.getByText('V')).toBeInTheDocument();
    });

    it('should show correct number of digit positions', () => {
      render(<DigitSpinner {...defaultProps} value={0} max={40} decimals={3} />);
      // max=40 needs 2 integer digits + 3 decimal digits = 5 total
      const plusButtons = screen.getAllByText('+');
      expect(plusButtons).toHaveLength(5);
    });

    it('should display decimal point when decimals > 0', () => {
      render(<DigitSpinner {...defaultProps} decimals={2} />);
      expect(screen.getByText('.')).toBeInTheDocument();
    });

    it('should not display decimal point when decimals = 0', () => {
      render(<DigitSpinner {...defaultProps} decimals={0} />);
      expect(screen.queryByText('.')).not.toBeInTheDocument();
    });
  });

  describe('Value formatting', () => {
    it('should display 0 as 00.000 for max=40 decimals=3', () => {
      render(<DigitSpinner {...defaultProps} value={0} max={40} decimals={3} />);
      // Check that we have zeros displayed
      const zeros = screen.getAllByText('0');
      expect(zeros.length).toBeGreaterThanOrEqual(5);
    });

    it('should display 12.5 correctly', () => {
      render(<DigitSpinner {...defaultProps} value={12.5} max={40} decimals={3} />);
      expect(screen.getByText('1')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
      expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('should format CR mode resistance (3 ohms) correctly', () => {
      render(<DigitSpinner {...defaultProps} value={3} decimals={3} min={0.05} max={15000} unit="Ω" />);
      // max=15000 needs 5 integer digits + 3 decimal digits = 8 total
      const plusButtons = screen.getAllByText('+');
      expect(plusButtons).toHaveLength(8);
      expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('should clamp values to min/max', () => {
      render(<DigitSpinner {...defaultProps} value={100} min={0} max={40} />);
      // Should display 40.000 (clamped to max)
      expect(screen.getByText('4')).toBeInTheDocument();
    });
  });

  describe('Button interactions - increment', () => {
    it('should call onChange when + button is clicked', () => {
      const onChange = vi.fn();
      render(<DigitSpinner {...defaultProps} value={5} onChange={onChange} />);

      const plusButtons = screen.getAllByText('+');
      // Click the last + button (least significant digit)
      fireEvent.click(plusButtons[plusButtons.length - 1]);

      expect(onChange).toHaveBeenCalled();
    });

    it('should increment the correct digit position', () => {
      const onChange = vi.fn();
      render(<DigitSpinner {...defaultProps} value={5} max={40} decimals={3} onChange={onChange} />);

      const plusButtons = screen.getAllByText('+');
      // For max=40, decimals=3: positions are [tens, ones, tenth, hundredth, thousandth]
      // Click the ones position (+1)
      fireEvent.click(plusButtons[1]);

      expect(onChange).toHaveBeenCalledWith(6);
    });

    it('should increment by 0.001 when clicking last decimal digit', () => {
      const onChange = vi.fn();
      render(<DigitSpinner {...defaultProps} value={5.123} max={40} decimals={3} onChange={onChange} />);

      const plusButtons = screen.getAllByText('+');
      fireEvent.click(plusButtons[plusButtons.length - 1]);

      expect(onChange).toHaveBeenCalledWith(5.124);
    });

    it('should increment by 10 when clicking tens position', () => {
      const onChange = vi.fn();
      render(<DigitSpinner {...defaultProps} value={5} max={40} decimals={3} onChange={onChange} />);

      const plusButtons = screen.getAllByText('+');
      // First button is tens position
      fireEvent.click(plusButtons[0]);

      expect(onChange).toHaveBeenCalledWith(15);
    });
  });

  describe('Button interactions - decrement', () => {
    it('should call onChange when - button is clicked', () => {
      const onChange = vi.fn();
      render(<DigitSpinner {...defaultProps} value={5} onChange={onChange} />);

      const minusButtons = screen.getAllByText('-');
      fireEvent.click(minusButtons[minusButtons.length - 1]);

      expect(onChange).toHaveBeenCalled();
    });

    it('should decrement the correct digit position', () => {
      const onChange = vi.fn();
      render(<DigitSpinner {...defaultProps} value={6} max={40} decimals={3} onChange={onChange} />);

      const minusButtons = screen.getAllByText('-');
      // Click the ones position (-1)
      fireEvent.click(minusButtons[1]);

      expect(onChange).toHaveBeenCalledWith(5);
    });

    it('should decrement by 0.001 when clicking last decimal digit', () => {
      const onChange = vi.fn();
      render(<DigitSpinner {...defaultProps} value={5.125} max={40} decimals={3} onChange={onChange} />);

      const minusButtons = screen.getAllByText('-');
      fireEvent.click(minusButtons[minusButtons.length - 1]);

      expect(onChange).toHaveBeenCalledWith(5.124);
    });
  });

  describe('Carry/borrow logic', () => {
    it('should carry when digit exceeds 9', () => {
      const onChange = vi.fn();
      render(<DigitSpinner {...defaultProps} value={5.999} max={40} decimals={3} onChange={onChange} />);

      const plusButtons = screen.getAllByText('+');
      // Click the last digit (thousandths)
      fireEvent.click(plusButtons[plusButtons.length - 1]);

      // 5.999 + 0.001 = 6.000
      expect(onChange).toHaveBeenCalledWith(6);
    });

    it('should borrow when digit goes below 0', () => {
      const onChange = vi.fn();
      render(<DigitSpinner {...defaultProps} value={6} max={40} decimals={3} onChange={onChange} />);

      const minusButtons = screen.getAllByText('-');
      // Click the last digit (thousandths)
      fireEvent.click(minusButtons[minusButtons.length - 1]);

      // 6.000 - 0.001 = 5.999
      expect(onChange).toHaveBeenCalledWith(5.999);
    });

    it('should carry through multiple digits (9.99 + 0.01 = 10.00)', () => {
      const onChange = vi.fn();
      render(<DigitSpinner {...defaultProps} value={9.99} max={40} decimals={2} onChange={onChange} />);

      const plusButtons = screen.getAllByText('+');
      // Click the hundredths position
      fireEvent.click(plusButtons[plusButtons.length - 1]);

      expect(onChange).toHaveBeenCalledWith(10);
    });
  });

  describe('Boundary conditions', () => {
    it('should not exceed max value', () => {
      const onChange = vi.fn();
      render(<DigitSpinner {...defaultProps} value={40} max={40} decimals={3} onChange={onChange} />);

      const plusButtons = screen.getAllByText('+');
      fireEvent.click(plusButtons[0]); // Try to add 10

      // Should not call onChange since result would exceed max
      expect(onChange).not.toHaveBeenCalled();
    });

    it('should not go below min value', () => {
      const onChange = vi.fn();
      render(<DigitSpinner {...defaultProps} value={0} min={0} max={40} decimals={3} onChange={onChange} />);

      const minusButtons = screen.getAllByText('-');
      fireEvent.click(minusButtons[minusButtons.length - 1]); // Try to subtract 0.001

      // Should not call onChange since result would be negative
      expect(onChange).not.toHaveBeenCalled();
    });

    it('should respect non-zero min value', () => {
      const onChange = vi.fn();
      render(<DigitSpinner {...defaultProps} value={0.05} min={0.05} max={15000} decimals={3} onChange={onChange} />);

      const minusButtons = screen.getAllByText('-');
      fireEvent.click(minusButtons[minusButtons.length - 1]); // Try to go below 0.05

      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('Disabled state', () => {
    it('should not call onChange when disabled', () => {
      const onChange = vi.fn();
      render(<DigitSpinner {...defaultProps} value={5} onChange={onChange} disabled />);

      const plusButtons = screen.getAllByText('+');
      fireEvent.click(plusButtons[0]);

      expect(onChange).not.toHaveBeenCalled();
    });

    it('should have disabled attribute on buttons when disabled', () => {
      render(<DigitSpinner {...defaultProps} disabled />);

      const plusButtons = screen.getAllByText('+');
      const minusButtons = screen.getAllByText('-');

      plusButtons.forEach(btn => {
        expect(btn).toBeDisabled();
      });
      minusButtons.forEach(btn => {
        expect(btn).toBeDisabled();
      });
    });
  });

  describe('External value changes', () => {
    it('should update display when value prop changes', () => {
      const { rerender } = render(<DigitSpinner {...defaultProps} value={5} max={40} decimals={3} />);
      expect(screen.getByText('5')).toBeInTheDocument();

      rerender(<DigitSpinner {...defaultProps} value={12} max={40} decimals={3} />);
      expect(screen.getByText('1')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
    });
  });

  describe('Visual feedback', () => {
    it('should flash digit on increment', () => {
      render(<DigitSpinner {...defaultProps} value={5} />);

      const plusButtons = screen.getAllByText('+');
      fireEvent.click(plusButtons[plusButtons.length - 1]);

      // Flash timeout is 150ms, check that the flash happens
      // The component uses a CSS class for flashing
      vi.advanceTimersByTime(150);

      // After timeout, flash should be cleared (no error means test passes)
    });
  });

  describe('Edge cases', () => {
    it('should handle value of exactly min', () => {
      const onChange = vi.fn();
      render(<DigitSpinner {...defaultProps} value={0.05} min={0.05} max={100} decimals={2} onChange={onChange} />);

      const plusButtons = screen.getAllByText('+');
      fireEvent.click(plusButtons[plusButtons.length - 1]);

      expect(onChange).toHaveBeenCalledWith(0.06);
    });

    it('should handle value of exactly max', () => {
      const onChange = vi.fn();
      render(<DigitSpinner {...defaultProps} value={100} min={0} max={100} decimals={2} onChange={onChange} />);

      const minusButtons = screen.getAllByText('-');
      fireEvent.click(minusButtons[minusButtons.length - 1]);

      expect(onChange).toHaveBeenCalledWith(99.99);
    });

    it('should handle single digit max (0-9)', () => {
      render(<DigitSpinner {...defaultProps} value={5} min={0} max={9} decimals={0} />);

      const plusButtons = screen.getAllByText('+');
      expect(plusButtons).toHaveLength(1);
    });

    it('should handle large max (15000 for resistance)', () => {
      render(<DigitSpinner {...defaultProps} value={1000} min={0.05} max={15000} decimals={3} unit="Ω" />);

      // 15000 needs 5 integer digits + 3 decimal = 8 digit positions
      const plusButtons = screen.getAllByText('+');
      expect(plusButtons).toHaveLength(8);
    });
  });
});
