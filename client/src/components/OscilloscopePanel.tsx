import { useState, useEffect } from 'react';
import type { Device } from '../types';
import { useOscilloscopeSocket } from '../hooks/useOscilloscopeSocket';
import { EditableDeviceHeader } from './EditableDeviceHeader';
import { WaveformDisplay } from './WaveformDisplay';
import { StatsBar } from './StatsBar';
import { StreamingControls } from './StreamingControls';
import { TriggerSlider } from './TriggerSlider';
import { TriggerSettings } from './TriggerSettings';
import { ChannelSettings } from './ChannelSettings';

interface OscilloscopePanelProps {
  device: Device;
  onClose: () => void;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}

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

  const handleGetWaveform = () => {
    getWaveform(selectedChannel);
  };

  const handleGetScreenshot = () => {
    setIsLoadingScreenshot(true);
    getScreenshot();
  };

  const handleStreamingToggle = (enabled: boolean) => {
    if (enabled) {
      startStreaming(enabledChannels, enabledChannels.length > 1 ? 350 : 200);
    } else {
      stopStreaming();
    }
  };

  const handleChannelToggle = (channel: string, enabled: boolean) => {
    setChannelEnabled(channel, enabled);
    setEnabledChannels(prev =>
      enabled ? [...prev, channel] : prev.filter(c => c !== channel)
    );
  };

  const handleTriggerLevelChange = (level: number) => {
    setTriggerLevel(level);
  };

  const isConnected = isSubscribed && state !== null;
  const deviceConnectionStatus = state?.connectionStatus ?? 'disconnected';
  const status = state?.status;

  // Channel buttons based on capabilities
  const channelCount = state?.capabilities?.channels ?? 2;
  const channels = Array.from({ length: channelCount }, (_, i) => `CHAN${i + 1}`);

  // Get waveform data for display
  const displayWaveforms = waveforms.length > 0 ? waveforms : (waveform ? [waveform] : []);
  const triggerLevel = status?.trigger?.level ?? 0;
  const triggerEdge = status?.trigger?.edge as 'rising' | 'falling' | 'either' ?? 'rising';

  // Calculate voltage range for trigger slider based on selected channel
  const selectedChannelStatus = status?.channels?.[selectedChannel];
  const scale = selectedChannelStatus?.scale ?? 1;
  const offset = selectedChannelStatus?.offset ?? 0;
  const minVoltage = offset - (scale * 4);
  const maxVoltage = offset + (scale * 4);

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

          {/* Waveform Display with Trigger Slider */}
          <div className="bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] rounded-md p-3 mb-2">
            <div className="flex gap-2">
              {/* Main waveform area */}
              <div className="flex-1">
                <WaveformDisplay
                  waveforms={displayWaveforms}
                  waveform={displayWaveforms[0]}
                  triggerLevel={triggerLevel}
                  showGrid={true}
                  width={600}
                  height={300}
                />
              </div>

              {/* Trigger slider on right */}
              <div className="flex flex-col items-center">
                <TriggerSlider
                  triggerLevel={triggerLevel}
                  minVoltage={minVoltage}
                  maxVoltage={maxVoltage}
                  triggerEdge={triggerEdge}
                  onTriggerLevelChange={handleTriggerLevelChange}
                  onSettingsClick={() => setShowTriggerSettings(!showTriggerSettings)}
                />
              </div>
            </div>

            {/* Trigger Settings Popover */}
            {showTriggerSettings && (
              <div className="absolute right-4 mt-2 z-10">
                <TriggerSettings
                  sources={channels}
                  currentSource={status?.trigger?.source ?? 'CHAN1'}
                  currentEdge={triggerEdge}
                  currentSweep={status?.trigger?.sweep as 'auto' | 'normal' | 'single' ?? 'auto'}
                  onSourceChange={setTriggerSource}
                  onEdgeChange={setTriggerEdge}
                  onSweepChange={setTriggerSweep}
                  onClose={() => setShowTriggerSettings(false)}
                />
              </div>
            )}

            {/* Manual waveform fetch */}
            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[var(--color-border-dark)]">
              <button
                className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--color-border-light)] text-[var(--color-text-primary)] hover:opacity-90"
                onClick={handleGetWaveform}
              >
                Fetch {selectedChannel.replace('CHAN', 'CH')}
              </button>
              <span className="text-xs text-[var(--color-text-muted)]">
                {displayWaveforms.length > 0 && `${displayWaveforms[0]?.points?.length ?? 0} points`}
              </span>
            </div>
          </div>

          {/* Stats Bar - Measurements */}
          <div className="bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] rounded-md mb-2">
            <StatsBar measurements={measurements} />
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
