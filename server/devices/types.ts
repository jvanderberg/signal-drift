// Re-export shared types
export * from '../../shared/types.js';

// Import for use in server-only types
import type { DeviceInfo, DeviceCapabilities, DeviceStatus, ListStep } from '../../shared/types.js';

// Server-only types

export interface Transport {
  open(): Promise<void>;
  close(): Promise<void>;
  query(cmd: string): Promise<string>;
  write(cmd: string): Promise<void>;
  isOpen(): boolean;
}

export interface DeviceDriver {
  info: DeviceInfo;
  capabilities: DeviceCapabilities;

  probe(): Promise<boolean>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  getStatus(): Promise<DeviceStatus>;
  setMode(mode: string): Promise<void>;
  setValue(name: string, value: number): Promise<void>;
  getValue?(name: string): Promise<number>;
  setOutput(enabled: boolean): Promise<void>;

  uploadList?(mode: string, steps: ListStep[], repeat?: number): Promise<void>;
  startList?(): Promise<void>;
  stopList?(): Promise<void>;
}

export type DriverFactory = (transport: Transport) => DeviceDriver;

export interface DriverRegistration {
  create: DriverFactory;
  transportType: 'usbtmc' | 'serial';
  match: {
    vendorId?: number;
    productId?: number;
    pathPattern?: RegExp;
  };
}
