# Contributing to Lab Controller

This guide covers coding standards and patterns for adding new device drivers.

## Coding Standards

### 1. Result Pattern for Errors

Our code never throws exceptions. Use `Result<T, E>` for all fallible operations:

```typescript
import { Result, Ok, Err } from '../../shared/types.js';

// Return Result from functions that can fail
async function getStatus(): Promise<Result<DeviceStatus, Error>> {
  const result = await transport.query(':SYST:STAT?');
  if (!result.ok) {
    return result;  // Propagate the error
  }

  const parsed = ScpiParser.parseNumber(result.value);
  if (!parsed.ok) {
    return Err(new Error(parsed.error));
  }

  return Ok({ voltage: parsed.value });
}

// Consumer code
const status = await driver.getStatus();
if (!status.ok) {
  console.error('Failed:', status.error.message);
  return;
}
console.log('Voltage:', status.value.voltage);
```

**Rules:**
- Never use `try/catch` in driver code
- Only use `try/catch` at boundaries (transport layer) to convert throws to Result
- Propagate errors with early returns, don't swallow them
- Exception: Test code may throw (e.g., `unwrapResult` helpers) since test failures are expected to throw

### 2. No `any` Types

Use proper types. Don't work around type errors with casts to `any`.

```typescript
// Bad
const value = response as any;

// Good
interface ParsedResponse { value: number; unit: string; }
const value: ParsedResponse = JSON.parse(response);
```

### 3. No `undefined` Literal

Never use the `undefined` literal directly. It's a code smell that usually indicates a missing abstraction or improper API design.

```typescript
// Bad
return undefined;
return Ok(undefined);
const x = undefined;

// Good
return;                    // implicit undefined for void functions
return Ok();               // Ok() helper handles void case
let x: string | undefined; // declare without initializing
```

### 4. Factory Functions Over Classes

Use factory functions that return interfaces, not ES6 classes:

```typescript
// Good - factory function
export function createMyDevice(transport: Transport): DeviceDriver {
  const info: DeviceInfo = { id: '', type: 'power-supply', ... };

  return {
    info,
    capabilities,
    async probe() { ... },
    async getStatus() { ... },
  };
}

// Avoid - class-based
export class MyDevice implements DeviceDriver { ... }
```

### 4. Use ScpiParser for Response Parsing

All SCPI response parsing goes through `ScpiParser`:

```typescript
import { ScpiParser } from '../scpi-parser.js';

// Parse numbers (handles "****", 9.9E37, empty responses)
const voltageResult = ScpiParser.parseNumber(response);
if (!voltageResult.ok) {
  return Err(new Error(`Failed to parse voltage: ${voltageResult.error}`));
}

// Parse with default for optional values
const voltage = ScpiParser.parseNumberOr(response, 0);

// Parse booleans ("0"/"1", "ON"/"OFF")
const enabled = ScpiParser.parseBool(response);

// Parse enums with mapping
const MODE_MAP: Record<string, string> = {
  'CURR': 'CC', 'CC': 'CC',
  'VOLT': 'CV', 'CV': 'CV',
};
const modeResult = ScpiParser.parseEnum(response, MODE_MAP);

// Parse IEEE 488.2 binary blocks (waveforms, screenshots)
const dataResult = ScpiParser.parseDefiniteLengthBlock(buffer);
```

---

## Adding a New Device

A device driver is a factory function that takes a `Transport` and returns an object implementing the `DeviceDriver` interface. The driver is responsible for:

1. **Probing** - Identifying if the connected device matches this driver (via `*IDN?` or similar)
2. **Status polling** - Reading measurements and current state from the device
3. **Control** - Setting mode, output enable, and setpoint values

All types are defined in `server/devices/types.ts` (which re-exports shared types from `shared/types.ts`).

### The DeviceDriver Interface

