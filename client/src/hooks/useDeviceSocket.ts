/**
 * useDeviceSocket - React hook for device state via WebSocket
 *
 * Thin wrapper around the Zustand deviceStore.
 * Provides a convenient hook interface for components that manage a single device.
 *
 * State management is delegated to the Zustand store - no duplicate local state.
 * Actions are accessed via getState() to avoid unnecessary subscriptions.
 */

import { useEffect, useCallback } from 'react';
import type { ConnectionState } from '../websocket';
import type { DeviceSessionState } from '../../../shared/types';
import {
  useDeviceStore,
  selectDeviceState,
  selectIsSubscribed,
  selectDeviceError,
} from '../stores';

export interface UseDeviceSocketResult {
  state: DeviceSessionState | null;
  connectionState: ConnectionState;
  isSubscribed: boolean;
  error: string | null;

  subscribe: () => void;
  unsubscribe: () => void;
  setMode: (mode: string) => void;
  setOutput: (enabled: boolean) => void;
  setRemoteSensing: (enabled: boolean) => void;
  setValue: (name: string, value: number, immediate?: boolean) => void;
  clearError: () => void;
}

// Get actions from store without subscribing (actions are stable references)
const getActions = () => {
  const store = useDeviceStore.getState();
  return {
    connect: store.connect,
    subscribeDevice: store.subscribeDevice,
    unsubscribeDevice: store.unsubscribeDevice,
    setMode: store.setMode,
    setOutput: store.setOutput,
    setRemoteSensing: store.setRemoteSensing,
    setValue: store.setValue,
    clearDeviceError: store.clearDeviceError,
  };
};

export function useDeviceSocket(deviceId: string): UseDeviceSocketResult {
  // Get state from Zustand store using selectors (4 subscriptions for reactive state)
  const state = useDeviceStore(selectDeviceState(deviceId));
  const connectionState = useDeviceStore((s) => s.connectionState);
  const isSubscribed = useDeviceStore(selectIsSubscribed(deviceId));
  const error = useDeviceStore(selectDeviceError(deviceId));

  // Connect WebSocket on mount
  useEffect(() => {
    getActions().connect();
  }, []);

  // Stable callbacks that delegate to store actions
  // Using getActions() inside callbacks to avoid subscribing to action changes
  const subscribe = useCallback(() => {
    getActions().subscribeDevice(deviceId);
  }, [deviceId]);

  const unsubscribe = useCallback(() => {
    getActions().unsubscribeDevice(deviceId);
  }, [deviceId]);

  const setMode = useCallback((mode: string) => {
    getActions().setMode(deviceId, mode);
  }, [deviceId]);

  const setOutput = useCallback((enabled: boolean) => {
    getActions().setOutput(deviceId, enabled);
  }, [deviceId]);

  const setRemoteSensing = useCallback((enabled: boolean) => {
    getActions().setRemoteSensing(deviceId, enabled);
  }, [deviceId]);

  const setValue = useCallback((name: string, value: number, immediate = false) => {
    getActions().setValue(deviceId, name, value, immediate);
  }, [deviceId]);

  const clearError = useCallback(() => {
    getActions().clearDeviceError(deviceId);
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
    setRemoteSensing,
    setValue,
    clearError,
  };
}
