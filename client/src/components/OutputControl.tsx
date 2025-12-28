interface OutputControlProps {
  enabled: boolean;
  mode: string;
  onToggle: (enabled: boolean) => void;
  disabled?: boolean;
}

export function OutputControl({ enabled, mode, onToggle, disabled }: OutputControlProps) {
  return (
    <div className="controls-row" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className={`status-dot ${enabled ? 'on' : 'off'}`} />
        <span style={{ fontWeight: 600, fontSize: 18 }}>
          {enabled ? 'ON' : 'OFF'}
        </span>
      </div>

      <span className={`mode-badge ${mode.toLowerCase()}`}>{mode}</span>

      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
        <button
          className="btn btn-success"
          onClick={() => onToggle(true)}
          disabled={disabled || enabled}
          style={{ opacity: enabled ? 0.5 : 1 }}
        >
          ON
        </button>
        <button
          className="btn btn-danger"
          onClick={() => onToggle(false)}
          disabled={disabled || !enabled}
          style={{ opacity: !enabled ? 0.5 : 1 }}
        >
          OFF
        </button>
      </div>
    </div>
  );
}
