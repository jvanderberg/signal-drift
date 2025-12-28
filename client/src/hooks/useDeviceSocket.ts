/**
 * useDeviceSocket - React hook for device state via WebSocket
 *
 * Replaces useDevice with a dumb mirror of server state.
 * No local state management, just mirrors what the server pushes.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getWebSocketManager, ConnectionState } from '../websocket';
import type { DeviceSessionState, ServerMessage, HistoryData } from '../../../shared/types';

export interface UseDeviceSocketResult {
  state: DeviceSessionState | null;
  connectionState: ConnectionState;
  isSubscribed: boolean;
  error: string | null;

  subscribe: () => void;
  unsubscribe: () => void;
  setMode: (mode: string) => void;
  setOutput: (enabled: boolean) => void;
  setValue: (name: string, value: number, immediate?: boolean) => void;
}

export function useDeviceSocket(deviceId: string): UseDeviceSocketResult {
  const [state, setState] = useState<DeviceSessionState | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
            setState(message.state);
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

        case 'measurement':
          if (message.deviceId === deviceId) {
            setState((prev) => {
              if (!prev) return prev;

              const { timestamp, measurements } = message.update;

              // Update measurements
              const newMeasurements = { ...prev.measurements, ...measurements };

              // Append to history
              const newHistory: HistoryData = {
                timestamps: [...prev.history.timestamps, timestamp],
                voltage: [...prev.history.voltage, measurements.voltage ?? prev.measurements.voltage],
                current: [...prev.history.current, measurements.current ?? prev.measurements.current],
                power: [...prev.history.power, measurements.power ?? prev.measurements.power],
                resistance: measurements.resistance !== undefined
                  ? [...(prev.history.resistance ?? []), measurements.resistance]
                  : prev.history.resistance,
              };

              return {
                ...prev,
                measurements: newMeasurements,
                history: newHistory,
                lastUpdated: timestamp,
              };
            });
          }
          break;

        case 'field':
          if (message.deviceId === deviceId) {
            setState((prev) => {
              if (!prev) return prev;

              const { field, value } = message;

              // Handle known fields
              switch (field) {
                case 'mode':
                  return { ...prev, mode: value as string };
                case 'outputEnabled':
                  return { ...prev, outputEnabled: value as boolean };
                case 'connectionStatus':
                  return { ...prev, connectionStatus: value as DeviceSessionState['connectionStatus'] };
                case 'setpoints':
                  return { ...prev, setpoints: value as Record<string, number> };
                case 'listRunning':
                  return { ...prev, listRunning: value as boolean };
                default:
                  // For unknown fields, try to update generically
                  return { ...prev, [field]: value };
              }
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

  const setMode = useCallback((mode: string) => {
    wsManager.current.send({ type: 'setMode', deviceId, mode });
  }, [deviceId]);

  const setOutput = useCallback((enabled: boolean) => {
    wsManager.current.send({ type: 'setOutput', deviceId, enabled });
  }, [deviceId]);

  const setValue = useCallback((name: string, value: number, immediate = false) => {
    wsManager.current.send({ type: 'setValue', deviceId, name, value, immediate });
  }, [deviceId]);

  return {
    state,
    connectionState,
    isSubscribed,
    error,
    subscribe,
    unsubscribe,
    setMode,
    setOutput,
    setValue,
  };
}
