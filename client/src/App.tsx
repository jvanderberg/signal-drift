import { useEffect, useMemo, useCallback } from 'react';
import type { DeviceSummary } from './types';
import { useUIStore, useLayoutStore, initializeLayoutStore, selectTheme, selectToasts, selectLayouts } from './stores';
import { useDeviceList } from './hooks/useDeviceList';
import { DevicePanel } from './components/DevicePanel';
import { OscilloscopePanel } from './components/OscilloscopePanel';
import { ToastContainer } from './components/ToastContainer';
import { DeviceSidebar } from './components/DeviceSidebar';
import { SequencePanel } from './components/sequencer';
import { TriggerScriptPanel } from './components/triggers';
import { DashboardGrid, getDevicePanelKey, getSequencerPanelKey, getTriggerScriptsPanelKey } from './components/DashboardGrid';
import { useState } from 'react';

function App() {
  const { devices, isLoading, scan } = useDeviceList();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Use individual selectors for state values (only re-render when they change)
  const theme = useUIStore(selectTheme);
  const toasts = useUIStore(selectToasts);
  const layouts = useLayoutStore(selectLayouts);

  // Actions are stable references
  const { setTheme, success, error } = useUIStore.getState();
  const { addPanel, removePanel, hasPanel } = useLayoutStore.getState();

  // Initialize layout store on mount
  useEffect(() => {
    initializeLayoutStore();
  }, []);

  // Get open device IDs from layout
  const openDeviceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of layouts.lg) {
      if (item.i.startsWith('device-')) {
        ids.add(item.i.replace('device-', ''));
      }
    }
    return ids;
  }, [layouts.lg]);

  // Check if sequencer/trigger scripts are shown
  const showSequencer = useMemo(() => hasPanel(getSequencerPanelKey()), [layouts.lg]);
  const showTriggerScripts = useMemo(() => hasPanel(getTriggerScriptsPanelKey()), [layouts.lg]);

  // Get open devices from the device list
  const openDevices = useMemo(() =>
    devices.filter(d => openDeviceIds.has(d.id)),
    [devices, openDeviceIds]
  );

  // Handle sidebar device click - toggle panel open/close
  const handleDeviceClick = useCallback((device: DeviceSummary) => {
    const key = getDevicePanelKey(device.id);
    if (hasPanel(key)) {
      removePanel(key);
    } else {
      addPanel(key);
    }
    setSidebarOpen(false);
  }, [addPanel, removePanel, hasPanel]);

  const handleDeviceClose = useCallback((deviceId: string) => {
    removePanel(getDevicePanelKey(deviceId));
  }, [removePanel]);

  const handleSequencerClick = useCallback(() => {
    const key = getSequencerPanelKey();
    if (hasPanel(key)) {
      removePanel(key);
    } else {
      addPanel(key);
    }
    setSidebarOpen(false);
  }, [addPanel, removePanel, hasPanel]);

  const handleTriggerScriptsClick = useCallback(() => {
    const key = getTriggerScriptsPanelKey();
    if (hasPanel(key)) {
      removePanel(key);
    } else {
      addPanel(key);
    }
    setSidebarOpen(false);
  }, [addPanel, removePanel, hasPanel]);

  const handleSequencerClose = useCallback(() => {
    removePanel(getSequencerPanelKey());
  }, [removePanel]);

  const handleTriggerScriptsClose = useCallback(() => {
    removePanel(getTriggerScriptsPanelKey());
  }, [removePanel]);

  // Check if any panels are open
  const hasPanels = layouts.lg.length > 0;

  return (
    <div className="h-screen flex flex-col">
      {/* Sidebar (hamburger menu) */}
      <DeviceSidebar
        devices={devices}
        openDeviceIds={openDeviceIds}
        showSequencer={showSequencer}
        showTriggerScripts={showTriggerScripts}
        onDeviceClick={handleDeviceClick}
        onSequencerClick={handleSequencerClick}
        onTriggerScriptsClick={handleTriggerScriptsClick}
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

      {/* Scrollable panel area with dashboard grid */}
      <div className="flex-1 overflow-auto p-4">
        {hasPanels ? (
          <DashboardGrid>
            {/* Device Panels */}
            {openDevices.map(device => (
              device.info.type === 'oscilloscope' ? (
                <OscilloscopePanel
                  key={getDevicePanelKey(device.id)}
                  device={device}
                  onClose={() => handleDeviceClose(device.id)}
                  onError={error}
                  onSuccess={success}
                />
              ) : (
                <DevicePanel
                  key={getDevicePanelKey(device.id)}
                  device={device}
                  onClose={() => handleDeviceClose(device.id)}
                  onError={error}
                  onSuccess={success}
                />
              )
            ))}

            {/* Sequence Panel */}
            {showSequencer && (
              <SequencePanel
                key={getSequencerPanelKey()}
                onClose={handleSequencerClose}
              />
            )}

            {/* Trigger Script Panel */}
            {showTriggerScripts && (
              <TriggerScriptPanel
                key={getTriggerScriptsPanelKey()}
                onClose={handleTriggerScriptsClose}
              />
            )}
          </DashboardGrid>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[var(--color-text-secondary)] text-sm py-20">
            Click the menu to open devices or widgets
          </div>
        )}
      </div>

      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} />
    </div>
  );
}

export default App;
