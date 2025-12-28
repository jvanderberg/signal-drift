# Lab Controller Design Document

## Architecture Overview

```
lab-controller/
├── shared/              # Shared types (single source of truth)
│   └── types.ts
├── server/
│   ├── index.ts         # Express server entry
│   ├── api/
│   │   └── devices.ts   # REST API routes
│   └── devices/
│       ├── types.ts     # Re-exports shared + server-only types
│       ├── registry.ts  # Device discovery & lifecycle
│       ├── scanner.ts   # USB/serial scanning
│       ├── transports/
│       │   ├── usbtmc.ts
│       │   └── serial.ts
│       └── drivers/
│           ├── rigol-dl3021.ts
│           └── matrix-wps300s.ts
├── client/
│   ├── src/
│   │   ├── types.ts     # Re-exports shared + client-only types
│   │   ├── api.ts       # Fetch wrapper
│   │   ├── hooks/
│   │   └── components/
│   └── vite.config.ts
└── electron/            # Future
```

## Key Design Decisions
### 0. TDD TDD TDD

Use test driven development for all the things.,

### 1. Shared Types (Single Source of Truth)

**Problem**: Duplicated types between server and client leads to type mismatches at runtime that TypeScript can't catch.

**Solution**: All API-facing types live in `shared/types.ts`. Both server and client re-export from there.

```typescript
// shared/types.ts - API contract types
export interface Device { ... }
export interface DeviceStatus { ... }
export interface DeviceListResponse { ... }

// server/devices/types.ts
export * from '../../shared/types.js';
// Server-only types (Transport, DeviceDriver, etc.)

// client/src/types.ts
export * from '../../shared/types';
// Client-only types (HistoryData, etc.)
```

### 2. Factory Functions Over Classes

**Pattern**: Use factory functions that return interface implementations, not ES6 classes.

```typescript
// Good - factory function
export function createRigolDL3021(transport: Transport): DeviceDriver {
  const info: DeviceInfo = { ... };
  const capabilities: DeviceCapabilities = { ... };

  return {
    info,
    capabilities,
    async probe() { ... },
    async getStatus() { ... },
    // ...
  };
}

// Avoid - class-based
export class RigolDL3021 implements DeviceDriver { ... }
```

**Benefits**:
- Simpler closure-based state management
- No `this` binding issues
- Transport is captured in closure, no need to store as property

### 3. Transport Abstraction

All device communication goes through a `Transport` interface:

```typescript
interface Transport {
  open(): Promise<void>;
  close(): Promise<void>;
  query(cmd: string): Promise<string>;  // Write + read response
  write(cmd: string): Promise<void>;     // Write only
  isOpen(): boolean;
}
```

**Key behaviors**:
- `query()` handles command/response timing (critical for serial)
- Transports must handle their own protocol framing
- Serial transport needs configurable command delay (50ms for Matrix PSU)

### 4. Device Lifecycle Management

**Problem**: Rescanning for devices fails if previous connections aren't closed.

**Solution**: Registry's `clearDevices()` must disconnect all devices before clearing.

```typescript
async clearDevices(): Promise<void> {
  for (const device of devices.values()) {
    try {
      await device.disconnect();
    } catch (err) {
      console.error(`Failed to disconnect ${device.info.id}:`, err);
    }
  }
  devices.clear();
}
```

**Rule**: Scan keeps transports open after successful probe. Rescan closes all before re-probing.

### 5. Polling Architecture

**Problem**: `setInterval` causes request queue buildup if device is slow.

**Solution**: Sequential polling - schedule next poll after current completes.

```typescript
const poll = useCallback(async () => {
  if (!pollingRef.current) return;

  try {
    const status = await api.getStatus(device.id);
    // Update state...

    // Schedule next poll AFTER completion
    if (pollingRef.current) {
      setTimeout(poll, 250);
    }
  } catch (err) {
    // Handle error, maybe retry with backoff
  }
}, [device]);
```

### 6. State Separation: User vs Device

