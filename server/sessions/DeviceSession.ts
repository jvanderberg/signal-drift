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
  Result,
} from '../../shared/types.js';
import { Ok, Err } from '../../shared/types.js';

export interface DeviceSessionConfig {
  pollIntervalMs?: number;
  historyWindowMs?: number;
  maxConsecutiveErrors?: number;
  debounceMs?: number;
  heartbeatIntervalMs?: number;  // Independent heartbeat check interval (default: 10000ms)
}

// Callback to request full teardown and reconnection
export type ForceReconnectCallback = (deviceId: string) => Promise<void>;

type SubscriberCallback = (message: ServerMessage) => void;

export interface DeviceSession {
  getState(): DeviceSessionState;
  getSubscriberCount(): number;
  hasSubscriber(clientId: string): boolean;
  subscribe(clientId: string, callback: SubscriberCallback): void;
  unsubscribe(clientId: string): void;
  setMode(mode: string): Promise<Result<void, Error>>;
  setOutput(enabled: boolean): Promise<Result<void, Error>>;
  setValue(name: string, value: number, immediate?: boolean): Promise<Result<void, Error>>;
  reconnect(newDriver: DeviceDriver): Promise<void>;
  stop(): Promise<void>;
  // Heartbeat control - allows external coordination with scanner
  pauseHeartbeat(): void;
  resumeHeartbeat(): void;
  isHeartbeatPaused(): boolean;
}

const DEFAULT_CONFIG: Required<DeviceSessionConfig> = {
  pollIntervalMs: 250,
  historyWindowMs: 30 * 60 * 1000, // 30 minutes
  maxConsecutiveErrors: 10,
  debounceMs: 250,
  heartbeatIntervalMs: 10000, // 10 seconds - independent health check
};

