import { useState } from 'react';
import type { Device } from '../types';
import { useDevice } from '../hooks/useDevice';
import { StatusReadings } from './StatusReadings';
import { OutputControl } from './OutputControl';
import { DigitSpinner } from './DigitSpinner';
import { ModeSelector } from './ModeSelector';
import { LiveChart } from './LiveChart';

interface DevicePanelProps {
  device: Device;
  onClose: () => void;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}

export function DevicePanel({ device, onClose, onError, onSuccess }: DevicePanelProps) {
  const {
    status,
    history,
    isConnected,
    connect,
    disconnect,
    setMode,
    setOutput,
    setValue,
    setHistoryWindow,
  } = useDevice(device);

  const [historyWindow, setHistoryWindowState] = useState(2);

  const handleConnect = async () => {
    try {
      await connect();
      onSuccess('Connected');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Connection failed');
    }
  };

  const handleDisconnect = () => {
    disconnect();
    onSuccess('Disconnected');
  };

  const handleModeChange = async (mode: string) => {
    try {
      // Safety: turn off output before changing mode
      if (status?.outputEnabled) {
        await setOutput(false);
      }
      await setMode(mode);
      // Status polling will automatically fetch new setpoint
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to set mode');
    }
  };

  const handleOutputToggle = async (enabled: boolean) => {
    try {
      await setOutput(enabled);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to toggle output');
    }
  };

  const handleValueChange = async (name: string, value: number) => {
    try {
      await setValue(name, value);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to set value');
    }
  };

  const handleHistoryWindowChange = (minutes: number) => {
    setHistoryWindowState(minutes);
    setHistoryWindow(minutes);
  };

  // Get current output descriptor based on mode
  const getCurrentOutput = () => {
    if (!status) return null;
    return device.capabilities.outputs.find(
      o => !o.modes || o.modes.includes(status.mode)
    );
  };

  const currentOutput = getCurrentOutput();
  const deviceClass = device.info.type === 'power-supply' ? 'device-psu' : 'device-load';

  return (
    <div className={deviceClass}>
      {/* Header */}
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">
              {device.info.manufacturer} {device.info.model}
            </h2>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {device.info.type === 'power-supply' ? 'Power Supply' : 'Electronic Load'}
              {device.info.serial && ` • ${device.info.serial}`}
            </div>
          </div>
          <div className="controls-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className={`status-dot ${isConnected ? 'connected' : 'disconnected'}`} />
              <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
            </div>
            {isConnected ? (
              <button className="btn btn-secondary" onClick={handleDisconnect}>
                Disconnect
              </button>
            ) : (
              <button className="btn btn-primary" onClick={handleConnect}>
                Connect
              </button>
            )}
            <button className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>

      {/* Status & Controls - only when connected */}
      {isConnected && status && (
        <>
          {/* Chart - first for visibility */}
          <LiveChart
            history={history}
            capabilities={device.capabilities}
            status={status}
            historyWindow={historyWindow}
            onHistoryWindowChange={handleHistoryWindowChange}
          />

          {/* Readings */}
          <div className="panel">
            <h3 className="panel-title" style={{ marginBottom: 12 }}>
              Measurements
            </h3>
            <StatusReadings status={status} capabilities={device.capabilities} />
            <OutputControl
              enabled={status.outputEnabled}
              mode={status.mode}
              onToggle={handleOutputToggle}
            />
          </div>

          {/* Setpoint Controls */}
          <div className="panel">
            <h3 className="panel-title" style={{ marginBottom: 12 }}>
              Setpoint
            </h3>

            {/* Value controls */}
            {device.info.type === 'power-supply' ? (
              // PSU: Always show voltage and current
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {device.capabilities.outputs.map(output => {
                  const setpointValue = status.setpoints[output.name] ?? 0;
                  return (
                    <div key={output.name}>
                      <div className="reading-label" style={{ marginBottom: 8 }}>
                        {output.name}
                      </div>
                      <DigitSpinner
                        value={setpointValue}
                        decimals={output.decimals}
                        min={output.min ?? 0}
                        max={output.max ?? 100}
                        unit={output.unit}
                        onChange={v => handleValueChange(output.name, v)}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              // Load: Mode selector and setpoint on same row
              <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
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
        </>
      )}
    </div>
  );
}
