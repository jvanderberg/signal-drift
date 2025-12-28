import type { DeviceStatus, DeviceCapabilities } from '../types';

interface StatusReadingsProps {
  status: DeviceStatus;
  capabilities: DeviceCapabilities;
}

export function StatusReadings({ status, capabilities }: StatusReadingsProps) {
  const formatValue = (value: number | undefined, decimals: number): string => {
    if (value === undefined || value === null) return '---';
    return value.toFixed(decimals);
  };

  return (
    <div className="bg-[var(--color-bg-readings)] rounded p-2">
      <div className="grid grid-cols-2 lg:grid-cols-1 gap-3">
        {capabilities.measurements.map(measurement => {
          const value = status.measurements[measurement.name];
          return (
            <div key={measurement.name} className="text-center">
              <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)] mb-0.5">
                {measurement.name}
              </div>
              <div>
                <span className="font-mono text-xl font-bold">
                  {formatValue(value, measurement.decimals)}
                </span>
                <span className="text-xs text-[var(--color-text-secondary)] ml-1">
                  {measurement.unit}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
