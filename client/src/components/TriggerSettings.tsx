/**
 * TriggerSettings - Popover for configuring oscilloscope trigger settings
 *
 * Features:
 * - Source selector (CHAN1, CHAN2, EXT)
 * - Edge selector (rising, falling)
 * - Sweep mode selector (auto, normal, single)
 * - Compact popover design
 */

export interface TriggerSettingsProps {
  sources?: string[];
  currentSource?: string;
  currentEdge?: 'rising' | 'falling' | 'either';
  currentSweep?: 'auto' | 'normal' | 'single';
  disabled?: boolean;
  onSourceChange?: (source: string) => void;
  onEdgeChange?: (edge: 'rising' | 'falling' | 'either') => void;
  onSweepChange?: (sweep: 'auto' | 'normal' | 'single') => void;
  onClose?: () => void;
}

export function TriggerSettings({
  sources = ['CHAN1', 'CHAN2'],
  currentSource = 'CHAN1',
  currentEdge = 'rising',
  currentSweep = 'auto',
  disabled = false,
  onSourceChange,
  onEdgeChange,
  onSweepChange,
  onClose,
}: TriggerSettingsProps) {
  const handleSourceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onSourceChange?.(e.target.value);
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
      className="trigger-settings popover compact bg-gray-800 border border-gray-600 rounded-lg shadow-lg p-3 min-w-48"
    >
      {/* Header with close button */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-200">Trigger Settings</span>
        <button
          data-testid="trigger-settings-close"
          className="text-gray-400 hover:text-white p-1"
          onClick={onClose}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Source selector */}
      <div className="setting-row mb-2">
        <label className="block text-xs text-gray-400 mb-1">Source</label>
        <select
          data-testid="trigger-source-select"
          className="w-full bg-gray-700 text-gray-200 text-sm rounded px-2 py-1 border border-gray-600"
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

      {/* Edge selector */}
      <div className="setting-row mb-2">
        <label className="block text-xs text-gray-400 mb-1">Edge</label>
        <select
          data-testid="trigger-edge-select"
          className="w-full bg-gray-700 text-gray-200 text-sm rounded px-2 py-1 border border-gray-600"
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
        <label className="block text-xs text-gray-400 mb-1">Sweep Mode</label>
        <select
          data-testid="trigger-sweep-select"
          className="w-full bg-gray-700 text-gray-200 text-sm rounded px-2 py-1 border border-gray-600"
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
