import { useState, useEffect } from 'react';
import type { Device } from '../types';
import { useOscilloscopeSocket } from '../hooks/useOscilloscopeSocket';
import { EditableDeviceHeader } from './EditableDeviceHeader';

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
    screenshot,
    subscribe,
    unsubscribe,
    run,
    stop,
    single,
    autoSetup,
    getWaveform,
    getScreenshot,
    clearError,
  } = useOscilloscopeSocket(device.id);

  const [selectedChannel, setSelectedChannel] = useState('CHAN1');
  const [isLoadingScreenshot, setIsLoadingScreenshot] = useState(false);

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

  const isConnected = isSubscribed && state !== null;
  const deviceConnectionStatus = state?.connectionStatus ?? 'disconnected';
  const status = state?.status;

  // Channel buttons based on capabilities
  const channelCount = state?.capabilities?.channels ?? 2;
  const channels = Array.from({ length: channelCount }, (_, i) => `CHAN${i + 1}`);

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
          {/* Trigger Status */}
          <div className="bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] rounded-md p-3 mb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className={`status-dot ${status?.running ? 'connected' : 'disconnected'}`} />
                  <span className="text-sm font-medium">
                    {status?.running ? 'Running' : 'Stopped'}
                  </span>
                </div>
                {status?.triggerStatus && (
                  <span className="text-xs text-[var(--color-text-muted)] uppercase">
                    Trigger: {status.triggerStatus}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                {status?.sampleRate && (
                  <span>{formatSampleRate(status.sampleRate)}</span>
                )}
                {status?.memoryDepth && (
                  <span>{formatMemoryDepth(status.memoryDepth)}</span>
                )}
              </div>
            </div>
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
            </div>
          </div>

          {/* Channel Selection and Waveform */}
          <div className="bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] rounded-md p-3 mb-2">
            <div className="flex items-center gap-2 mb-3">
              {channels.map((ch) => (
                <button
                  key={ch}
                  className={`px-3 py-1.5 text-xs font-medium rounded ${
                    selectedChannel === ch
                      ? 'bg-[var(--color-accent)] text-white'
                      : 'bg-[var(--color-border-light)] text-[var(--color-text-primary)]'
                  } hover:opacity-90`}
                  onClick={() => setSelectedChannel(ch)}
                >
                  {ch.replace('CHAN', 'CH')}
                </button>
              ))}
              <div className="flex-1" />
              <button
                className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--color-border-light)] text-[var(--color-text-primary)] hover:opacity-90"
                onClick={handleGetWaveform}
              >
                Get Waveform
              </button>
            </div>

            {/* Channel Status */}
            {status?.channels?.[selectedChannel] && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-3">
                <div>
                  <span className="text-[var(--color-text-muted)]">Scale: </span>
                  <span>{formatVoltage(status.channels[selectedChannel].scale)}/div</span>
                </div>
                <div>
                  <span className="text-[var(--color-text-muted)]">Offset: </span>
                  <span>{formatVoltage(status.channels[selectedChannel].offset)}</span>
                </div>
                <div>
                  <span className="text-[var(--color-text-muted)]">Coupling: </span>
                  <span>{status.channels[selectedChannel].coupling}</span>
                </div>
                <div>
                  <span className="text-[var(--color-text-muted)]">Probe: </span>
                  <span>{status.channels[selectedChannel].probe}x</span>
                </div>
              </div>
            )}

            {/* Waveform Display */}
            {waveform && waveform.channel === selectedChannel && (
              <div className="border border-[var(--color-border-dark)] rounded bg-[var(--color-bg)] p-2">
                <div className="text-xs text-[var(--color-text-muted)] mb-1">
                  {waveform.points.length} points
                  {' | '}
                  {formatTime(waveform.xIncrement)}/pt
                </div>
                <WaveformCanvas waveform={waveform} height={150} />
              </div>
            )}
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

          {/* Trigger Info */}
          {status?.trigger && (
            <div className="bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] rounded-md p-3 mb-2">
              <div className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide mb-2">
                Trigger
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                <div>
                  <span className="text-[var(--color-text-muted)]">Source: </span>
                  <span>{status.trigger.source}</span>
                </div>
                <div>
                  <span className="text-[var(--color-text-muted)]">Level: </span>
                  <span>{formatVoltage(status.trigger.level)}</span>
                </div>
                <div>
                  <span className="text-[var(--color-text-muted)]">Edge: </span>
                  <span className="capitalize">{status.trigger.edge}</span>
                </div>
                <div>
                  <span className="text-[var(--color-text-muted)]">Sweep: </span>
                  <span className="uppercase">{status.trigger.sweep}</span>
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

// Simple waveform canvas renderer
function WaveformCanvas({ waveform, height }: { waveform: { points: number[] }; height: number }) {
  const points = waveform.points;
  if (points.length === 0) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  // Create SVG path
  const width = 100; // Use viewBox for scaling
  const pathData = points.map((y, i) => {
    const x = (i / (points.length - 1)) * width;
    const normalizedY = height - ((y - min) / range) * height;
    return i === 0 ? `M ${x} ${normalizedY}` : `L ${x} ${normalizedY}`;
  }).join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
    >
      <path
        d={pathData}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="0.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
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

function formatSampleRate(rate: number): string {
  if (rate >= 1e9) return `${(rate / 1e9).toFixed(2)} GSa/s`;
  if (rate >= 1e6) return `${(rate / 1e6).toFixed(1)} MSa/s`;
  if (rate >= 1e3) return `${(rate / 1e3).toFixed(0)} kSa/s`;
  return `${rate} Sa/s`;
}

function formatMemoryDepth(depth: number): string {
  if (depth >= 1e6) return `${(depth / 1e6).toFixed(1)} Mpts`;
  if (depth >= 1e3) return `${(depth / 1e3).toFixed(0)} kpts`;
  return `${depth} pts`;
}
