// Shared types for client and server

// ============ Result Type ============
// Use Result<T, E> instead of throwing exceptions.
// Try/catch only at boundaries (transport layer wrapping external libs).

export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

// Helper constructors
export function Ok(): Result<void, never>;
export function Ok<T>(value: T): Result<T, never>;
export function Ok<T>(value?: T): Result<T | void, never> {
  return { ok: true, value: value as T };
}
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
  | { type: 'scopeStopStreaming'; deviceId: string }
  // Sequence messages - library
  | { type: 'sequenceLibraryList' }
  | { type: 'sequenceLibrarySave'; definition: Omit<SequenceDefinition, 'id' | 'createdAt' | 'updatedAt'> }
  | { type: 'sequenceLibraryUpdate'; definition: SequenceDefinition }
  | { type: 'sequenceLibraryDelete'; sequenceId: string }
  // Sequence messages - playback
  | { type: 'sequenceRun'; config: SequenceRunConfig }
  | { type: 'sequenceAbort' }
  // Trigger script messages - library
  | { type: 'triggerScriptLibraryList' }
  | { type: 'triggerScriptLibrarySave'; script: Omit<TriggerScript, 'id' | 'createdAt' | 'updatedAt'> }
  | { type: 'triggerScriptLibraryUpdate'; script: TriggerScript }
  | { type: 'triggerScriptLibraryDelete'; scriptId: string }
  // Trigger script messages - execution
  | { type: 'triggerScriptRun'; scriptId: string }
  | { type: 'triggerScriptStop' }
  | { type: 'triggerScriptPause' }
  | { type: 'triggerScriptResume' };

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
  | { type: 'scopeScreenshot'; deviceId: string; data: string }  // Base64-encoded PNG
  // Sequence responses - library
  | { type: 'sequenceLibrary'; sequences: SequenceDefinition[] }
  | { type: 'sequenceLibrarySaved'; sequenceId: string }
  | { type: 'sequenceLibraryDeleted'; sequenceId: string }
  // Sequence responses - playback
  | { type: 'sequenceStarted'; state: SequenceState }
  | { type: 'sequenceProgress'; state: SequenceState }
  | { type: 'sequenceCompleted'; sequenceId: string }
  | { type: 'sequenceAborted'; sequenceId: string }
  | { type: 'sequenceError'; sequenceId: string; error: string }
  // Trigger script responses - library
  | { type: 'triggerScriptLibrary'; scripts: TriggerScript[] }
  | { type: 'triggerScriptLibrarySaved'; scriptId: string }
  | { type: 'triggerScriptLibraryDeleted'; scriptId: string }
  // Trigger script responses - execution
  | { type: 'triggerScriptStarted'; state: TriggerScriptState }
  | { type: 'triggerScriptProgress'; state: TriggerScriptState }
  | { type: 'triggerScriptStopped'; scriptId: string }
  | { type: 'triggerScriptPaused'; scriptId: string }
  | { type: 'triggerScriptResumed'; scriptId: string }
  | { type: 'triggerScriptError'; scriptId: string; error: string }
  | { type: 'triggerFired'; scriptId: string; triggerId: string; triggerState: TriggerState }
  | { type: 'triggerActionFailed'; scriptId: string; triggerId: string; actionType: string; error: string };

// Lightweight device info for listing (before subscription)
export interface DeviceSummary {
  id: string;
  info: DeviceInfo;
  capabilities: DeviceCapabilities;
  connectionStatus: ConnectionStatus;
}

// ============ Sequence / AWG Types ============

/** Standard waveform shapes */
export type WaveformType = 'sine' | 'triangle' | 'ramp' | 'square';

/** How the sequence repeats (chosen at runtime) */
export type RepeatMode = 'once' | 'count' | 'continuous';

/** Current execution state of a sequence */
export type SequenceExecutionState = 'idle' | 'running' | 'paused' | 'completed' | 'error';

/** A single step in a sequence */
export interface SequenceStep {
  value: number;
  dwellMs: number;
}

/** Standard waveform parameters (generates steps automatically) */
export interface WaveformParams {
  type: WaveformType;
  min: number;
  max: number;
  pointsPerCycle: number;
  intervalMs: number;
}

/** Random walk parameters */
export interface RandomWalkParams {
  type: 'random';
  startValue: number;       // Initial value for first cycle
  maxStepSize: number;      // Max change per step (uniform random in [-maxStepSize, +maxStepSize])
  min: number;              // Lower bound (clamp)
  max: number;              // Upper bound (clamp)
  pointsPerCycle: number;
  intervalMs: number;
}

