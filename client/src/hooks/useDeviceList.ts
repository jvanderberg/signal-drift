/**
 * useDeviceList - React hook for getting device list via WebSocket
 */

import { useState, useEffect, useCallback } from 'react';
import { getWebSocketManager } from '../websocket';
import type { DeviceSummary, ServerMessage } from '../../../shared/types';

export interface UseDeviceListResult {
  devices: DeviceSummary[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
  scan: () => void;
}

export function useDeviceList(): UseDeviceListResult {
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const wsManager = getWebSocketManager();

    // Handle incoming messages
    const unsubscribe = wsManager.onMessage((message: ServerMessage) => {
      if (message.type === 'deviceList') {
        setDevices(message.devices);
        setIsLoading(false);
        setError(null);
      } else if (message.type === 'error' && !('deviceId' in message && message.deviceId)) {
        setError(message.message);
        setIsLoading(false);
      }
    });

    // Connect and request initial device list
    wsManager.connect();
    wsManager.send({ type: 'getDevices' });

    return () => {
      unsubscribe();
    };
  }, []);

  const refresh = useCallback(() => {
    setIsLoading(true);
    getWebSocketManager().send({ type: 'getDevices' });
  }, []);

  const scan = useCallback(() => {
    setIsLoading(true);
    getWebSocketManager().send({ type: 'scan' });
  }, []);

  return {
    devices,
    isLoading,
    error,
    refresh,
    scan,
  };
}
