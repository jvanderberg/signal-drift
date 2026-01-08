# Plan: Extract VISA-like Abstraction Layer as npm Module

## Overview

Extract the instrument communication layer from signal-drift into a standalone, reusable npm package similar to PyVISA for Python. The package will be called `visa-ts`.

## Goals

1. Create a standalone npm package with zero application-specific dependencies
2. Maintain PyVISA-like API patterns for familiarity
3. Support USB-TMC and Serial transports initially
4. Enable easy addition of new transports (GPIB, Ethernet/LXI)
5. Provide TypeScript-first experience with full type safety

## Package Structure

```
packages/
└── visa-ts/
    ├── package.json
    ├── tsconfig.json
    ├── README.md
    ├── src/
    │   ├── index.ts                    # Public API exports
    │   ├── types.ts                    # Core interfaces
    │   ├── result.ts                   # Result<T,E> type
    │   ├── resource-manager.ts         # ResourceManager (PyVISA equivalent)
    │   ├── resource-string.ts          # VISA resource string parser
    │   ├── resources/
    │   │   ├── base.ts                 # Resource base class
    │   │   ├── message-based.ts        # MessageBasedResource
    │   │   └── register-based.ts       # RegisterBasedResource (stub)
    │   ├── transports/
    │   │   ├── transport.ts            # Transport interface
    │   │   ├── usbtmc.ts               # USB-TMC implementation
    │   │   ├── serial.ts               # Serial implementation
    │   │   └── tcpip.ts                # TCP/IP socket (future)
    │   └── util/
    │       └── scpi-parser.ts          # SCPI response parsing
    └── test/
        ├── resource-string.test.ts
        ├── usbtmc.test.ts
        └── serial.test.ts
```

## Implementation Phases

### Phase 1: Core Infrastructure (Foundation)

**Files to create:**

1. **`src/types.ts`** - Core interfaces
   - `Resource` interface (open, close, query, write, read)
   - `ResourceManager` interface
   - `TransportFactory` type
   - `ResourceInfo` type
   - Configuration types

2. **`src/result.ts`** - Error handling
   - Copy `Result<T,E>`, `Ok()`, `Err()` from `shared/types.ts`
   - Add helper functions: `isOk()`, `isErr()`, `unwrap()`, `unwrapOr()`

3. **`src/resource-string.ts`** - VISA resource string support
   - Parse: `"USB0::0x1AB1::0x04CE::DS1ZA123456789::INSTR"` → structured object
   - Generate: structured object → resource string
   - Pattern matching for `list_resources()` queries (e.g., `"USB?*::INSTR"`)
   - Support USB, Serial (ASRL), TCPIP formats

**Source from signal-drift:**
- `shared/types.ts` → `Result`, `Ok`, `Err`

---

### Phase 2: Transport Layer

**Files to create:**

1. **`src/transports/transport.ts`** - Transport interface
   ```typescript
   interface Transport {
     open(): Promise<Result<void, Error>>;
     close(): Promise<Result<void, Error>>;
     query(cmd: string, timeout?: number): Promise<Result<string, Error>>;
     queryBinary(cmd: string, timeout?: number): Promise<Result<Buffer, Error>>;
     write(cmd: string): Promise<Result<void, Error>>;
     read(timeout?: number): Promise<Result<string, Error>>;
     readBinary(timeout?: number): Promise<Result<Buffer, Error>>;
     clear(): Promise<Result<void, Error>>;
     isOpen(): boolean;
   }
   ```

2. **`src/transports/usbtmc.ts`** - USB-TMC transport
   - Copy from `server/devices/transports/usbtmc.ts`
   - Remove application-specific logging
   - Add configurable quirk modes (not just Rigol)
   - Export helper functions for device enumeration

3. **`src/transports/serial.ts`** - Serial transport
   - Copy from `server/devices/transports/serial.ts`
   - Add auto-baud detection as option
   - Support different line endings (CR, LF, CRLF)

