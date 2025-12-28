interface ModeSelectorProps {
  modes: string[];
  currentMode: string;
  onChange: (mode: string) => void;
  disabled?: boolean;
}

const MODE_NAMES: Record<string, string> = {
  CC: 'Constant Current',
  CV: 'Constant Voltage',
  CP: 'Constant Power',
  CR: 'Constant Resistance',
};

export function ModeSelector({ modes, currentMode, onChange, disabled }: ModeSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-[var(--color-text-secondary)]">Mode:</label>
      <select
        className="px-2 py-1 text-xs rounded"
        value={currentMode}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
      >
        {modes.map(mode => (
          <option key={mode} value={mode}>
            {MODE_NAMES[mode] ?? mode}
          </option>
        ))}
      </select>
    </div>
  );
}