```typescript
interface DeviceDriver {
  info: DeviceInfo;              // id, type, manufacturer, model, serial
  capabilities: DeviceCapabilities;

  // Lifecycle
  probe(): Promise<Result<DeviceInfo, ProbeError>>;
  connect(): Promise<Result<void, Error>>;
  disconnect(): Promise<Result<void, Error>>;

  // Status & Control
  getStatus(): Promise<Result<DeviceStatus, Error>>;
  setMode(mode: string): Promise<Result<void, Error>>;
  setValue(name: string, value: number): Promise<Result<void, Error>>;
  setOutput(enabled: boolean): Promise<Result<void, Error>>;

  // Optional
  getValue?(name: string): Promise<Result<number, Error>>;
  uploadList?(mode: string, steps: ListStep[], repeat?: number): Promise<Result<void, Error>>;
  startList?(): Promise<Result<void, Error>>;
  stopList?(): Promise<Result<void, Error>>;
}
```

### DeviceStatus Shape

`getStatus()` returns the current device state:

```typescript
interface DeviceStatus {
  mode: string;                              // 'CC', 'CV', etc.
  outputEnabled: boolean;
  setpoints: Record<string, number>;         // { voltage: 12.0, current: 1.5 }
  measurements: Record<string, number>;      // { voltage: 11.98, current: 1.52, power: 18.2 }
}
```

### DeviceCapabilities Shape

Capabilities describe what the device can do (used by UI for layout decisions):

```typescript
interface DeviceCapabilities {
  deviceClass: 'psu' | 'load' | 'oscilloscope' | 'awg';
  features: {
    listMode?: boolean;
    remoteSensing?: boolean;
    // ... other optional features
  };
  modes: string[];           // ['CC', 'CV', 'CR', 'CP']
  modesSettable: boolean;
  outputs: ValueDescriptor[];      // What can be set (with min/max/units)
  measurements: ValueDescriptor[]; // What can be measured
}

interface ValueDescriptor {
  name: string;        // 'voltage', 'current', etc.
  unit: string;        // 'V', 'A', 'W', 'Ω'
  decimals: number;    // Display precision
  min?: number;
  max?: number;
  modes?: string[];    // Which modes this applies to
}
```

### Step 1: Create the Driver

Create `server/devices/drivers/your-device.ts`:

```typescript
import type { DeviceDriver, DeviceInfo, DeviceCapabilities, Transport, ProbeError } from '../types.js';
import type { Result } from '../../../shared/types.js';
import { Ok, Err } from '../../../shared/types.js';
import { ScpiParser } from '../scpi-parser.js';

export function createYourDevice(transport: Transport): DeviceDriver {
  const info: DeviceInfo = {
    id: '',                      // Set during probe()
    type: 'power-supply',        // 'power-supply' | 'electronic-load' | 'oscilloscope'
    manufacturer: 'Your Mfg',
    model: 'Model123',
  };

  const capabilities: DeviceCapabilities = {
    deviceClass: 'psu',          // 'psu' | 'load' | 'oscilloscope' | 'awg'
    features: {
      remoteSensing: true,       // Optional feature flags
      softStart: true,
    },
    modes: ['CV', 'CC'],
    modesSettable: true,
    outputs: [
      { name: 'voltage', unit: 'V', decimals: 2, min: 0, max: 30, modes: ['CV'] },
      { name: 'current', unit: 'A', decimals: 3, min: 0, max: 5, modes: ['CC'] },
    ],
    measurements: [
      { name: 'voltage', unit: 'V', decimals: 3 },
      { name: 'current', unit: 'A', decimals: 3 },
      { name: 'power', unit: 'W', decimals: 2 },
    ],
  };

  return {
    info,
    capabilities,

    async probe(): Promise<Result<DeviceInfo, ProbeError>> {
      const result = await transport.query('*IDN?');
      if (!result.ok) {
        return Err({ reason: 'timeout', message: result.error.message });
      }

      if (!result.value.includes('YourMfg') || !result.value.includes('Model123')) {
        return Err({ reason: 'wrong_device', message: `Not a Model123: ${result.value}` });
      }

      // Parse serial number
      const parts = ScpiParser.parseCsv(result.value);
      if (parts.length >= 3) {
        info.serial = parts[2];
        info.id = `your-device-${info.serial}`;
      }

      return Ok(info);
    },

    async connect(): Promise<Result<void, Error>> {
      return transport.open();
    },

    async disconnect(): Promise<Result<void, Error>> {
      return transport.close();
    },

    async getStatus(): Promise<Result<DeviceStatus, Error>> {
      // Query device state and return parsed status
      const voltageResult = await transport.query(':MEAS:VOLT?');
      if (!voltageResult.ok) return voltageResult;

      const voltage = ScpiParser.parseNumberOr(voltageResult.value, 0);
      // ... more queries ...

      return Ok({
        mode: 'CV',
        outputEnabled: true,
        setpoints: { voltage: 12.0 },
        measurements: { voltage, current: 0.5, power: 6.0 },
      });
    },

    // Implement remaining DeviceDriver methods...
  };
}
```

