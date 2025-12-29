// Re-export shared types
export * from '../../shared/types.js';

// Import for use in server-only types
import type {
  DeviceInfo,
  DeviceCapabilities,
  DeviceStatus,
  ListStep,
  OscilloscopeStatus,
  OscilloscopeCapabilities,
  WaveformData,
} from '../../shared/types.js';

// Server-only types

export interface Transport {
  open(): Promise<void>;
  close(): Promise<void>;
  query(cmd: string): Promise<string>;
  queryBinary?(cmd: string): Promise<Buffer>;  // For binary data (waveforms, screenshots)
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

export interface SerialOptions {
  baudRate?: number;           // Default: auto-detect or 115200
  baudRates?: number[];        // Baud rates to try during auto-detect (default: [115200, 9600, 57600, 38400, 19200])
  commandDelay?: number;       // ms delay between commands (default: 50)
  timeout?: number;            // Query timeout in ms (default: 2000)
}

export interface DriverRegistration {
  create: DriverFactory;
  transportType: 'usbtmc' | 'serial';
  match: {
    vendorId?: number;
    productId?: number;
    pathPattern?: RegExp;
  };
  serialOptions?: SerialOptions;  // Serial-specific configuration
}

export interface OscilloscopeDriverRegistration {
  create: OscilloscopeDriverFactory;
  transportType: 'usbtmc' | 'serial';
  match: {
    // USB matching (to know which devices to probe)
    vendorId?: number;
    // IDN pattern matching (manufacturer and model from *IDN? response)
    manufacturer?: string | RegExp;  // e.g., 'RIGOL' or /RIGOL/i
    model?: string | RegExp;         // e.g., /^DS/ or /^DS21/ for more specific
  };
  // Specificity score - higher = more specific match wins (e.g., DS21* = 4, DS* = 2)
  specificity?: number;
}

// Oscilloscope-specific types
export interface OscilloscopeInfo {
  id: string;
  type: 'oscilloscope';
  manufacturer: string;
  model: string;
  serial?: string;
}

export interface OscilloscopeDriver {
  info: OscilloscopeInfo;
  capabilities: OscilloscopeCapabilities;

  // Lifecycle
  probe(): Promise<boolean>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  // Status (fast, for polling)
  getStatus(): Promise<OscilloscopeStatus>;

  // Control
  run(): Promise<void>;
  stop(): Promise<void>;
  single(): Promise<void>;           // Single trigger mode
  autoSetup(): Promise<void>;        // Auto-configure for current signal
  forceTrigger(): Promise<void>;     // Force immediate trigger

  // Channel configuration
  setChannelEnabled(channel: string, enabled: boolean): Promise<void>;
  setChannelScale(channel: string, scale: number): Promise<void>;
  setChannelOffset(channel: string, offset: number): Promise<void>;
  setChannelCoupling(channel: string, coupling: string): Promise<void>;
  setChannelProbe(channel: string, ratio: number): Promise<void>;

  // Timebase
  setTimebaseScale(scale: number): Promise<void>;
  setTimebaseOffset(offset: number): Promise<void>;

  // Trigger
  setTriggerSource(source: string): Promise<void>;
  setTriggerLevel(level: number): Promise<void>;
  setTriggerEdge(edge: string): Promise<void>;
  setTriggerSweep(sweep: string): Promise<void>;

  // Measurements (stateless - query specific measurement on demand)
  getMeasurement(channel: string, type: string): Promise<number | null>;
  getMeasurements(channel: string, types: string[]): Promise<Record<string, number | null>>;

  // Waveform acquisition (slow, on-demand)
  getWaveform(channel: string, start?: number, count?: number): Promise<WaveformData>;

  // Screenshot (download utility, not for primary UI)
  getScreenshot(): Promise<Buffer>;
}

export type OscilloscopeDriverFactory = (transport: Transport) => OscilloscopeDriver;
