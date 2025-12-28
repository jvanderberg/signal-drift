import { describe, it, expect } from 'vitest';

// Test the digit formatting logic extracted from DigitSpinner
function formatValue(value: number, decimals: number, min: number, max: number): string[] {
  const totalDigits = Math.max(
    Math.floor(Math.log10(Math.max(max, 1))) + 1 + decimals,
    decimals + 1
  );

  const clamped = Math.max(min, Math.min(max, value));
  const multiplier = Math.pow(10, decimals);
  const intVal = Math.round(clamped * multiplier);
  const str = intVal.toString().padStart(totalDigits, '0');
  return str.split('');
}

function digitsToDisplay(digits: string[], decimals: number, max: number): string {
  const totalDigits = Math.max(
    Math.floor(Math.log10(Math.max(max, 1))) + 1 + decimals,
    decimals + 1
  );
  const integerDigits = totalDigits - decimals;

  const intPart = digits.slice(0, integerDigits).join('');
  const decPart = digits.slice(integerDigits).join('');
  return decimals > 0 ? `${intPart}.${decPart}` : intPart;
}

describe('DigitSpinner formatting', () => {
  describe('CR mode (resistance)', () => {
    const decimals = 3;
    const min = 0.05;
    const max = 15000;

    it('should format 3 ohms as 00003.000', () => {
      const digits = formatValue(3, decimals, min, max);
      const display = digitsToDisplay(digits, decimals, max);
      console.log('3 ohms:', digits.join(''), '->', display);
      expect(display).toBe('00003.000');
    });

    it('should format 0.05 ohms (min) as 00000.050', () => {
      const digits = formatValue(0.05, decimals, min, max);
      const display = digitsToDisplay(digits, decimals, max);
      console.log('0.05 ohms:', digits.join(''), '->', display);
      expect(display).toBe('00000.050');
    });

    it('should format 15000 ohms (max) as 15000.000', () => {
      const digits = formatValue(15000, decimals, min, max);
      const display = digitsToDisplay(digits, decimals, max);
      console.log('15000 ohms:', digits.join(''), '->', display);
      expect(display).toBe('15000.000');
    });

    it('should format 123.456 ohms correctly', () => {
      const digits = formatValue(123.456, decimals, min, max);
      const display = digitsToDisplay(digits, decimals, max);
      console.log('123.456 ohms:', digits.join(''), '->', display);
      expect(display).toBe('00123.456');
    });
  });

  describe('CC mode (current)', () => {
    const decimals = 3;
    const min = 0;
    const max = 40;

    it('should format 1.5 amps as 01.500', () => {
      const digits = formatValue(1.5, decimals, min, max);
      const display = digitsToDisplay(digits, decimals, max);
      console.log('1.5 amps:', digits.join(''), '->', display);
      expect(display).toBe('01.500');
    });

    it('should format 40 amps (max) as 40.000', () => {
      const digits = formatValue(40, decimals, min, max);
      const display = digitsToDisplay(digits, decimals, max);
      console.log('40 amps:', digits.join(''), '->', display);
      expect(display).toBe('40.000');
    });
  });

  describe('CV mode (voltage)', () => {
    const decimals = 3;
    const min = 0;
    const max = 150;

    it('should format 12.5 volts as 012.500', () => {
      const digits = formatValue(12.5, decimals, min, max);
      const display = digitsToDisplay(digits, decimals, max);
      console.log('12.5 volts:', digits.join(''), '->', display);
      expect(display).toBe('012.500');
    });
  });
});
