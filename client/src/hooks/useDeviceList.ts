/**
 * useDeviceList - React hook for getting device list via WebSocket
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { getWebSocketManager } from '../websocket';
import type { DeviceSummary, StandardDeviceSummary, ServerMessage } from '../../../shared/types';
import { isStandardDevice } from '../../../shared/types';

export interface UseDeviceListResult {
  /** All devices (PSU/loads and oscilloscopes) */
  devices: DeviceSummary[];
  /** Only PSU/load devices (filtered, with DeviceCapabilities) */
  standardDevices: StandardDeviceSummary[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
  scan: () => void;
}

export function useDeviceList(): UseDeviceListResult {
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtered list of standard devices only (PSU/loads)
  const standardDevices = useMemo(
    () => devices.filter(isStandardDevice),
    [devices]
  );

  useEffect(() => {
    const wsManager = getWebSocketManager();

    // Handle incoming messages
    const unsubscribeMessage = wsManager.onMessage((message: ServerMessage) => {
      if (message.type === 'deviceList') {
        setDevices(message.devices);
        setIsLoading(false);
        setError(null);
      } else if (message.type === 'error' && !('deviceId' in message && message.deviceId)) {
        setError(message.message);
        setIsLoading(false);
      }
    });

    // Re-request device list when connection is restored
    const unsubscribeState = wsManager.onStateChange((state) => {
      if (state === 'connected') {
        wsManager.send({ type: 'getDevices' });
      }
    });

    // Connect and request initial device list
    wsManager.connect();
    wsManager.send({ type: 'getDevices' });

    return () => {
      unsubscribeMessage();
      unsubscribeState();
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
    standardDevices,
    isLoading,
    error,
    refresh,
    scan,
  };
}
