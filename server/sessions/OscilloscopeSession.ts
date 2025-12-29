/**
 * OscilloscopeSession - Manages state for a single oscilloscope
 *
 * Unlike DeviceSession (continuous polling), oscilloscopes use:
 * - Slower status polling (trigger status, sample rate)
 * - On-demand waveform/screenshot fetches
 * - On-demand measurement queries
 */

import type { OscilloscopeDriver, OscilloscopeStatus, WaveformData } from '../devices/types.js';
import type { ConnectionStatus, ServerMessage } from '../../shared/types.js';

export interface OscilloscopeSessionConfig {
  statusPollIntervalMs?: number;  // Slow poll for trigger status (default: 500ms)
  maxConsecutiveErrors?: number;
}

export interface OscilloscopeSessionState {
  info: {
    id: string;
    type: 'oscilloscope';
    manufacturer: string;
    model: string;
    serial?: string;
  };
  capabilities: OscilloscopeDriver['capabilities'];
  connectionStatus: ConnectionStatus;
  consecutiveErrors: number;
  status: OscilloscopeStatus | null;
  lastUpdated: number;
}

type SubscriberCallback = (message: ServerMessage) => void;

export interface OscilloscopeSession {
  getState(): OscilloscopeSessionState;
  getSubscriberCount(): number;
  hasSubscriber(clientId: string): boolean;
  subscribe(clientId: string, callback: SubscriberCallback): void;
  unsubscribe(clientId: string): void;

  // Control commands
  run(): Promise<void>;
  stop(): Promise<void>;
  single(): Promise<void>;
  autoSetup(): Promise<void>;
  forceTrigger(): Promise<void>;

  // Channel configuration
  setChannelEnabled(channel: string, enabled: boolean): Promise<void>;
  setChannelScale(channel: string, scale: number): Promise<void>;
  setChannelOffset(channel: string, offset: number): Promise<void>;
  setChannelCoupling(channel: string, coupling: 'AC' | 'DC' | 'GND'): Promise<void>;
  setChannelProbe(channel: string, ratio: number): Promise<void>;
  setChannelBwLimit(channel: string, enabled: boolean): Promise<void>;

  // Timebase
  setTimebaseScale(scale: number): Promise<void>;
  setTimebaseOffset(offset: number): Promise<void>;

  // Trigger
  setTriggerSource(source: string): Promise<void>;
  setTriggerLevel(level: number): Promise<void>;
  setTriggerEdge(edge: string): Promise<void>;
  setTriggerSweep(sweep: string): Promise<void>;

  // On-demand queries
  getMeasurement(channel: string, type: string): Promise<number | null>;
  getWaveform(channel: string): Promise<WaveformData>;
  getScreenshot(): Promise<Buffer>;

  // Streaming
  startStreaming(channels: string[], intervalMs: number): Promise<void>;
  stopStreaming(): Promise<void>;

  // Lifecycle
  reconnect(newDriver: OscilloscopeDriver): Promise<void>;
  stopSession(): void;
}

const DEFAULT_CONFIG: Required<OscilloscopeSessionConfig> = {
  statusPollIntervalMs: 500,
  maxConsecutiveErrors: 5,
};

