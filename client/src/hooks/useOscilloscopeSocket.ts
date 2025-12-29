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
import type { ServerMessage, OscilloscopeStatus, WaveformData } from '../../../shared/types';

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
  screenshot: string | null;  // base64 PNG

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
}

export function useOscilloscopeSocket(deviceId: string): UseOscilloscopeSocketResult {
  const [state, setState] = useState<OscilloscopeSessionState | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waveform, setWaveform] = useState<WaveformData | null>(null);
  const [screenshot, setScreenshot] = useState<string | null>(null);

  const wsManager = useRef(getWebSocketManager());
  const isSubscribedRef = useRef(false);

  // Handle incoming messages
  useEffect(() => {
    const manager = wsManager.current;

    // Set up connection state tracking
    const unsubscribeState = manager.onStateChange((newState) => {
      setConnectionState(newState);
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
          }
          break;

        case 'scopeScreenshot':
          if (message.deviceId === deviceId) {
            setScreenshot(message.data);
          }
          break;

        case 'scopeMeasurement':
          // Could store measurements if needed
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

  return {
    state,
    connectionState,
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
    getMeasurement,
    getScreenshot,
    clearError,
  };
}
