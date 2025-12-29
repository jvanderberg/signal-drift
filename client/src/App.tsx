import { useState } from 'react';
import type { Device } from './types';
import { useTheme } from './hooks/useTheme';
import { useToast } from './hooks/useToast';
import { DeviceScanner } from './components/DeviceScanner';
import { DevicePanel } from './components/DevicePanel';
import { OscilloscopePanel } from './components/OscilloscopePanel';
import { ToastContainer } from './components/ToastContainer';

function App() {
  const [openDevices, setOpenDevices] = useState<Device[]>([]);
  const [showScanner, setShowScanner] = useState(true);
  const { theme, setTheme } = useTheme();
  const { toasts, success, error } = useToast();

  const handleDeviceSelect = (device: Device) => {
    // Don't add if already open
    if (openDevices.some(d => d.id === device.id)) {
      return;
    }
    setOpenDevices(prev => [...prev, device]);
    setShowScanner(false);
  };

  const handleDeviceClose = (deviceId: string) => {
    setOpenDevices(prev => prev.filter(d => d.id !== deviceId));
  };

  const handleAddDevice = () => {
    setShowScanner(true);
  };

  return (
    <div className="px-4 py-3">
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-lg font-semibold">Lab Controller</h1>
        <div className="flex items-center gap-2">
          {!showScanner && (
            <button
              className="w-7 h-7 flex items-center justify-center text-lg font-light rounded bg-[var(--color-border-light)] text-[var(--color-text-secondary)] hover:opacity-90"
              onClick={handleAddDevice}
              aria-label="Add device"
            >
              +
            </button>
          )}
          <select
            className="px-2 py-1 text-xs rounded"
            value={theme}
            onChange={e => setTheme(e.target.value as 'light' | 'dark' | 'system')}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </div>

      {/* Device Scanner */}
      {showScanner && (
        <div className="mb-4">
          <DeviceScanner onDeviceSelect={handleDeviceSelect} />
          {openDevices.length > 0 && (
            <button
              className="mt-2 px-3 py-1.5 text-xs font-medium rounded bg-[var(--color-border-light)] text-[var(--color-text-primary)] hover:opacity-90"
              onClick={() => setShowScanner(false)}
            >
              Done
            </button>
          )}
        </div>
      )}

      {/* Device Panels */}
      {openDevices.length > 0 && (
        <div className="flex flex-wrap gap-4 items-start">
          {openDevices.map(device => (
            <div key={device.id} className="flex-1 basis-[calc(50%-0.5rem)] min-w-[420px]">
              {device.info.type === 'oscilloscope' ? (
                <OscilloscopePanel
                  device={device}
                  onClose={() => handleDeviceClose(device.id)}
                  onError={error}
                  onSuccess={success}
                />
              ) : (
                <DevicePanel
                  device={device}
                  onClose={() => handleDeviceClose(device.id)}
                  onError={error}
                  onSuccess={success}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} />
    </div>
  );
}

export default App;
