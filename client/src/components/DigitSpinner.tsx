import { useState, useEffect, useRef } from 'react';

interface DigitSpinnerProps {
  value: number;
  decimals: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  unit: string;
  disabled?: boolean;
}

export function DigitSpinner({
  value,
  decimals,
  min,
  max,
  onChange,
  unit,
  disabled,
}: DigitSpinnerProps) {
  // Format the value into digit columns
  const totalDigits = Math.max(
    Math.floor(Math.log10(Math.max(max, 1))) + 1 + decimals,
    decimals + 1
  );
  const integerDigits = totalDigits - decimals;

  // Convert value to string with proper padding
  const formatValue = (v: number): string[] => {
    const clamped = Math.max(min, Math.min(max, v));
    const multiplier = Math.pow(10, decimals);
    const intVal = Math.round(clamped * multiplier);
    const str = intVal.toString().padStart(totalDigits, '0');
    return str.split('');
  };

  const [digits, setDigits] = useState(() => formatValue(value));
  const [flashIndex, setFlashIndex] = useState<number | null>(null);
  const flashTimeoutRef = useRef<number>();

  // Sync with external value changes
  useEffect(() => {
    setDigits(formatValue(value));
  }, [value, decimals, max]);

  const digitsToNumber = (d: string[]): number => {
    const intVal = parseInt(d.join(''), 10);
    return intVal / Math.pow(10, decimals);
  };

  const adjustDigit = (index: number, delta: number) => {
    if (disabled) return;

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
      i--; // Always move left for carry/borrow
    }

    const newValue = digitsToNumber(newDigits);
    if (newValue >= min && newValue <= max) {
      setDigits(newDigits);
      onChange(newValue);

      // Flash feedback
      setFlashIndex(index);
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
      flashTimeoutRef.current = window.setTimeout(() => setFlashIndex(null), 150);
    }
  };

  // Build elements with decimal point inserted at the right position
  const elements: JSX.Element[] = [];

  digits.forEach((digit, index) => {
    // Insert decimal point before the decimal digits
    if (index === integerDigits && decimals > 0) {
      elements.push(
        <div
          key="decimal"
          className="flex items-center text-xl font-bold text-[var(--color-text-primary)] -mx-0.5"
        >
          .
        </div>
      );
    }

    elements.push(
      <div key={index} className="flex flex-col items-center">
        <button
          className="px-1.5 py-0.5 text-[10px] leading-none font-medium rounded bg-[var(--color-border-light)] text-[var(--color-text-primary)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed min-w-[22px]"
          onClick={() => adjustDigit(index, 1)}
          disabled={disabled}
        >
          +
        </button>
        <div
          className={`font-mono text-xl font-bold px-1 py-0.5 min-w-[22px] text-center rounded transition-colors ${
            flashIndex === index ? 'bg-[var(--color-accent-load)]' : ''
          }`}
        >
          {digit}
        </div>
        <button
          className="px-1.5 py-0.5 text-[10px] leading-none font-medium rounded bg-[var(--color-border-light)] text-[var(--color-text-primary)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed min-w-[22px]"
          onClick={() => adjustDigit(index, -1)}
          disabled={disabled}
        >
          -
        </button>
      </div>
    );
  });

  return (
    <div className="flex items-center gap-0.5">
      {elements}
      <span className="text-xs text-[var(--color-text-secondary)] ml-1">
        {unit}
      </span>
    </div>
  );
}