### Step 2: Register in Scanner

Add your device to `server/devices/scanner.ts`:

```typescript
import { createYourDevice } from './drivers/your-device.js';

// In the appropriate transport probe section:
const driver = createYourDevice(transport);
const probeResult = await driver.probe();
if (probeResult.ok) {
  registry.addDevice(driver);
  return;
}
```

### Step 3: Write Tests

Create `server/devices/__tests__/your-device.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createYourDevice } from '../drivers/your-device.js';
import { createMockTransport } from './test-utils.js';
import { Ok, Err } from '../../../shared/types.js';

describe('YourDevice', () => {
  let transport: MockTransport;
  let driver: DeviceDriver;

  beforeEach(() => {
    transport = createMockTransport();
    driver = createYourDevice(transport);
  });

  describe('probe()', () => {
    it('should return Ok for valid IDN response', async () => {
      transport.setResponse('*IDN?', 'YourMfg,Model123,ABC123,1.0');
      await transport.open();

      const result = await driver.probe();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.serial).toBe('ABC123');
      }
    });

    it('should return Err for wrong device', async () => {
      transport.setResponse('*IDN?', 'OtherMfg,OtherModel,123,1.0');
      await transport.open();

      const result = await driver.probe();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reason).toBe('wrong_device');
      }
    });
  });
});
```

---

## Device Class Checklist

### Power Supply (PSU)

```typescript
const capabilities: DeviceCapabilities = {
  deviceClass: 'psu',
  features: {
    remoteSensing: boolean,   // 4-wire sensing support
    softStart: boolean,       // Programmable soft-start
    tracking: boolean,        // Tracking mode for multi-channel
    parallelMode: boolean,    // Parallel channels for higher current
    seriesMode: boolean,      // Series channels for higher voltage
  },
  modes: ['CV', 'CC'],        // CV = Constant Voltage, CC = Constant Current
  modesSettable: true,
  outputs: [
    { name: 'voltage', unit: 'V', ... },
    { name: 'current', unit: 'A', ... },  // Current limit in CV mode
  ],
  measurements: [
    { name: 'voltage', unit: 'V', ... },
    { name: 'current', unit: 'A', ... },
    { name: 'power', unit: 'W', ... },
  ],
};
```

### Electronic Load

```typescript
const capabilities: DeviceCapabilities = {
  deviceClass: 'load',
  features: {
    listMode: boolean,        // Programmable sequences
    batteryTest: boolean,     // Battery discharge testing
    ocp: boolean,             // Over-current protection test
    opMode: boolean,          // Operate point testing
  },
  modes: ['CC', 'CV', 'CR', 'CP'],
  modesSettable: true,
  outputs: [
    { name: 'current', unit: 'A', modes: ['CC'] },
    { name: 'voltage', unit: 'V', modes: ['CV'] },
    { name: 'resistance', unit: 'Ω', modes: ['CR'] },
    { name: 'power', unit: 'W', modes: ['CP'] },
  ],
  measurements: [
    { name: 'voltage', unit: 'V', ... },
    { name: 'current', unit: 'A', ... },
    { name: 'power', unit: 'W', ... },
  ],
  listMode: {
    maxSteps: number,
    supportedModes: ['CC', 'CV', 'CR', 'CP'],
  },
};
```

### Oscilloscope

Oscilloscopes use a different driver interface (`OscilloscopeDriver`):

