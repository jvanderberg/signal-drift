import { useEffect, useMemo, useCallback } from 'react';
import type { DeviceSummary } from './types';
import { useUIStore, useLayoutStore, initializeLayoutStore, selectTheme, selectToasts, selectLayouts } from './stores';
import { useDeviceList } from './hooks/useDeviceList';
import { DevicePanel } from './components/DevicePanel';
import { OscilloscopePanel } from './components/OscilloscopePanel';
import { ToastContainer } from './components/ToastContainer';
import { DeviceSidebar } from './components/DeviceSidebar';
import { SequencePanel } from './components/sequencer';
import { BatteryTestPanel } from './components/BatteryTestPanel';
import { TriggerScriptPanel } from './components/triggers';
import { DashboardGrid, getBatteryTesterPanelKey, getDevicePanelKey, getOscilloscopePanelKey, getSequencerPanelKey, getTriggerScriptsPanelKey } from './components/DashboardGrid';
import { useState } from 'react';
import type { PanelDefaults } from './stores';

// Widget size defaults - each widget type specifies its own preferred dimensions
const PSU_PANEL_DEFAULTS: PanelDefaults = { height: 12 };  // ~360px
const LOAD_PANEL_DEFAULTS: PanelDefaults = { height: 12 };  // ~360px
const OSCILLOSCOPE_PANEL_DEFAULTS: PanelDefaults = { height: 20 };  // ~600px - needs room for waveform
const SEQUENCER_PANEL_DEFAULTS: PanelDefaults = { height: 12 };  // ~360px
const BATTERY_TESTER_PANEL_DEFAULTS: PanelDefaults = { height: 12 };  // ~360px
const TRIGGER_SCRIPTS_PANEL_DEFAULTS: PanelDefaults = { height: 12 };  // ~360px

