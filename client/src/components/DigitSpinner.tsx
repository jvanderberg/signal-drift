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
          style={{
            display: 'flex',
            alignItems: 'center',
            fontSize: 28,
            fontWeight: 'bold',
            color: 'var(--text-primary)',
            marginLeft: -4,
            marginRight: -4,
          }}
        >
          .
        </div>
      );
    }

    elements.push(
      <div key={index} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <button
          className="btn btn-secondary"
          style={{
            padding: '2px 8px',
            fontSize: 12,
            minWidth: 28,
          }}
          onClick={() => adjustDigit(index, 1)}
          disabled={disabled}
        >
          +
        </button>
        <div
          style={{
            fontFamily: "'Courier New', monospace",
            fontSize: 28,
            fontWeight: 'bold',
            padding: '4px 6px',
            minWidth: 28,
            textAlign: 'center',
            backgroundColor: flashIndex === index ? 'var(--accent-load)' : 'transparent',
            borderRadius: 4,
            transition: 'background-color 0.1s',
          }}
        >
          {digit}
        </div>
        <button
          className="btn btn-secondary"
          style={{
            padding: '2px 8px',
            fontSize: 12,
            minWidth: 28,
          }}
          onClick={() => adjustDigit(index, -1)}
          disabled={disabled}
        >
          -
        </button>
      </div>
    );
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      {elements}
      <span
        style={{
          fontSize: 16,
          color: 'var(--text-secondary)',
          marginLeft: 8,
        }}
      >
        {unit}
      </span>
    </div>
  );
}