```typescript
import type { OscilloscopeDriver, OscilloscopeCapabilities } from '../types.js';

export function createYourOscilloscope(transport: Transport): OscilloscopeDriver {
  const capabilities: OscilloscopeCapabilities = {
    channels: 4,
    bandwidth: 200,           // MHz
    maxSampleRate: 1e9,       // 1 GSa/s
    maxMemoryDepth: 24000000,
    supportedMeasurements: ['VPP', 'FREQ', 'VMAX', 'VMIN', 'PERIOD'],
    hasAWG: false,
  };

  return {
    info,
    capabilities,

    async probe() { ... },
    async connect() { ... },
    async disconnect() { ... },
    async getStatus() { ... },

    // Oscilloscope-specific methods:
    async run() { ... },
    async stop() { ... },
    async single() { ... },
    async autoSetup() { ... },
    async forceTrigger() { ... },
    async getWaveform(channel: string) { ... },
    async getScreenshot() { ... },
    async getMeasurement(channel: string, type: string) { ... },
    async setChannelEnabled(channel: string, enabled: boolean) { ... },
    async setChannelScale(channel: string, scale: number) { ... },
    // ... etc
  };
}
```

---

## Transport Layer

Drivers receive a `Transport` interface. Current implementations:

- **Serial** (`transports/serial.ts`) - RS-232/USB-Serial devices
- **USB-TMC** (`transports/usbtmc.ts`) - USB Test & Measurement Class devices

Transport methods return `Result`:

```typescript
interface Transport {
  open(): Promise<Result<void, Error>>;
  close(): Promise<Result<void, Error>>;
  query(cmd: string): Promise<Result<string, Error>>;
  queryBinary?(cmd: string): Promise<Result<Buffer, Error>>;
  write(cmd: string): Promise<Result<void, Error>>;
  isOpen(): boolean;
}
```

---

## Testing

### Run All Tests
```bash
npm run test:run
```

### Run Specific Test File
```bash
npx vitest run server/devices/__tests__/your-device.test.ts
```

### Type Check
```bash
npx tsc --noEmit
```

### Integration Tests (with real hardware)
```bash
npm run dev  # Start server with connected devices
npx vitest run server/websocket/__tests__/integration.test.ts
```

---

## Common Patterns

### Query with Error Handling

```typescript
async function queryValue(cmd: string): Promise<Result<number, Error>> {
  const result = await transport.query(cmd);
  if (!result.ok) {
    return result;
  }

  const parsed = ScpiParser.parseNumber(result.value);
  if (!parsed.ok) {
    return Err(new Error(`Failed to parse response: ${parsed.error}`));
  }

  return Ok(parsed.value);
}
```

### Mode Mapping

```typescript
const MODE_MAP: Record<string, string> = {
  // SCPI response -> Our mode name
  'CURR': 'CC', 'CC': 'CC',
  'VOLT': 'CV', 'CV': 'CV',
};

const REVERSE_MODE_MAP: Record<string, string> = {
  // Our mode name -> SCPI command
  'CC': 'CURR',
  'CV': 'VOLT',
};

async function getMode(): Promise<Result<string, Error>> {
  const result = await transport.query(':FUNC?');
  if (!result.ok) return result;

  const mode = ScpiParser.parseEnumOr(result.value, MODE_MAP, 'CC');
  return Ok(mode);
}

async function setMode(mode: string): Promise<Result<void, Error>> {
  const scpiMode = REVERSE_MODE_MAP[mode] ?? mode;
  return transport.write(`:FUNC ${scpiMode}`);
}
```

### Binary Data Transfer

```typescript
async function getWaveform(channel: string): Promise<Result<WaveformData, Error>> {
  await transport.write(`:WAV:SOUR ${channel}`);
  await transport.write(':WAV:MODE NORM');
  await transport.write(':WAV:FORM BYTE');

  const dataResult = await transport.queryBinary(':WAV:DATA?');
  if (!dataResult.ok) return dataResult;

  const parsed = ScpiParser.parseDefiniteLengthBlock(dataResult.value);
  if (!parsed.ok) {
    return Err(new Error(`Failed to parse waveform: ${parsed.error}`));
  }

  // Process raw bytes into waveform points...
  return Ok(waveformData);
}
```
