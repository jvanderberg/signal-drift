/**
 * SessionManager - Creates and manages DeviceSession instances
 *
 * - One session per device (sessions persist through disconnects)
 * - Creates session on device discovery
 * - Sessions stay alive when disconnected, reconnect when device returns
 * - Provides device summaries for listing
 */

import type { DeviceRegistry } from '../devices/registry.js';
import type { DeviceDriver, OscilloscopeDriver, WaveformData } from '../devices/types.js';
import type { DeviceSummary, ServerMessage } from '../../shared/types.js';
import { createDeviceSession, DeviceSession, DeviceSessionConfig } from './DeviceSession.js';
import { createOscilloscopeSession, OscilloscopeSession } from './OscilloscopeSession.js';

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

  // Standard device actions
  setMode(deviceId: string, mode: string): Promise<void>;
  setOutput(deviceId: string, enabled: boolean): Promise<void>;
  setValue(deviceId: string, name: string, value: number, immediate?: boolean): Promise<void>;

  // Oscilloscope-specific
  getOscilloscopeSession(deviceId: string): OscilloscopeSession | undefined;
  oscilloscopeRun(deviceId: string): Promise<void>;
  oscilloscopeStop(deviceId: string): Promise<void>;
  oscilloscopeSingle(deviceId: string): Promise<void>;
  oscilloscopeAutoSetup(deviceId: string): Promise<void>;
  oscilloscopeGetWaveform(deviceId: string, channel: string): Promise<WaveformData>;
  oscilloscopeGetMeasurement(deviceId: string, channel: string, type: string): Promise<number | null>;
  oscilloscopeGetScreenshot(deviceId: string): Promise<Buffer>;

  stop(): void;
}

const DEFAULT_SCAN_INTERVAL = 10000; // 10 seconds

