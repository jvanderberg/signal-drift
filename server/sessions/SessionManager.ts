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
import type { DeviceSummary, ServerMessage, Result } from '../../shared/types.js';
import { Ok, Err } from '../../shared/types.js';
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
  reconnectOscilloscopeSession(deviceId: string, newDriver: OscilloscopeDriver): void;
  getSession(deviceId: string): DeviceSession | undefined;
  getSessionCount(): number;
  getDeviceSummaries(): DeviceSummary[];

  subscribe(deviceId: string, clientId: string, callback: SubscriberCallback): boolean;
  unsubscribe(deviceId: string, clientId: string): void;
  unsubscribeAll(clientId: string): void;
  isSubscribed(deviceId: string, clientId: string): boolean;

  // Standard device actions
  setMode(deviceId: string, mode: string): Promise<Result<void, Error>>;
  setOutput(deviceId: string, enabled: boolean): Promise<Result<void, Error>>;
  setValue(deviceId: string, name: string, value: number, immediate?: boolean): Promise<Result<void, Error>>;

  // Oscilloscope-specific
  getOscilloscopeSession(deviceId: string): OscilloscopeSession | undefined;
  oscilloscopeRun(deviceId: string): Promise<Result<void, Error>>;
  oscilloscopeStop(deviceId: string): Promise<Result<void, Error>>;
  oscilloscopeSingle(deviceId: string): Promise<Result<void, Error>>;
  oscilloscopeAutoSetup(deviceId: string): Promise<Result<void, Error>>;
  oscilloscopeGetWaveform(deviceId: string, channel: string): Promise<Result<WaveformData, Error>>;
  oscilloscopeGetMeasurement(deviceId: string, channel: string, type: string): Promise<Result<number | null, Error>>;
  oscilloscopeGetScreenshot(deviceId: string): Promise<Result<Buffer, Error>>;

  // Oscilloscope channel settings
  oscilloscopeSetChannelEnabled(deviceId: string, channel: string, enabled: boolean): Promise<Result<void, Error>>;
  oscilloscopeSetChannelScale(deviceId: string, channel: string, scale: number): Promise<Result<void, Error>>;
  oscilloscopeSetChannelOffset(deviceId: string, channel: string, offset: number): Promise<Result<void, Error>>;
  oscilloscopeSetChannelCoupling(deviceId: string, channel: string, coupling: 'AC' | 'DC' | 'GND'): Promise<Result<void, Error>>;
  oscilloscopeSetChannelProbe(deviceId: string, channel: string, ratio: number): Promise<Result<void, Error>>;
  oscilloscopeSetChannelBwLimit(deviceId: string, channel: string, enabled: boolean): Promise<Result<void, Error>>;

  // Oscilloscope timebase settings
  oscilloscopeSetTimebaseScale(deviceId: string, scale: number): Promise<Result<void, Error>>;
  oscilloscopeSetTimebaseOffset(deviceId: string, offset: number): Promise<Result<void, Error>>;

  // Oscilloscope trigger settings
  oscilloscopeSetTriggerSource(deviceId: string, source: string): Promise<Result<void, Error>>;
  oscilloscopeSetTriggerLevel(deviceId: string, level: number): Promise<Result<void, Error>>;
  oscilloscopeSetTriggerEdge(deviceId: string, edge: 'rising' | 'falling' | 'either'): Promise<Result<void, Error>>;
  oscilloscopeSetTriggerSweep(deviceId: string, sweep: 'auto' | 'normal' | 'single'): Promise<Result<void, Error>>;

  // Oscilloscope streaming
  oscilloscopeStartStreaming(deviceId: string, channels: string[], intervalMs: number, measurements?: string[]): Promise<Result<void, Error>>;
  oscilloscopeStopStreaming(deviceId: string): Promise<Result<void, Error>>;

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
  }

  function reconnectOscilloscopeSession(deviceId: string, newDriver: OscilloscopeDriver): void {
    const session = oscilloscopeSessions.get(deviceId);
    if (session) {
      session.reconnect(newDriver);
    }
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

  async function setMode(deviceId: string, mode: string): Promise<Result<void, Error>> {
    const session = sessions.get(deviceId);
    if (!session) {
      return Err(new Error(`Session not found: ${deviceId}`));
    }
    return session.setMode(mode);
  }

  async function setOutput(deviceId: string, enabled: boolean): Promise<Result<void, Error>> {
    const session = sessions.get(deviceId);
    if (!session) {
      return Err(new Error(`Session not found: ${deviceId}`));
    }
    return session.setOutput(enabled);
  }

  async function setValue(
    deviceId: string,
    name: string,
    value: number,
    immediate = false
  ): Promise<Result<void, Error>> {
    const session = sessions.get(deviceId);
    if (!session) {
      return Err(new Error(`Session not found: ${deviceId}`));
    }
    return session.setValue(name, value, immediate);
  }

  // Oscilloscope-specific methods
  async function oscilloscopeRun(deviceId: string): Promise<Result<void, Error>> {
    const session = oscilloscopeSessions.get(deviceId);
    if (!session) return Err(new Error(`Oscilloscope session not found: ${deviceId}`));
    await session.run();
    return Ok();
  }

  async function oscilloscopeStop(deviceId: string): Promise<Result<void, Error>> {
    const session = oscilloscopeSessions.get(deviceId);
    if (!session) return Err(new Error(`Oscilloscope session not found: ${deviceId}`));
    await session.stop();
    return Ok();
  }

  async function oscilloscopeSingle(deviceId: string): Promise<Result<void, Error>> {
    const session = oscilloscopeSessions.get(deviceId);
    if (!session) return Err(new Error(`Oscilloscope session not found: ${deviceId}`));
    await session.single();
    return Ok();
  }

  async function oscilloscopeAutoSetup(deviceId: string): Promise<Result<void, Error>> {
    const session = oscilloscopeSessions.get(deviceId);
    if (!session) return Err(new Error(`Oscilloscope session not found: ${deviceId}`));
    await session.autoSetup();
    return Ok();
  }

  async function oscilloscopeGetWaveform(deviceId: string, channel: string): Promise<Result<WaveformData, Error>> {
    const session = oscilloscopeSessions.get(deviceId);
    if (!session) return Err(new Error(`Oscilloscope session not found: ${deviceId}`));
    return session.getWaveform(channel);
  }

  async function oscilloscopeGetMeasurement(deviceId: string, channel: string, type: string): Promise<Result<number | null, Error>> {
    const session = oscilloscopeSessions.get(deviceId);
    if (!session) return Err(new Error(`Oscilloscope session not found: ${deviceId}`));
    return session.getMeasurement(channel, type);
  }

  async function oscilloscopeGetScreenshot(deviceId: string): Promise<Result<Buffer, Error>> {
    const session = oscilloscopeSessions.get(deviceId);
    if (!session) return Err(new Error(`Oscilloscope session not found: ${deviceId}`));
    return session.getScreenshot();
  }

  // Oscilloscope channel settings
  async function oscilloscopeSetChannelEnabled(deviceId: string, channel: string, enabled: boolean): Promise<Result<void, Error>> {
    const session = oscilloscopeSessions.get(deviceId);
    if (!session) return Err(new Error(`Oscilloscope session not found: ${deviceId}`));
    await session.setChannelEnabled(channel, enabled);
    return Ok();
  }

  async function oscilloscopeSetChannelScale(deviceId: string, channel: string, scale: number): Promise<Result<void, Error>> {
    const session = oscilloscopeSessions.get(deviceId);
    if (!session) return Err(new Error(`Oscilloscope session not found: ${deviceId}`));
    await session.setChannelScale(channel, scale);
    return Ok();
  }

  async function oscilloscopeSetChannelOffset(deviceId: string, channel: string, offset: number): Promise<Result<void, Error>> {
    const session = oscilloscopeSessions.get(deviceId);
    if (!session) return Err(new Error(`Oscilloscope session not found: ${deviceId}`));
    await session.setChannelOffset(channel, offset);
    return Ok();
  }

  async function oscilloscopeSetChannelCoupling(deviceId: string, channel: string, coupling: 'AC' | 'DC' | 'GND'): Promise<Result<void, Error>> {
    const session = oscilloscopeSessions.get(deviceId);
    if (!session) return Err(new Error(`Oscilloscope session not found: ${deviceId}`));
    await session.setChannelCoupling(channel, coupling);
    return Ok();
  }

  async function oscilloscopeSetChannelProbe(deviceId: string, channel: string, ratio: number): Promise<Result<void, Error>> {
    const session = oscilloscopeSessions.get(deviceId);
    if (!session) return Err(new Error(`Oscilloscope session not found: ${deviceId}`));
    await session.setChannelProbe(channel, ratio);
    return Ok();
  }

  async function oscilloscopeSetChannelBwLimit(deviceId: string, channel: string, enabled: boolean): Promise<Result<void, Error>> {
    const session = oscilloscopeSessions.get(deviceId);
    if (!session) return Err(new Error(`Oscilloscope session not found: ${deviceId}`));
    await session.setChannelBwLimit(channel, enabled);
    return Ok();
  }

  // Oscilloscope timebase settings
  async function oscilloscopeSetTimebaseScale(deviceId: string, scale: number): Promise<Result<void, Error>> {
    const session = oscilloscopeSessions.get(deviceId);
    if (!session) return Err(new Error(`Oscilloscope session not found: ${deviceId}`));
    await session.setTimebaseScale(scale);
    return Ok();
  }

  async function oscilloscopeSetTimebaseOffset(deviceId: string, offset: number): Promise<Result<void, Error>> {
    const session = oscilloscopeSessions.get(deviceId);
    if (!session) return Err(new Error(`Oscilloscope session not found: ${deviceId}`));
    await session.setTimebaseOffset(offset);
    return Ok();
  }

  // Oscilloscope trigger settings
  async function oscilloscopeSetTriggerSource(deviceId: string, source: string): Promise<Result<void, Error>> {
    const session = oscilloscopeSessions.get(deviceId);
    if (!session) return Err(new Error(`Oscilloscope session not found: ${deviceId}`));
    await session.setTriggerSource(source);
    return Ok();
  }

  async function oscilloscopeSetTriggerLevel(deviceId: string, level: number): Promise<Result<void, Error>> {
    const session = oscilloscopeSessions.get(deviceId);
    if (!session) return Err(new Error(`Oscilloscope session not found: ${deviceId}`));
    await session.setTriggerLevel(level);
    return Ok();
  }

  async function oscilloscopeSetTriggerEdge(deviceId: string, edge: 'rising' | 'falling' | 'either'): Promise<Result<void, Error>> {
    const session = oscilloscopeSessions.get(deviceId);
    if (!session) return Err(new Error(`Oscilloscope session not found: ${deviceId}`));
    await session.setTriggerEdge(edge);
    return Ok();
  }

  async function oscilloscopeSetTriggerSweep(deviceId: string, sweep: 'auto' | 'normal' | 'single'): Promise<Result<void, Error>> {
    const session = oscilloscopeSessions.get(deviceId);
    if (!session) return Err(new Error(`Oscilloscope session not found: ${deviceId}`));
    await session.setTriggerSweep(sweep);
    return Ok();
  }

  // Oscilloscope streaming
  async function oscilloscopeStartStreaming(deviceId: string, channels: string[], intervalMs: number, measurements?: string[]): Promise<Result<void, Error>> {
    const session = oscilloscopeSessions.get(deviceId);
    if (!session) return Err(new Error(`Oscilloscope session not found: ${deviceId}`));
    await session.startStreaming(channels, intervalMs, measurements);
    return Ok();
  }

  async function oscilloscopeStopStreaming(deviceId: string): Promise<Result<void, Error>> {
    const session = oscilloscopeSessions.get(deviceId);
    if (!session) return Err(new Error(`Oscilloscope session not found: ${deviceId}`));
    await session.stopStreaming();
    return Ok();
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
    reconnectOscilloscopeSession,
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
    oscilloscopeSetChannelEnabled,
    oscilloscopeSetChannelScale,
    oscilloscopeSetChannelOffset,
    oscilloscopeSetChannelCoupling,
    oscilloscopeSetChannelProbe,
    oscilloscopeSetChannelBwLimit,
    oscilloscopeSetTimebaseScale,
    oscilloscopeSetTimebaseOffset,
    oscilloscopeSetTriggerSource,
    oscilloscopeSetTriggerLevel,
    oscilloscopeSetTriggerEdge,
    oscilloscopeSetTriggerSweep,
    oscilloscopeStartStreaming,
    oscilloscopeStopStreaming,
    stop,
  };
}