**Source from signal-drift:**
- `server/devices/transports/usbtmc.ts` → USB-TMC implementation
- `server/devices/transports/serial.ts` → Serial implementation
- `server/devices/types.ts:18-31` → Transport interface

---

### Phase 3: Resource Classes

**Files to create:**

1. **`src/resources/base.ts`** - Base Resource class
   ```typescript
   abstract class Resource {
     readonly resourceString: string;
     readonly transport: Transport;

     // Attributes (PyVISA style)
     timeout: number;
     readTermination: string;
     writeTermination: string;

     abstract open(): Promise<Result<void, Error>>;
     abstract close(): Promise<Result<void, Error>>;
   }
   ```

2. **`src/resources/message-based.ts`** - MessageBasedResource
   ```typescript
   class MessageBasedResource extends Resource {
     query(cmd: string): Promise<Result<string, Error>>;
     queryBinaryValues(cmd: string, datatype?: string): Promise<Result<number[], Error>>;
     write(cmd: string): Promise<Result<void, Error>>;
     read(): Promise<Result<string, Error>>;
     readBinaryValues(datatype?: string): Promise<Result<number[], Error>>;
     clear(): Promise<Result<void, Error>>;
   }
   ```

3. **`src/resources/register-based.ts`** - RegisterBasedResource (stub for future)
   - Placeholder for VXI/PXI register-based instruments

**New code required:**
- Attribute system implementation
- Binary value encoding/decoding (IEEE 488.2 format)

---

### Phase 4: ResourceManager

**Files to create:**

1. **`src/resource-manager.ts`** - Main entry point
   ```typescript
   class ResourceManager {
     constructor(backend?: string);  // '@usb', '@serial', '@sim'

     // Discovery
     listResources(query?: string): Promise<string[]>;

     // Connection
     openResource(resourceString: string, options?: OpenOptions): Promise<MessageBasedResource>;

     // Lifecycle
     close(): Promise<void>;

     // Backend registration
     static registerBackend(name: string, factory: BackendFactory): void;
   }
   ```

**Source from signal-drift:**
- `server/devices/registry.ts` → Device registration pattern
- `server/devices/scanner.ts` → Device discovery logic

---

### Phase 5: SCPI Utilities

**Files to create:**

1. **`src/util/scpi-parser.ts`** - SCPI response parsing
   - `parseNumber()` - Handle scientific notation, overflow markers
   - `parseBool()` - Handle 0/1, ON/OFF, TRUE/FALSE
   - `parseEnum()` - Map string responses to enums
   - `parseDefiniteLengthBlock()` - IEEE 488.2 `#NXXX...` format
   - `parseArbitraryBlock()` - IEEE 488.2 `#0...` format

**Source from signal-drift:**
- `server/devices/scpi-parser.ts` → Copy directly with minor cleanup

---

### Phase 6: Package Configuration & Documentation

**Files to create:**

1. **`package.json`**
   ```json
   {
     "name": "visa-ts",
     "version": "0.1.0",
     "description": "TypeScript VISA library for instrument communication",
     "main": "dist/index.js",
     "types": "dist/index.d.ts",
     "exports": {
       ".": "./dist/index.js",
       "./transports/usbtmc": "./dist/transports/usbtmc.js",
       "./transports/serial": "./dist/transports/serial.js"
     },
     "peerDependencies": {
       "usb": "^2.9.0",
       "serialport": "^12.0.0"
     }
   }
   ```

2. **`README.md`** - Documentation
   - Installation
   - Quick start example
   - API reference
   - Comparison to PyVISA
   - Transport-specific notes

3. **`tsconfig.json`** - TypeScript config for library

---

## Migration Path for signal-drift

After extracting visa-ts, update signal-drift to use it:

1. Add `visa-ts` as dependency (or workspace reference)
2. Update imports in `server/devices/`:
   - `transports/usbtmc.ts` → `import { UsbtmcTransport } from 'visa-ts'`
   - `transports/serial.ts` → `import { SerialTransport } from 'visa-ts'`
