/**
 * DeviceSession - Manages state and polling for a single device
 *
 * - Starts polling immediately when created (on device discovery)
 * - Polls device every pollIntervalMs via driver.getStatus()
 * - Maintains history buffer (configurable window)
 * - Continues polling regardless of subscriber count
 * - Notifies subscribers on state changes
 * - Handles actions: setMode, setOutput, setValue (with debounce)
 */

import type { DeviceDriver, DeviceStatus } from '../devices/types.js';
import type {
  DeviceSessionState,
  ConnectionStatus,
  HistoryData,
  ServerMessage,
  MeasurementUpdate,
} from '../../shared/types.js';

export interface DeviceSessionConfig {
  pollIntervalMs?: number;
  historyWindowMs?: number;
  maxConsecutiveErrors?: number;
  debounceMs?: number;
}

type SubscriberCallback = (message: ServerMessage) => void;

export interface DeviceSession {
  getState(): DeviceSessionState;
  getSubscriberCount(): number;
  hasSubscriber(clientId: string): boolean;
  subscribe(clientId: string, callback: SubscriberCallback): void;
  unsubscribe(clientId: string): void;
  setMode(mode: string): Promise<void>;
  setOutput(enabled: boolean): Promise<void>;
  setValue(name: string, value: number, immediate?: boolean): Promise<void>;
  reconnect(newDriver: DeviceDriver): Promise<void>;
  stop(): void;
}

const DEFAULT_CONFIG: Required<DeviceSessionConfig> = {
  pollIntervalMs: 250,
  historyWindowMs: 30 * 60 * 1000, // 30 minutes
  maxConsecutiveErrors: 10,
  debounceMs: 250,
};

