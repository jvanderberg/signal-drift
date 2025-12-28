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
    <div className="readings">
      <div className="readings-grid">
        {capabilities.measurements.map(measurement => {
          const value = status.measurements[measurement.name];
          return (
            <div key={measurement.name}>
              <div className="reading-label">{measurement.name}</div>
              <div>
                <span className="reading-value">
                  {formatValue(value, measurement.decimals)}
                </span>
                <span className="reading-unit">{measurement.unit}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
