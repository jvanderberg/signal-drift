/**
 * TriggerSlider - Vertical slider for adjusting oscilloscope trigger level
 *
 * Features:
 * - Vertical slider for trigger level adjustment
 * - Current level value display with unit formatting
 * - Edge direction indicator (rising/falling/either)
 * - Settings cog button to open trigger settings
 */

export interface TriggerSliderProps {
  triggerLevel?: number;
  minVoltage?: number;
  maxVoltage?: number;
  triggerEdge?: 'rising' | 'falling' | 'either';
  disabled?: boolean;
  onTriggerLevelChange?: (level: number) => void;
  onSettingsClick?: () => void;
}

// Format voltage with appropriate unit
function formatVoltage(voltage: number): string {
  const abs = Math.abs(voltage);
  if (abs >= 1) {
    return `${voltage.toFixed(2)} V`;
  }
  if (abs >= 0.001) {
    return `${(voltage * 1000).toFixed(0)} mV`;
  }
  return `${(voltage * 1000000).toFixed(0)} uV`;
}

// Get edge indicator symbol
function getEdgeIndicator(edge: 'rising' | 'falling' | 'either'): string {
  switch (edge) {
    case 'rising':
      return '↑';
    case 'falling':
      return '↓';
    case 'either':
      return '↕';
  }
}

export function TriggerSlider({
  triggerLevel = 0,
  minVoltage = -10,
  maxVoltage = 10,
  triggerEdge = 'rising',
  disabled = false,
  onTriggerLevelChange,
  onSettingsClick,
}: TriggerSliderProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    onTriggerLevelChange?.(value);
  };

  // Calculate step based on range for fine control
  const range = maxVoltage - minVoltage;
  const step = Math.min(0.1, range / 200);

  return (
    <div
      data-testid="trigger-slider"
      className={`trigger-slider vertical rotate flex flex-col items-center gap-1 p-1 ${
        disabled ? 'disabled opacity-50' : ''
      }`}
    >
      {/* Edge indicator */}
      <div
        data-testid="trigger-edge-indicator"
        className="trigger-edge-indicator text-yellow-500 text-sm font-bold"
        title={`Trigger edge: ${triggerEdge}`}
      >
        {getEdgeIndicator(triggerEdge)}
      </div>

      {/* Vertical slider container */}
      <div className="slider-container relative h-32 flex flex-col items-center">
        <input
          type="range"
          data-testid="trigger-level-input"
          className="trigger-level-slider h-24 w-4 appearance-none bg-gray-700 rounded cursor-pointer"
          style={{
            writingMode: 'vertical-lr',
            direction: 'rtl',
          }}
          min={minVoltage}
          max={maxVoltage}
          step={step}
          value={triggerLevel}
          onChange={handleChange}
          disabled={disabled}
        />
      </div>

      {/* Current value display */}
      <div
        data-testid="trigger-level-value"
        className="trigger-level-value text-xs text-gray-300 font-mono whitespace-nowrap"
      >
        {formatVoltage(triggerLevel)}
      </div>

      {/* Settings cog button */}
      <button
        data-testid="trigger-settings-button"
        className="trigger-settings-button p-1 text-gray-400 hover:text-white transition-colors"
        onClick={onSettingsClick}
        title="Trigger settings"
        disabled={disabled}
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      </button>
    </div>
  );
}