export function createDeviceSession(
  initialDriver: DeviceDriver,
  config: DeviceSessionConfig = {}
): DeviceSession {
  const cfg: Required<DeviceSessionConfig> = { ...DEFAULT_CONFIG, ...config };

  // Driver (can be replaced on reconnect)
  let driver = initialDriver;

  // State
  let mode = '';
  let outputEnabled = false;
  let setpoints: Record<string, number> = {};
  let measurements: Record<string, number> = {};
  let listRunning = false;
  let connectionStatus: ConnectionStatus = 'connected';
  let consecutiveErrors = 0;
  let lastUpdated = Date.now();

  const history: HistoryData = {
    timestamps: [],
    voltage: [],
    current: [],
    power: [],
    resistance: [],
  };

  // Subscribers
  const subscribers = new Map<string, SubscriberCallback>();

  // Polling control
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let isRunning = true;
  let pollInProgress: Promise<void> | null = null;

  // Debounce state for setValue
  const pendingValues = new Map<string, { value: number; timer: ReturnType<typeof setTimeout> }>();

  // Helper: Broadcast message to all subscribers
  function broadcast(message: ServerMessage): void {
    for (const callback of subscribers.values()) {
      try {
        callback(message);
      } catch (err) {
        console.error('Subscriber callback error:', err);
      }
    }
  }

  // Helper: Trim history to window
  function trimHistory(): void {
    const cutoff = Date.now() - cfg.historyWindowMs;
    let trimIndex = 0;

    while (trimIndex < history.timestamps.length && history.timestamps[trimIndex] < cutoff) {
      trimIndex++;
    }

    if (trimIndex > 0) {
      history.timestamps = history.timestamps.slice(trimIndex);
      history.voltage = history.voltage.slice(trimIndex);
      history.current = history.current.slice(trimIndex);
      history.power = history.power.slice(trimIndex);
      if (history.resistance) {
        history.resistance = history.resistance.slice(trimIndex);
      }
    }
  }

  // Helper: Add measurement to history
  function addToHistory(timestamp: number, meas: Record<string, number>): void {
    history.timestamps.push(timestamp);
    history.voltage.push(meas.voltage ?? 0);
    history.current.push(meas.current ?? 0);
    history.power.push(meas.power ?? 0);
    if (meas.resistance !== undefined) {
      if (!history.resistance) {
        history.resistance = [];
      }
      history.resistance.push(meas.resistance);
    }
    trimHistory();
  }

  // Internal poll implementation
  async function doPoll(): Promise<void> {
    if (!isRunning) return;

    try {
      const status = await driver.getStatus();
      const now = Date.now();

      // Check for mode change and broadcast
      if (status.mode !== mode) {
        mode = status.mode;
        broadcast({
          type: 'field',
          deviceId: driver.info.id,
          field: 'mode',
          value: mode,
        });
      }

      // Check for output state change and broadcast
      if (status.outputEnabled !== outputEnabled) {
        outputEnabled = status.outputEnabled;
        broadcast({
          type: 'field',
          deviceId: driver.info.id,
          field: 'outputEnabled',
          value: outputEnabled,
        });
      }

      // Update remaining state
      setpoints = status.setpoints;
      measurements = status.measurements;
      listRunning = status.listRunning ?? false;
      lastUpdated = now;

      // Reset errors on success
      if (consecutiveErrors > 0 || connectionStatus !== 'connected') {
        consecutiveErrors = 0;
        connectionStatus = 'connected';
        broadcast({
          type: 'field',
          deviceId: driver.info.id,
          field: 'connectionStatus',
          value: 'connected',
        });
      }

      // Add to history
      addToHistory(now, measurements);

      // Notify subscribers
      const update: MeasurementUpdate = {
        timestamp: now,
        measurements: { ...measurements },
      };
      broadcast({
        type: 'measurement',
        deviceId: driver.info.id,
        update,
      });
    } catch (err) {
      consecutiveErrors++;
      lastUpdated = Date.now();

      // Check for fatal device errors that indicate immediate disconnection
      const isFatalError = err instanceof Error && (
        // USB errors
        err.message.includes('LIBUSB_ERROR_NO_DEVICE') ||
        err.message.includes('LIBUSB_ERROR_IO') ||
        err.message.includes('LIBUSB_ERROR_PIPE') ||
        // Serial port errors
        err.message.includes('SERIAL_PORT_DISCONNECTED') ||
        err.message.includes('SERIAL_PORT_ERROR')
      );

      if (isFatalError || consecutiveErrors >= cfg.maxConsecutiveErrors) {
        connectionStatus = 'disconnected';
        broadcast({
          type: 'field',
          deviceId: driver.info.id,
          field: 'connectionStatus',
          value: 'disconnected',
        });
        console.log(`[Session] DISCONNECTED: ${driver.info.id}`, isFatalError ? '(device removed)' : `(${consecutiveErrors} consecutive errors)`);
      } else if (connectionStatus === 'connected') {
        connectionStatus = 'error';
        broadcast({
          type: 'field',
          deviceId: driver.info.id,
          field: 'connectionStatus',
          value: 'error',
        });
        console.error(`Poll error for ${driver.info.id}:`, err);
      }
    }

    // Schedule next poll
    if (isRunning && connectionStatus !== 'disconnected') {
      pollTimer = setTimeout(poll, cfg.pollIntervalMs);
    } else {
      pollTimer = null;
    }
  }

  // Poll wrapper that tracks when poll is in progress
  function poll(): void {
    pollInProgress = doPoll().finally(() => {
      pollInProgress = null;
    });
  }

  // Wait for any in-flight poll to complete
  async function waitForPoll(): Promise<void> {
    if (pollInProgress) {
      await pollInProgress;
    }
  }

  // Actions
  async function setModeAction(newMode: string): Promise<void> {
    // Save old value for rollback
    const oldMode = mode;

    // Optimistic update - notify before hardware execution
    mode = newMode;
    broadcast({
      type: 'field',
      deviceId: driver.info.id,
      field: 'mode',
      value: newMode,
    });

    try {
      await driver.setMode(newMode);
    } catch (err) {
      console.error('setMode error:', err);
      // Rollback to previous value
      mode = oldMode;
      broadcast({
        type: 'field',
        deviceId: driver.info.id,
        field: 'mode',
        value: oldMode,
      });
      throw err;
    }
  }

  async function setOutputAction(enabled: boolean): Promise<void> {
    // Save old value for rollback
    const oldEnabled = outputEnabled;

    // Optimistic update
    outputEnabled = enabled;
    broadcast({
      type: 'field',
      deviceId: driver.info.id,
      field: 'outputEnabled',
      value: enabled,
    });

    try {
      await driver.setOutput(enabled);
    } catch (err) {
      console.error('setOutput error:', err);
      // Rollback to previous value
      outputEnabled = oldEnabled;
      broadcast({
        type: 'field',
        deviceId: driver.info.id,
        field: 'outputEnabled',
        value: oldEnabled,
      });
      throw err;
    }
  }

  async function setValueAction(name: string, value: number, immediate = false): Promise<void> {
    if (immediate) {
      // Save old value before updating
      const oldValue = setpoints[name];

      // Optimistic update
      setpoints = { ...setpoints, [name]: value };
      broadcast({
        type: 'field',
        deviceId: driver.info.id,
        field: 'setpoints',
        value: { ...setpoints },
      });

      try {
        await driver.setValue(name, value);
      } catch (err) {
        console.error('setValue error:', err);

        // Read back actual value from device (if driver supports it)
        let actualValue = oldValue;
        if (driver.getValue) {
          try {
            actualValue = await driver.getValue(name);
          } catch {
            // Fall back to oldValue
          }
        }

        // Revert to actual device value and broadcast
        setpoints = { ...setpoints, [name]: actualValue };
        broadcast({
          type: 'field',
          deviceId: driver.info.id,
          field: 'setpoints',
          value: { ...setpoints },
        });
        throw err;
      }
      return;
    }

    // Debounced execution
    const existing = pendingValues.get(name);
    if (existing) {
      clearTimeout(existing.timer);
    }

    const timer = setTimeout(async () => {
      pendingValues.delete(name);

      // Save old value before updating
      const oldValue = setpoints[name];
      console.log(`[Session] setValue debounce fired: ${name} = ${value} (oldValue: ${oldValue})`);

      // Optimistic update
      setpoints = { ...setpoints, [name]: value };
      console.log(`[Session] Broadcasting optimistic setpoints:`, { ...setpoints });
      broadcast({
        type: 'field',
        deviceId: driver.info.id,
        field: 'setpoints',
        value: { ...setpoints },
      });

      try {
        await driver.setValue(name, value);
        console.log(`[Session] driver.setValue succeeded for ${name} = ${value}`);
      } catch (err) {
        console.error(`[Session] driver.setValue FAILED for ${name} = ${value}:`, err);

        // Read back actual value from device (if driver supports it)
        let actualValue = oldValue;
        if (driver.getValue) {
          try {
            actualValue = await driver.getValue(name);
            console.log(`[Session] Read back actual value from device: ${name} = ${actualValue}`);
          } catch (readErr) {
            console.error(`[Session] Failed to read back value, using oldValue:`, readErr);
          }
        }

        // Revert to actual device value and broadcast
        setpoints = { ...setpoints, [name]: actualValue };
        console.log(`[Session] Broadcasting reverted setpoints:`, { ...setpoints });
        broadcast({
          type: 'field',
          deviceId: driver.info.id,
          field: 'setpoints',
          value: { ...setpoints },
        });
        // Notify subscribers of the error (can't re-throw from setTimeout)
        broadcast({
          type: 'error',
          deviceId: driver.info.id,
          code: 'SET_VALUE_FAILED',
          message: err instanceof Error ? err.message : 'Failed to set value',
        });
      }
    }, cfg.debounceMs);

    pendingValues.set(name, { value, timer });
  }

  async function reconnect(newDriver: DeviceDriver): Promise<void> {
    console.log(`[Session] reconnect() called for ${newDriver.info.id}, pollTimer=${!!pollTimer}, isRunning=${isRunning}`);

    // Wait for any in-flight poll to complete before swapping driver
    await waitForPoll();

    // Replace driver with fresh one
    driver = newDriver;

    // Reset error state
    consecutiveErrors = 0;
    connectionStatus = 'connected';

    // Notify subscribers of reconnection
    broadcast({
      type: 'field',
      deviceId: driver.info.id,
      field: 'connectionStatus',
      value: 'connected',
    });

    // Resume polling if not already running
    if (!pollTimer && isRunning) {
      console.log(`[Session] Resuming polling for ${driver.info.id}`);
      poll();
    } else {
      console.log(`[Session] NOT resuming polling: pollTimer=${!!pollTimer}, isRunning=${isRunning}`);
    }
  }

  function stop(): void {
    isRunning = false;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    // Clear any pending debounced values
    for (const pending of pendingValues.values()) {
      clearTimeout(pending.timer);
    }
    pendingValues.clear();
  }

  function getState(): DeviceSessionState {
    // Note: We return direct references instead of copying since this data
    // is immediately serialized to JSON for WebSocket transmission.
    // Callers should not mutate the returned object.
    return {
      info: driver.info,
      capabilities: driver.capabilities,
      connectionStatus,
      consecutiveErrors,
      mode,
      outputEnabled,
      setpoints,
      measurements,
      listRunning,
      history,
      lastUpdated,
    };
  }

  function subscribe(clientId: string, callback: SubscriberCallback): void {
    subscribers.set(clientId, callback);
  }

  function unsubscribe(clientId: string): void {
    subscribers.delete(clientId);
  }

  function getSubscriberCount(): number {
    return subscribers.size;
  }

  function hasSubscriber(clientId: string): boolean {
    return subscribers.has(clientId);
  }

  // Start polling immediately
  poll();

  return {
    getState,
    getSubscriberCount,
    hasSubscriber,
    subscribe,
    unsubscribe,
    setMode: setModeAction,
    setOutput: setOutputAction,
    setValue: setValueAction,
    reconnect,
    stop,
  };
}
