// Shared types for client and server

export type DeviceType = 'power-supply' | 'electronic-load';

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
  | { type: 'stopList'; deviceId: string };

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
  | { type: 'error'; deviceId?: string; code: string; message: string };

// Lightweight device info for listing (before subscription)
export interface DeviceSummary {
  id: string;
  info: DeviceInfo;
  capabilities: DeviceCapabilities;
  connectionStatus: ConnectionStatus;
}
