// Shared types for client and server

// ============ Result Type ============
// Use Result<T, E> instead of throwing exceptions.
// Try/catch only at boundaries (transport layer wrapping external libs).

export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

// Helper constructors
export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });

// Helper to wrap a throwing function into Result
export const tryResult = <T>(fn: () => T): Result<T, Error> => {
  try {
    return Ok(fn());
  } catch (e) {
    return Err(e instanceof Error ? e : new Error(String(e)));
  }
};

// Async version
export const tryResultAsync = async <T>(fn: () => Promise<T>): Promise<Result<T, Error>> => {
  try {
    return Ok(await fn());
  } catch (e) {
    return Err(e instanceof Error ? e : new Error(String(e)));
  }
};

// Result utilities for ergonomic chaining
export const Result = {
  /** Transform the success value */
  map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
    return result.ok ? Ok(fn(result.value)) : result;
  },

  /** Chain operations that return Result (flatMap) */
  andThen<T, U, E>(result: Result<T, E>, fn: (value: T) => Result<U, E>): Result<U, E> {
    return result.ok ? fn(result.value) : result;
  },

  /** Get value or return default */
  unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
    return result.ok ? result.value : defaultValue;
  },

  /** Get value or compute default lazily */
  unwrapOrElse<T, E>(result: Result<T, E>, fn: (error: E) => T): T {
    return result.ok ? result.value : fn(result.error);
  },

  /** Combine multiple Results - returns first error or all values */
  all<T, E>(results: Result<T, E>[]): Result<T[], E> {
    const values: T[] = [];
    for (const result of results) {
      if (!result.ok) return result;
      values.push(result.value);
    }
    return Ok(values);
  },

  /** Map error type */
  mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
    return result.ok ? result : Err(fn(result.error));
  },
};

// ============ Device Types ============

export type DeviceType = 'power-supply' | 'electronic-load' | 'oscilloscope';

/**
 * Device class describes common capability patterns.
 * UI uses this to determine control layout without model-specific checks.
 */
export type DeviceClass = 'psu' | 'load' | 'oscilloscope' | 'awg';

/**
 * Feature flags for optional device capabilities.
 * Drivers set these based on what features they support.
 * UI uses these for conditional feature rendering.
 */
export interface DeviceFeatures {
  /** Device supports programmable sequences (list mode) */
  listMode?: boolean;
  /** PSU supports 4-wire remote sensing */
  remoteSensing?: boolean;
  /** Device has external trigger input */
  externalTrigger?: boolean;
  /** PSU supports programmable soft-start */
  softStart?: boolean;
  /** Device supports OCP (over-current protection) configuration */
  ocp?: boolean;
  /** Device supports OVP (over-voltage protection) configuration */
  ovp?: boolean;
}

export interface ValueDescriptor {
  name: string;
  unit: string;
  decimals: number;
  min?: number;
  max?: number;
  modes?: string[];
}

export interface DeviceInfo {
  id: string;
  type: DeviceType;
  manufacturer: string;
  model: string;
  serial?: string;
}

export interface ListModeCapability {
  maxSteps: number;
  supportedModes: string[];
}

export interface DeviceCapabilities {
  /** Device class for UI layout decisions */
  deviceClass: DeviceClass;
  /** Feature flags for optional capabilities */
  features: DeviceFeatures;
  /** Available operating modes (e.g., ['CC', 'CV', 'CR', 'CP']) */
  modes: string[];
  /** Whether mode can be changed programmatically (false for auto-ranging PSUs) */
  modesSettable: boolean;
  /** Controllable outputs/setpoints */
  outputs: ValueDescriptor[];
  /** Readable measurements */
  measurements: ValueDescriptor[];
  /** List mode configuration (if features.listMode is true) */
  listMode?: ListModeCapability;
}

export interface DeviceStatus {
  mode: string;
  outputEnabled: boolean;
  setpoints: Record<string, number>;
  measurements: Record<string, number>;
  listRunning?: boolean;
}

