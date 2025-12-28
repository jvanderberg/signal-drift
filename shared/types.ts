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
