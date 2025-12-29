import { useState, useEffect } from 'react';
import type { Device } from '../types';
import { useDeviceSocket } from '../hooks/useDeviceSocket';
import { StatusReadings } from './StatusReadings';
import { OutputControl } from './OutputControl';
import { DigitSpinner } from './DigitSpinner';
import { ModeSelector } from './ModeSelector';
import { LiveChart } from './LiveChart';
import { EditableDeviceHeader } from './EditableDeviceHeader';

interface DevicePanelProps {
  device: Device;
  onClose: () => void;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}

export function DevicePanel({ device, onClose, onError, onSuccess }: DevicePanelProps) {
  const {
    state,
    connectionState,
    isSubscribed,
    error,
    subscribe,
    unsubscribe,
    setMode,
    setOutput,
    setValue,
    clearError,
  } = useDeviceSocket(device.id);

  const [historyWindow, setHistoryWindow] = useState(2);

  // Auto-subscribe on mount
  useEffect(() => {
    subscribe();
    return () => {
      unsubscribe();
    };
  }, [subscribe, unsubscribe]);

  // Handle errors from websocket
  useEffect(() => {
    if (error) {
      onError(error);
      clearError();
    }
  }, [error, onError, clearError]);

  // Notify on subscription state change
  useEffect(() => {
    if (isSubscribed) {
      onSuccess('Connected');
    }
  }, [isSubscribed, onSuccess]);

  const handleModeChange = (mode: string) => {
    // Safety: turn off output before changing mode
    if (state?.outputEnabled) {
      setOutput(false);
    }
    setMode(mode);
  };

  const handleOutputToggle = (enabled: boolean) => {
    setOutput(enabled);
  };

  const handleValueChange = (name: string, value: number) => {
    setValue(name, value);
  };

  const handleHistoryWindowChange = (minutes: number) => {
    setHistoryWindow(minutes);
  };

  // Get current output descriptor based on mode
  const getCurrentOutput = () => {
    if (!state) return null;
    return device.capabilities.outputs.find(
      o => !o.modes || o.modes.includes(state.mode)
    );
  };

  const currentOutput = getCurrentOutput();

  // Determine if we're connected (either websocket connected or subscribed with state)
  // Show UI if we have state data (even if stale)
  const hasState = state !== null;

  // Create status object compatible with existing components
  const status = state ? {
    mode: state.mode,
    outputEnabled: state.outputEnabled,
    setpoints: state.setpoints,
    measurements: state.measurements,
    listRunning: state.listRunning,
  } : null;

  // Create history object from state
  const history = state?.history ?? {
    timestamps: [],
    voltage: [],
    current: [],
    power: [],
  };

  // Show disconnected if websocket is down, otherwise show device status
  const wsConnected = connectionState === 'connected';
  const deviceConnectionStatus = wsConnected
    ? (state?.connectionStatus ?? 'disconnected')
    : 'disconnected';

  return (
    <div>
      {/* Header */}
      <EditableDeviceHeader
        info={device.info}
        connectionStatus={deviceConnectionStatus}
        onClose={onClose}
      />

      {/* Status & Controls - only when connected */}
      {hasState && status && (
        <>
          {/* Chart + Live Data in responsive row */}
          <div className="bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] rounded-md p-3 mb-2">
            <div className="flex flex-col lg:flex-row lg:items-start gap-3">
              {/* Chart - fixed height */}
              <div className="min-w-0 h-[280px] lg:flex-1">
                <LiveChart
                  history={history}
                  capabilities={device.capabilities}
                  status={status}
                  historyWindow={historyWindow}
                  onHistoryWindowChange={handleHistoryWindowChange}
                />
              </div>
              {/* Status readings - beside chart on large screens only */}
              <div className="hidden lg:block lg:w-48 shrink-0">
                <StatusReadings status={status} capabilities={device.capabilities} />
              </div>
            </div>
          </div>

          {/* Status readings - compact row on small screens only */}
          <div className="lg:hidden bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] rounded-md p-2 mb-2">
            <StatusReadings status={status} capabilities={device.capabilities} />
          </div>

          {/* Output + Setpoint Controls */}
          <div className="bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] rounded-md p-3 mb-2 min-h-[72px]">
            <div className="flex items-center gap-3 flex-wrap">
              {/* Output control */}
              <OutputControl
                enabled={status.outputEnabled}
                mode={status.mode}
                onToggle={handleOutputToggle}
              />

              <div className="w-px h-8 bg-[var(--color-border-dark)] mx-2" />

              {/* Setpoint controls */}
              {device.info.type === 'power-supply' ? (
                // PSU: Horizontal voltage and current setpoints
                <div className="flex items-center gap-4 flex-wrap">
                  {device.capabilities.outputs.map(output => {
                    const setpointValue = status.setpoints[output.name] ?? 0;
                    return (
                      <DigitSpinner
                        key={output.name}
                        value={setpointValue}
                        decimals={output.decimals}
                        min={output.min ?? 0}
                        max={output.max ?? 100}
                        unit={output.unit}
                        onChange={v => handleValueChange(output.name, v)}
                      />
                    );
                  })}
                </div>
              ) : (
                // Load: Mode selector and setpoint
                <div className="flex items-center gap-3 flex-wrap">
                  {device.capabilities.modesSettable && (
                    <ModeSelector
                      modes={device.capabilities.modes}
                      currentMode={status.mode}
                      onChange={handleModeChange}
                    />
                  )}
                  {currentOutput && (
                    <DigitSpinner
                      value={status.setpoints[currentOutput.name] ?? 0}
                      decimals={currentOutput.decimals}
                      min={currentOutput.min ?? 0}
                      max={currentOutput.max ?? 100}
                      unit={currentOutput.unit}
                      onChange={v => handleValueChange(currentOutput.name, v)}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
