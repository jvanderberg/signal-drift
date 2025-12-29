import { useState, useEffect } from 'react';

/**
 * TriggerSettings - Popover for configuring oscilloscope trigger settings
 *
 * Features:
 * - Trigger level input
 * - Source selector (CHAN1, CHAN2, EXT)
 * - Edge selector (rising, falling)
 * - Sweep mode selector (auto, normal, single)
 * - Compact popover design
 */

export interface TriggerSettingsProps {
  sources?: string[];
  currentSource?: string;
  currentLevel?: number;
  currentEdge?: 'rising' | 'falling' | 'either';
  currentSweep?: 'auto' | 'normal' | 'single';
  disabled?: boolean;
  onSourceChange?: (source: string) => void;
  onLevelChange?: (level: number) => void;
  onEdgeChange?: (edge: 'rising' | 'falling' | 'either') => void;
  onSweepChange?: (sweep: 'auto' | 'normal' | 'single') => void;
  onClose?: () => void;
}

export function TriggerSettings({
  sources = ['CHAN1', 'CHAN2'],
  currentSource = 'CHAN1',
  currentLevel = 0,
  currentEdge = 'rising',
  currentSweep = 'auto',
  disabled = false,
  onSourceChange,
  onLevelChange,
  onEdgeChange,
  onSweepChange,
  onClose,
}: TriggerSettingsProps) {
  const [levelInput, setLevelInput] = useState(currentLevel.toFixed(3));

  // Sync input with prop when it changes (e.g., from dragging)
  useEffect(() => {
    setLevelInput(currentLevel.toFixed(3));
  }, [currentLevel]);

  const handleSourceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onSourceChange?.(e.target.value);
  };

  const handleLevelInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLevelInput(e.target.value);
  };

  const handleLevelSubmit = () => {
    const value = parseFloat(levelInput);
    if (!isNaN(value)) {
      onLevelChange?.(value);
    }
  };

  const handleLevelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleLevelSubmit();
    }
  };

  const handleEdgeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onEdgeChange?.(e.target.value as 'rising' | 'falling' | 'either');
  };

  const handleSweepChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onSweepChange?.(e.target.value as 'auto' | 'normal' | 'single');
  };

  return (
    <div
      data-testid="trigger-settings"
      className="trigger-settings popover compact bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] rounded-lg shadow-lg p-3 min-w-48"
    >
      {/* Header with close button */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-[var(--color-text-primary)]">Trigger Settings</span>
        <button
          data-testid="trigger-settings-close"
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] p-1"
          onClick={onClose}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Source selector */}
      <div className="setting-row mb-2">
        <label className="block text-xs text-[var(--color-text-muted)] mb-1">Source</label>
        <select
          data-testid="trigger-source-select"
          className="w-full bg-[var(--color-border-dark)] text-[var(--color-text-primary)] text-sm rounded px-2 py-1 border border-[var(--color-border-dark)]"
          value={currentSource}
          onChange={handleSourceChange}
          disabled={disabled}
        >
          {sources.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
      </div>

      {/* Level input */}
      <div className="setting-row mb-2">
        <label className="block text-xs text-[var(--color-text-muted)] mb-1">Level (V)</label>
        <div className="flex gap-1">
          <input
            data-testid="trigger-level-input"
            type="text"
            className="flex-1 bg-[var(--color-border-dark)] text-[var(--color-text-primary)] text-sm rounded px-2 py-1 border border-[var(--color-border-dark)] font-mono"
            value={levelInput}
            onChange={handleLevelInputChange}
            onBlur={handleLevelSubmit}
            onKeyDown={handleLevelKeyDown}
            disabled={disabled}
          />
          <button
            className="px-2 py-1 text-xs bg-[var(--color-border-light)] hover:opacity-80 text-[var(--color-text-primary)] rounded"
            onClick={handleLevelSubmit}
            disabled={disabled}
          >
            Set
          </button>
        </div>
      </div>

      {/* Edge selector */}
      <div className="setting-row mb-2">
        <label className="block text-xs text-[var(--color-text-muted)] mb-1">Edge</label>
        <select
          data-testid="trigger-edge-select"
          className="w-full bg-[var(--color-border-dark)] text-[var(--color-text-primary)] text-sm rounded px-2 py-1 border border-[var(--color-border-dark)]"
          value={currentEdge}
          onChange={handleEdgeChange}
          disabled={disabled}
        >
          <option value="rising">Rising ↑</option>
          <option value="falling">Falling ↓</option>
          <option value="either">Either ↕</option>
        </select>
      </div>

      {/* Sweep mode selector */}
      <div className="setting-row">
        <label className="block text-xs text-[var(--color-text-muted)] mb-1">Sweep Mode</label>
        <select
          data-testid="trigger-sweep-select"
          className="w-full bg-[var(--color-border-dark)] text-[var(--color-text-primary)] text-sm rounded px-2 py-1 border border-[var(--color-border-dark)]"
          value={currentSweep}
          onChange={handleSweepChange}
          disabled={disabled}
        >
          <option value="auto">Auto</option>
          <option value="normal">Normal</option>
          <option value="single">Single</option>
        </select>
      </div>
    </div>
  );
}
