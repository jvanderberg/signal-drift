// Shared types for client and server

export type DeviceType = 'power-supply' | 'electronic-load' | 'oscilloscope';

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
  modes: string[];
  modesSettable: boolean;
  outputs: ValueDescriptor[];
  measurements: ValueDescriptor[];
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
  | { type: 'scopeStartStreaming'; deviceId: string; channels: string[]; intervalMs: number }
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
