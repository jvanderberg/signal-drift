import { useState, useMemo } from 'react';
import type { DeviceSummary } from './types';
import { useTheme } from './hooks/useTheme';
import { useToast } from './hooks/useToast';
import { useDeviceList } from './hooks/useDeviceList';
import { DevicePanel } from './components/DevicePanel';
import { OscilloscopePanel } from './components/OscilloscopePanel';
import { ToastContainer } from './components/ToastContainer';
import { DeviceSidebar } from './components/DeviceSidebar';
import { SequencePanel } from './components/sequencer';

function App() {
  const { devices, isLoading, scan } = useDeviceList();
  const [openDeviceIds, setOpenDeviceIds] = useState<Set<string>>(new Set());
  const [showSequencer, setShowSequencer] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const { toasts, success, error } = useToast();

  // Get open devices from the device list
  const openDevices = useMemo(() =>
    devices.filter(d => openDeviceIds.has(d.id)),
    [devices, openDeviceIds]
  );

  // Handle sidebar device click - toggle panel open/close
  const handleDeviceClick = (device: DeviceSummary) => {
    setOpenDeviceIds(prev => {
      const next = new Set(prev);
      if (next.has(device.id)) {
        next.delete(device.id);
      } else {
        next.add(device.id);
      }
      return next;
    });
    setSidebarOpen(false);
  };

  const handleDeviceClose = (deviceId: string) => {
    setOpenDeviceIds(prev => {
      const next = new Set(prev);
      next.delete(deviceId);
      return next;
    });
  };

  const handleSequencerClick = () => {
    setShowSequencer(prev => !prev);
    setSidebarOpen(false);
  };

  return (
    <div className="h-screen flex flex-col">
      {/* Sidebar (hamburger menu) */}
      <DeviceSidebar
        devices={devices}
        openDeviceIds={openDeviceIds}
        showSequencer={showSequencer}
        onDeviceClick={handleDeviceClick}
        onSequencerClick={handleSequencerClick}
        onScan={scan}
        isScanning={isLoading}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(prev => !prev)}
      />

      {/* Header */}
      <div className="flex justify-between items-center px-4 py-2 border-b border-[var(--color-border-dark)] flex-shrink-0">
        <h1 className="text-lg font-semibold ml-12">Lab Controller</h1>
        <select
          className="px-2 py-1 text-xs rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
          value={theme}
          onChange={e => setTheme(e.target.value as 'light' | 'dark' | 'system')}
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>

      {/* Scrollable panel area */}
      <div className="flex-1 overflow-auto p-4">
        <div className="flex flex-wrap gap-4 items-start">
          {/* Device Panels */}
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

          {/* Sequence Panel */}
          {showSequencer && (
            <div className="flex-1 basis-[calc(50%-0.5rem)] min-w-[420px]">
              <SequencePanel />
            </div>
          )}

          {/* Empty state when nothing is open */}
          {openDevices.length === 0 && !showSequencer && (
            <div className="flex-1 flex items-center justify-center text-[var(--color-text-secondary)] text-sm py-20">
              Click the menu to open devices or widgets
            </div>
          )}
        </div>
      </div>

      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} />
    </div>
  );
}

export default App;
