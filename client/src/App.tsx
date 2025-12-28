import { useState } from 'react';
import type { Device } from './types';
import { useTheme } from './hooks/useTheme';
import { useToast } from './hooks/useToast';
import { DeviceScanner } from './components/DeviceScanner';
import { DevicePanel } from './components/DevicePanel';
import { ToastContainer } from './components/ToastContainer';

function App() {
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const { theme, setTheme } = useTheme();
  const { toasts, success, error } = useToast();

  return (
    <div className="container">
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 600 }}>Lab Controller</h1>
        <select
          value={theme}
          onChange={e => setTheme(e.target.value as 'light' | 'dark' | 'system')}
          style={{ fontSize: 12 }}
        >
          <option value="system">System Theme</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>

      {/* Device Scanner or Device Panel */}
      {selectedDevice ? (
        <DevicePanel
          device={selectedDevice}
          onClose={() => setSelectedDevice(null)}
          onError={error}
          onSuccess={success}
        />
      ) : (
        <DeviceScanner onDeviceSelect={setSelectedDevice} />
      )}

      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} />
    </div>
  );
}

export default App;
