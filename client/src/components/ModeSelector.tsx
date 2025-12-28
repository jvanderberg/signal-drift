interface ModeSelectorProps {
  modes: string[];
  currentMode: string;
  onChange: (mode: string) => void;
  disabled?: boolean;
}

export function ModeSelector({ modes, currentMode, onChange, disabled }: ModeSelectorProps) {
  return (
    <div className="controls-row">
      <label style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Mode:</label>
      <select
        value={currentMode}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        style={{ minWidth: 80 }}
      >
        {modes.map(mode => (
          <option key={mode} value={mode}>
            {mode}
          </option>
        ))}
      </select>
    </div>
  );
}
