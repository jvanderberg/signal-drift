import { useState, useEffect } from 'react';
import type { Device } from '../types';
import { useOscilloscopeSocket } from '../hooks/useOscilloscopeSocket';
import { EditableDeviceHeader } from './EditableDeviceHeader';
import { WaveformDisplay } from './WaveformDisplay';
import { StatsBar } from './StatsBar';
import { StreamingControls } from './StreamingControls';
import { TriggerSettings } from './TriggerSettings';
import { ChannelSettings } from './ChannelSettings';

interface OscilloscopePanelProps {
  device: Device;
  onClose: () => void;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}

// Measurement descriptions for tooltips
const MEASUREMENT_INFO: Record<string, { desc: string; unit: string }> = {
  VPP: { desc: 'Peak-to-peak voltage difference between max and min', unit: 'V' },
  VMAX: { desc: 'Maximum voltage in the waveform', unit: 'V' },
  VMIN: { desc: 'Minimum voltage in the waveform', unit: 'V' },
  VAMP: { desc: 'Amplitude between top and base levels', unit: 'V' },
  VTOP: { desc: 'Top voltage level (90th percentile)', unit: 'V' },
  VBAS: { desc: 'Base voltage level (10th percentile)', unit: 'V' },
  VAVG: { desc: 'Average voltage across all samples', unit: 'V' },
  VRMS: { desc: 'Root mean square voltage', unit: 'V' },
  FREQ: { desc: 'Dominant frequency from FFT analysis', unit: 'Hz' },
  PER: { desc: 'Period of the dominant frequency', unit: 's' },
  PDUT: { desc: 'Positive duty cycle - % of time above midpoint', unit: '%' },
  NDUT: { desc: 'Negative duty cycle - % of time below midpoint', unit: '%' },
  PWID: { desc: 'Positive pulse width per cycle', unit: 's' },
  NWID: { desc: 'Negative pulse width per cycle', unit: 's' },
  RISE: { desc: 'Rise time from 10% to 90% of amplitude', unit: 's' },
  FALL: { desc: 'Fall time from 90% to 10% of amplitude', unit: 's' },
  OVER: { desc: 'Overshoot - % signal exceeds top level', unit: '%' },
  PRES: { desc: 'Preshoot - % signal undershoots base level', unit: '%' },
};

