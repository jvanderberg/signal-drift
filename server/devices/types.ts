// Re-export shared types
export * from '../../shared/types.js';

// Import for use in server-only types
import type {
  Result,
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
  open(): Promise<Result<void, Error>>;
  close(): Promise<Result<void, Error>>;
  query(cmd: string): Promise<Result<string, Error>>;
  queryBinary?(cmd: string): Promise<Result<Buffer, Error>>;
  write(cmd: string): Promise<Result<void, Error>>;
  isOpen(): boolean;
}

/** Error type for probe failures with specific reason codes */
export interface ProbeError {
  reason: 'timeout' | 'wrong_device' | 'parse_error' | 'connection_failed';
  message: string;
}

export interface DeviceDriver {
  info: DeviceInfo;
  capabilities: DeviceCapabilities;

  probe(): Promise<Result<DeviceInfo, ProbeError>>;
  connect(): Promise<Result<void, Error>>;
  disconnect(): Promise<Result<void, Error>>;

  getStatus(): Promise<Result<DeviceStatus, Error>>;
  setMode(mode: string): Promise<Result<void, Error>>;
  setValue(name: string, value: number): Promise<Result<void, Error>>;
  getValue?(name: string): Promise<Result<number, Error>>;
  setOutput(enabled: boolean): Promise<Result<void, Error>>;

  uploadList?(mode: string, steps: ListStep[], repeat?: number): Promise<Result<void, Error>>;
  startList?(): Promise<Result<void, Error>>;
  stopList?(): Promise<Result<void, Error>>;
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
  probe(): Promise<Result<OscilloscopeInfo, ProbeError>>;
  connect(): Promise<Result<void, Error>>;
  disconnect(): Promise<Result<void, Error>>;

  // Status (fast, for polling)
  getStatus(): Promise<Result<OscilloscopeStatus, Error>>;

  // Control
  run(): Promise<Result<void, Error>>;
  stop(): Promise<Result<void, Error>>;
  single(): Promise<Result<void, Error>>;           // Single trigger mode
  autoSetup(): Promise<Result<void, Error>>;        // Auto-configure for current signal
  forceTrigger(): Promise<Result<void, Error>>;     // Force immediate trigger

  // Channel configuration
  setChannelEnabled(channel: string, enabled: boolean): Promise<Result<void, Error>>;
  setChannelScale(channel: string, scale: number): Promise<Result<void, Error>>;
  setChannelOffset(channel: string, offset: number): Promise<Result<void, Error>>;
  setChannelCoupling(channel: string, coupling: string): Promise<Result<void, Error>>;
  setChannelProbe(channel: string, ratio: number): Promise<Result<void, Error>>;
  setChannelBwLimit(channel: string, enabled: boolean): Promise<Result<void, Error>>;

  // Timebase
  setTimebaseScale(scale: number): Promise<Result<void, Error>>;
  setTimebaseOffset(offset: number): Promise<Result<void, Error>>;

  // Trigger
  setTriggerSource(source: string): Promise<Result<void, Error>>;
  setTriggerLevel(level: number): Promise<Result<void, Error>>;
  setTriggerEdge(edge: string): Promise<Result<void, Error>>;
  setTriggerSweep(sweep: string): Promise<Result<void, Error>>;

  // Measurements (stateless - query specific measurement on demand)
  getMeasurement(channel: string, type: string): Promise<Result<number | null, Error>>;
  getMeasurements(channel: string, types: string[]): Promise<Result<Record<string, number | null>, Error>>;

  // Waveform acquisition (slow, on-demand)
  getWaveform(channel: string, start?: number, count?: number): Promise<Result<WaveformData, Error>>;

  // Screenshot (download utility, not for primary UI)
  getScreenshot(): Promise<Result<Buffer, Error>>;
}

export type OscilloscopeDriverFactory = (transport: Transport) => OscilloscopeDriver;
