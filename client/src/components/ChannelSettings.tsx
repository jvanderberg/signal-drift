/**
 * ChannelSettings - Popover for configuring oscilloscope channel settings
 *
 * Features:
 * - Scale selector (1mV - 10V/div)
 * - Offset input
 * - Coupling selector (AC/DC/GND)
 * - Probe ratio selector (1x/10x/100x)
 * - BW limit toggle
 * - Channel-specific color styling
 */

// Channel colors using CSS variables for theme support
const CHANNEL_CSS_VARS: Record<string, string> = {
  CHAN1: 'var(--color-waveform-chan1)',
  CHAN2: 'var(--color-waveform-chan2)',
  CHAN3: 'var(--color-waveform-chan3)',
  CHAN4: 'var(--color-waveform-chan4)',
};

// Standard oscilloscope scale values (V/div)
const SCALE_OPTIONS = [
  { value: 0.001, label: '1 mV/div' },
  { value: 0.002, label: '2 mV/div' },
  { value: 0.005, label: '5 mV/div' },
  { value: 0.01, label: '10 mV/div' },
  { value: 0.02, label: '20 mV/div' },
  { value: 0.05, label: '50 mV/div' },
  { value: 0.1, label: '100 mV/div' },
  { value: 0.2, label: '200 mV/div' },
  { value: 0.5, label: '500 mV/div' },
  { value: 1, label: '1 V/div' },
  { value: 2, label: '2 V/div' },
  { value: 5, label: '5 V/div' },
  { value: 10, label: '10 V/div' },
];

// Standard probe ratios
const PROBE_OPTIONS = [
  { value: 0.01, label: '0.01x' },
  { value: 0.1, label: '0.1x' },
  { value: 1, label: '1x' },
  { value: 10, label: '10x' },
  { value: 100, label: '100x' },
  { value: 1000, label: '1000x' },
];

export interface ChannelSettingsProps {
  channel: string;
  currentScale?: number;
  currentOffset?: number;
  currentCoupling?: 'AC' | 'DC' | 'GND';
  currentProbeRatio?: number;
  currentBwLimit?: boolean;
  disabled?: boolean;
  onScaleChange?: (scale: number) => void;
  onOffsetChange?: (offset: number) => void;
  onCouplingChange?: (coupling: 'AC' | 'DC' | 'GND') => void;
  onProbeRatioChange?: (ratio: number) => void;
  onBwLimitChange?: (enabled: boolean) => void;
  onClose?: () => void;
}

export function ChannelSettings({
  channel,
  currentScale = 1,
  currentOffset = 0,
  currentCoupling = 'DC',
  currentProbeRatio = 1,
  currentBwLimit = false,
  disabled = false,
  onScaleChange,
  onOffsetChange,
  onCouplingChange,
  onProbeRatioChange,
  onBwLimitChange,
  onClose,
}: ChannelSettingsProps) {
  const color = CHANNEL_CSS_VARS[channel] ?? 'var(--color-text-primary)';
  const channelClass = channel.toLowerCase().replace(/\s+/g, '');

  const handleScaleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onScaleChange?.(parseFloat(e.target.value));
  };

  const handleOffsetChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    if (!isNaN(value)) {
      onOffsetChange?.(value);
    }
  };

  const handleCouplingChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onCouplingChange?.(e.target.value as 'AC' | 'DC' | 'GND');
  };

  const handleProbeRatioChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onProbeRatioChange?.(parseFloat(e.target.value));
  };

  const handleBwLimitChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onBwLimitChange?.(e.target.checked);
  };

  return (
    <div
      data-testid="channel-settings"
      className={`channel-settings ${channelClass} bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] rounded-lg shadow-lg p-3 min-w-52`}
      style={{ borderTopColor: color, borderTopWidth: '3px' }}
    >
      {/* Header with channel name and close button */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium" style={{ color }}>
          {channel.replace('CHAN', 'CH ')} Settings
        </span>
        <button
          data-testid="channel-settings-close"
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] p-1"
          onClick={onClose}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Scale selector */}
      <div className="setting-row mb-2">
        <label className="block text-xs text-[var(--color-text-muted)] mb-1">Scale</label>
        <select
          data-testid="channel-scale-select"
          className="w-full bg-[var(--color-border-dark)] text-[var(--color-text-primary)] text-sm rounded px-2 py-1 border border-[var(--color-border-dark)]"
          value={currentScale}
          onChange={handleScaleChange}
          disabled={disabled}
        >
          {SCALE_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* Offset input */}
      <div className="setting-row mb-2">
        <label className="block text-xs text-[var(--color-text-muted)] mb-1">Offset (V)</label>
        <input
          type="number"
          data-testid="channel-offset-input"
          className="w-full bg-[var(--color-border-dark)] text-[var(--color-text-primary)] text-sm rounded px-2 py-1 border border-[var(--color-border-dark)]"
          value={currentOffset}
          onChange={handleOffsetChange}
          step={0.1}
          disabled={disabled}
        />
      </div>

      {/* Coupling selector */}
      <div className="setting-row mb-2">
        <label className="block text-xs text-[var(--color-text-muted)] mb-1">Coupling</label>
        <select
          data-testid="channel-coupling-select"
          className="w-full bg-[var(--color-border-dark)] text-[var(--color-text-primary)] text-sm rounded px-2 py-1 border border-[var(--color-border-dark)]"
          value={currentCoupling}
          onChange={handleCouplingChange}
          disabled={disabled}
        >
          <option value="DC">DC</option>
          <option value="AC">AC</option>
          <option value="GND">GND</option>
        </select>
      </div>

      {/* Probe ratio selector */}
      <div className="setting-row mb-2">
        <label className="block text-xs text-[var(--color-text-muted)] mb-1">Probe Ratio</label>
        <select
          data-testid="channel-probe-select"
          className="w-full bg-[var(--color-border-dark)] text-[var(--color-text-primary)] text-sm rounded px-2 py-1 border border-[var(--color-border-dark)]"
          value={currentProbeRatio}
          onChange={handleProbeRatioChange}
          disabled={disabled}
        >
          {PROBE_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* BW Limit toggle */}
      <div className="setting-row flex items-center justify-between">
        <label className="text-xs text-[var(--color-text-muted)]">BW Limit</label>
        <input
          type="checkbox"
          data-testid="channel-bwlimit-toggle"
          className="h-4 w-4 rounded bg-[var(--color-border-dark)] border-[var(--color-border-dark)] accent-[var(--color-accent-load)]"
          checked={currentBwLimit}
          onChange={handleBwLimitChange}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