export function OscilloscopePanel({ device, onClose, onError, onSuccess }: OscilloscopePanelProps) {
  const {
    state,
    isSubscribed,
    error,
    waveform,
    waveforms,
    measurements,
    screenshot,
    isStreaming,
    subscribe,
    unsubscribe,
    run,
    stop,
    single,
    autoSetup,
    getWaveform,
    getScreenshot,
    clearError,
    setChannelEnabled,
    setChannelScale,
    setChannelOffset,
    setChannelCoupling,
    setChannelProbe,
    setChannelBwLimit,
    // setTimebaseScale, // Not used in UI yet
    // setTimebaseOffset, // Not used in UI yet
    setTriggerSource,
    setTriggerLevel,
    setTriggerEdge,
    setTriggerSweep,
    startStreaming,
    stopStreaming,
  } = useOscilloscopeSocket(device.id);

  const [selectedChannel, setSelectedChannel] = useState('CHAN1');
  const [isLoadingScreenshot, setIsLoadingScreenshot] = useState(false);
  const [showTriggerSettings, setShowTriggerSettings] = useState(false);
  const [showChannelSettings, setShowChannelSettings] = useState<string | null>(null);
  const [enabledChannels, setEnabledChannels] = useState<string[]>(['CHAN1']);
  const [showMeasurementPicker, setShowMeasurementPicker] = useState(false);
  const [hasAutoStarted, setHasAutoStarted] = useState(false);

  // Load selected measurements from localStorage
  const [selectedMeasurements, setSelectedMeasurements] = useState<string[]>(() => {
    const saved = localStorage.getItem(`scope-measurements-${device.id}`);
    return saved ? JSON.parse(saved) : ['VPP', 'FREQ', 'VAVG'];
  });

  // Persist selected measurements to localStorage
  useEffect(() => {
    localStorage.setItem(`scope-measurements-${device.id}`, JSON.stringify(selectedMeasurements));
  }, [selectedMeasurements, device.id]);

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

  // Auto-start streaming once when first subscribed
  useEffect(() => {
    if (isSubscribed && !hasAutoStarted && enabledChannels.length > 0) {
      setHasAutoStarted(true);
      startStreaming(enabledChannels, enabledChannels.length > 1 ? 350 : 200, selectedMeasurements);
    }
  }, [isSubscribed, hasAutoStarted, enabledChannels, selectedMeasurements, startStreaming]);

  // Reset loading state when screenshot arrives
  useEffect(() => {
    if (screenshot) {
      setIsLoadingScreenshot(false);
    }
  }, [screenshot]);

  // Sync enabled channels from status
  useEffect(() => {
    if (state?.status?.channels) {
      const enabled = Object.entries(state.status.channels)
        .filter(([_, ch]) => ch.enabled)
        .map(([name]) => name);
      if (enabled.length > 0) {
        setEnabledChannels(enabled);
      }
    }
  }, [state?.status?.channels]);

  const handleRun = () => run();
  const handleStop = () => stop();
  const handleSingle = () => single();
  const handleAutoSetup = () => autoSetup();

  const handleGetScreenshot = () => {
    setIsLoadingScreenshot(true);
    getScreenshot();
  };

  const handleStreamingToggle = (enabled: boolean) => {
    if (enabled) {
      startStreaming(enabledChannels, enabledChannels.length > 1 ? 350 : 200, selectedMeasurements);
    } else {
      stopStreaming();
    }
  };

  const handleChannelToggle = (channel: string, enabled: boolean) => {
    setChannelEnabled(channel, enabled);
    const newChannels = enabled
      ? [...enabledChannels, channel]
      : enabledChannels.filter(c => c !== channel);
    setEnabledChannels(newChannels);

    // Restart streaming with updated channels if currently streaming
    if (isStreaming && newChannels.length > 0) {
      startStreaming(newChannels, newChannels.length > 1 ? 350 : 200, selectedMeasurements);
    } else if (isStreaming && newChannels.length === 0) {
      stopStreaming();
    }
  };

  const handleMeasurementToggle = (measurement: string) => {
    const newMeasurements = selectedMeasurements.includes(measurement)
      ? selectedMeasurements.filter(m => m !== measurement)
      : [...selectedMeasurements, measurement];
    setSelectedMeasurements(newMeasurements);

    // Restart streaming with updated measurements
    if (isStreaming && enabledChannels.length > 0) {
      startStreaming(enabledChannels, enabledChannels.length > 1 ? 350 : 200, newMeasurements);
    }
  };

  const handleTriggerLevelChange = (level: number) => {
    setTriggerLevel(level);
  };

  const isConnected = isSubscribed && state !== null;
  const deviceConnectionStatus = state?.connectionStatus ?? 'disconnected';
  const status = state?.status;

  // Channel buttons based on capabilities
  const channelCount = state?.capabilities?.channels || 4;
  const channels = Array.from({ length: channelCount }, (_, i) => `CHAN${i + 1}`);

  // Available measurements from capabilities
  const supportedMeasurements = state?.capabilities?.supportedMeasurements ?? [
    'VPP', 'VMAX', 'VMIN', 'VAVG', 'VRMS', 'FREQ', 'PER'
  ];

  // Get waveform data for display
  const displayWaveforms = waveforms.length > 0 ? waveforms : (waveform ? [waveform] : []);
  const triggerLevel = status?.trigger?.level ?? 0;
  const triggerEdge = status?.trigger?.edge as 'rising' | 'falling' | 'either' ?? 'rising';

  // Filter measurements to only show enabled channels and selected types
  const filteredMeasurements = measurements.filter(
    m => enabledChannels.includes(m.channel) && selectedMeasurements.includes(m.type)
  );

  return (
    <div>
      {/* Header */}
      <EditableDeviceHeader
        info={device.info}
        connectionStatus={deviceConnectionStatus}
        onClose={onClose}
      />

      {/* Status & Controls - only when connected */}
      {isConnected && (
        <>
          {/* Streaming Controls Bar */}
          <div className="bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] rounded-md p-2 mb-2">
            <StreamingControls
              isStreaming={isStreaming}
              scopeRunning={status?.running ?? false}
              channels={channels}
              enabledChannels={enabledChannels}
              intervalMs={enabledChannels.length > 1 ? 350 : 200}
              onStreamingToggle={handleStreamingToggle}
              onChannelToggle={handleChannelToggle}
            />
          </div>

          {/* Run/Stop Controls */}
          <div className="bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] rounded-md p-3 mb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                className="px-4 py-2 text-sm font-medium rounded bg-[var(--color-success)] text-white hover:opacity-90"
                onClick={handleRun}
              >
                Run
              </button>
              <button
                className="px-4 py-2 text-sm font-medium rounded bg-[var(--color-danger)] text-white hover:opacity-90"
                onClick={handleStop}
              >
                Stop
              </button>
              <button
                className="px-4 py-2 text-sm font-medium rounded bg-[var(--color-border-light)] text-[var(--color-text-primary)] hover:opacity-90"
                onClick={handleSingle}
              >
                Single
              </button>
              <button
                className="px-4 py-2 text-sm font-medium rounded bg-[var(--color-border-light)] text-[var(--color-text-primary)] hover:opacity-90"
                onClick={handleAutoSetup}
              >
                Auto
              </button>
              <div className="flex-1" />
              <div className="flex items-center gap-2">
                <span className={`status-dot ${status?.running ? 'connected' : 'disconnected'}`} />
                <span className="text-sm font-medium">
                  {status?.running ? 'Running' : 'Stopped'}
                </span>
                {status?.triggerStatus && (
                  <span className="text-xs text-[var(--color-text-muted)] uppercase ml-2">
                    {status.triggerStatus}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Waveform Display with integrated trigger drag */}
          <div className="bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] rounded-md p-3 mb-2 relative">
            <WaveformDisplay
              waveforms={displayWaveforms}
              waveform={displayWaveforms[0]}
              triggerLevel={triggerLevel}
              onTriggerLevelChange={handleTriggerLevelChange}
              showGrid={true}
              height={300}
            />

            {/* Trigger settings button + popover container */}
            <div className="absolute top-2 right-2">
              <button
                className="p-1.5 rounded bg-[var(--color-border-dark)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border-light)] transition-colors"
                onClick={() => setShowTriggerSettings(!showTriggerSettings)}
                title="Trigger settings"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
              </button>

              {/* Trigger Settings Popover */}
              {showTriggerSettings && (
                <div className="absolute top-full right-0 mt-1 z-10">
                  <TriggerSettings
                    sources={channels}
                    currentSource={status?.trigger?.source ?? 'CHAN1'}
                    currentLevel={triggerLevel}
                    currentEdge={triggerEdge}
                    currentSweep={status?.trigger?.sweep as 'auto' | 'normal' | 'single' ?? 'auto'}
                    onSourceChange={setTriggerSource}
                    onLevelChange={handleTriggerLevelChange}
                    onEdgeChange={setTriggerEdge}
                    onSweepChange={setTriggerSweep}
                    onClose={() => setShowTriggerSettings(false)}
                  />
                </div>
              )}
            </div>

          </div>

          {/* Stats Bar - Measurements */}
          <div className="bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] rounded-md mb-2 relative">
            <div className="flex items-center">
              <div className="flex-1">
                <StatsBar measurements={filteredMeasurements} />
              </div>
              <button
                className="p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border-dark)] rounded transition-colors"
                onClick={() => setShowMeasurementPicker(!showMeasurementPicker)}
                title="Select measurements"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </button>
            </div>

            {/* Measurement Picker Popover */}
            {showMeasurementPicker && (
              <div className="absolute right-0 top-full mt-1 z-20 bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] rounded-md shadow-lg p-3 min-w-[200px]">
                <div className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide mb-2 flex items-center justify-between">
                  <span>Measurements</span>
                  <button
                    className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                    onClick={() => setShowMeasurementPicker(false)}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1 max-h-[200px] overflow-y-auto">
                  {supportedMeasurements.map((m) => {
                    const info = MEASUREMENT_INFO[m];
                    const tooltip = info ? `${info.desc} (${info.unit})` : m;
                    return (
                      <button
                        key={m}
                        title={tooltip}
                        className={`px-2 py-1 text-xs rounded transition-colors ${
                          selectedMeasurements.includes(m)
                            ? 'bg-[var(--color-accent)] text-white'
                            : 'bg-[var(--color-border-dark)] text-[var(--color-text-muted)] hover:bg-[var(--color-border-light)]'
                        }`}
                        onClick={() => handleMeasurementToggle(m)}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Channel Settings */}
          <div className="bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] rounded-md p-3 mb-2">
            <div className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide mb-2">
              Channels
            </div>
            <div className="flex gap-2 flex-wrap">
              {channels.map((ch) => {
                const chStatus = status?.channels?.[ch];
                return (
                  <div key={ch} className="relative">
                    <button
                      className={`px-3 py-1.5 text-xs font-medium rounded ${
                        selectedChannel === ch
                          ? 'bg-[var(--color-accent)] text-white'
                          : 'bg-[var(--color-border-light)] text-[var(--color-text-primary)]'
                      } hover:opacity-90`}
                      onClick={() => {
                        setSelectedChannel(ch);
                        setShowChannelSettings(showChannelSettings === ch ? null : ch);
                      }}
                    >
                      {ch.replace('CHAN', 'CH')}
                      {chStatus && (
                        <span className="ml-1 text-[10px] opacity-75">
                          {formatVoltage(chStatus.scale)}/div
                        </span>
                      )}
                    </button>

                    {/* Channel Settings Popover */}
                    {showChannelSettings === ch && chStatus && (
                      <div className="absolute top-full left-0 mt-1 z-10">
                        <ChannelSettings
                          channel={ch}
                          currentScale={chStatus.scale}
                          currentOffset={chStatus.offset}
                          currentCoupling={chStatus.coupling as 'AC' | 'DC' | 'GND'}
                          currentProbeRatio={chStatus.probe}
                          currentBwLimit={chStatus.bwLimit}
                          onScaleChange={(scale) => setChannelScale(ch, scale)}
                          onOffsetChange={(offset) => setChannelOffset(ch, offset)}
                          onCouplingChange={(coupling) => setChannelCoupling(ch, coupling)}
                          onProbeRatioChange={(ratio) => setChannelProbe(ch, ratio)}
                          onBwLimitChange={(enabled) => setChannelBwLimit(ch, enabled)}
                          onClose={() => setShowChannelSettings(null)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Timebase Info */}
          {status?.timebase && (
            <div className="bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] rounded-md p-3 mb-2">
              <div className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide mb-2">
                Timebase
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <span className="text-[var(--color-text-muted)]">Scale: </span>
                  <span>{formatTime(status.timebase.scale)}/div</span>
                </div>
                <div>
                  <span className="text-[var(--color-text-muted)]">Offset: </span>
                  <span>{formatTime(status.timebase.offset)}</span>
                </div>
                <div>
                  <span className="text-[var(--color-text-muted)]">Mode: </span>
                  <span className="uppercase">{status.timebase.mode}</span>
                </div>
              </div>
            </div>
          )}

          {/* Screenshot */}
          <div className="bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] rounded-md p-3 mb-2">
            <div className="flex items-center gap-2 mb-2">
              <button
                className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--color-border-light)] text-[var(--color-text-primary)] hover:opacity-90 disabled:opacity-50"
                onClick={handleGetScreenshot}
                disabled={isLoadingScreenshot}
              >
                {isLoadingScreenshot ? 'Loading...' : 'Capture Screenshot'}
              </button>
            </div>
            {screenshot && (
              <div className="border border-[var(--color-border-dark)] rounded overflow-hidden">
                <img
                  src={`data:image/png;base64,${screenshot}`}
                  alt="Oscilloscope screenshot"
                  className="w-full h-auto"
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Formatting helpers
function formatVoltage(v: number): string {
  if (Math.abs(v) >= 1) return `${v.toFixed(2)} V`;
  if (Math.abs(v) >= 0.001) return `${(v * 1000).toFixed(1)} mV`;
  return `${(v * 1e6).toFixed(0)} uV`;
}

function formatTime(t: number): string {
  if (Math.abs(t) >= 1) return `${t.toFixed(2)} s`;
  if (Math.abs(t) >= 0.001) return `${(t * 1000).toFixed(2)} ms`;
  if (Math.abs(t) >= 1e-6) return `${(t * 1e6).toFixed(2)} us`;
  return `${(t * 1e9).toFixed(1)} ns`;
}
