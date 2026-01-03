/**
 * useDeviceSocket - React hook for device state via WebSocket
 *
 * Thin wrapper around the Zustand deviceStore.
 * Provides a convenient hook interface for components that manage a single device.
 *
 * State management is delegated to the Zustand store - no duplicate local state.
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
  setValue: (name: string, value: number, immediate?: boolean) => void;
  clearError: () => void;
}

export function useDeviceSocket(deviceId: string): UseDeviceSocketResult {
  // Get state from Zustand store using selectors
  const state = useDeviceStore(selectDeviceState(deviceId));
  const connectionState = useDeviceStore((s) => s.connectionState);
  const isSubscribed = useDeviceStore(selectIsSubscribed(deviceId));
  const error = useDeviceStore(selectDeviceError(deviceId));

  // Get store actions
  const connect = useDeviceStore((s) => s.connect);
  const subscribeDevice = useDeviceStore((s) => s.subscribeDevice);
  const unsubscribeDevice = useDeviceStore((s) => s.unsubscribeDevice);
  const setModeAction = useDeviceStore((s) => s.setMode);
  const setOutputAction = useDeviceStore((s) => s.setOutput);
  const setValueAction = useDeviceStore((s) => s.setValue);
  const clearDeviceError = useDeviceStore((s) => s.clearDeviceError);

  // Connect WebSocket on mount
  useEffect(() => {
    connect();
  }, [connect]);

  // Stable callbacks that delegate to store actions
  const subscribe = useCallback(() => {
    subscribeDevice(deviceId);
  }, [subscribeDevice, deviceId]);

  const unsubscribe = useCallback(() => {
    unsubscribeDevice(deviceId);
  }, [unsubscribeDevice, deviceId]);

  const setMode = useCallback((mode: string) => {
    setModeAction(deviceId, mode);
  }, [setModeAction, deviceId]);

  const setOutput = useCallback((enabled: boolean) => {
    setOutputAction(deviceId, enabled);
  }, [setOutputAction, deviceId]);

  const setValue = useCallback((name: string, value: number, immediate = false) => {
    setValueAction(deviceId, name, value, immediate);
  }, [setValueAction, deviceId]);

  const clearError = useCallback(() => {
    clearDeviceError(deviceId);
  }, [clearDeviceError, deviceId]);

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
    clearError,
  };
}