export function createDeviceSession(
  initialDriver: DeviceDriver,
  config: DeviceSessionConfig = {},
  onForceReconnect?: ForceReconnectCallback
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

  // Heartbeat control - independent health check that runs alongside polling
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatPaused = false;
  let heartbeatInProgress = false;
  let lastHeartbeatSuccess = Date.now();

  // In-flight command tracking - prevents poll from reverting optimistic updates
  // while hardware commands are being processed
  let outputCommandInFlight = false;
  let modeCommandInFlight = false;

  // Helper: Broadcast message to all subscribers
  function broadcast(message: ServerMessage): void {
    const timestampedMessage = { ...message, timestamp: Date.now() };
    for (const callback of subscribers.values()) {
      try {
        callback(timestampedMessage);
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

    const statusResult = await driver.getStatus();
    const now = Date.now();

    if (statusResult.ok) {
      const status = statusResult.value;

      // Check for mode change and broadcast
      // Skip if a setMode command is in flight to prevent reverting optimistic updates
      if (status.mode !== mode && !modeCommandInFlight) {
        mode = status.mode;
        broadcast({
          type: 'field',
          deviceId: driver.info.id,
          field: 'mode',
          value: mode,
        });
      }

      // Check for output state change and broadcast
      // Skip if a setOutput command is in flight to prevent reverting optimistic updates
      if (status.outputEnabled !== outputEnabled && !outputCommandInFlight) {
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
    } else {
      // Handle error
      const err = statusResult.error;
      consecutiveErrors++;
      lastUpdated = Date.now();

      // Check for fatal device errors that indicate immediate disconnection
      const isFatalError = (
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

  // Wait for any in-flight heartbeat to complete (with timeout for safety)
  async function waitForHeartbeat(timeoutMs = 3000): Promise<void> {
    if (!heartbeatInProgress) return;

    const start = Date.now();
    while (heartbeatInProgress && Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, 50));
    }
  }

  /**
   * Heartbeat - Independent health check that verifies device responsiveness
   *
   * Unlike polling which accumulates errors before disconnecting, the heartbeat
   * immediately tears down the connection on failure. This catches "stuck" devices
   * that are technically connected but not responding to commands.
   *
   * The heartbeat coordinates with the scanner via pause/resume to avoid conflicts
   * during reconnection attempts.
   */
  async function doHeartbeat(): Promise<void> {
    // Skip if paused (scanner is running) or already in progress
    if (heartbeatPaused || heartbeatInProgress || !isRunning) {
      return;
    }

    // Skip if already disconnected - scanner will handle reconnection
    if (connectionStatus === 'disconnected') {
      return;
    }

    // Skip if poll is currently in progress to avoid command interleaving
    if (pollInProgress) {
      return;
    }

    heartbeatInProgress = true;

    try {
      // Use getStatus as our heartbeat probe - it's the same as what poll does
      // but we have stricter failure handling
      const result = await driver.getStatus();

      if (result.ok) {
        lastHeartbeatSuccess = Date.now();
        // If we were in error state, heartbeat success doesn't clear it
        // (let the regular polling handle state transitions)
      } else {
        // Heartbeat failure - this is serious
        // If device was working and suddenly fails heartbeat, tear it down
        const timeSinceSuccess = Date.now() - lastHeartbeatSuccess;

        console.error(
          `[Heartbeat] FAILED for ${driver.info.id}: ${result.error.message}` +
          ` (last success ${Math.round(timeSinceSuccess / 1000)}s ago)`
        );

        // Check for fatal errors that indicate device is gone
        const err = result.error;
        const isFatalError = (
          err.message.includes('LIBUSB_ERROR_NO_DEVICE') ||
          err.message.includes('LIBUSB_ERROR_IO') ||
          err.message.includes('LIBUSB_ERROR_PIPE') ||
          err.message.includes('SERIAL_PORT_DISCONNECTED') ||
          err.message.includes('SERIAL_PORT_ERROR') ||
          err.message.includes('Timeout')
        );

        if (isFatalError) {
          // Immediate teardown
          console.log(`[Heartbeat] Forcing disconnect for ${driver.info.id} due to fatal error`);

          // Stop polling
          if (pollTimer) {
            clearTimeout(pollTimer);
            pollTimer = null;
          }

          // Mark as disconnected
          connectionStatus = 'disconnected';
          broadcast({
            type: 'field',
            deviceId: driver.info.id,
            field: 'connectionStatus',
            value: 'disconnected',
          });

          // Close the transport to ensure clean state
          if (driver.disconnect) {
            try {
              await driver.disconnect();
            } catch (closeErr) {
              console.error(`[Heartbeat] Error closing transport: ${closeErr}`);
            }
          }

          // Request reconnection from scanner if callback provided
          if (onForceReconnect) {
            // Don't await - let scanner handle it asynchronously
            Promise.resolve(onForceReconnect(driver.info.id)).catch(err => {
              console.error(`[Heartbeat] Force reconnect callback failed: ${err}`);
            });
          }
        }
      }
    } catch (err) {
      console.error(`[Heartbeat] Unexpected error for ${driver.info.id}:`, err);
    } finally {
      heartbeatInProgress = false;
    }
  }

  // Start heartbeat timer
  function startHeartbeat(): void {
    if (heartbeatTimer || cfg.heartbeatIntervalMs <= 0) {
      return;
    }
    heartbeatTimer = setInterval(() => {
      doHeartbeat().catch(err => {
        console.error(`[Heartbeat] Unhandled error: ${err}`);
      });
    }, cfg.heartbeatIntervalMs);
  }

  // Stop heartbeat timer
  function stopHeartbeat(): void {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  // Pause heartbeat (for scanner coordination)
  function pauseHeartbeat(): void {
    heartbeatPaused = true;
  }

  // Resume heartbeat (after scanner completes)
  function resumeHeartbeat(): void {
    heartbeatPaused = false;
    lastHeartbeatSuccess = Date.now(); // Reset timer after scanner operation
  }

  function isHeartbeatPaused(): boolean {
    return heartbeatPaused;
  }

  // Actions
  async function setModeAction(newMode: string): Promise<Result<void, Error>> {
    // Save old value for rollback
    const oldMode = mode;

    // Mark command as in-flight to prevent poll from reverting optimistic update
    modeCommandInFlight = true;

    // Optimistic update - notify before hardware execution
    mode = newMode;
    broadcast({
      type: 'field',
      deviceId: driver.info.id,
      field: 'mode',
      value: newMode,
    });

    try {
      const result = await driver.setMode(newMode);
      if (!result.ok) {
        console.error('setMode error:', result.error);
        // Rollback to previous value
        mode = oldMode;
        broadcast({
          type: 'field',
          deviceId: driver.info.id,
          field: 'mode',
          value: oldMode,
        });
        return result;
      }
      return Ok();
    } finally {
      modeCommandInFlight = false;
    }
  }

  async function setOutputAction(enabled: boolean): Promise<Result<void, Error>> {
    // Save old value for rollback
    const oldEnabled = outputEnabled;

    // Mark command as in-flight to prevent poll from reverting optimistic update
    outputCommandInFlight = true;

    // Optimistic update
    outputEnabled = enabled;
    broadcast({
      type: 'field',
      deviceId: driver.info.id,
      field: 'outputEnabled',
      value: enabled,
    });

    try {
      const result = await driver.setOutput(enabled);
      if (!result.ok) {
        console.error('setOutput error:', result.error);
        // Rollback to previous value
        outputEnabled = oldEnabled;
        broadcast({
          type: 'field',
          deviceId: driver.info.id,
          field: 'outputEnabled',
          value: oldEnabled,
        });
        return result;
      }
      return Ok();
    } finally {
      outputCommandInFlight = false;
    }
  }

  async function setValueAction(name: string, value: number, immediate = false): Promise<Result<void, Error>> {
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

      const result = await driver.setValue(name, value);
      if (!result.ok) {
        console.error('setValue error:', result.error);

        // Read back actual value from device (if driver supports it)
        let actualValue = oldValue;
        if (driver.getValue) {
          const getResult = await driver.getValue(name);
          if (getResult.ok) {
            actualValue = getResult.value;
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
        return result;
      }
      return Ok();
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

      const result = await driver.setValue(name, value);
      if (result.ok) {
        console.log(`[Session] driver.setValue succeeded for ${name} = ${value}`);
      } else {
        console.error(`[Session] driver.setValue FAILED for ${name} = ${value}:`, result.error);

        // Read back actual value from device (if driver supports it)
        let actualValue = oldValue;
        if (driver.getValue) {
          const getResult = await driver.getValue(name);
          if (getResult.ok) {
            actualValue = getResult.value;
            console.log(`[Session] Read back actual value from device: ${name} = ${actualValue}`);
          } else {
            console.error(`[Session] Failed to read back value, using oldValue:`, getResult.error);
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
          message: result.error.message,
        });
      }
    }, cfg.debounceMs);

    pendingValues.set(name, { value, timer });

    // Debounced: return Ok immediately, actual result comes via broadcast
    return Ok();
  }

  async function reconnect(newDriver: DeviceDriver): Promise<void> {
    console.log(`[Session] reconnect() called for ${newDriver.info.id}, pollTimer=${!!pollTimer}, isRunning=${isRunning}`);

    // Wait for any in-flight poll to complete before swapping driver
    await waitForPoll();

    // Wait for any in-flight heartbeat to complete before swapping driver
    await waitForHeartbeat();

    // Replace driver with fresh one
    driver = newDriver;

    // Reset error state
    consecutiveErrors = 0;
    connectionStatus = 'connected';

    // Reset heartbeat state
    lastHeartbeatSuccess = Date.now();
    heartbeatInProgress = false;

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

  async function stop(): Promise<void> {
    isRunning = false;

    // Stop heartbeat first
    stopHeartbeat();

    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    // Clear any pending debounced values
    for (const pending of pendingValues.values()) {
      clearTimeout(pending.timer);
    }
    pendingValues.clear();

    // Wait for any in-flight operations to complete (with timeout)
    const STOP_TIMEOUT = 3000;
    const waitPromises: Promise<void>[] = [];

    if (pollInProgress) {
      waitPromises.push(pollInProgress);
    }

    if (heartbeatInProgress) {
      waitPromises.push(waitForHeartbeat(STOP_TIMEOUT));
    }

    if (waitPromises.length > 0) {
      await Promise.race([
        Promise.all(waitPromises),
        new Promise<void>(resolve => setTimeout(resolve, STOP_TIMEOUT)),
      ]);
    }
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

  // Start heartbeat monitoring (independent from polling)
  startHeartbeat();

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
    // Heartbeat control - allows external coordination with scanner
    pauseHeartbeat,
    resumeHeartbeat,
    isHeartbeatPaused,
  };
}