**Problem**: Polling overwrites user's pending changes, causing UI flickering and race conditions.

**Solution**: Separate what polling updates from what user controls.

```typescript
// Polling only updates measurements and read-only state
setStatus(prev => prev ? {
  ...prev,
  measurements: newStatus.measurements,
  outputEnabled: newStatus.outputEnabled,
} : newStatus);

// User actions (setMode, setValue) do optimistic updates
const setMode = async (mode: string) => {
  setStatus(prev => prev ? { ...prev, mode } : null);  // Optimistic
  await api.setMode(device.id, mode);
  // Fetch new setpoint since it changes with mode
  const newStatus = await api.getStatus(device.id);
  setStatus(prev => prev ? { ...prev, setpoints: newStatus.setpoints } : newStatus);
};
```

### 7. API Response Consistency

**Rule**: All endpoints returning device lists must use the same shape.

```typescript
// Both GET /devices and POST /devices/scan return:
interface DeviceListResponse {
  devices: Device[];  // Full Device objects, not partial
}
```

### 8. Driver Mode Parsing

**Problem**: SCPI devices return mode in various formats.

**Solution**: Handle all variants in parsing.

```typescript
// Rigol DL3021 returns "CC", "CV", "CR", "CP" OR "CURRent", "VOLTage", etc.
const modeUpper = response.toUpperCase().trim();
if (modeUpper.includes('CV') || modeUpper.includes('VOLT')) mode = 'CV';
else if (modeUpper.includes('CR') || modeUpper.includes('RES')) mode = 'CR';
// ...
```

## UI Patterns

### DigitSpinner Carry/Borrow

Increment/decrement with proper carry propagation:

```typescript
const adjustDigit = (index: number, delta: number) => {
  const newDigits = [...digits];
  let carry = delta;
  let i = index;

  // Always propagate LEFT (toward higher-order digits)
  while (carry !== 0 && i >= 0) {
    let digit = parseInt(newDigits[i], 10) + carry;
    if (digit > 9) { carry = 1; digit = 0; }
    else if (digit < 0) { carry = -1; digit = 9; }
    else { carry = 0; }
    newDigits[i] = digit.toString();
    i--;  // Always left
  }
  // Validate against min/max before applying
};
```

### Dynamic Chart Axes

First two visible series get visible Y-axes (left/right), additional series get hidden independent axes:

```typescript
const [visibleSeries, setVisibleSeries] = useState<string[]>(['voltage', 'current']);

const getAxisId = (name: string): string => {
  const idx = visibleSeries.indexOf(name);
  if (idx === 0) return 'y';   // Left axis
  if (idx === 1) return 'y1';  // Right axis
  return `y${idx}`;            // Hidden axis
};

// Build scales dynamically
visibleSeries.forEach((name, idx) => {
  scales[getAxisId(name)] = {
    display: idx < 2,  // Only first two visible
    position: idx === 0 ? 'left' : 'right',
    // ...
  };
});
```

### Setpoint Reference Lines

Show current setpoint as dashed horizontal line on chart:

```typescript
const setpointDatasets = Object.entries(status.setpoints)
  .filter(([name]) => isVisible(name))
  .map(([name, value]) => ({
    label: `${name} setpoint`,
    data: timestamps.map(() => value),  // Horizontal line
    borderDash: [5, 5],
    borderWidth: 1,
    yAxisID: getAxisId(name),
  }));
```

## Common Pitfalls

1. **HMR doesn't reset useState initializers** - Changing default values requires page refresh
2. **Serial ports need lock release** - Close transport before rescanning
3. **USB-TMC needs kernel driver detach** - Handle LIBUSB_ERROR_ACCESS
4. **Mode changes affect setpoints** - Fetch new setpoint after mode change API call
5. **SCPI command timing** - Serial devices need delay between commands (50ms typical)

## Testing Strategy

- Mock transports for driver unit tests
- Mock API for React component tests
- Real hardware for integration tests (manual)
- Type safety enforced by shared types
