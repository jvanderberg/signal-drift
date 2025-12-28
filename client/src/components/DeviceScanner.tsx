import { useDeviceList } from '../hooks/useDeviceList';
import type { Device } from '../types';

interface DeviceScannerProps {
  onDeviceSelect: (device: Device) => void;
}

export function DeviceScanner({ onDeviceSelect }: DeviceScannerProps) {
  const { devices, isLoading, error, scan } = useDeviceList();

  const getDeviceIcon = (type: string) => {
    return type === 'power-supply' ? '⚡' : '📊';
  };

  // Convert DeviceSummary to Device for compatibility
  const handleDeviceSelect = (summary: typeof devices[0]) => {
    const device: Device = {
      id: summary.id,
      info: summary.info,
      capabilities: summary.capabilities,
      connected: summary.connectionStatus === 'connected',
    };
    onDeviceSelect(device);
  };

  return (
    <div className="bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] rounded-md p-3 mb-2">
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
          Devices
        </h2>
        <button
          className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--color-border-light)] text-[var(--color-text-primary)] hover:opacity-90 disabled:opacity-50"
          onClick={scan}
          disabled={isLoading}
        >
          {isLoading ? 'Scanning...' : 'Rescan'}
        </button>
      </div>

      {error && (
        <div className="text-xs text-[var(--color-danger)] mb-2">
          {error}
        </div>
      )}

      {devices.length === 0 && !isLoading && (
        <div className="text-xs text-[var(--color-text-muted)] text-center py-4">
          No devices found. Connect a device and click Rescan.
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {devices.map(device => (
          <button
            key={device.id}
            className="flex items-center gap-2.5 p-2.5 text-left rounded bg-[var(--color-border-light)] hover:opacity-90"
            onClick={() => handleDeviceSelect(device)}
          >
            <span className="text-lg">{getDeviceIcon(device.info.type)}</span>
            <div>
              <div className="font-semibold text-[13px]">
                {device.info.manufacturer} {device.info.model}
              </div>
              <div className="text-[11px] text-[var(--color-text-muted)]">
                {device.info.type === 'power-supply' ? 'PSU' : 'Load'}
                {device.info.serial && ` · ${device.info.serial}`}
                <span
                  className="ml-1.5"
                  style={{
                    color: device.connectionStatus === 'connected'
                      ? 'var(--color-success)'
                      : 'var(--color-text-muted)'
                  }}
                >
                  · {device.connectionStatus}
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
