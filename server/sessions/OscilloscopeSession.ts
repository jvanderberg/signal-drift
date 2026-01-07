/**
 * OscilloscopeSession - Manages state for a single oscilloscope
 *
 * REDESIGNED: "Always-On Streaming Engine"
 *
 * The session automatically streams ALL enabled channels whenever there are
 * subscribers. The streaming state is the single source of truth, broadcast
 * to all clients so UI stays in sync.
 *
 * Key principles:
 * 1. Server is the source of truth for streaming state
 * 2. Streaming auto-starts on first subscriber, auto-stops on last unsubscribe
 * 3. All enabled channels are always streamed (UI filters what to display)
 * 4. State changes are broadcast so clients stay synchronized
 * 5. No busy-wait loops - use proper async signaling
 */

import type { OscilloscopeDriver, OscilloscopeStatus, WaveformData } from '../devices/types.js';
import type { ServerMessage, Result, OscilloscopeSessionState, ConnectionStatus, StreamingState } from '../../shared/types.js';

export interface OscilloscopeSessionConfig {
  statusPollIntervalMs?: number;  // Slow poll for trigger status (default: 500ms)
  maxConsecutiveErrors?: number;
}

// Re-export for consumers that import from this module
export type { OscilloscopeSessionState, StreamingState } from '../../shared/types.js';

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
  getMeasurement(channel: string, type: string): Promise<Result<number | null, Error>>;
  getWaveform(channel: string): Promise<Result<WaveformData, Error>>;
  getScreenshot(): Promise<Result<Buffer, Error>>;

  // Streaming control (simplified - mainly for pause/resume during config changes)
  startStreaming(channels: string[], intervalMs: number, measurements?: string[]): Promise<void>;
  stopStreaming(): Promise<void>;

  // Lifecycle
  reconnect(newDriver: OscilloscopeDriver): Promise<void>;
  stopSession(): Promise<void>;
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
  let streamingTimer: ReturnType<typeof setTimeout> | null = null;
  let streamingChannels: string[] = [];
  let streamingMeasurements: string[] = [];
  let isRunning = true;
  let isFetching = false;
  let streamingGeneration = 0;
  let lastStatusPoll = 0;
  const STATUS_POLL_INTERVAL = 5000;

  // Waveform cache for fast acquisition (skips preamble query)
  const waveformCache = new Map<string, WaveformData>();

  // FPS tracking
  let frameCount = 0;
  let fpsWindowStart = 0;
  let currentFps = 0;

  // Frequency cache - only recalculate once per second
  const freqCache = new Map<string, { value: number; timestamp: number }>();
  const FREQ_UPDATE_INTERVAL = 1000;

  // Default measurements to calculate from waveform data
  const DEFAULT_STREAMING_MEASUREMENTS = ['VPP', 'FREQ', 'VAVG'];

  // Promise-based fetch completion signaling (replaces busy-wait)
  let fetchCompleteResolve: (() => void) | null = null;

  // Fast radix-2 FFT - O(n log n) instead of O(n²)
  function fft(real: number[], imag: number[]): void {
    const n = real.length;
    if (n <= 1) return;

    let j = 0;
    for (let i = 0; i < n - 1; i++) {
      if (i < j) {
        [real[i], real[j]] = [real[j], real[i]];
        [imag[i], imag[j]] = [imag[j], imag[i]];
      }
      let k = n >> 1;
      while (k <= j) {
        j -= k;
        k >>= 1;
      }
      j += k;
    }

    for (let len = 2; len <= n; len <<= 1) {
      const halfLen = len >> 1;
      const angle = -2 * Math.PI / len;
      const wReal = Math.cos(angle);
      const wImag = Math.sin(angle);

      for (let i = 0; i < n; i += len) {
        let curReal = 1, curImag = 0;
        for (let k = 0; k < halfLen; k++) {
          const evenIdx = i + k;
          const oddIdx = i + k + halfLen;

          const tReal = curReal * real[oddIdx] - curImag * imag[oddIdx];
          const tImag = curReal * imag[oddIdx] + curImag * real[oddIdx];

          real[oddIdx] = real[evenIdx] - tReal;
          imag[oddIdx] = imag[evenIdx] - tImag;
          real[evenIdx] += tReal;
          imag[evenIdx] += tImag;

          const nextReal = curReal * wReal - curImag * wImag;
          curImag = curReal * wImag + curImag * wReal;
          curReal = nextReal;
        }
      }
    }
  }

  function findFrequency(points: number[], xIncrement: number): number | null {
    const n = points.length;
    if (n < 8) return null;

    let fftSize = 1;
    while (fftSize < n) fftSize <<= 1;

    const avg = points.reduce((a, b) => a + b, 0) / n;
    const real = new Array(fftSize).fill(0);
    const imag = new Array(fftSize).fill(0);
    for (let i = 0; i < n; i++) {
      real[i] = points[i] - avg;
    }

    fft(real, imag);

    let maxMag = 0;
    let peakBin = 0;
    const minBin = 3;
    const maxBin = fftSize >> 1;
    for (let k = minBin; k < maxBin; k++) {
      const mag = real[k] * real[k] + imag[k] * imag[k];
      if (mag > maxMag) {
        maxMag = mag;
        peakBin = k;
      }
    }

    if (peakBin === 0) return null;

    const sampleRate = 1 / xIncrement;
    const freq = (peakBin * sampleRate) / fftSize;
    return freq > 0 && isFinite(freq) ? freq : null;
  }

  function calculateMeasurement(waveform: WaveformData, type: string, channel: string): number | null {
    const points = waveform.points;
    if (!points || points.length === 0) return null;

    switch (type.toUpperCase()) {
      case 'VMAX':
        return Math.max(...points);

      case 'VMIN':
        return Math.min(...points);

      case 'VPP':
        return Math.max(...points) - Math.min(...points);

      case 'VAVG': {
        const sum = points.reduce((a, b) => a + b, 0);
        return sum / points.length;
      }

      case 'VRMS': {
        const sumSq = points.reduce((a, b) => a + b * b, 0);
        return Math.sqrt(sumSq / points.length);
      }

      case 'FREQ':
      case 'PER': {
        const cacheKey = `${channel}-FREQ`;
        const cached = freqCache.get(cacheKey);
        const now = Date.now();

        if (cached && now - cached.timestamp < FREQ_UPDATE_INTERVAL) {
          return type.toUpperCase() === 'FREQ' ? cached.value : 1 / cached.value;
        }

        const freq = findFrequency(points, waveform.xIncrement);
        if (freq === null) return null;

        freqCache.set(cacheKey, { value: freq, timestamp: now });
        return type.toUpperCase() === 'FREQ' ? freq : 1 / freq;
      }

      case 'VAMP':
        return Math.max(...points) - Math.min(...points);

      case 'VTOP': {
        const sorted = [...points].sort((a, b) => b - a);
        return sorted[Math.floor(sorted.length * 0.1)];
      }

      case 'VBAS': {
        const sorted = [...points].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length * 0.1)];
      }

      case 'PDUT':
      case 'NDUT': {
        const max = Math.max(...points);
        const min = Math.min(...points);
        const mid = (max + min) / 2;
        const aboveCount = points.filter(p => p > mid).length;
        const duty = aboveCount / points.length * 100;
        return type.toUpperCase() === 'PDUT' ? duty : 100 - duty;
      }

      case 'PWID':
      case 'NWID': {
        const max = Math.max(...points);
        const min = Math.min(...points);
        const mid = (max + min) / 2;
        const totalTime = waveform.xIncrement * points.length;

        let transitions = 0;
        for (let i = 1; i < points.length; i++) {
          if ((points[i-1] <= mid && points[i] > mid) ||
              (points[i-1] > mid && points[i] <= mid)) {
            transitions++;
          }
        }
        const cycles = Math.max(1, transitions / 2);

        const aboveCount = points.filter(p => p > mid).length;
        const aboveTime = (aboveCount / points.length) * totalTime;
        const belowTime = totalTime - aboveTime;

        return type.toUpperCase() === 'PWID' ? aboveTime / cycles : belowTime / cycles;
      }

      case 'RISE': {
        const max = Math.max(...points);
        const min = Math.min(...points);
        const amp = max - min;
        if (amp <= 0) return null;
        const low = min + amp * 0.1;
        const high = min + amp * 0.9;

        for (let i = 1; i < points.length; i++) {
          if (points[i-1] <= low && points[i] > low) {
            for (let j = i; j < points.length; j++) {
              if (points[j] >= high) {
                const riseTime = (j - i + 1) * waveform.xIncrement;
                return Math.max(riseTime, waveform.xIncrement);
              }
              if (points[j] < points[j-1] && points[j] < high * 0.5) break;
            }
          }
        }
        return null;
      }

      case 'FALL': {
        const max = Math.max(...points);
        const min = Math.min(...points);
        const amp = max - min;
        if (amp <= 0) return null;
        const low = min + amp * 0.1;
        const high = min + amp * 0.9;

        for (let i = 1; i < points.length; i++) {
          if (points[i-1] >= high && points[i] < high) {
            for (let j = i; j < points.length; j++) {
              if (points[j] <= low) {
                const fallTime = (j - i + 1) * waveform.xIncrement;
                return Math.max(fallTime, waveform.xIncrement);
              }
              if (points[j] > points[j-1] && points[j] > low * 2 + min) break;
            }
          }
        }
        return null;
      }

      case 'OVER': {
        const sorted = [...points].sort((a, b) => b - a);
        const top = sorted[Math.floor(sorted.length * 0.1)];
        const base = sorted[Math.floor(sorted.length * 0.9)];
        const max = Math.max(...points);
        const amp = top - base;
        if (amp <= 0) return 0;
        return ((max - top) / amp) * 100;
      }

      case 'PRES': {
        const sorted = [...points].sort((a, b) => b - a);
        const top = sorted[Math.floor(sorted.length * 0.1)];
        const base = sorted[Math.floor(sorted.length * 0.9)];
        const min = Math.min(...points);
        const amp = top - base;
        if (amp <= 0) return 0;
        return ((base - min) / amp) * 100;
      }

      default:
        return null;
    }
  }

  function getStreamingState(): StreamingState {
    return {
      isStreaming: streamingChannels.length > 0,
      channels: [...streamingChannels],
      fps: currentFps,
    };
  }

  function broadcast(message: ServerMessage): void {
    // Add timestamp to high-frequency messages for stale message filtering
    const timestampedMessage = addMessageTimestamp(message);
    for (const callback of subscribers.values()) {
      try {
        callback(timestampedMessage);
      } catch (err) {
        console.error('Subscriber callback error:', err);
      }
    }
  }

  // Add timestamp to high-frequency messages (scopeWaveform, field, measurement)
  function addMessageTimestamp(message: ServerMessage): ServerMessage {
    const timestamp = Date.now();
    switch (message.type) {
      case 'scopeWaveform':
        return { ...message, timestamp };
      case 'field':
        return { ...message, timestamp };
      case 'measurement':
        return { ...message, timestamp };
      default:
        return message;
    }
  }

  function broadcastStreamingState(): void {
    broadcast({
      type: 'field',
      deviceId: driver.info.id,
      field: 'streaming',
      value: getStreamingState(),
    });
  }

  // Wait for current fetch to complete with timeout
  async function waitForFetchComplete(timeoutMs: number = 3000): Promise<boolean> {
    if (!isFetching) return true;

    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        fetchCompleteResolve = null;
        resolve(false);
      }, timeoutMs);

      fetchCompleteResolve = () => {
        clearTimeout(timeout);
        fetchCompleteResolve = null;
        resolve(true);
      };
    });
  }

  // Signal that fetch is complete
  function signalFetchComplete(): void {
    if (fetchCompleteResolve) {
      fetchCompleteResolve();
    }
  }

  async function pollStatus(): Promise<void> {
    if (!isRunning) return;

    const statusResult = await driver.getStatus();

    if (statusResult.ok) {
      status = statusResult.value;
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

      broadcast({
        type: 'field',
        deviceId: driver.info.id,
        field: 'oscilloscopeStatus',
        value: status,
      });

      // Auto-start streaming if we have subscribers and enabled channels
      if (subscribers.size > 0 && streamingChannels.length === 0 && status?.channels) {
        const enabledChannels = Object.entries(status.channels)
          .filter(([_, ch]) => ch.enabled)
          .map(([name]) => name);

        if (enabledChannels.length > 0) {
          console.log(`[OscilloscopeSession] Auto-starting streaming for ${enabledChannels.length} channel(s): ${enabledChannels.join(', ')}`);
          streamingChannels = enabledChannels;
          streamingMeasurements = [...DEFAULT_STREAMING_MEASUREMENTS];

          if (pollTimer) {
            clearTimeout(pollTimer);
            pollTimer = null;
          }

          broadcastStreamingState();
          runStreamingLoop();
          return;
        }
      }
    } else {
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
        console.error(`Poll error for oscilloscope ${driver.info.id}:`, statusResult.error);
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
      streaming: getStreamingState(),
    };
  }

  function runStreamingLoop(): void {
    if (streamingChannels.length === 0) return;

    frameCount = 0;
    fpsWindowStart = Date.now();
    currentFps = 0;

    const myGeneration = streamingGeneration;

    async function fetchAndBroadcast() {
      if (myGeneration !== streamingGeneration) {
        return;
      }

      if (connectionStatus === 'disconnected') {
        streamingTimer = null;
        return;
      }

      if (isFetching) {
        if (streamingChannels.length > 0 && myGeneration === streamingGeneration) {
          streamingTimer = setTimeout(fetchAndBroadcast, 10);
        }
        return;
      }

      isFetching = true;
      try {
        const channelsToFetch = [...streamingChannels];
        let allChannelsSucceeded = true;

        for (const channel of channelsToFetch) {
          if (myGeneration !== streamingGeneration) {
            return;
          }

          const cached = waveformCache.get(channel);
          const waveformResult = driver.getWaveformFast
            ? await driver.getWaveformFast(channel, cached)
            : await driver.getWaveform(channel);

          if (waveformResult.ok) {
            const waveform = waveformResult.value;
            waveformCache.set(channel, waveform);

            frameCount++;
            const measureStartTime = Date.now();
            const elapsed = measureStartTime - fpsWindowStart;
            if (elapsed >= 1000) {
              currentFps = Math.round((frameCount * 1000) / elapsed);
              frameCount = 0;
              fpsWindowStart = measureStartTime;
            }

            if (myGeneration === streamingGeneration) {
              broadcast({
                type: 'scopeWaveform',
                deviceId: driver.info.id,
                channel,
                waveform,
                fps: currentFps,
              });

              const measurementsToCalc = streamingMeasurements.length > 0
                ? streamingMeasurements
                : DEFAULT_STREAMING_MEASUREMENTS;

              for (const measurementType of measurementsToCalc) {
                const value = calculateMeasurement(waveform, measurementType, channel);
                if (value !== null) {
                  broadcast({
                    type: 'scopeMeasurement',
                    deviceId: driver.info.id,
                    channel,
                    measurementType,
                    value,
                  });
                }
              }
            }

            if (consecutiveErrors > 0) {
              consecutiveErrors = 0;
            }
          } else {
            allChannelsSucceeded = false;
            const errorMsg = waveformResult.error?.message || '';

            // Log channel-specific errors
            console.warn(`[OscilloscopeSession] Waveform fetch failed for ${channel}: ${errorMsg}`);

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
                streamingTimer = null;
                broadcastStreamingState();
                return;
              }
            }
          }
        }

        // Interleave status polling during streaming
        const now = Date.now();
        if (now - lastStatusPoll >= STATUS_POLL_INTERVAL && myGeneration === streamingGeneration) {
          lastStatusPoll = now;

          const statusResult = await driver.getStatus();
          if (statusResult.ok) {
            status = statusResult.value;
            lastUpdated = Date.now();

            // Check if enabled channels changed - update streaming channels
            if (status?.channels) {
              const newEnabledChannels = Object.entries(status.channels)
                .filter(([_, ch]) => ch.enabled)
                .map(([name]) => name);

              const channelsChanged =
                newEnabledChannels.length !== streamingChannels.length ||
                !newEnabledChannels.every(ch => streamingChannels.includes(ch));

              if (channelsChanged) {
                console.log(`[OscilloscopeSession] Enabled channels changed: ${newEnabledChannels.join(', ')}`);
                streamingChannels = newEnabledChannels;
                broadcastStreamingState();
              }
            }

            broadcast({
              type: 'field',
              deviceId: driver.info.id,
              field: 'oscilloscopeStatus',
              value: status,
            });
          }
        }
      } finally {
        isFetching = false;
        signalFetchComplete();
      }

      if (streamingChannels.length > 0 && myGeneration === streamingGeneration) {
        streamingTimer = setTimeout(fetchAndBroadcast, 0);
      }
    }

    fetchAndBroadcast();
  }

  // Pause streaming and wait for current fetch to complete
  async function pauseStreaming(): Promise<void> {
    if (streamingChannels.length === 0) return;

    streamingGeneration++;
    if (streamingTimer) {
      clearTimeout(streamingTimer);
      streamingTimer = null;
    }

    await waitForFetchComplete(3000);
  }

  // Resume streaming with current channels
  function resumeStreaming(): void {
    if (streamingChannels.length > 0) {
      runStreamingLoop();
    }
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
      const hadSubscribers = subscribers.size > 0;
      subscribers.set(clientId, callback);

      // If this is the first subscriber, auto-start streaming if we have status
      if (!hadSubscribers && status?.channels) {
        const enabledChannels = Object.entries(status.channels)
          .filter(([_, ch]) => ch.enabled)
          .map(([name]) => name);

        if (enabledChannels.length > 0 && streamingChannels.length === 0) {
          console.log(`[OscilloscopeSession] First subscriber - auto-starting streaming: ${enabledChannels.join(', ')}`);
          streamingChannels = enabledChannels;
          streamingMeasurements = [...DEFAULT_STREAMING_MEASUREMENTS];

          if (pollTimer) {
            clearTimeout(pollTimer);
            pollTimer = null;
          }

          broadcastStreamingState();
          runStreamingLoop();
        }
      }
    },

    unsubscribe(clientId: string): void {
      subscribers.delete(clientId);

      // If no more subscribers, stop streaming to save resources
      if (subscribers.size === 0 && streamingChannels.length > 0) {
        console.log(`[OscilloscopeSession] No more subscribers - stopping streaming`);
        streamingGeneration++;
        streamingChannels = [];
        if (streamingTimer) {
          clearTimeout(streamingTimer);
          streamingTimer = null;
        }

        // Resume status polling
        if (isRunning && connectionStatus !== 'disconnected' && !pollTimer) {
          pollTimer = setTimeout(pollStatus, cfg.statusPollIntervalMs);
        }
      }
    },

    // Control commands - optimistically update and broadcast (no extra hardware poll)
    async run(): Promise<void> {
      await driver.run();
      if (status) {
        status = { ...status, running: true };
        lastUpdated = Date.now();
        broadcast({
          type: 'field',
          deviceId: driver.info.id,
          field: 'oscilloscopeStatus',
          value: status,
        });
      }
    },

    async stop(): Promise<void> {
      await driver.stop();
      if (status) {
        status = { ...status, running: false };
        lastUpdated = Date.now();
        broadcast({
          type: 'field',
          deviceId: driver.info.id,
          field: 'oscilloscopeStatus',
          value: status,
        });
      }
    },

    async single(): Promise<void> {
      await driver.single();
      if (status) {
        // Single triggers once then stops, so running becomes false
        status = { ...status, running: false };
        lastUpdated = Date.now();
        broadcast({
          type: 'field',
          deviceId: driver.info.id,
          field: 'oscilloscopeStatus',
          value: status,
        });
      }
    },

    async autoSetup(): Promise<void> {
      await pauseStreaming();

      waveformCache.clear();
      freqCache.clear();

      await driver.autoSetup();
      await new Promise(resolve => setTimeout(resolve, 1500));

      const statusResult = await driver.getStatus();
      if (statusResult.ok) {
        status = statusResult.value;
        lastUpdated = Date.now();

        // Update streaming channels based on new enabled channels
        if (status?.channels) {
          streamingChannels = Object.entries(status.channels)
            .filter(([_, ch]) => ch.enabled)
            .map(([name]) => name);
        }

        broadcast({
          type: 'field',
          deviceId: driver.info.id,
          field: 'oscilloscopeStatus',
          value: status,
        });
      }

      broadcastStreamingState();
      resumeStreaming();
    },

    async forceTrigger(): Promise<void> {
      await driver.forceTrigger();
    },

    // Channel configuration
    async setChannelEnabled(channel: string, enabled: boolean): Promise<void> {
      await driver.setChannelEnabled(channel, enabled);

      // Clear cache for this channel
      waveformCache.delete(channel);
      freqCache.delete(`${channel}-FREQ`);

      // Update local status immediately so client doesn't have to wait for poll
      if (status?.channels?.[channel]) {
        status = {
          ...status,
          channels: {
            ...status.channels,
            [channel]: {
              ...status.channels[channel],
              enabled,
            },
          },
        };
        broadcast({
          type: 'field',
          deviceId: driver.info.id,
          field: 'oscilloscopeStatus',
          value: status,
        });
      }

      // Update streaming channels
      if (enabled && !streamingChannels.includes(channel)) {
        streamingChannels.push(channel);
        broadcastStreamingState();
      } else if (!enabled && streamingChannels.includes(channel)) {
        streamingChannels = streamingChannels.filter(ch => ch !== channel);
        broadcastStreamingState();
      }
    },

    async setChannelScale(channel: string, scale: number): Promise<void> {
      await pauseStreaming();

      waveformCache.delete(channel);
      freqCache.delete(`${channel}-FREQ`);

      await driver.setChannelScale(channel, scale);

      // Optimistic update and broadcast
      if (status?.channels?.[channel]) {
        status = {
          ...status,
          channels: {
            ...status.channels,
            [channel]: {
              ...status.channels[channel],
              scale,
            },
          },
        };
        broadcast({
          type: 'field',
          deviceId: driver.info.id,
          field: 'oscilloscopeStatus',
          value: status,
        });
      }

      resumeStreaming();
    },

    async setChannelOffset(channel: string, offset: number): Promise<void> {
      await driver.setChannelOffset(channel, offset);

      // Optimistic update and broadcast
      if (status?.channels?.[channel]) {
        status = {
          ...status,
          channels: {
            ...status.channels,
            [channel]: {
              ...status.channels[channel],
              offset,
            },
          },
        };
        broadcast({
          type: 'field',
          deviceId: driver.info.id,
          field: 'oscilloscopeStatus',
          value: status,
        });
      }
    },

    async setChannelCoupling(channel: string, coupling: 'AC' | 'DC' | 'GND'): Promise<void> {
      await driver.setChannelCoupling(channel, coupling);

      // Optimistic update and broadcast
      if (status?.channels?.[channel]) {
        status = {
          ...status,
          channels: {
            ...status.channels,
            [channel]: {
              ...status.channels[channel],
              coupling,
            },
          },
        };
        broadcast({
          type: 'field',
          deviceId: driver.info.id,
          field: 'oscilloscopeStatus',
          value: status,
        });
      }
    },

    async setChannelProbe(channel: string, ratio: number): Promise<void> {
      await driver.setChannelProbe(channel, ratio);

      // Optimistic update and broadcast
      if (status?.channels?.[channel]) {
        status = {
          ...status,
          channels: {
            ...status.channels,
            [channel]: {
              ...status.channels[channel],
              probe: ratio,
            },
          },
        };
        broadcast({
          type: 'field',
          deviceId: driver.info.id,
          field: 'oscilloscopeStatus',
          value: status,
        });
      }
    },

    async setChannelBwLimit(channel: string, enabled: boolean): Promise<void> {
      await driver.setChannelBwLimit(channel, enabled);

      // Optimistic update and broadcast
      if (status?.channels?.[channel]) {
        status = {
          ...status,
          channels: {
            ...status.channels,
            [channel]: {
              ...status.channels[channel],
              bwLimit: enabled,
            },
          },
        };
        broadcast({
          type: 'field',
          deviceId: driver.info.id,
          field: 'oscilloscopeStatus',
          value: status,
        });
      }
    },

    // Timebase
    async setTimebaseScale(scale: number): Promise<void> {
      await pauseStreaming();

      waveformCache.clear();
      freqCache.clear();

      await driver.setTimebaseScale(scale);

      // Optimistic update and broadcast (no hardware poll)
      if (status?.timebase) {
        status = {
          ...status,
          timebase: { ...status.timebase, scale },
        };
        lastUpdated = Date.now();
        broadcast({
          type: 'field',
          deviceId: driver.info.id,
          field: 'oscilloscopeStatus',
          value: status,
        });
      }

      resumeStreaming();
    },

    async setTimebaseOffset(offset: number): Promise<void> {
      await pauseStreaming();

      waveformCache.clear();
      freqCache.clear();

      await driver.setTimebaseOffset(offset);

      // Optimistic update and broadcast (no hardware poll)
      if (status?.timebase) {
        status = {
          ...status,
          timebase: { ...status.timebase, offset },
        };
        lastUpdated = Date.now();
        broadcast({
          type: 'field',
          deviceId: driver.info.id,
          field: 'oscilloscopeStatus',
          value: status,
        });
      }

      resumeStreaming();
    },

    // Trigger
    async setTriggerSource(source: string): Promise<void> {
      await driver.setTriggerSource(source);

      // Optimistic update and broadcast
      if (status?.trigger) {
        status = {
          ...status,
          trigger: { ...status.trigger, source },
        };
        broadcast({
          type: 'field',
          deviceId: driver.info.id,
          field: 'oscilloscopeStatus',
          value: status,
        });
      }
    },

    async setTriggerLevel(level: number): Promise<void> {
      await driver.setTriggerLevel(level);
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

      // Optimistic update and broadcast
      if (status?.trigger) {
        status = {
          ...status,
          trigger: { ...status.trigger, edge: edge as 'rising' | 'falling' | 'either' },
        };
        broadcast({
          type: 'field',
          deviceId: driver.info.id,
          field: 'oscilloscopeStatus',
          value: status,
        });
      }
    },

    async setTriggerSweep(sweep: string): Promise<void> {
      await driver.setTriggerSweep(sweep);

      // Optimistic update and broadcast
      if (status?.trigger) {
        status = {
          ...status,
          trigger: { ...status.trigger, sweep: sweep as 'auto' | 'normal' | 'single' },
        };
        broadcast({
          type: 'field',
          deviceId: driver.info.id,
          field: 'oscilloscopeStatus',
          value: status,
        });
      }
    },

    // On-demand queries
    async getMeasurement(channel: string, type: string): Promise<Result<number | null, Error>> {
      return driver.getMeasurement(channel, type);
    },

    async getWaveform(channel: string): Promise<Result<WaveformData, Error>> {
      return driver.getWaveform(channel);
    },

    async getScreenshot(): Promise<Result<Buffer, Error>> {
      await pauseStreaming();

      try {
        const result = await driver.getScreenshot();
        return result;
      } finally {
        resumeStreaming();
      }
    },

    // Streaming - now simplified, mainly for measurement configuration
    async startStreaming(channels: string[], _intervalMs: number, measurements?: string[]): Promise<void> {
      streamingGeneration++;

      if (streamingTimer) {
        clearTimeout(streamingTimer);
        streamingTimer = null;
      }

      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }

      lastStatusPoll = 0;
      streamingChannels = [...channels];
      streamingMeasurements = measurements ? [...measurements] : [];

      broadcastStreamingState();
      runStreamingLoop();
    },

    async stopStreaming(): Promise<void> {
      streamingGeneration++;
      streamingChannels = [];

      if (streamingTimer) {
        clearTimeout(streamingTimer);
        streamingTimer = null;
      }

      broadcastStreamingState();

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

      if (streamingChannels.length > 0) {
        console.log(`[OscilloscopeSession] RECONNECTED, resuming streaming: ${driver.info.id}`);
        streamingGeneration++;
        broadcastStreamingState();
        runStreamingLoop();
      } else if (!pollTimer && isRunning) {
        pollStatus();
      }
    },

    async stopSession(): Promise<void> {
      isRunning = false;
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

      // Wait for any in-flight fetch to complete
      await waitForFetchComplete(3000);
    },
  };
}