function App() {
  const { devices, isLoading, scan } = useDeviceList();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [clearLayoutConfirm, setClearLayoutConfirm] = useState(false);

  // Use individual selectors for state values (only re-render when they change)
  const theme = useUIStore(selectTheme);
  const toasts = useUIStore(selectToasts);
  const layouts = useLayoutStore(selectLayouts);

  // Actions are stable references
  const { setTheme, success, error } = useUIStore.getState();
  const { addPanel, removePanel, hasPanel, clearLayoutFromServer } = useLayoutStore.getState();

  // Initialize layout store on mount
  useEffect(() => {
    initializeLayoutStore();
  }, []);

  // Get open device IDs from layout (check all breakpoints for robustness)
  const openDeviceIds = useMemo(() => {
    const ids = new Set<string>();
    // Check all breakpoints since layouts might be inconsistent
    for (const bp of Object.keys(layouts) as (keyof typeof layouts)[]) {
      for (const item of layouts[bp]) {
        if (item.i.startsWith('device-')) {
          ids.add(item.i.replace('device-', ''));
        } else if (item.i.startsWith('oscilloscope-')) {
          ids.add(item.i.replace('oscilloscope-', ''));
        }
      }
    }
    return ids;
  }, [layouts]);

  // Check if sequencer/trigger scripts are shown
  const showSequencer = useMemo(() => hasPanel(getSequencerPanelKey()), [layouts]);
  const showBatteryTester = useMemo(() => hasPanel(getBatteryTesterPanelKey()), [layouts]);
  const showTriggerScripts = useMemo(() => hasPanel(getTriggerScriptsPanelKey()), [layouts]);

  // Get open devices from the device list
  const openDevices = useMemo(() =>
    devices.filter(d => openDeviceIds.has(d.id)),
    [devices, openDeviceIds]
  );

  // Handle sidebar device click - open panel (close via panel's X button only)
  const handleDeviceClick = useCallback((device: DeviceSummary) => {
    const key = device.info.type === 'oscilloscope'
      ? getOscilloscopePanelKey(device.id)
      : getDevicePanelKey(device.id);
    if (!hasPanel(key)) {
      // Use appropriate defaults based on device type
      const defaults = device.info.type === 'oscilloscope' ? OSCILLOSCOPE_PANEL_DEFAULTS
        : device.info.type === 'electronic-load' ? LOAD_PANEL_DEFAULTS
        : PSU_PANEL_DEFAULTS;
      addPanel(key, defaults);
    }
    // Always close sidebar
    setSidebarOpen(false);
  }, [addPanel, hasPanel]);

  const handleDeviceClose = useCallback((device: DeviceSummary) => {
    const key = device.info.type === 'oscilloscope'
      ? getOscilloscopePanelKey(device.id)
      : getDevicePanelKey(device.id);
    removePanel(key);
  }, [removePanel]);

  const handleSequencerClick = useCallback(() => {
    const key = getSequencerPanelKey();
    if (!hasPanel(key)) {
      addPanel(key, SEQUENCER_PANEL_DEFAULTS);
    }
    setSidebarOpen(false);
  }, [addPanel, hasPanel]);

  const handleTriggerScriptsClick = useCallback(() => {
    const key = getTriggerScriptsPanelKey();
    if (!hasPanel(key)) {
      addPanel(key, TRIGGER_SCRIPTS_PANEL_DEFAULTS);
    }
    setSidebarOpen(false);
  }, [addPanel, hasPanel]);

  const handleBatteryTesterClick = useCallback(() => {
    const key = getBatteryTesterPanelKey();
    if (!hasPanel(key)) addPanel(key, BATTERY_TESTER_PANEL_DEFAULTS);
    setSidebarOpen(false);
  }, [addPanel, hasPanel]);

  const handleSequencerClose = useCallback(() => {
    removePanel(getSequencerPanelKey());
  }, [removePanel]);

  const handleBatteryTesterClose = useCallback(() => {
    removePanel(getBatteryTesterPanelKey());
  }, [removePanel]);

  const handleTriggerScriptsClose = useCallback(() => {
    removePanel(getTriggerScriptsPanelKey());
  }, [removePanel]);

  // Check if any panels are open (check all breakpoints for robustness)
  const hasPanels = useMemo(() => {
    return Object.values(layouts).some(items => items.length > 0);
  }, [layouts]);

  return (
    <div className="h-screen flex flex-col">
      {/* Sidebar (hamburger menu) */}
      <DeviceSidebar
        devices={devices}
        openDeviceIds={openDeviceIds}
        showSequencer={showSequencer}
        showBatteryTester={showBatteryTester}
        showTriggerScripts={showTriggerScripts}
        onDeviceClick={handleDeviceClick}
        onSequencerClick={handleSequencerClick}
        onBatteryTesterClick={handleBatteryTesterClick}
        onTriggerScriptsClick={handleTriggerScriptsClick}
        onScan={scan}
        isScanning={isLoading}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(prev => !prev)}
      />

      {/* Header */}
      <div className="flex justify-between items-center px-4 py-2 border-b border-[var(--color-border-dark)] flex-shrink-0">
        <h1 className="text-lg font-semibold ml-12">Lab Controller</h1>
        <div className="flex items-center gap-3">
          <div className="relative flex items-center">
            {/* Clear Layout button */}
            <button
              className={`px-2 py-1 text-xs rounded bg-[var(--color-bg-secondary)] hover:bg-[var(--color-border-dark)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all duration-150 ${
                clearLayoutConfirm ? 'opacity-0 pointer-events-none' : 'opacity-100'
              }`}
              onClick={() => setClearLayoutConfirm(true)}
            >
              ✕ Clear Layout
            </button>
            {/* Confirmation overlay */}
            <div
              className={`absolute right-0 flex items-center gap-2 whitespace-nowrap transition-opacity duration-150 ease-out ${
                clearLayoutConfirm ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
            >
              <span className="text-xs text-[var(--color-text-primary)]">Clear layout?</span>
              <button
                className="px-2 py-1 text-xs rounded bg-[var(--color-bg-secondary)] hover:bg-[var(--color-border-dark)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                onClick={() => setClearLayoutConfirm(false)}
              >
                No
              </button>
              <button
                className="px-2 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700 transition-colors duration-100"
                onClick={() => {
                  clearLayoutFromServer();
                  setClearLayoutConfirm(false);
                }}
              >
                Yes
              </button>
            </div>
          </div>
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
      </div>

      {/* Scrollable panel area with dashboard grid */}
      <div className="flex-1 overflow-auto p-4">
        {hasPanels ? (
          <DashboardGrid>
            {/* Device Panels */}
            {openDevices.map(device => (
              device.info.type === 'oscilloscope' ? (
                <OscilloscopePanel
                  key={getOscilloscopePanelKey(device.id)}
                  device={device}
                  onClose={() => handleDeviceClose(device)}
                  onError={error}
                  onSuccess={success}
                />
              ) : (
                <DevicePanel
                  key={getDevicePanelKey(device.id)}
                  device={device}
                  onClose={() => handleDeviceClose(device)}
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

            {/* Battery Tester Panel */}
            {showBatteryTester && (
              <BatteryTestPanel
                key={getBatteryTesterPanelKey()}
                onClose={handleBatteryTesterClose}
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