export interface ListStep {
  value: number;
  duration: number;
  slew?: number;
}

export interface Device {
  id: string;
  info: DeviceInfo;
  capabilities: DeviceCapabilities;
  connected: boolean;
}

export interface DeviceListResponse {
  devices: Device[];
}

export interface ApiError {
  error: string;
  message: string;
}

// ============ Oscilloscope Types ============

export interface ChannelConfig {
  enabled: boolean;
  scale: number;      // V/div
  offset: number;     // V
  coupling: 'AC' | 'DC' | 'GND';
  probe: number;      // 1x, 10x, 100x
  bwLimit: boolean;
}

export interface TimebaseConfig {
  scale: number;      // s/div
  offset: number;     // s (horizontal position)
  mode: 'main' | 'zoom' | 'roll';
}

export interface TriggerConfig {
  source: string;     // 'CHAN1', 'CHAN2', 'EXT', 'LINE'
  mode: 'edge' | 'pulse' | 'slope' | 'video';
  coupling: 'AC' | 'DC' | 'LFReject' | 'HFReject';
  level: number;      // V
  edge: 'rising' | 'falling' | 'either';
  sweep: 'auto' | 'normal' | 'single';
}

export interface OscilloscopeMeasurement {
  channel: string;
  type: string;       // 'VPP', 'VAVG', 'FREQ', 'PERIOD', 'RISE', 'FALL', etc.
  value: number;
  unit: string;
}

export type TriggerStatus = 'armed' | 'triggered' | 'stopped' | 'auto' | 'wait';

export interface OscilloscopeStatus {
  running: boolean;
  triggerStatus: TriggerStatus;
  sampleRate: number;
  memoryDepth: number;
  channels: Record<string, ChannelConfig>;  // 'CHAN1' -> config
  timebase: TimebaseConfig;
  trigger: TriggerConfig;
  measurements: OscilloscopeMeasurement[];
}

export interface WaveformData {
  channel: string;
  points: number[];           // Raw sample values (after scaling)
  xIncrement: number;         // Time between samples
  xOrigin: number;            // Time of first sample
  yIncrement: number;         // Voltage per LSB
  yOrigin: number;            // Voltage offset
  yReference: number;         // Reference point
}

export interface OscilloscopeCapabilities {
  channels: number;                    // 2 or 4
  bandwidth: number;                   // MHz
  maxSampleRate: number;               // Sa/s
  maxMemoryDepth: number;              // points
  supportedMeasurements: string[];     // ['VPP', 'VAVG', 'FREQ', ...]
  hasAWG: boolean;                     // Built-in arbitrary waveform generator
}

// ============ WebSocket Types ============

// Device connection status (managed by server proxy)
export type ConnectionStatus = 'connected' | 'error' | 'disconnected';

// History data - server maintains full window, not UI-clipped
export interface HistoryData {
  timestamps: number[];
  voltage: number[];
  current: number[];
  power: number[];
  resistance?: number[];
}

// Complete device state - the abstract representation
export interface DeviceSessionState {
  // Identity (static)
  info: DeviceInfo;
  capabilities: DeviceCapabilities;

  // Connection status (managed by server)
  connectionStatus: ConnectionStatus;
  consecutiveErrors: number;

  // Current operating state
  mode: string;                         // CC, CV, CR, CP
  outputEnabled: boolean;
  setpoints: Record<string, number>;    // e.g., { voltage: 12.5, current: 1.0 }
  measurements: Record<string, number>; // e.g., { voltage: 12.48, current: 0.98 }
  listRunning?: boolean;

  // Full history (server's max window, e.g., 30 min)
  history: HistoryData;

  // Meta
  lastUpdated: number;
}

// Incremental measurement update (sent on each poll)
export interface MeasurementUpdate {
  timestamp: number;
  measurements: Record<string, number>;
}

