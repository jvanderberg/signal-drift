import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api';
import type { Device, DeviceStatus, HistoryData } from '../types';

interface UseDeviceOptions {
  historyWindowMinutes?: number;
}

interface UseDeviceResult {
  status: DeviceStatus | null;
  history: HistoryData;
  isConnected: boolean;
  isPolling: boolean;
  consecutiveFailures: number;
  connect: () => Promise<void>;
  disconnect: () => void;
  setMode: (mode: string) => Promise<void>;
  setOutput: (enabled: boolean) => Promise<void>;
  setValue: (name: string, value: number) => Promise<void>;
  setHistoryWindow: (minutes: number) => void;
}

const MAX_CONSECUTIVE_FAILURES = 3;

export function useDevice(device: Device | null, options: UseDeviceOptions = {}): UseDeviceResult {
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [history, setHistory] = useState<HistoryData>({
    timestamps: [],
    voltage: [],
    current: [],
    power: [],
    resistance: [],
  });
  const [isConnected, setIsConnected] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  const [historyWindow, setHistoryWindow] = useState(options.historyWindowMinutes ?? 2);

  const pollingRef = useRef(false);

  // Sequential polling - wait for previous request to complete
  const poll = useCallback(async () => {
    if (!device || !pollingRef.current) return;

    try {
      const newStatus = await api.getStatus(device.id);
      setConsecutiveFailures(0);

      // Only update measurements and output state - mode/setpoints are user-controlled
      setStatus(prev => prev ? {
        ...prev,
        measurements: newStatus.measurements,
        outputEnabled: newStatus.outputEnabled,
      } : newStatus);

      // Always update history with measurements
      const now = Date.now();
      const cutoff = now - historyWindow * 60 * 1000;

      setHistory(prev => {
          const newHistory: HistoryData = {
            timestamps: [...prev.timestamps, now].filter(t => t > cutoff),
            voltage: [...prev.voltage, newStatus.measurements.voltage ?? 0].slice(-(prev.timestamps.length + 1)),
            current: [...prev.current, newStatus.measurements.current ?? 0].slice(-(prev.timestamps.length + 1)),
            power: [...prev.power, newStatus.measurements.power ?? 0].slice(-(prev.timestamps.length + 1)),
          };

          // Trim to match timestamps length
          const len = newHistory.timestamps.length;
          newHistory.voltage = newHistory.voltage.slice(-len);
          newHistory.current = newHistory.current.slice(-len);
          newHistory.power = newHistory.power.slice(-len);

          if (newStatus.measurements.resistance !== undefined) {
            newHistory.resistance = [...(prev.resistance ?? []), newStatus.measurements.resistance].slice(-len);
          }

          return newHistory;
        });

      // Schedule next poll
      if (pollingRef.current) {
        setTimeout(poll, 250);
      }
    } catch (err) {
      const failures = consecutiveFailures + 1;
      setConsecutiveFailures(failures);

      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        // Auto-disconnect after too many failures
        pollingRef.current = false;
        setIsPolling(false);
        setIsConnected(false);
        console.error('Disconnected due to consecutive failures');
      } else if (pollingRef.current) {
        // Retry after delay
        setTimeout(poll, 1000);
      }
    }
  }, [device, historyWindow, consecutiveFailures]);

  const connect = useCallback(async () => {
    if (!device) return;

    try {
      // Get initial status
      const initialStatus = await api.getStatus(device.id);
      setStatus(initialStatus);
      setIsConnected(true);
      setConsecutiveFailures(0);

      // Clear history
      setHistory({
        timestamps: [],
        voltage: [],
        current: [],
        power: [],
        resistance: [],
      });

      // Start polling
      pollingRef.current = true;
      setIsPolling(true);
      poll();
    } catch (err) {
      console.error('Failed to connect:', err);
      throw err;
    }
  }, [device, poll]);

  const disconnect = useCallback(() => {
    pollingRef.current = false;
    setIsPolling(false);
    setIsConnected(false);
    setStatus(null);
  }, []);

  const setMode = useCallback(async (mode: string) => {
    if (!device) return;
    // Optimistic update mode immediately
    setStatus(prev => prev ? { ...prev, mode } : null);
    await api.setMode(device.id, mode);
    // Fetch new setpoint from device after mode change
    const newStatus = await api.getStatus(device.id);
    setStatus(prev => prev ? {
      ...prev,
      setpoints: newStatus.setpoints
    } : newStatus);
  }, [device]);

  const setOutput = useCallback(async (enabled: boolean) => {
    if (!device) return;
    // Optimistic update
    setStatus(prev => prev ? { ...prev, outputEnabled: enabled } : null);
    await api.setOutput(device.id, enabled);
  }, [device]);

  const setValue = useCallback(async (name: string, value: number) => {
    if (!device) return;
    // Optimistic update
    setStatus(prev => prev ? {
      ...prev,
      setpoints: { ...prev.setpoints, [name]: value }
    } : null);
    await api.setValues(device.id, { [name]: value });
  }, [device]);

  // Cleanup on unmount or device change
  useEffect(() => {
    return () => {
      pollingRef.current = false;
    };
  }, [device]);

  return {
    status,
    history,
    isConnected,
    isPolling,
    consecutiveFailures,
    connect,
    disconnect,
    setMode,
    setOutput,
    setValue,
    setHistoryWindow,
  };
}
