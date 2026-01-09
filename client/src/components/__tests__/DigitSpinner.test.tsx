import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DigitSpinner } from '../DigitSpinner';
import {
  formatValue,
  digitsToDisplay,
  digitsToNumber,
  getTotalDigits,
  adjustDigitWithCarry,
} from '../digitSpinnerUtils';

describe('digitSpinnerUtils', () => {
  describe('getTotalDigits', () => {
    it('calculates correct total digits for CR mode', () => {
      // max=15000, decimals=3 -> 5 integer digits + 3 decimal = 8
      expect(getTotalDigits(15000, 3)).toBe(8);
    });

    it('calculates correct total digits for CC mode', () => {
      // max=40, decimals=3 -> 2 integer digits + 3 decimal = 5
      expect(getTotalDigits(40, 3)).toBe(5);
    });

    it('calculates correct total digits for CV mode', () => {
      // max=150, decimals=3 -> 3 integer digits + 3 decimal = 6
      expect(getTotalDigits(150, 3)).toBe(6);
    });

    it('handles max of 0 correctly', () => {
      expect(getTotalDigits(0, 2)).toBe(3); // 1 + 2 = 3
    });
  });

  describe('formatValue', () => {
    describe('CR mode (resistance)', () => {
      const decimals = 3;
      const min = 0.05;
      const max = 15000;

      it('formats 3 ohms correctly', () => {
        const digits = formatValue(3, decimals, min, max);
        expect(digits).toEqual(['0', '0', '0', '0', '3', '0', '0', '0']);
      });

      it('formats 0.05 ohms (min) correctly', () => {
        const digits = formatValue(0.05, decimals, min, max);
        expect(digits).toEqual(['0', '0', '0', '0', '0', '0', '5', '0']);
      });

      it('formats 15000 ohms (max) correctly', () => {
        const digits = formatValue(15000, decimals, min, max);
        expect(digits).toEqual(['1', '5', '0', '0', '0', '0', '0', '0']);
      });

      it('formats 123.456 ohms correctly', () => {
        const digits = formatValue(123.456, decimals, min, max);
        expect(digits).toEqual(['0', '0', '1', '2', '3', '4', '5', '6']);
      });

      it('clamps values below min', () => {
        const digits = formatValue(0.01, decimals, min, max);
        expect(digitsToNumber(digits, decimals)).toBe(0.05);
      });

      it('clamps values above max', () => {
        const digits = formatValue(20000, decimals, min, max);
        expect(digitsToNumber(digits, decimals)).toBe(15000);
      });
    });

    describe('CC mode (current)', () => {
      const decimals = 3;
      const min = 0;
      const max = 40;

      it('formats 1.5 amps correctly', () => {
        const digits = formatValue(1.5, decimals, min, max);
        expect(digits).toEqual(['0', '1', '5', '0', '0']);
      });

      it('formats 40 amps (max) correctly', () => {
        const digits = formatValue(40, decimals, min, max);
        expect(digits).toEqual(['4', '0', '0', '0', '0']);
      });
    });

    describe('CV mode (voltage)', () => {
      const decimals = 3;
      const min = 0;
      const max = 150;

      it('formats 12.5 volts correctly', () => {
        const digits = formatValue(12.5, decimals, min, max);
        expect(digits).toEqual(['0', '1', '2', '5', '0', '0']);
      });
    });
  });

  describe('digitsToDisplay', () => {
    it('formats CR mode digits with decimal', () => {
      const digits = ['0', '0', '0', '0', '3', '0', '0', '0'];
      expect(digitsToDisplay(digits, 3, 15000)).toBe('00003.000');
    });

    it('formats CC mode digits with decimal', () => {
      const digits = ['0', '1', '5', '0', '0'];
      expect(digitsToDisplay(digits, 3, 40)).toBe('01.500');
    });

    it('handles zero decimals', () => {
      const digits = ['1', '2', '3'];
      expect(digitsToDisplay(digits, 0, 999)).toBe('123');
    });
  });

  describe('digitsToNumber', () => {
    it('converts digits back to number', () => {
      expect(digitsToNumber(['0', '1', '5', '0', '0'], 3)).toBe(1.5);
      expect(digitsToNumber(['4', '0', '0', '0', '0'], 3)).toBe(40);
      expect(digitsToNumber(['0', '0', '1', '2', '3', '4', '5', '6'], 3)).toBe(123.456);
    });
  });

  describe('adjustDigitWithCarry', () => {
    const decimals = 3;
    const min = 0;
    const max = 40;

    it('increments a single digit without carry', () => {
      const digits = ['0', '1', '0', '0', '0']; // 1.000
      const result = adjustDigitWithCarry(digits, 1, 1, decimals, min, max);
      expect(result).toEqual(['0', '2', '0', '0', '0']); // 2.000
    });

    it('decrements a single digit without borrow', () => {
      const digits = ['0', '5', '0', '0', '0']; // 5.000
      const result = adjustDigitWithCarry(digits, 1, -1, decimals, min, max);
      expect(result).toEqual(['0', '4', '0', '0', '0']); // 4.000
    });

    it('carries over when digit goes above 9', () => {
      const digits = ['0', '9', '0', '0', '0']; // 9.000
      const result = adjustDigitWithCarry(digits, 1, 1, decimals, min, max);
      expect(result).toEqual(['1', '0', '0', '0', '0']); // 10.000
    });

    it('borrows when digit goes below 0', () => {
      const digits = ['1', '0', '0', '0', '0']; // 10.000
      const result = adjustDigitWithCarry(digits, 1, -1, decimals, min, max);
      expect(result).toEqual(['0', '9', '0', '0', '0']); // 9.000
    });

    it('handles multi-digit carry (9999 + 1)', () => {
      // 9.999 -> 10.000
      const digits = ['0', '9', '9', '9', '9'];
      const result = adjustDigitWithCarry(digits, 4, 1, decimals, min, max);
      expect(result).toEqual(['1', '0', '0', '0', '0']);
    });

    it('handles multi-digit borrow (10000 - 1 on last digit)', () => {
      // 10.000 -> 9.999
      const digits = ['1', '0', '0', '0', '0'];
      const result = adjustDigitWithCarry(digits, 4, -1, decimals, min, max);
      expect(result).toEqual(['0', '9', '9', '9', '9']);
    });

    it('returns null when result would exceed max', () => {
      const digits = ['4', '0', '0', '0', '0']; // 40.000 (at max)
      const result = adjustDigitWithCarry(digits, 0, 1, decimals, min, max);
      expect(result).toBeNull();
    });

    it('returns null when result would go below min', () => {
      const digits = ['0', '0', '0', '0', '0']; // 0.000 (at min)
      const result = adjustDigitWithCarry(digits, 4, -1, decimals, min, max);
      expect(result).toBeNull();
    });

    it('handles decimal digit adjustments', () => {
      const digits = ['0', '1', '5', '0', '0']; // 1.500
      const result = adjustDigitWithCarry(digits, 2, 1, decimals, min, max);
      expect(result).toEqual(['0', '1', '6', '0', '0']); // 1.600
    });
  });
});

