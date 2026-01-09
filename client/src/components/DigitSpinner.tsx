import { useState, useEffect, useRef } from 'react';
import {
  formatValue,
  getTotalDigits,
  adjustDigitWithCarry,
} from './digitSpinnerUtils';

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
  const totalDigits = getTotalDigits(max, decimals);
  const integerDigits = totalDigits - decimals;

  const [digits, setDigits] = useState(() => formatValue(value, decimals, min, max));
  const [flashIndex, setFlashIndex] = useState<number | null>(null);
  const flashTimeoutRef = useRef<number>();

  // Sync with external value changes
  useEffect(() => {
    setDigits(formatValue(value, decimals, min, max));
  }, [value, decimals, min, max]);

  const adjustDigit = (index: number, delta: number) => {
    if (disabled) return;

    const newDigits = adjustDigitWithCarry(digits, index, delta, decimals, min, max);
    if (newDigits) {
      setDigits(newDigits);
      onChange(
        parseInt(newDigits.join(''), 10) / Math.pow(10, decimals)
      );

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
          className="px-1.5 py-0.5 text-[10px] leading-none font-medium rounded bg-[var(--color-border-light)] text-[var(--color-text-primary)] hover:bg-[var(--color-border-dark)] hover:text-[var(--color-text-primary)] active:scale-90 active:bg-[var(--color-bg-secondary)] disabled:opacity-50 disabled:cursor-not-allowed min-w-[22px] cursor-pointer transition-all duration-100 select-none"
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
          className="px-1.5 py-0.5 text-[10px] leading-none font-medium rounded bg-[var(--color-border-light)] text-[var(--color-text-primary)] hover:bg-[var(--color-border-dark)] hover:text-[var(--color-text-primary)] active:scale-90 active:bg-[var(--color-bg-secondary)] disabled:opacity-50 disabled:cursor-not-allowed min-w-[22px] cursor-pointer transition-all duration-100 select-none"
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
