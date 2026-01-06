/**
 * OscilloscopeSession - Manages state for a single oscilloscope
 *
 * Unlike DeviceSession (continuous polling), oscilloscopes use:
 * - Slower status polling (trigger status, sample rate)
 * - On-demand waveform/screenshot fetches
 * - On-demand measurement queries
 */

import type { OscilloscopeDriver, OscilloscopeStatus, WaveformData } from '../devices/types.js';
import type { ServerMessage, Result, OscilloscopeSessionState, ConnectionStatus } from '../../shared/types.js';

export interface OscilloscopeSessionConfig {
  statusPollIntervalMs?: number;  // Slow poll for trigger status (default: 500ms)
  maxConsecutiveErrors?: number;
}

// Re-export for consumers that import from this module
export type { OscilloscopeSessionState } from '../../shared/types.js';

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

  // Streaming
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
  let streamingTimer: ReturnType<typeof setInterval> | null = null;
  let streamingChannels: string[] = [];
  let streamingMeasurements: string[] = [];  // Measurements to fetch during streaming
  let streamingIntervalMs = 200;
  let isRunning = true;
  let isFetching = false;  // Guard against concurrent fetches
  let streamingGeneration = 0;  // Increment when streaming restarts to cancel stale fetches
  let lastStatusPoll = 0;  // Track when we last polled status
  const STATUS_POLL_INTERVAL = 5000;  // Poll status every 5s during streaming (was 500ms)
  let autoStreamingStarted = false;  // Track if we've auto-started streaming

  // Waveform cache for fast acquisition (skips preamble query)
  const waveformCache = new Map<string, WaveformData>();

  // FPS tracking
  let frameCount = 0;
  let fpsWindowStart = 0;
  let currentFps = 0;

  // Frequency cache - only recalculate once per second
  const freqCache = new Map<string, { value: number; timestamp: number }>();
  const FREQ_UPDATE_INTERVAL = 1000; // ms

  // Default measurements to calculate from waveform data
  const DEFAULT_STREAMING_MEASUREMENTS = ['VPP', 'FREQ', 'VAVG'];

  // Fast radix-2 FFT - O(n log n) instead of O(n²)
  function fft(real: number[], imag: number[]): void {
    const n = real.length;
    if (n <= 1) return;

    // Bit-reversal permutation
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

    // Cooley-Tukey butterfly
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

  // Find dominant frequency using FFT
  function findFrequency(points: number[], xIncrement: number): number | null {
    const n = points.length;
    if (n < 8) return null;

    // Pad to next power of 2
    let fftSize = 1;
    while (fftSize < n) fftSize <<= 1;

    // Remove DC offset and copy to FFT buffers
    const avg = points.reduce((a, b) => a + b, 0) / n;
    const real = new Array(fftSize).fill(0);
    const imag = new Array(fftSize).fill(0);
    for (let i = 0; i < n; i++) {
      real[i] = points[i] - avg;
    }

    // Run FFT
    fft(real, imag);

    // Find peak magnitude (skip DC and low-freq bins to avoid leakage, check up to Nyquist)
    let maxMag = 0;
    let peakBin = 0;
    const minBin = 3;  // Skip bins 0-2 to avoid DC leakage
    const maxBin = fftSize >> 1;
    for (let k = minBin; k < maxBin; k++) {
      const mag = real[k] * real[k] + imag[k] * imag[k];
      if (mag > maxMag) {
        maxMag = mag;
        peakBin = k;
      }
    }

    // No significant peak found
    if (peakBin === 0) return null;

    // Convert bin to frequency
    const sampleRate = 1 / xIncrement;
    const freq = (peakBin * sampleRate) / fftSize;
    return freq > 0 && isFinite(freq) ? freq : null;
  }

  // Calculate measurements locally from waveform data (no SCPI round-trip needed)
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
        // Throttle frequency calculation to once per second
        const cacheKey = `${channel}-FREQ`;
        const cached = freqCache.get(cacheKey);
        const now = Date.now();

        if (cached && now - cached.timestamp < FREQ_UPDATE_INTERVAL) {
          return type.toUpperCase() === 'FREQ' ? cached.value : 1 / cached.value;
        }

        // Calculate frequency using FFT
        const freq = findFrequency(points, waveform.xIncrement);
        if (freq === null) return null;

        freqCache.set(cacheKey, { value: freq, timestamp: now });
        return type.toUpperCase() === 'FREQ' ? freq : 1 / freq;
      }

      case 'VAMP': {
        // Amplitude (similar to VPP but sometimes defined differently)
        return Math.max(...points) - Math.min(...points);
      }

      case 'VTOP': {
        // Top value - estimate using histogram or percentile
        const sorted = [...points].sort((a, b) => b - a);
        return sorted[Math.floor(sorted.length * 0.1)]; // 90th percentile
      }

      case 'VBAS': {
        // Base value - estimate using histogram or percentile
        const sorted = [...points].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length * 0.1)]; // 10th percentile
      }

      case 'PDUT':
      case 'NDUT': {
        // Duty cycle - % of time above/below midpoint
        const max = Math.max(...points);
        const min = Math.min(...points);
        const mid = (max + min) / 2;
        const aboveCount = points.filter(p => p > mid).length;
        const duty = aboveCount / points.length * 100;
        return type.toUpperCase() === 'PDUT' ? duty : 100 - duty;
      }

      case 'PWID':
      case 'NWID': {
        // Pulse width - average time above/below midpoint per cycle
        const max = Math.max(...points);
        const min = Math.min(...points);
        const mid = (max + min) / 2;
        const totalTime = waveform.xIncrement * points.length;

        // Count transitions to estimate cycles
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
        // Rise time - 10% to 90% of amplitude
        const max = Math.max(...points);
        const min = Math.min(...points);
        const amp = max - min;
        if (amp <= 0) return null;
        const low = min + amp * 0.1;
        const high = min + amp * 0.9;

        // Find first rising edge - look for transition from below low to above high
        for (let i = 1; i < points.length; i++) {
          // Look for start of rising edge (crossing 10% going up)
          if (points[i-1] <= low && points[i] > low) {
            // Now find where it crosses 90%
            // For fast edges, might be same sample or next
            for (let j = i; j < points.length; j++) {
              if (points[j] >= high) {
                // Interpolate for better accuracy
                const riseTime = (j - i + 1) * waveform.xIncrement;
                return Math.max(riseTime, waveform.xIncrement); // At least 1 sample
              }
              // If signal drops before reaching 90%, abort this edge
              if (points[j] < points[j-1] && points[j] < high * 0.5) break;
            }
          }
        }
        return null;
      }

      case 'FALL': {
        // Fall time - 90% to 10% of amplitude
        const max = Math.max(...points);
        const min = Math.min(...points);
        const amp = max - min;
        if (amp <= 0) return null;
        const low = min + amp * 0.1;
        const high = min + amp * 0.9;

        // Find first falling edge - look for transition from above high to below low
        for (let i = 1; i < points.length; i++) {
          // Look for start of falling edge (crossing 90% going down)
          if (points[i-1] >= high && points[i] < high) {
            // Now find where it crosses 10%
            for (let j = i; j < points.length; j++) {
              if (points[j] <= low) {
                const fallTime = (j - i + 1) * waveform.xIncrement;
                return Math.max(fallTime, waveform.xIncrement);
              }
              // If signal rises before reaching 10%, abort this edge
              if (points[j] > points[j-1] && points[j] > low * 2 + min) break;
            }
          }
        }
        return null;
      }

      case 'OVER': {
        // Overshoot - % above top value on rising edge
        const sorted = [...points].sort((a, b) => b - a);
        const top = sorted[Math.floor(sorted.length * 0.1)];
        const base = sorted[Math.floor(sorted.length * 0.9)];
        const max = Math.max(...points);
        const amp = top - base;
        if (amp <= 0) return 0;
        return ((max - top) / amp) * 100;
      }

      case 'PRES': {
        // Preshoot - % below base value on rising edge
        const sorted = [...points].sort((a, b) => b - a);
        const top = sorted[Math.floor(sorted.length * 0.1)];
        const base = sorted[Math.floor(sorted.length * 0.9)];
        const min = Math.min(...points);
        const amp = top - base;
        if (amp <= 0) return 0;
        return ((base - min) / amp) * 100;
      }

      default:
        return null; // Unknown or requires 2 channels (RDEL, FDEL, RPH, FPH)
    }
  }

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

      // Broadcast status update
      broadcast({
        type: 'field',
        deviceId: driver.info.id,
        field: 'oscilloscopeStatus',
        value: status,
      });

      // Auto-start streaming on first successful status poll
      if (!autoStreamingStarted && status?.channels) {
        autoStreamingStarted = true;
        const enabledChannels = Object.entries(status.channels)
          .filter(([_, ch]) => ch.enabled)
          .map(([name]) => name);

        if (enabledChannels.length > 0) {
          console.log(`[OscilloscopeSession] Auto-starting streaming for: ${enabledChannels.join(', ')}`);
          streamingChannels = enabledChannels;
          streamingMeasurements = [...DEFAULT_STREAMING_MEASUREMENTS];
          streamingIntervalMs = enabledChannels.length > 1 ? 350 : 200;
          // Stop polling, start streaming loop
          if (pollTimer) {
            clearTimeout(pollTimer);
            pollTimer = null;
          }
          runStreamingLoop();
          return; // Don't schedule another poll - streaming handles it
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
    };
  }

  // Internal streaming loop - can be called from startStreaming and reconnect
  function runStreamingLoop(): void {
    if (streamingChannels.length === 0) return;

    // Reset FPS tracking
    frameCount = 0;
    fpsWindowStart = Date.now();
    currentFps = 0;

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
        // Schedule retry immediately
        if (streamingChannels.length > 0 && myGeneration === streamingGeneration) {
          streamingTimer = setTimeout(fetchAndBroadcast, 10);
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

          // Use cached preamble for fast fetch, or full fetch if cache empty
          const cached = waveformCache.get(channel);
          const waveformResult = driver.getWaveformFast
            ? await driver.getWaveformFast(channel, cached)
            : await driver.getWaveform(channel);

          if (waveformResult.ok) {
            const waveform = waveformResult.value;
            waveformCache.set(channel, waveform);

            // Track FPS - count frames and calculate every second
            frameCount++;
            const measureStartTime = Date.now();
            const elapsed = measureStartTime - fpsWindowStart;
            if (elapsed >= 1000) {
              currentFps = Math.round((frameCount * 1000) / elapsed);
              frameCount = 0;
              fpsWindowStart = measureStartTime;
            }

            // Double-check generation before broadcasting
            if (myGeneration === streamingGeneration) {
              broadcast({
                type: 'scopeWaveform',
                deviceId: driver.info.id,
                channel,
                waveform,
                fps: currentFps,
              });

              // Calculate measurements locally from waveform data (no SCPI needed!)
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
            // Reset error count on success
            if (consecutiveErrors > 0) {
              consecutiveErrors = 0;
            }
          } else {
            // Check for fatal USB errors that indicate disconnection
            const errorMsg = waveformResult.error?.message || '';
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

        // Interleave status polling during streaming
        const now = Date.now();
        if (now - lastStatusPoll >= STATUS_POLL_INTERVAL && myGeneration === streamingGeneration) {
          lastStatusPoll = now;

          // Fetch status
          const statusResult = await driver.getStatus();
          if (statusResult.ok) {
            status = statusResult.value;
            lastUpdated = Date.now();
            broadcast({
              type: 'field',
              deviceId: driver.info.id,
              field: 'oscilloscopeStatus',
              value: status,
            });
          }
          // Status fetch failed, continue streaming
        }

        // Measurements are now calculated locally from waveform data - no SCPI needed!
      } finally {
        isFetching = false;
      }

      // Schedule next fetch immediately - push as fast as hardware allows
      if (streamingChannels.length > 0 && myGeneration === streamingGeneration) {
        streamingTimer = setTimeout(fetchAndBroadcast, 0);
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
      // Pause streaming - autoSetup changes timebase/scale
      const wasStreaming = streamingChannels.length > 0;
      if (wasStreaming) {
        streamingGeneration++;
        const timeout = Date.now() + 3000;
        while (isFetching && Date.now() < timeout) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      // Clear caches - autoSetup changes everything
      waveformCache.clear();
      freqCache.clear();

      await driver.autoSetup();
      // Auto setup takes time - wait for scope to settle then refresh status
      await new Promise(resolve => setTimeout(resolve, 1500));
      const statusResult = await driver.getStatus();
      if (statusResult.ok) {
        status = statusResult.value;
        lastUpdated = Date.now();
        broadcast({
          type: 'field',
          deviceId: driver.info.id,
          field: 'oscilloscopeStatus',
          value: status,
        });
      }

      // Resume streaming
      if (wasStreaming) {
        runStreamingLoop();
      }
    },

    async forceTrigger(): Promise<void> {
      await driver.forceTrigger();
    },

    // Channel configuration
    async setChannelEnabled(channel: string, enabled: boolean): Promise<void> {
      await driver.setChannelEnabled(channel, enabled);
    },

    async setChannelScale(channel: string, scale: number): Promise<void> {
      // Pause streaming to prevent race conditions
      const wasStreaming = streamingChannels.length > 0;
      if (wasStreaming) {
        streamingGeneration++;
        const timeout = Date.now() + 3000;
        while (isFetching && Date.now() < timeout) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      // Clear cache for this channel BEFORE hardware change
      waveformCache.delete(channel);
      freqCache.delete(`${channel}-FREQ`);

      // Now safe to change hardware setting
      await driver.setChannelScale(channel, scale);

      // Resume streaming - cache will rebuild naturally
      if (wasStreaming) {
        runStreamingLoop();
      }
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
      // Pause streaming to prevent race conditions
      const wasStreaming = streamingChannels.length > 0;
      if (wasStreaming) {
        streamingGeneration++;  // Invalidate current streaming loop
        // Wait for in-flight fetch to complete
        const timeout = Date.now() + 3000;
        while (isFetching && Date.now() < timeout) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      // Clear caches BEFORE hardware change
      waveformCache.clear();
      freqCache.clear();

      // Now safe to change hardware setting
      await driver.setTimebaseScale(scale);

      // Fetch and broadcast new status immediately
      const statusResult = await driver.getStatus();
      if (statusResult.ok) {
        status = statusResult.value;
        lastUpdated = Date.now();
        broadcast({
          type: 'field',
          deviceId: driver.info.id,
          field: 'oscilloscopeStatus',
          value: status,
        });
      }

      // Resume streaming - cache will rebuild naturally with fresh fetches
      if (wasStreaming) {
        runStreamingLoop();
      }
    },

    async setTimebaseOffset(offset: number): Promise<void> {
      // Pause streaming to prevent race conditions
      const wasStreaming = streamingChannels.length > 0;
      if (wasStreaming) {
        streamingGeneration++;
        const timeout = Date.now() + 3000;
        while (isFetching && Date.now() < timeout) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      // Clear caches BEFORE hardware change
      waveformCache.clear();
      freqCache.clear();

      // Now safe to change hardware setting
      await driver.setTimebaseOffset(offset);

      // Fetch and broadcast new status immediately
      const statusResult = await driver.getStatus();
      if (statusResult.ok) {
        status = statusResult.value;
        lastUpdated = Date.now();
        broadcast({
          type: 'field',
          deviceId: driver.info.id,
          field: 'oscilloscopeStatus',
          value: status,
        });
      }

      // Resume streaming
      if (wasStreaming) {
        runStreamingLoop();
      }
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
    async getMeasurement(channel: string, type: string): Promise<Result<number | null, Error>> {
      return driver.getMeasurement(channel, type);
    },

    async getWaveform(channel: string): Promise<Result<WaveformData, Error>> {
      return driver.getWaveform(channel);
    },

    async getScreenshot(): Promise<Result<Buffer, Error>> {
      // Pause streaming during screenshot capture
      const wasStreaming = streamingChannels.length > 0;
      if (wasStreaming) {
        streamingGeneration++;
        const timeout = Date.now() + 3000;
        while (isFetching && Date.now() < timeout) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      try {
        const result = await driver.getScreenshot();
        return result;
      } finally {
        // Resume streaming even if screenshot failed
        if (wasStreaming) {
          runStreamingLoop();
        }
      }
    },

    // Streaming
    async startStreaming(channels: string[], intervalMs: number, measurements?: string[]): Promise<void> {
      // Increment generation to invalidate any in-flight fetches
      streamingGeneration++;

      // Reset isFetching so new generation can start immediately
      // (old generation will see generation mismatch and exit cleanly)
      isFetching = false;

      // Stop existing streaming if any
      if (streamingTimer) {
        clearTimeout(streamingTimer);
        streamingTimer = null;
      }

      // Stop separate status polling timer - we'll poll inline during streaming
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }

      // Reset poll timer so first streaming iteration polls status immediately
      lastStatusPoll = 0;

      streamingChannels = [...channels];
      streamingMeasurements = measurements ? [...measurements] : [];
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

    async stopSession(): Promise<void> {
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

      // Wait for any in-flight fetch to complete (with timeout)
      if (isFetching) {
        const STOP_TIMEOUT = 3000;
        const startTime = Date.now();
        while (isFetching && Date.now() - startTime < STOP_TIMEOUT) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    },
  };
}
