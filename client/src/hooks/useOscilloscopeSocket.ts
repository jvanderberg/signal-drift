/**
 * useOscilloscopeSocket - React hook for oscilloscope state via WebSocket
 *
 * Similar to useDeviceSocket but with oscilloscope-specific operations:
 * - run/stop/single for trigger control
 * - getWaveform for waveform data
 * - getMeasurement for measurement queries
 * - getScreenshot for screen capture
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getWebSocketManager, ConnectionState } from '../websocket';
import type { ServerMessage, OscilloscopeStatus, WaveformData, OscilloscopeMeasurement } from '../../../shared/types';

// Infer measurement unit from type
function getMeasurementUnit(type: string): string {
  const upper = type.toUpperCase();
  if (upper === 'FREQ') return 'Hz';
  if (upper === 'PER' || upper === 'PERIOD') return 's';
  if (upper.includes('TIM') || upper.includes('RISE') || upper.includes('FALL') || upper.includes('DELAY')) return 's';
  if (upper.includes('WID')) return 's'; // Pulse width (PWID, NWID)
  if (upper.includes('DUT')) return '%'; // Duty cycle (PDUT, NDUT)
  if (upper === 'OVER' || upper === 'PRES') return '%'; // Overshoot/preshoot
  return 'V'; // Default to voltage
}

export interface OscilloscopeSessionState {
  info: {
    id: string;
    type: 'oscilloscope';
    manufacturer: string;
    model: string;
    serial?: string;
  };
  capabilities: {
    channels: number;
    bandwidth: number;
    maxSampleRate: number;
    maxMemoryDepth: number;
    supportedMeasurements: string[];
    hasAWG: boolean;
  };
  connectionStatus: 'connected' | 'error' | 'disconnected';
  consecutiveErrors: number;
  status: OscilloscopeStatus | null;
  lastUpdated: number;
}

export interface UseOscilloscopeSocketResult {
  state: OscilloscopeSessionState | null;
  connectionState: ConnectionState;
  isSubscribed: boolean;
  error: string | null;

  // Waveform data (last fetched)
  waveform: WaveformData | null;
  waveforms: WaveformData[];  // Multi-channel waveforms
  measurements: OscilloscopeMeasurement[];
  screenshot: string | null;  // base64 PNG
  isStreaming: boolean;

  // Actions
  subscribe: () => void;
  unsubscribe: () => void;
  run: () => void;
  stop: () => void;
  single: () => void;
  autoSetup: () => void;
  getWaveform: (channel: string) => void;
  getMeasurement: (channel: string, type: string) => void;
  getScreenshot: () => void;
  clearError: () => void;

  // Channel settings
  setChannelEnabled: (channel: string, enabled: boolean) => void;
  setChannelScale: (channel: string, scale: number) => void;
  setChannelOffset: (channel: string, offset: number) => void;
  setChannelCoupling: (channel: string, coupling: 'AC' | 'DC' | 'GND') => void;
  setChannelProbe: (channel: string, ratio: number) => void;
  setChannelBwLimit: (channel: string, enabled: boolean) => void;

  // Timebase settings
  setTimebaseScale: (scale: number) => void;
  setTimebaseOffset: (offset: number) => void;

  // Trigger settings
  setTriggerSource: (source: string) => void;
  setTriggerLevel: (level: number) => void;
  setTriggerEdge: (edge: 'rising' | 'falling' | 'either') => void;
  setTriggerSweep: (sweep: 'auto' | 'normal' | 'single') => void;

  // Streaming
  startStreaming: (channels: string[], intervalMs: number, measurements?: string[]) => void;
  stopStreaming: () => void;
}

export function useOscilloscopeSocket(deviceId: string): UseOscilloscopeSocketResult {
  const [state, setState] = useState<OscilloscopeSessionState | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waveform, setWaveform] = useState<WaveformData | null>(null);
  const [waveforms, setWaveforms] = useState<WaveformData[]>([]);
  const [measurements, setMeasurements] = useState<OscilloscopeMeasurement[]>([]);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  const wsManager = useRef(getWebSocketManager());
  const isSubscribedRef = useRef(false);

  // Handle incoming messages
  useEffect(() => {
    const manager = wsManager.current;

    // Set up connection state tracking and re-subscribe on reconnect
    const unsubscribeState = manager.onStateChange((newState) => {
      setConnectionState(newState);
      // Re-subscribe when connection is restored
      if (newState === 'connected' && isSubscribedRef.current) {
        manager.send({ type: 'subscribe', deviceId });
      }
    });

    // Set initial connection state
    setConnectionState(manager.getState());

    // Connect the WebSocket
    manager.connect();

    // Set up message handler
    const unsubscribeMessage = manager.onMessage((message: ServerMessage) => {
      // Only handle messages for our device
      if ('deviceId' in message && message.deviceId !== deviceId) {
        return;
      }

      switch (message.type) {
        case 'subscribed':
          if (message.deviceId === deviceId) {
            // The state from oscilloscope subscription has a different shape
            setState(message.state as unknown as OscilloscopeSessionState);
            setIsSubscribed(true);
            isSubscribedRef.current = true;
            setError(null);
          }
          break;

        case 'unsubscribed':
          if (message.deviceId === deviceId) {
            setIsSubscribed(false);
            isSubscribedRef.current = false;
          }
          break;

        case 'field':
          if (message.deviceId === deviceId) {
            setState((prev) => {
              if (!prev) return prev;

              const { field, value } = message;

              switch (field) {
                case 'connectionStatus':
                  return { ...prev, connectionStatus: value as OscilloscopeSessionState['connectionStatus'] };
                case 'oscilloscopeStatus':
                  return { ...prev, status: value as OscilloscopeStatus };
                default:
                  return { ...prev, [field]: value };
              }
            });
          }
          break;

        case 'scopeWaveform':
          if (message.deviceId === deviceId) {
            setWaveform(message.waveform);
            // Update waveforms array (replace if same channel, add if new)
            setWaveforms(prev => {
              const idx = prev.findIndex(w => w.channel === message.waveform.channel);
              if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = message.waveform;
                return updated;
              }
              return [...prev, message.waveform];
            });
          }
          break;

        case 'scopeScreenshot':
          if (message.deviceId === deviceId) {
            setScreenshot(message.data);
          }
          break;

        case 'scopeMeasurement':
          if (message.deviceId === deviceId && message.value !== null) {
            // Update or add measurement
            // Infer unit from measurement type
            const unit = getMeasurementUnit(message.measurementType);
            setMeasurements(prev => {
              const idx = prev.findIndex(m =>
                m.channel === message.channel && m.type === message.measurementType
              );
              const newMeasurement: OscilloscopeMeasurement = {
                channel: message.channel,
                type: message.measurementType,
                value: message.value as number,
                unit,
              };
              if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = newMeasurement;
                return updated;
              }
              return [...prev, newMeasurement];
            });
          }
          break;

        case 'error':
          if (!message.deviceId || message.deviceId === deviceId) {
            setError(message.message);
          }
          break;
      }
    });

    // Cleanup
    return () => {
      unsubscribeState();
      unsubscribeMessage();

      // Unsubscribe from device if we were subscribed
      if (isSubscribedRef.current) {
        manager.send({ type: 'unsubscribe', deviceId });
        isSubscribedRef.current = false;
      }
    };
  }, [deviceId]);

  const subscribe = useCallback(() => {
    wsManager.current.send({ type: 'subscribe', deviceId });
  }, [deviceId]);

  const unsubscribe = useCallback(() => {
    wsManager.current.send({ type: 'unsubscribe', deviceId });
    setIsSubscribed(false);
    isSubscribedRef.current = false;
  }, [deviceId]);

  const run = useCallback(() => {
    wsManager.current.send({ type: 'scopeRun', deviceId });
  }, [deviceId]);

  const stop = useCallback(() => {
    wsManager.current.send({ type: 'scopeStop', deviceId });
  }, [deviceId]);

  const single = useCallback(() => {
    wsManager.current.send({ type: 'scopeSingle', deviceId });
  }, [deviceId]);

  const autoSetup = useCallback(() => {
    wsManager.current.send({ type: 'scopeAutoSetup', deviceId });
  }, [deviceId]);

  const getWaveform = useCallback((channel: string) => {
    wsManager.current.send({ type: 'scopeGetWaveform', deviceId, channel });
  }, [deviceId]);

  const getMeasurement = useCallback((channel: string, measurementType: string) => {
    wsManager.current.send({ type: 'scopeGetMeasurement', deviceId, channel, measurementType });
  }, [deviceId]);

  const getScreenshot = useCallback(() => {
    wsManager.current.send({ type: 'scopeGetScreenshot', deviceId });
  }, [deviceId]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Channel settings
  const setChannelEnabled = useCallback((channel: string, enabled: boolean) => {
    wsManager.current.send({ type: 'scopeSetChannelEnabled', deviceId, channel, enabled });
  }, [deviceId]);

  const setChannelScale = useCallback((channel: string, scale: number) => {
    wsManager.current.send({ type: 'scopeSetChannelScale', deviceId, channel, scale });
  }, [deviceId]);

  const setChannelOffset = useCallback((channel: string, offset: number) => {
    wsManager.current.send({ type: 'scopeSetChannelOffset', deviceId, channel, offset });
  }, [deviceId]);

  const setChannelCoupling = useCallback((channel: string, coupling: 'AC' | 'DC' | 'GND') => {
    wsManager.current.send({ type: 'scopeSetChannelCoupling', deviceId, channel, coupling });
  }, [deviceId]);

  const setChannelProbe = useCallback((channel: string, ratio: number) => {
    wsManager.current.send({ type: 'scopeSetChannelProbe', deviceId, channel, ratio });
  }, [deviceId]);

  const setChannelBwLimit = useCallback((channel: string, enabled: boolean) => {
    wsManager.current.send({ type: 'scopeSetChannelBwLimit', deviceId, channel, enabled });
  }, [deviceId]);

  // Timebase settings
  const setTimebaseScale = useCallback((scale: number) => {
    wsManager.current.send({ type: 'scopeSetTimebaseScale', deviceId, scale });
  }, [deviceId]);

  const setTimebaseOffset = useCallback((offset: number) => {
    wsManager.current.send({ type: 'scopeSetTimebaseOffset', deviceId, offset });
  }, [deviceId]);

  // Trigger settings
  const setTriggerSource = useCallback((source: string) => {
    wsManager.current.send({ type: 'scopeSetTriggerSource', deviceId, source });
  }, [deviceId]);

  const setTriggerLevel = useCallback((level: number) => {
    wsManager.current.send({ type: 'scopeSetTriggerLevel', deviceId, level });
  }, [deviceId]);

  const setTriggerEdge = useCallback((edge: 'rising' | 'falling' | 'either') => {
    wsManager.current.send({ type: 'scopeSetTriggerEdge', deviceId, edge });
  }, [deviceId]);

  const setTriggerSweep = useCallback((sweep: 'auto' | 'normal' | 'single') => {
    wsManager.current.send({ type: 'scopeSetTriggerSweep', deviceId, sweep });
  }, [deviceId]);

  // Streaming
  const startStreaming = useCallback((channels: string[], intervalMs: number, measurements?: string[]) => {
    wsManager.current.send({ type: 'scopeStartStreaming', deviceId, channels, intervalMs, measurements });
    setIsStreaming(true);
  }, [deviceId]);

  const stopStreaming = useCallback(() => {
    wsManager.current.send({ type: 'scopeStopStreaming', deviceId });
    setIsStreaming(false);
  }, [deviceId]);

  return {
    state,
    connectionState,
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
    getMeasurement,
    getScreenshot,
    clearError,
    setChannelEnabled,
    setChannelScale,
    setChannelOffset,
    setChannelCoupling,
    setChannelProbe,
    setChannelBwLimit,
    setTimebaseScale,
    setTimebaseOffset,
    setTriggerSource,
    setTriggerLevel,
    setTriggerEdge,
    setTriggerSweep,
    startStreaming,
    stopStreaming,
  };
}