export function createOscilloscopeSession(
  initialDriver: OscilloscopeDriver,
  config: OscilloscopeSessionConfig = {}
): OscilloscopeSession {
  const cfg: Required<OscilloscopeSessionConfig> = { ...DEFAULT_CONFIG, ...config };

  let driver = initialDriver;
  let connectionStatus: ConnectionStatus = 'connected';
  let consecutiveErrors = 0;
  let lastUpdated = Date.now();
  let status: OscilloscopeStatus | null = null;

  const subscribers = new Map<string, SubscriberCallback>();

  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let streamingTimer: ReturnType<typeof setInterval> | null = null;
  let streamingChannels: string[] = [];
  let streamingIntervalMs = 200;
  let isRunning = true;
  let isFetching = false;  // Guard against concurrent fetches
  let streamingGeneration = 0;  // Increment when streaming restarts to cancel stale fetches

  function broadcast(message: ServerMessage): void {
    for (const callback of subscribers.values()) {
      try {
        callback(message);
      } catch (err) {
        console.error('Subscriber callback error:', err);
      }
    }
  }

  async function pollStatus(): Promise<void> {
    if (!isRunning) return;

    try {
      status = await driver.getStatus();
      lastUpdated = Date.now();

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

      // Broadcast status update
      broadcast({
        type: 'field',
        deviceId: driver.info.id,
        field: 'oscilloscopeStatus',
        value: status,
      });
    } catch (err) {
      consecutiveErrors++;
      lastUpdated = Date.now();

      if (consecutiveErrors >= cfg.maxConsecutiveErrors) {
        connectionStatus = 'disconnected';
        broadcast({
          type: 'field',
          deviceId: driver.info.id,
          field: 'connectionStatus',
          value: 'disconnected',
        });
        console.log(`[OscilloscopeSession] DISCONNECTED: ${driver.info.id} (${consecutiveErrors} errors)`);
      } else if (connectionStatus === 'connected') {
        connectionStatus = 'error';
        broadcast({
          type: 'field',
          deviceId: driver.info.id,
          field: 'connectionStatus',
          value: 'error',
        });
        console.error(`Poll error for oscilloscope ${driver.info.id}:`, err);
      }
    }

    if (isRunning && connectionStatus !== 'disconnected') {
      pollTimer = setTimeout(pollStatus, cfg.statusPollIntervalMs);
    } else {
      pollTimer = null;
    }
  }

  function getState(): OscilloscopeSessionState {
    return {
      info: driver.info,
      capabilities: driver.capabilities,
      connectionStatus,
      consecutiveErrors,
      status,
      lastUpdated,
    };
  }

  // Internal streaming loop - can be called from startStreaming and reconnect
  function runStreamingLoop(): void {
    if (streamingChannels.length === 0) return;

    const minInterval = streamingChannels.length > 1 ? 350 : 200;
    const safeInterval = Math.max(streamingIntervalMs, minInterval);

    // Capture current generation to detect if streaming was restarted
    const myGeneration = streamingGeneration;

    async function fetchAndBroadcast() {
      // Check if streaming was restarted (stale fetch)
      if (myGeneration !== streamingGeneration) {
        return;
      }

      // Don't fetch if disconnected - reconnect will resume
      if (connectionStatus === 'disconnected') {
        streamingTimer = null;
        return;
      }

      // Prevent concurrent fetches - if one is in progress, skip this iteration
      if (isFetching) {
        // Schedule retry after interval
        if (streamingChannels.length > 0 && myGeneration === streamingGeneration) {
          streamingTimer = setTimeout(fetchAndBroadcast, safeInterval);
        }
        return;
      }

      isFetching = true;
      try {
        // Capture channels at start of fetch to ensure consistency
        const channelsToFetch = [...streamingChannels];

        for (const channel of channelsToFetch) {
          // Check if streaming was restarted mid-fetch
          if (myGeneration !== streamingGeneration) {
            return;
          }

          try {
            const waveform = await driver.getWaveform(channel);
            // Double-check generation before broadcasting
            if (myGeneration === streamingGeneration) {
              broadcast({
                type: 'scopeWaveform',
                deviceId: driver.info.id,
                channel,
                waveform,
              });
            }
            // Reset error count on success
            if (consecutiveErrors > 0) {
              consecutiveErrors = 0;
            }
          } catch (err: any) {
            // Check for fatal USB errors that indicate disconnection
            const errorMsg = err?.message || String(err);
            if (errorMsg.includes('LIBUSB_ERROR_NO_DEVICE') ||
                errorMsg.includes('LIBUSB_ERROR_IO') ||
                errorMsg.includes('LIBUSB_ERROR_PIPE')) {
              consecutiveErrors++;
              if (consecutiveErrors >= cfg.maxConsecutiveErrors) {
                connectionStatus = 'disconnected';
                broadcast({
                  type: 'field',
                  deviceId: driver.info.id,
                  field: 'connectionStatus',
                  value: 'disconnected',
                });
                console.log(`[OscilloscopeSession] DISCONNECTED during streaming: ${driver.info.id}`);
                // Don't clear streamingChannels - reconnect will resume
                streamingTimer = null;
                return;
              }
            }
          }
        }
      } finally {
        isFetching = false;
      }

      // Schedule next fetch if still streaming and this generation is still active
      if (streamingChannels.length > 0 && myGeneration === streamingGeneration) {
        streamingTimer = setTimeout(fetchAndBroadcast, safeInterval);
      }
    }

    fetchAndBroadcast();
  }

  // Start polling
  pollStatus();

  return {
    getState,

    getSubscriberCount(): number {
      return subscribers.size;
    },

    hasSubscriber(clientId: string): boolean {
      return subscribers.has(clientId);
    },

    subscribe(clientId: string, callback: SubscriberCallback): void {
      subscribers.set(clientId, callback);
    },

    unsubscribe(clientId: string): void {
      subscribers.delete(clientId);
    },

    // Control commands
    async run(): Promise<void> {
      await driver.run();
    },

    async stop(): Promise<void> {
      await driver.stop();
    },

    async single(): Promise<void> {
      await driver.single();
    },

    async autoSetup(): Promise<void> {
      await driver.autoSetup();
    },

    async forceTrigger(): Promise<void> {
      await driver.forceTrigger();
    },

    // Channel configuration
    async setChannelEnabled(channel: string, enabled: boolean): Promise<void> {
      await driver.setChannelEnabled(channel, enabled);
    },

    async setChannelScale(channel: string, scale: number): Promise<void> {
      await driver.setChannelScale(channel, scale);
    },

    async setChannelOffset(channel: string, offset: number): Promise<void> {
      await driver.setChannelOffset(channel, offset);
    },

    async setChannelCoupling(channel: string, coupling: 'AC' | 'DC' | 'GND'): Promise<void> {
      await driver.setChannelCoupling(channel, coupling);
    },

    async setChannelProbe(channel: string, ratio: number): Promise<void> {
      await driver.setChannelProbe(channel, ratio);
    },

    async setChannelBwLimit(channel: string, enabled: boolean): Promise<void> {
      await driver.setChannelBwLimit(channel, enabled);
    },

    // Timebase
    async setTimebaseScale(scale: number): Promise<void> {
      await driver.setTimebaseScale(scale);
    },

    async setTimebaseOffset(offset: number): Promise<void> {
      await driver.setTimebaseOffset(offset);
    },

    // Trigger
    async setTriggerSource(source: string): Promise<void> {
      await driver.setTriggerSource(source);
    },

    async setTriggerLevel(level: number): Promise<void> {
      await driver.setTriggerLevel(level);
      // Update local status and broadcast so clients see the change immediately
      if (status?.trigger) {
        status = {
          ...status,
          trigger: { ...status.trigger, level },
        };
        broadcast({
          type: 'field',
          deviceId: driver.info.id,
          field: 'oscilloscopeStatus',
          value: status,
        });
      }
    },

    async setTriggerEdge(edge: string): Promise<void> {
      await driver.setTriggerEdge(edge);
    },

    async setTriggerSweep(sweep: string): Promise<void> {
      await driver.setTriggerSweep(sweep);
    },

    // On-demand queries
    async getMeasurement(channel: string, type: string): Promise<number | null> {
      return driver.getMeasurement(channel, type);
    },

    async getWaveform(channel: string): Promise<WaveformData> {
      return driver.getWaveform(channel);
    },

    async getScreenshot(): Promise<Buffer> {
      return driver.getScreenshot();
    },

    // Streaming
    async startStreaming(channels: string[], intervalMs: number): Promise<void> {
      // Increment generation to invalidate any in-flight fetches
      streamingGeneration++;

      // Stop existing streaming if any
      if (streamingTimer) {
        clearTimeout(streamingTimer);
        streamingTimer = null;
      }

      // Pause status polling during streaming to avoid USB congestion
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }

      streamingChannels = [...channels];
      streamingIntervalMs = intervalMs;
      runStreamingLoop();
    },

    async stopStreaming(): Promise<void> {
      // Increment generation to invalidate any in-flight fetches
      streamingGeneration++;
      streamingChannels = [];
      if (streamingTimer) {
        clearTimeout(streamingTimer);
        streamingTimer = null;
      }

      // Resume status polling when streaming stops
      if (isRunning && connectionStatus !== 'disconnected' && !pollTimer) {
        pollTimer = setTimeout(pollStatus, cfg.statusPollIntervalMs);
      }
    },

    // Lifecycle
    async reconnect(newDriver: OscilloscopeDriver): Promise<void> {
      driver = newDriver;
      consecutiveErrors = 0;
      connectionStatus = 'connected';

      broadcast({
        type: 'field',
        deviceId: driver.info.id,
        field: 'connectionStatus',
        value: 'connected',
      });

      // Resume streaming if we were streaming before disconnect
      if (streamingChannels.length > 0) {
        console.log(`[OscilloscopeSession] RECONNECTED, resuming streaming: ${driver.info.id}`);
        // Increment generation to ensure clean start
        streamingGeneration++;
        runStreamingLoop();
      } else if (!pollTimer && isRunning) {
        pollStatus();
      }
    },

    stopSession(): void {
      isRunning = false;
      // Increment generation to invalidate any in-flight fetches
      streamingGeneration++;
      streamingChannels = [];
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      if (streamingTimer) {
        clearTimeout(streamingTimer);
        streamingTimer = null;
      }
    },
  };
}