export function createSessionManager(
  registry: DeviceRegistry,
  config: SessionManagerConfig = {}
): SessionManager {
  const sessions = new Map<string, DeviceSession>();
  const oscilloscopeSessions = new Map<string, OscilloscopeSession>();

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

    // Add sessions for new oscilloscopes
    const currentOscilloscopes = registry.getOscilloscopes();
    for (const driver of currentOscilloscopes) {
      if (!oscilloscopeSessions.has(driver.info.id)) {
        console.log(`[SessionManager] Creating oscilloscope session for: ${driver.info.id}`);
        const session = createOscilloscopeSession(driver);
        oscilloscopeSessions.set(driver.info.id, session);
      }
    }
  }

  // Start auto-sync if configured
  if (config.scanIntervalMs !== undefined) {
    scanTimer = setInterval(syncDevices, config.scanIntervalMs);
  }

  function hasSession(deviceId: string): boolean {
    return sessions.has(deviceId) || oscilloscopeSessions.has(deviceId);
  }

  function isSessionDisconnected(deviceId: string): boolean {
    const session = sessions.get(deviceId);
    if (session) {
      return session.getState().connectionStatus === 'disconnected';
    }
    const scopeSession = oscilloscopeSessions.get(deviceId);
    if (scopeSession) {
      return scopeSession.getState().connectionStatus === 'disconnected';
    }
    return false;
  }

  function reconnectSession(deviceId: string, newDriver: DeviceDriver): void {
    const session = sessions.get(deviceId);
    if (session) {
      session.reconnect(newDriver);
    }
    // Note: oscilloscope reconnection would need OscilloscopeDriver
  }

  function getSession(deviceId: string): DeviceSession | undefined {
    return sessions.get(deviceId);
  }

  function getOscilloscopeSession(deviceId: string): OscilloscopeSession | undefined {
    return oscilloscopeSessions.get(deviceId);
  }

  function getSessionCount(): number {
    return sessions.size + oscilloscopeSessions.size;
  }

  function getDeviceSummaries(): DeviceSummary[] {
    const summaries: DeviceSummary[] = [];

    // Standard devices
    for (const session of sessions.values()) {
      const state = session.getState();
      summaries.push({
        id: state.info.id,
        info: state.info,
        capabilities: state.capabilities,
        connectionStatus: state.connectionStatus,
      });
    }

    // Oscilloscopes
    for (const session of oscilloscopeSessions.values()) {
      const state = session.getState();
      summaries.push({
        id: state.info.id,
        info: state.info,
        capabilities: state.capabilities as any,  // Different capability shape
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
    if (session) {
      session.subscribe(clientId, callback);
      return true;
    }
    const scopeSession = oscilloscopeSessions.get(deviceId);
    if (scopeSession) {
      scopeSession.subscribe(clientId, callback);
      return true;
    }
    return false;
  }

  function unsubscribe(deviceId: string, clientId: string): void {
    const session = sessions.get(deviceId);
    if (session) {
      session.unsubscribe(clientId);
    }
    const scopeSession = oscilloscopeSessions.get(deviceId);
    if (scopeSession) {
      scopeSession.unsubscribe(clientId);
    }
  }

  function unsubscribeAll(clientId: string): void {
    for (const session of sessions.values()) {
      session.unsubscribe(clientId);
    }
    for (const session of oscilloscopeSessions.values()) {
      session.unsubscribe(clientId);
    }
  }

  function isSubscribed(deviceId: string, clientId: string): boolean {
    const session = sessions.get(deviceId);
    if (session) return session.hasSubscriber(clientId);
    const scopeSession = oscilloscopeSessions.get(deviceId);
    if (scopeSession) return scopeSession.hasSubscriber(clientId);
    return false;
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

  // Oscilloscope-specific methods
  async function oscilloscopeRun(deviceId: string): Promise<void> {
    const session = oscilloscopeSessions.get(deviceId);
    if (!session) throw new Error(`Oscilloscope session not found: ${deviceId}`);
    await session.run();
  }

  async function oscilloscopeStop(deviceId: string): Promise<void> {
    const session = oscilloscopeSessions.get(deviceId);
    if (!session) throw new Error(`Oscilloscope session not found: ${deviceId}`);
    await session.stop();
  }

  async function oscilloscopeSingle(deviceId: string): Promise<void> {
    const session = oscilloscopeSessions.get(deviceId);
    if (!session) throw new Error(`Oscilloscope session not found: ${deviceId}`);
    await session.single();
  }

  async function oscilloscopeAutoSetup(deviceId: string): Promise<void> {
    const session = oscilloscopeSessions.get(deviceId);
    if (!session) throw new Error(`Oscilloscope session not found: ${deviceId}`);
    await session.autoSetup();
  }

  async function oscilloscopeGetWaveform(deviceId: string, channel: string): Promise<WaveformData> {
    const session = oscilloscopeSessions.get(deviceId);
    if (!session) throw new Error(`Oscilloscope session not found: ${deviceId}`);
    return session.getWaveform(channel);
  }

  async function oscilloscopeGetMeasurement(deviceId: string, channel: string, type: string): Promise<number | null> {
    const session = oscilloscopeSessions.get(deviceId);
    if (!session) throw new Error(`Oscilloscope session not found: ${deviceId}`);
    return session.getMeasurement(channel, type);
  }

  async function oscilloscopeGetScreenshot(deviceId: string): Promise<Buffer> {
    const session = oscilloscopeSessions.get(deviceId);
    if (!session) throw new Error(`Oscilloscope session not found: ${deviceId}`);
    return session.getScreenshot();
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

    for (const session of oscilloscopeSessions.values()) {
      session.stopSession();
    }
    oscilloscopeSessions.clear();
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
    getOscilloscopeSession,
    oscilloscopeRun,
    oscilloscopeStop,
    oscilloscopeSingle,
    oscilloscopeAutoSetup,
    oscilloscopeGetWaveform,
    oscilloscopeGetMeasurement,
    oscilloscopeGetScreenshot,
    stop,
  };
}
