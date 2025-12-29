/**
 * TimebaseControls - Inline control for stepping through oscilloscope timebase scales
 *
 * Features:
 * - Step up/down buttons
 * - Current scale display
 * - Standard 1-2-5 sequence values
 */

// Standard oscilloscope timebase values (seconds/div) in 1-2-5 sequence
// Rigol DHO800/900 supports 2ns to 1000s
const TIMEBASE_SCALES = [
  2e-9,    // 2 ns
  5e-9,    // 5 ns
  10e-9,   // 10 ns
  20e-9,   // 20 ns
  50e-9,   // 50 ns
  100e-9,  // 100 ns
  200e-9,  // 200 ns
  500e-9,  // 500 ns
  1e-6,    // 1 us
  2e-6,    // 2 us
  5e-6,    // 5 us
  10e-6,   // 10 us
  20e-6,   // 20 us
  50e-6,   // 50 us
  100e-6,  // 100 us
  200e-6,  // 200 us
  500e-6,  // 500 us
  1e-3,    // 1 ms
  2e-3,    // 2 ms
  5e-3,    // 5 ms
  10e-3,   // 10 ms
  20e-3,   // 20 ms
  50e-3,   // 50 ms
  100e-3,  // 100 ms
  200e-3,  // 200 ms
  500e-3,  // 500 ms
  1,       // 1 s
  2,       // 2 s
  5,       // 5 s
  10,      // 10 s
];

function formatTimebase(t: number): string {
  if (t >= 1) return `${t} s/div`;
  if (t >= 1e-3) return `${(t * 1000).toFixed(0)} ms/div`;
  if (t >= 1e-6) return `${(t * 1e6).toFixed(0)} us/div`;
  return `${(t * 1e9).toFixed(0)} ns/div`;
}

function findClosestIndex(value: number): number {
  let closest = 0;
  let minDiff = Math.abs(Math.log10(TIMEBASE_SCALES[0]) - Math.log10(value));
  for (let i = 1; i < TIMEBASE_SCALES.length; i++) {
    const diff = Math.abs(Math.log10(TIMEBASE_SCALES[i]) - Math.log10(value));
    if (diff < minDiff) {
      minDiff = diff;
      closest = i;
    }
  }
  return closest;
}

export interface TimebaseControlsProps {
  currentScale: number;
  onScaleChange: (scale: number) => void;
  disabled?: boolean;
}

export function TimebaseControls({
  currentScale,
  onScaleChange,
  disabled = false,
}: TimebaseControlsProps) {
  const currentIndex = findClosestIndex(currentScale);
  const canZoomIn = currentIndex > 0;
  const canZoomOut = currentIndex < TIMEBASE_SCALES.length - 1;

  const handleZoomIn = () => {
    if (canZoomIn) {
      onScaleChange(TIMEBASE_SCALES[currentIndex - 1]);
    }
  };

  const handleZoomOut = () => {
    if (canZoomOut) {
      onScaleChange(TIMEBASE_SCALES[currentIndex + 1]);
    }
  };

  return (
    <div className="inline-flex items-center gap-1 bg-[var(--color-bg-panel)] bg-opacity-80 rounded px-1">
      <button
        className="w-5 h-5 text-xs font-medium rounded bg-[var(--color-border-light)] text-[var(--color-text-primary)] hover:bg-[var(--color-border-dark)] disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={handleZoomIn}
        disabled={disabled || !canZoomIn}
        title="Zoom in (faster timebase)"
      >
        -
      </button>
      <span className="min-w-16 text-center text-xs font-mono text-[var(--color-text-primary)]">
        {formatTimebase(currentScale)}
      </span>
      <button
        className="w-5 h-5 text-xs font-medium rounded bg-[var(--color-border-light)] text-[var(--color-text-primary)] hover:bg-[var(--color-border-dark)] disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={handleZoomOut}
        disabled={disabled || !canZoomOut}
        title="Zoom out (slower timebase)"
      >
        +
      </button>
    </div>
  );
}
