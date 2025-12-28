/**
 * SessionManager - Creates and manages DeviceSession instances
 *
 * - One session per device (sessions persist through disconnects)
 * - Creates session on device discovery
 * - Sessions stay alive when disconnected, reconnect when device returns
 * - Provides device summaries for listing
 */

import type { DeviceRegistry } from '../devices/registry.js';
import type { DeviceDriver } from '../devices/types.js';
import type { DeviceSummary, ServerMessage } from '../../shared/types.js';
import { createDeviceSession, DeviceSession, DeviceSessionConfig } from './DeviceSession.js';

export interface SessionManagerConfig extends DeviceSessionConfig {
  scanIntervalMs?: number;
}

type SubscriberCallback = (message: ServerMessage) => void;

export interface SessionManager {
  syncDevices(): Promise<void>;
  hasSession(deviceId: string): boolean;
  isSessionDisconnected(deviceId: string): boolean;
  reconnectSession(deviceId: string, newDriver: DeviceDriver): void;
  getSession(deviceId: string): DeviceSession | undefined;
  getSessionCount(): number;
  getDeviceSummaries(): DeviceSummary[];

  subscribe(deviceId: string, clientId: string, callback: SubscriberCallback): boolean;
  unsubscribe(deviceId: string, clientId: string): void;
  unsubscribeAll(clientId: string): void;
  isSubscribed(deviceId: string, clientId: string): boolean;

  setMode(deviceId: string, mode: string): Promise<void>;
  setOutput(deviceId: string, enabled: boolean): Promise<void>;
  setValue(deviceId: string, name: string, value: number, immediate?: boolean): Promise<void>;

  stop(): void;
}

const DEFAULT_SCAN_INTERVAL = 10000; // 10 seconds

export function createSessionManager(
  registry: DeviceRegistry,
  config: SessionManagerConfig = {}
): SessionManager {
  const sessions = new Map<string, DeviceSession>();
  const sessionConfig: DeviceSessionConfig = {
    pollIntervalMs: config.pollIntervalMs,
    historyWindowMs: config.historyWindowMs,
    maxConsecutiveErrors: config.maxConsecutiveErrors,
    debounceMs: config.debounceMs,
  };

  let scanTimer: ReturnType<typeof setInterval> | null = null;
  let isRunning = true;

  // Sync sessions with registry - only creates new sessions, never removes
  async function syncDevices(): Promise<void> {
    if (!isRunning) return;

    // Add sessions for new devices
    const currentDevices = registry.getDevices();
    for (const driver of currentDevices) {
      if (!sessions.has(driver.info.id)) {
        console.log(`[SessionManager] Creating session for: ${driver.info.id}`);
        const session = createDeviceSession(driver, sessionConfig);
        sessions.set(driver.info.id, session);
      }
    }
  }

  // Start auto-sync if configured
  if (config.scanIntervalMs !== undefined) {
    scanTimer = setInterval(syncDevices, config.scanIntervalMs);
  }

  function hasSession(deviceId: string): boolean {
    return sessions.has(deviceId);
  }

  function isSessionDisconnected(deviceId: string): boolean {
    const session = sessions.get(deviceId);
    return session ? session.getState().connectionStatus === 'disconnected' : false;
  }

  function reconnectSession(deviceId: string, newDriver: DeviceDriver): void {
    const session = sessions.get(deviceId);
    if (session) {
      session.reconnect(newDriver);
    }
  }

  function getSession(deviceId: string): DeviceSession | undefined {
    return sessions.get(deviceId);
  }

  function getSessionCount(): number {
    return sessions.size;
  }

  function getDeviceSummaries(): DeviceSummary[] {
    const summaries: DeviceSummary[] = [];
    for (const session of sessions.values()) {
      const state = session.getState();
      summaries.push({
        id: state.info.id,
        info: state.info,
        capabilities: state.capabilities,
        connectionStatus: state.connectionStatus,
      });
    }
    return summaries;
  }

  function subscribe(
    deviceId: string,
    clientId: string,
    callback: SubscriberCallback
  ): boolean {
    const session = sessions.get(deviceId);
    if (!session) {
      return false;
    }
    session.subscribe(clientId, callback);
    return true;
  }

  function unsubscribe(deviceId: string, clientId: string): void {
    const session = sessions.get(deviceId);
    if (session) {
      session.unsubscribe(clientId);
    }
  }

  function unsubscribeAll(clientId: string): void {
    for (const session of sessions.values()) {
      session.unsubscribe(clientId);
    }
  }

  function isSubscribed(deviceId: string, clientId: string): boolean {
    const session = sessions.get(deviceId);
    return session ? session.hasSubscriber(clientId) : false;
  }

  async function setMode(deviceId: string, mode: string): Promise<void> {
    const session = sessions.get(deviceId);
    if (!session) {
      throw new Error(`Session not found: ${deviceId}`);
    }
    await session.setMode(mode);
  }

  async function setOutput(deviceId: string, enabled: boolean): Promise<void> {
    const session = sessions.get(deviceId);
    if (!session) {
      throw new Error(`Session not found: ${deviceId}`);
    }
    await session.setOutput(enabled);
  }

  async function setValue(
    deviceId: string,
    name: string,
    value: number,
    immediate = false
  ): Promise<void> {
    const session = sessions.get(deviceId);
    if (!session) {
      throw new Error(`Session not found: ${deviceId}`);
    }
    await session.setValue(name, value, immediate);
  }

  function stop(): void {
    isRunning = false;

    if (scanTimer) {
      clearInterval(scanTimer);
      scanTimer = null;
    }

    for (const session of sessions.values()) {
      session.stop();
    }
    sessions.clear();
  }

  return {
    syncDevices,
    hasSession,
    isSessionDisconnected,
    reconnectSession,
    getSession,
    getSessionCount,
    getDeviceSummaries,
    subscribe,
    unsubscribe,
    unsubscribeAll,
    isSubscribed,
    setMode,
    setOutput,
    setValue,
    stop,
  };
}
