interface OutputControlProps {
  enabled: boolean;
  mode: string;
  onToggle: (enabled: boolean) => void;
  disabled?: boolean;
}

export function OutputControl({ enabled, mode, onToggle, disabled }: OutputControlProps) {
  return (
    <div className="flex items-center gap-3">
      <span className={`mode-badge ${mode.toLowerCase()}`}>{mode}</span>
      <button
        className={`relative w-11 h-6 rounded-full transition-colors ${
          enabled ? 'bg-[var(--color-success)]' : 'bg-[var(--color-border-dark)]'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        onClick={() => !disabled && onToggle(!enabled)}
        disabled={disabled}
        aria-label={enabled ? 'Turn off' : 'Turn on'}
      >
        <span
          className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-200 ${
            enabled ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
      <span className="text-xs font-medium w-6">
        {enabled ? 'ON' : 'OFF'}
      </span>
    </div>
  );
}
