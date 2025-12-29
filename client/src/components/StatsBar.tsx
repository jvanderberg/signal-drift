/**
 * StatsBar - Real-time oscilloscope measurements display
 *
 * Features:
 * - Compact display of multiple measurements
 * - Channel color-coding
 * - Smart unit formatting (mV, kHz, ns, etc.)
 * - Handles null/invalid values gracefully
 */

import type { OscilloscopeMeasurement } from '../../../shared/types';

// Channel colors using CSS variables for theme support
const CHANNEL_CSS_VARS: Record<string, string> = {
  CHAN1: 'var(--color-waveform-chan1)',
  CHAN2: 'var(--color-waveform-chan2)',
  CHAN3: 'var(--color-waveform-chan3)',
  CHAN4: 'var(--color-waveform-chan4)',
};

const DEFAULT_COLOR = 'var(--color-text-primary)';

export interface StatsBarProps {
  measurements?: OscilloscopeMeasurement[];
  compact?: boolean;
}

// Format value with appropriate SI prefix
function formatWithUnit(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '--';
  }

  const abs = Math.abs(value);

  // Handle frequency (Hz)
  if (unit === 'Hz') {
    if (abs >= 1e9) return `${(value / 1e9).toFixed(2)} GHz`;
    if (abs >= 1e6) return `${(value / 1e6).toFixed(2)} MHz`;
    if (abs >= 1e3) return `${(value / 1e3).toFixed(2)} kHz`;
    return `${value.toFixed(2)} Hz`;
  }

  // Handle time (s)
  if (unit === 's') {
    if (abs >= 1) return `${value.toFixed(3)} s`;
    if (abs >= 1e-3) return `${(value * 1e3).toFixed(2)} ms`;
    if (abs >= 1e-6) return `${(value * 1e6).toFixed(2)} us`;
    if (abs >= 1e-9) return `${(value * 1e9).toFixed(0)} ns`;
    return `${(value * 1e12).toFixed(0)} ps`;
  }

  // Handle voltage (V)
  if (unit === 'V') {
    if (abs >= 1) return `${value.toFixed(3)} V`;
    if (abs >= 1e-3) return `${(value * 1e3).toFixed(2)} mV`;
    return `${(value * 1e6).toFixed(0)} uV`;
  }

  // Handle percentage
  if (unit === '%') {
    return `${value.toFixed(1)}%`;
  }

  // Default: just show value with unit
  return `${value.toFixed(3)} ${unit}`;
}

// Get channel class for color coding
function getChannelClass(channel: string): string {
  switch (channel) {
    case 'CHAN1': return 'channel-1';
    case 'CHAN2': return 'channel-2';
    case 'CHAN3': return 'channel-3';
    case 'CHAN4': return 'channel-4';
    default: return 'channel-default';
  }
}

export function StatsBar({ measurements = [], compact = false }: StatsBarProps) {
  const containerClass = `stats-bar flex flex-wrap gap-2 p-2 text-sm ${
    compact ? 'compact text-xs gap-1 p-1' : ''
  }`;

  if (measurements.length === 0) {
    return (
      <div data-testid="stats-bar" className={containerClass}>
        <span className="text-[var(--color-text-muted)] italic">No measurements</span>
      </div>
    );
  }

  return (
    <div data-testid="stats-bar" className={containerClass}>
      {measurements.map((m) => {
        const color = CHANNEL_CSS_VARS[m.channel] ?? DEFAULT_COLOR;
        const channelClass = getChannelClass(m.channel);
        const formattedValue = formatWithUnit(m.value, m.unit);
        const isInvalid = formattedValue === '--';

        return (
          <div
            key={`${m.channel}-${m.type}`}
            data-testid={`stat-${m.channel}-${m.type}`}
            className={`stat-item ${channelClass} flex items-center gap-2 px-3 py-1 rounded bg-[var(--color-bg-tertiary)] w-[185px]`}
            style={{ borderLeft: `3px solid ${color}` }}
          >
            <span className="stat-label text-[var(--color-text-muted)] font-medium w-12 shrink-0">{m.type}:</span>
            <span
              className={`stat-value font-mono flex-1 text-right ${isInvalid ? 'text-[var(--color-text-muted)]' : ''}`}
              style={{ color: isInvalid ? undefined : color }}
            >
              {formattedValue}
            </span>
          </div>
        );
      })}
    </div>
  );
}
