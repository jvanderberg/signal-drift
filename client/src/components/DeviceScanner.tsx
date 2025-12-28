import { useState, useEffect } from 'react';
import { api } from '../api';
import type { Device } from '../types';

interface DeviceScannerProps {
  onDeviceSelect: (device: Device) => void;
}

export function DeviceScanner({ onDeviceSelect }: DeviceScannerProps) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = async () => {
    setScanning(true);
    setError(null);
    try {
      const result = await api.scanDevices();
      setDevices(result.devices);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  // Initial scan on mount
  useEffect(() => {
    const loadDevices = async () => {
      try {
        const result = await api.getDevices();
        setDevices(result.devices);
        if (result.devices.length === 0) {
          scan();
        }
      } catch {
        scan();
      }
    };
    loadDevices();
  }, []);

  const getDeviceIcon = (type: string) => {
    return type === 'power-supply' ? '⚡' : '📊';
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2 className="panel-title">Devices</h2>
        <button className="btn btn-secondary" onClick={scan} disabled={scanning}>
          {scanning ? 'Scanning...' : 'Rescan'}
        </button>
      </div>

      {error && (
        <div style={{ color: 'var(--color-danger)', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {devices.length === 0 && !scanning && (
        <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>
          No devices found. Connect a device and click Rescan.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {devices.map(device => (
          <button
            key={device.id}
            className="btn btn-secondary"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: 16,
              textAlign: 'left',
            }}
            onClick={() => onDeviceSelect(device)}
          >
            <span style={{ fontSize: 24 }}>{getDeviceIcon(device.info.type)}</span>
            <div>
              <div style={{ fontWeight: 600 }}>
                {device.info.manufacturer} {device.info.model}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {device.info.type === 'power-supply' ? 'Power Supply' : 'Electronic Load'}
                {device.info.serial && ` • ${device.info.serial}`}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
