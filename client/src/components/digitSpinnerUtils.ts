/**
 * Utility functions for DigitSpinner component
 * Extracted to enable proper unit testing
 */

/**
 * Calculate total number of digits needed to display a value with given constraints
 */
export function getTotalDigits(max: number, decimals: number): number {
  return Math.max(
    Math.floor(Math.log10(Math.max(max, 1))) + 1 + decimals,
    decimals + 1
  );
}

/**
 * Format a number into an array of digit strings with proper padding
 */
export function formatValue(
  value: number,
  decimals: number,
  min: number,
  max: number
): string[] {
  const totalDigits = getTotalDigits(max, decimals);
  const clamped = Math.max(min, Math.min(max, value));
  const multiplier = Math.pow(10, decimals);
  const intVal = Math.round(clamped * multiplier);
  const str = intVal.toString().padStart(totalDigits, '0');
  return str.split('');
}

/**
 * Convert an array of digit strings back to a number
 */
export function digitsToNumber(digits: string[], decimals: number): number {
  const intVal = parseInt(digits.join(''), 10);
  return intVal / Math.pow(10, decimals);
}

/**
 * Format digits for display with decimal point inserted
 */
export function digitsToDisplay(
  digits: string[],
  decimals: number,
  max: number
): string {
  const totalDigits = getTotalDigits(max, decimals);
  const integerDigits = totalDigits - decimals;

  const intPart = digits.slice(0, integerDigits).join('');
  const decPart = digits.slice(integerDigits).join('');
  return decimals > 0 ? `${intPart}.${decPart}` : intPart;
}

/**
 * Adjust a digit at a given index and propagate carry/borrow
 * Returns the new digits array, or null if the result would be out of bounds
 */
export function adjustDigitWithCarry(
  digits: string[],
  index: number,
  delta: number,
  decimals: number,
  min: number,
  max: number
): string[] | null {
  const newDigits = [...digits];
  let carry = delta;
  let i = index;

  // Propagate carry/borrow through digits (always moves left)
  while (carry !== 0 && i >= 0) {
    let currentDigit = parseInt(newDigits[i], 10) + carry;
    if (currentDigit > 9) {
      carry = 1;
      currentDigit = 0;
    } else if (currentDigit < 0) {
      carry = -1;
      currentDigit = 9;
    } else {
      carry = 0;
    }
    newDigits[i] = currentDigit.toString();
    i--;
  }

  const newValue = digitsToNumber(newDigits, decimals);
  if (newValue >= min && newValue <= max) {
    return newDigits;
  }
  return null;
}