// Client -> Server messages
export type ClientMessage =
  | { type: 'getDevices' }
  | { type: 'scan' }                                                  // Manual scan trigger
  | { type: 'subscribe'; deviceId: string }
  | { type: 'unsubscribe'; deviceId: string }
  | { type: 'setMode'; deviceId: string; mode: string }
  | { type: 'setOutput'; deviceId: string; enabled: boolean }
  | { type: 'setValue'; deviceId: string; name: string; value: number; immediate?: boolean }
  | { type: 'startList'; deviceId: string }
  | { type: 'stopList'; deviceId: string }
  // Oscilloscope messages - queries
  | { type: 'scopeRun'; deviceId: string }
  | { type: 'scopeStop'; deviceId: string }
  | { type: 'scopeSingle'; deviceId: string }
  | { type: 'scopeAutoSetup'; deviceId: string }
  | { type: 'scopeGetWaveform'; deviceId: string; channel: string }
  | { type: 'scopeGetMeasurement'; deviceId: string; channel: string; measurementType: string }
  | { type: 'scopeGetScreenshot'; deviceId: string }
  // Oscilloscope messages - channel settings
  | { type: 'scopeSetChannelEnabled'; deviceId: string; channel: string; enabled: boolean }
  | { type: 'scopeSetChannelScale'; deviceId: string; channel: string; scale: number }
  | { type: 'scopeSetChannelOffset'; deviceId: string; channel: string; offset: number }
  | { type: 'scopeSetChannelCoupling'; deviceId: string; channel: string; coupling: 'AC' | 'DC' | 'GND' }
  | { type: 'scopeSetChannelProbe'; deviceId: string; channel: string; ratio: number }
  | { type: 'scopeSetChannelBwLimit'; deviceId: string; channel: string; enabled: boolean }
  // Oscilloscope messages - timebase settings
  | { type: 'scopeSetTimebaseScale'; deviceId: string; scale: number }
  | { type: 'scopeSetTimebaseOffset'; deviceId: string; offset: number }
  // Oscilloscope messages - trigger settings
  | { type: 'scopeSetTriggerSource'; deviceId: string; source: string }
  | { type: 'scopeSetTriggerLevel'; deviceId: string; level: number }
  | { type: 'scopeSetTriggerEdge'; deviceId: string; edge: 'rising' | 'falling' | 'either' }
  | { type: 'scopeSetTriggerSweep'; deviceId: string; sweep: 'auto' | 'normal' | 'single' }
  // Oscilloscope messages - streaming
  | { type: 'scopeStartStreaming'; deviceId: string; channels: string[]; intervalMs: number; measurements?: string[] }
  | { type: 'scopeStopStreaming'; deviceId: string };

// setValue behavior:
// - immediate: false (default) - debounced ~250ms, for UI digit spinner
// - immediate: true - execute now, for programmatic sequences

// Server -> Client messages
export type ServerMessage =
  | { type: 'deviceList'; devices: DeviceSummary[] }                  // Response to getDevices, scan, or auto-discovery
  | { type: 'subscribed'; deviceId: string; state: DeviceSessionState }
  | { type: 'unsubscribed'; deviceId: string }
  | { type: 'measurement'; deviceId: string; update: MeasurementUpdate }
  | { type: 'field'; deviceId: string; field: string; value: unknown }
  | { type: 'error'; deviceId?: string; code: string; message: string }
  // Oscilloscope responses
  | { type: 'scopeWaveform'; deviceId: string; channel: string; waveform: WaveformData }
  | { type: 'scopeMeasurement'; deviceId: string; channel: string; measurementType: string; value: number | null }
  | { type: 'scopeScreenshot'; deviceId: string; data: string };  // Base64-encoded PNG

// Lightweight device info for listing (before subscription)
export interface DeviceSummary {
  id: string;
  info: DeviceInfo;
  capabilities: DeviceCapabilities;
  connectionStatus: ConnectionStatus;
}