/** Arbitrary waveform data (user-defined steps) */
export interface ArbitraryWaveform {
  steps: SequenceStep[];
}

/** Complete sequence definition - saved in library, device-agnostic */
export interface SequenceDefinition {
  id: string;
  name: string;
  unit: string;  // 'V', 'A', 'Ω', 'W' - filters valid target parameters
  waveform: WaveformParams | RandomWalkParams | ArbitraryWaveform;
  preValue?: number;      // Set before starting
  postValue?: number;     // Set after completing
  scale?: number;         // Multiply all values (default: 1.0)
  offset?: number;        // Add to all values (default: 0)
  minClamp?: number;      // Safety limit - clamp values below this
  maxClamp?: number;      // Safety limit - clamp values above this
  maxSlewRate?: number;   // V/s or A/s - limit rate of change
  createdAt: number;
  updatedAt: number;
}

/** Runtime config - chosen when you hit "Run" */
export interface SequenceRunConfig {
  sequenceId: string;
  deviceId: string;
  parameter: string;
  repeatMode: RepeatMode;
  repeatCount?: number;  // For 'count' mode
}

/** Runtime state of a running sequence */
export interface SequenceState {
  sequenceId: string;
  runConfig: SequenceRunConfig;
  executionState: SequenceExecutionState;

  // Progress tracking
  currentStepIndex: number;
  totalSteps: number;
  currentCycle: number;
  totalCycles: number | null;  // null for continuous

  // Timing
  startedAt: number | null;
  elapsedMs: number;

  // Current values
  commandedValue: number;

  // Error info (if state is 'error')
  error?: string;
}

// ============ Trigger Script Types ============

/** Comparison operators for value-based triggers */
export type TriggerOperator = '>' | '<' | '>=' | '<=' | '==' | '!=';

/** Trigger repetition mode */
export type TriggerRepeatMode = 'once' | 'repeat';

/** Condition types */
export type TriggerConditionType = 'value' | 'time';

/** Value-based trigger condition: when device.parameter <op> value */
export interface ValueTriggerCondition {
  type: 'value';
  deviceId: string;
  parameter: string;   // 'voltage', 'current', etc.
  operator: TriggerOperator;
  value: number;
}

/** Time-based trigger condition: at t=X seconds from script start */
export interface TimeTriggerCondition {
  type: 'time';
  seconds: number;     // Seconds from script start
}

export type TriggerCondition = ValueTriggerCondition | TimeTriggerCondition;

/** Action types */
export type TriggerActionType =
  | 'setValue'
  | 'setOutput'
  | 'startSequence'
  | 'stopSequence'
  | 'pauseSequence';

/** Set a device value */
export interface SetValueAction {
  type: 'setValue';
  deviceId: string;
  parameter: string;
  value: number;
}

/** Set device output on/off */
export interface SetOutputAction {
  type: 'setOutput';
  deviceId: string;
  enabled: boolean;
}

/** Start a sequence */
export interface StartSequenceAction {
  type: 'startSequence';
  sequenceId: string;
  deviceId: string;
  parameter: string;
  repeatMode: RepeatMode;
  repeatCount?: number;
}

/** Stop a sequence */
export interface StopSequenceAction {
  type: 'stopSequence';
}

/** Pause a sequence */
export interface PauseSequenceAction {
  type: 'pauseSequence';
}

export type TriggerAction =
  | SetValueAction
  | SetOutputAction
  | StartSequenceAction
  | StopSequenceAction
  | PauseSequenceAction;

/** A single trigger: condition + action + modifiers */
export interface Trigger {
  id: string;
  condition: TriggerCondition;
  action: TriggerAction;
  repeatMode: TriggerRepeatMode;
  debounceMs: number;          // Debounce window in ms (0 = no debounce)
}

/** A trigger script: named collection of triggers */
export interface TriggerScript {
  id: string;
  name: string;
  triggers: Trigger[];
  createdAt: number;
  updatedAt: number;
}

/** Runtime state of a trigger script */
export type TriggerScriptExecutionState = 'idle' | 'running' | 'paused' | 'error';

/** Runtime state of an individual trigger */
export interface TriggerState {
  triggerId: string;
  firedCount: number;          // Number of times this trigger has fired
  lastFiredAt: number | null;  // Timestamp of last fire (for debounce)
  conditionMet: boolean;       // Current condition state
}

/** Runtime state of a running trigger script */
export interface TriggerScriptState {
  scriptId: string;
  executionState: TriggerScriptExecutionState;
  startedAt: number | null;
  elapsedMs: number;
  triggerStates: TriggerState[];
  error?: string;
}