describe('DigitSpinner component', () => {
  const defaultProps = {
    value: 1.5,
    decimals: 3,
    min: 0,
    max: 40,
    onChange: vi.fn(),
    unit: 'A',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the correct digits', () => {
    render(<DigitSpinner {...defaultProps} />);
    // Should show 01.500 for 1.5A with max 40
    // Multiple 0s exist, so use getAllByText
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBe(3); // Three zeros in 01.500
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('.')).toBeInTheDocument();
  });

  it('renders the unit', () => {
    render(<DigitSpinner {...defaultProps} />);
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('renders increment and decrement buttons for each digit', () => {
    render(<DigitSpinner {...defaultProps} />);
    const plusButtons = screen.getAllByText('+');
    const minusButtons = screen.getAllByText('-');
    // 5 digits (2 integer + 3 decimal)
    expect(plusButtons).toHaveLength(5);
    expect(minusButtons).toHaveLength(5);
  });

  it('calls onChange when increment button is clicked', () => {
    const onChange = vi.fn();
    render(<DigitSpinner {...defaultProps} onChange={onChange} />);

    const plusButtons = screen.getAllByText('+');
    fireEvent.click(plusButtons[1]); // Click + on the "1" digit

    expect(onChange).toHaveBeenCalledWith(2.5); // 1.5 + 1.0 = 2.5
  });

  it('calls onChange when decrement button is clicked', () => {
    const onChange = vi.fn();
    render(<DigitSpinner {...defaultProps} onChange={onChange} />);

    const minusButtons = screen.getAllByText('-');
    fireEvent.click(minusButtons[1]); // Click - on the "1" digit

    expect(onChange).toHaveBeenCalledWith(0.5); // 1.5 - 1.0 = 0.5
  });

  it('does not call onChange when disabled', () => {
    const onChange = vi.fn();
    render(<DigitSpinner {...defaultProps} onChange={onChange} disabled />);

    const plusButtons = screen.getAllByText('+');
    fireEvent.click(plusButtons[0]);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('disables buttons when disabled prop is true', () => {
    render(<DigitSpinner {...defaultProps} disabled />);

    const plusButtons = screen.getAllByText('+');
    const minusButtons = screen.getAllByText('-');

    plusButtons.forEach(btn => expect(btn).toBeDisabled());
    minusButtons.forEach(btn => expect(btn).toBeDisabled());
  });

  it('does not allow value to exceed max', () => {
    const onChange = vi.fn();
    render(<DigitSpinner {...defaultProps} value={40} onChange={onChange} />);

    const plusButtons = screen.getAllByText('+');
    fireEvent.click(plusButtons[0]); // Try to increment tens digit

    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not allow value to go below min', () => {
    const onChange = vi.fn();
    render(<DigitSpinner {...defaultProps} value={0} onChange={onChange} />);

    const minusButtons = screen.getAllByText('-');
    fireEvent.click(minusButtons[4]); // Try to decrement smallest decimal

    expect(onChange).not.toHaveBeenCalled();
  });

  it('handles carry correctly when incrementing 9', () => {
    const onChange = vi.fn();
    render(<DigitSpinner {...defaultProps} value={9} onChange={onChange} />);

    const plusButtons = screen.getAllByText('+');
    fireEvent.click(plusButtons[1]); // Click + on the "9" digit (ones place)

    expect(onChange).toHaveBeenCalledWith(10);
  });

  it('handles borrow correctly when decrementing 0 with higher digit available', () => {
    const onChange = vi.fn();
    render(<DigitSpinner {...defaultProps} value={10} onChange={onChange} />);

    const minusButtons = screen.getAllByText('-');
    fireEvent.click(minusButtons[1]); // Click - on the "0" digit (ones place)

    expect(onChange).toHaveBeenCalledWith(9);
  });
});