3. Keep device-specific drivers (Rigol, Matrix) in signal-drift
4. Update `DeviceDriver` to use `MessageBasedResource` internally

---

## API Design (PyVISA Compatibility)

### Example Usage

```typescript
import { ResourceManager } from 'visa-ts';

// Create resource manager
const rm = new ResourceManager();

// List connected instruments
const resources = await rm.listResources('USB?*::INSTR');
console.log(resources);
// ['USB0::0x1AB1::0x04CE::DS1ZA123456789::INSTR']

// Open instrument
const instr = await rm.openResource('USB0::0x1AB1::0x04CE::DS1ZA123456789::INSTR');

// Configure
instr.timeout = 5000;
instr.readTermination = '\n';

// Communicate
const idn = await instr.query('*IDN?');
console.log(idn.value);  // 'RIGOL TECHNOLOGIES,DS1054Z,...'

// Binary data
const waveform = await instr.queryBinaryValues(':WAV:DATA?', 'b');

// Close
await instr.close();
await rm.close();
```

### Resource String Formats

| Type | Format | Example |
|------|--------|---------|
| USB-TMC | `USB[board]::vendor::product::serial::INSTR` | `USB0::0x1AB1::0x04CE::DS1ZA123456789::INSTR` |
| Serial | `ASRL[port]::INSTR` | `ASRL/dev/ttyUSB0::INSTR` or `ASRLCOM3::INSTR` |
| TCP/IP | `TCPIP[board]::host::port::SOCKET` | `TCPIP0::192.168.1.100::5025::SOCKET` |
| TCP/IP (VXI-11) | `TCPIP[board]::host::INSTR` | `TCPIP0::192.168.1.100::INSTR` |

---

## File Mapping: signal-drift → visa-ts

| signal-drift source | visa-ts destination | Changes needed |
|---------------------|---------------------|----------------|
| `shared/types.ts` (Result) | `src/result.ts` | Add helpers |
| `server/devices/types.ts` (Transport) | `src/transports/transport.ts` | Add read(), readBinary() |
| `server/devices/transports/usbtmc.ts` | `src/transports/usbtmc.ts` | Remove logging, generalize quirks |
| `server/devices/transports/serial.ts` | `src/transports/serial.ts` | Add line ending config |
| `server/devices/scpi-parser.ts` | `src/util/scpi-parser.ts` | Cleanup |
| `server/devices/registry.ts` | `src/resource-manager.ts` | Add resource strings |
| `server/devices/scanner.ts` | `src/resource-manager.ts` | Merge discovery logic |
| (new) | `src/resource-string.ts` | VISA string parser |
| (new) | `src/resources/message-based.ts` | PyVISA-style Resource |

---

## Testing Strategy

1. **Unit tests** - Resource string parsing, SCPI parser
2. **Integration tests** - Mock USB/Serial devices
3. **Hardware tests** - Manual testing with real instruments (optional CI)

---

## Open Questions for User

1. **Package location**:
   - Separate repo?
   - Monorepo workspace in signal-drift?
   - npm organization scope? (e.g., `@signal-drift/visa-ts`)

2. **Scope of initial release**:
   - USB-TMC + Serial only?
   - Include TCP/IP socket transport?

3. **Backend plugin system**:
   - Full plugin architecture now?
   - Or simpler direct imports initially?

4. **Simulation backend**:
   - Include mock/simulation transport for testing?

---

## Estimated Effort

| Phase | Description | Complexity |
|-------|-------------|------------|
| 1 | Core Infrastructure | Low |
| 2 | Transport Layer | Low (mostly copy) |
| 3 | Resource Classes | Medium |
| 4 | ResourceManager | Medium |
| 5 | SCPI Utilities | Low (mostly copy) |
| 6 | Package & Docs | Low |

Total: Medium complexity, mostly extraction with some new code for resource strings and PyVISA-compatible API.
