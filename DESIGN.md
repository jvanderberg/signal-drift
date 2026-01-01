# Lab Controller Design Document

## Architecture Overview

```
lab-controller/
├── shared/              # Shared types (single source of truth)
│   └── types.ts         # Device, WebSocket message types, sequence types
├── server/
│   ├── index.ts         # HTTP + WebSocket server entry
│   ├── api/
│   │   └── devices.ts   # REST API routes (deprecated, for backward compat)
│   ├── sessions/
│   │   ├── DeviceSession.ts        # Per-device polling & state (PSU/Load)
│   │   ├── OscilloscopeSession.ts  # Oscilloscope-specific session
│   │   └── SessionManager.ts       # Manages all device sessions
│   ├── sequences/
│   │   ├── SequenceController.ts   # Timer-based execution engine
│   │   ├── SequenceManager.ts      # Library + playback management
│   │   ├── SequenceStore.ts        # JSON persistence
│   │   └── WaveformGenerator.ts    # Waveform -> steps conversion
│   ├── websocket/
│   │   └── WebSocketHandler.ts # WebSocket connection & message routing
│   └── devices/
│       ├── types.ts     # Re-exports shared + server-only types
│       ├── registry.ts  # Device discovery & lifecycle
│       ├── scanner.ts   # USB/serial scanning
│       ├── transports/
│       │   ├── usbtmc.ts
│       │   └── serial.ts
│       └── drivers/
│           ├── rigol-dl3021.ts      # Rigol DL3021 Electronic Load
│           ├── matrix-wps300s.ts    # Matrix WPS300S Power Supply
│           └── rigol-oscilloscope.ts # Rigol DS/MSO Series Oscilloscopes
├── client/
│   ├── src/
│   │   ├── types.ts     # Re-exports shared + client-only types
│   │   ├── websocket.ts # WebSocket connection manager (singleton)
│   │   ├── hooks/
│   │   │   ├── useDeviceSocket.ts       # Device state via WebSocket (PSU/Load)
│   │   │   ├── useOscilloscopeSocket.ts # Oscilloscope state via WebSocket
│   │   │   ├── useDeviceList.ts         # Device discovery via WebSocket
│   │   │   └── useSequencer.ts          # Sequence library and playback
│   │   └── components/
│   │       ├── DevicePanel.tsx          # PSU/Load control panel
│   │       ├── OscilloscopePanel.tsx    # Oscilloscope control panel
│   │       ├── WaveformDisplay.tsx      # SVG waveform renderer with trigger drag
│   │       ├── TimebaseControls.tsx     # Compact +/- timebase scale controls
│   │       ├── ChannelSettings.tsx      # Channel configuration popover
│   │       ├── TriggerSettings.tsx      # Trigger configuration popover
│   │       └── sequencer/               # Sequence editor and playback UI
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

## UI Styling Guide

All UI components must follow these patterns to maintain visual consistency across device modules.

### Theme Colors (CSS Variables)

Always use CSS custom properties from `client/src/index.css`. Never hardcode colors.

```css
/* Backgrounds */
--color-bg-body         /* Page background */
--color-bg-panel        /* Card/panel background */
--color-bg-readings     /* Measurement display background */

/* Accents (device-specific) */
--color-accent-psu      /* Orange - power supply elements */
--color-accent-load     /* Blue - electronic load elements */

/* Status */
--color-success         /* Green - connected, enabled, running */
--color-danger          /* Red - error, stop, disconnect */

/* Text hierarchy */
--color-text-primary    /* Main text */
--color-text-secondary  /* Labels, subtitles */
--color-text-muted      /* Disabled, hints */

/* Borders */
--color-border-light    /* Subtle separators */
--color-border-dark     /* Panel borders */

/* Waveform display (oscilloscope) */
--color-waveform-bg         /* Dark background for waveform area */
--color-waveform-grid       /* Minor grid lines */
--color-waveform-grid-major /* Major grid lines (edges) */
--color-waveform-label      /* Axis labels */
--color-waveform-trigger    /* Trigger level indicator */
```

### Panel Structure

Every device panel follows this structure:

```jsx
{/* Outer container with border */}
<div className="bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] rounded-md p-3 mb-2">
  {/* Content */}
</div>
```

### Typography

| Element | Classes |
|---------|---------|
| Panel headers | `text-sm font-semibold` |
| Labels | `text-xs text-[var(--color-text-secondary)] uppercase` |
| Measurement values | `font-mono text-xl font-bold` |
| Small labels | `text-[10px] uppercase tracking-wide` |
| Muted text | `text-[var(--color-text-muted)]` |

### Buttons

**Primary action (Run/Start):**
```jsx
className="px-4 py-2 text-sm font-medium rounded bg-[var(--color-success)] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
```

**Danger action (Stop):**
```jsx
className="px-4 py-2 text-sm font-medium rounded bg-[var(--color-danger)] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
```

**Secondary:**
```jsx
className="px-4 py-2 text-sm font-medium rounded bg-[var(--color-border-light)] text-[var(--color-text-primary)] hover:opacity-90"
```

**Small controls:**
```jsx
className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-[var(--color-border-light)] text-[var(--color-text-primary)] hover:opacity-90 disabled:opacity-50 min-w-[22px]"
```

### Form Controls

**Selects/Dropdowns:**
```jsx
className="px-2 py-1 text-xs rounded bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-load)]"
```

**Toggle Switch:**
```jsx
<button className={`relative w-11 h-6 rounded-full transition-colors ${
  enabled ? 'bg-[var(--color-success)]' : 'bg-[var(--color-border-dark)]'
}`}>
  <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-200 ${
    enabled ? 'translate-x-5' : 'translate-x-0'
  }`} />
</button>
```

### Spacing

| Context | Value |
|---------|-------|
| Panel padding | `p-3` (12px) |
| Header padding | `p-2` (8px) |
| Control padding | `p-1.5` (6px) |
| Between major sections | `gap-4` (16px) |
| Between control groups | `gap-2` to `gap-3` (8-12px) |
| Within button groups | `gap-1` to `gap-1.5` (4-6px) |
| Between panels | `mb-2` (8px) |

### Status Indicators

**Status dot (CSS classes defined in index.css):**
```jsx
<span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
```

**Mode badge:**
```jsx
<span className={`mode-badge ${mode.toLowerCase()}`}>{mode}</span>
```

### Device-Specific Colors

**Oscilloscope channels:**
```typescript
const CHANNEL_COLORS = {
  CHAN1: '#FFD700',  // Yellow
  CHAN2: '#00FFFF',  // Cyan
  CHAN3: '#FF00FF',  // Magenta
  CHAN4: '#00FF00',  // Green
};
```

**Chart series:**
```typescript
const SERIES_COLORS = {
  voltage:    '#ff9f43',  // Orange (matches --color-accent-psu)
  current:    '#00d4ff',  // Cyan (matches --color-accent-load)
  power:      '#2ed573',  // Green
  resistance: '#a55eea',  // Purple
};
```

### Popovers and Overlays

```jsx
<div className="bg-gray-800 border border-gray-600 rounded-lg shadow-lg p-3"
     style={{ borderTopColor: accentColor, borderTopWidth: '3px' }}>
  {/* Content */}
</div>
```

### Responsive Patterns

- Use `lg:` breakpoint for desktop-specific layouts
- Mobile-first: controls stack vertically, expand horizontally on desktop
- Hide secondary info on mobile: `hidden lg:block`
- Flexible grids: `grid-cols-2 lg:grid-cols-1`

### Common Mistakes to Avoid

1. **Hardcoding colors** - Always use CSS variables
2. **Inconsistent spacing** - Use the established scale (gap-1, gap-2, gap-3, gap-4)
3. **Missing hover/disabled states** - All interactive elements need both
4. **Wrong text hierarchy** - Use the typography classes consistently
5. **Dark mode issues** - Test both themes; CSS variables handle this automatically
6. **Missing rounded corners** - Use `rounded` or `rounded-md` on all panels/buttons

## Sequencer Architecture

The sequencer enables arbitrary waveform generation on power supplies and electronic loads. It's designed around device-agnostic sequence definitions that can be played on any compatible device.

### Key Design Principles

1. **Separation of Definition and Execution** - Sequences are defined once (with unit like 'V' or 'A'), then played on any device with a matching parameter.

2. **Timer-based Execution** - Uses absolute timestamps to prevent drift, not relative delays.

3. **Server-side Execution** - All timing happens on the server for consistent playback regardless of client state.

### Components

```
server/sequences/
├── SequenceController.ts    # Timer-based execution engine
├── SequenceManager.ts       # Library CRUD + active sequence management
├── SequenceStore.ts         # JSON file persistence
├── WaveformGenerator.ts     # Generates steps from waveform parameters
└── __tests__/               # Comprehensive test coverage
```

**SequenceController** - The execution engine:
- Precomputes absolute target times to prevent timing drift
- Supports pause/resume with schedule adjustment
- Frame-drops (skips steps) if execution falls behind schedule
- Regenerates random walk values on each cycle for true randomness

**SequenceManager** - Manages library and playback:
- CRUD operations for sequence library with validation
- JSON file persistence with debounced writes
- Routes playback commands to active controller
- Broadcasts state changes to WebSocket subscribers

**WaveformGenerator** - Converts parameters to step arrays:
- Standard waveforms: sine, triangle, ramp, square
- Random walk: bounded random steps with configurable max step size
- All generators produce `{ value, dwellMs }[]` arrays

### Sequence Definition

```typescript
interface SequenceDefinition {
  id: string;
  name: string;
  unit: string;  // 'V', 'A', 'Ω', 'W' - determines compatible parameters

  // One of: standard waveform, random walk, or arbitrary steps
  waveform: WaveformParams | RandomWalkParams | ArbitraryWaveform;

  // Optional modifiers (applied in order: scale → offset → clamp)
  scale?: number;      // Multiply all values
  offset?: number;     // Add to all values
  minClamp?: number;   // Floor
  maxClamp?: number;   // Ceiling

  // Optional pre/post values
  preValue?: number;   // Set before starting
  postValue?: number;  // Set after completing
}
```

### Execution Flow

```
[sequenceRun]
Client                          SequenceManager                    SequenceController
   |-- sequenceRun(config) -->      |                                    |
   |                                 | (1) Validate sequence & device     |
   |                                 | (2) Create controller ------------> |
   |                                 | (3) Subscribe to events            |
   |                                 |<-- controller.start() -------------|
   |<-- sequenceStarted(state) ---- |                                    |
   |                                 |                                    |
   |<-- sequenceProgress(state) --- | <-- (timer fires, setValue) -------|
   |<-- sequenceProgress(state) --- | <-- (timer fires, setValue) -------|
   |                                 |                                    |
   |<-- sequenceCompleted --------- | <-- (all steps done) --------------|
```

### Timing Strategy

The controller uses absolute timestamps to maintain accurate timing:

```typescript
// Build schedule with absolute times (not relative delays)
function buildSchedule(startTime: number): void {
  schedule = [];
  let cumulative = startTime;
  for (const step of steps) {
    schedule.push(cumulative);
    cumulative += step.dwellMs;
  }
}

// Execute at scheduled time, skip if behind
function scheduleNextStep(): void {
  const now = Date.now();
  const targetTime = schedule[currentStepIndex];
  const delay = Math.max(0, targetTime - now);

  // Skip past any steps whose time has already passed
  while (schedule[currentStepIndex + 1] <= now) {
    currentStepIndex++;
    skippedSteps++;
  }

  setTimeout(executeStep, delay);
}
```

### WebSocket Messages

Client -> Server:
- `sequenceLibraryList` - Request all saved sequences
- `sequenceLibrarySave { definition }` - Save new sequence
- `sequenceLibraryUpdate { definition }` - Update existing
- `sequenceLibraryDelete { sequenceId }` - Delete sequence
- `sequenceRun { config }` - Start playback
- `sequenceAbort` - Stop current sequence

Server -> Client:
- `sequenceLibrary { sequences }` - Full library list
- `sequenceLibrarySaved { sequenceId }` - Confirm save
- `sequenceLibraryDeleted { sequenceId }` - Confirm delete
- `sequenceStarted { state }` - Sequence began
- `sequenceProgress { state }` - Step executed (includes commanded value)
- `sequenceCompleted { sequenceId }` - Finished successfully
- `sequenceAborted { sequenceId }` - Stopped by user
- `sequenceError { sequenceId, error }` - Failed

### Random Walk Regeneration

For random walk waveforms, new random values are generated at the start of each cycle:

```typescript
// On cycle completion, regenerate from current value
if (isRandomWalk && currentCycle < totalCycles) {
  const newSteps = generator.generateRandomWalk(params, commandedValue);
  processedSteps = applyModifiers(newSteps, definition);
}
```

This ensures:
- Continuity: Next cycle starts from where previous ended
- True randomness: Different path each cycle
- Bounded behavior: Values stay within min/max limits

### Client Hook

```typescript
const {
  library,           // All saved sequences
  activeState,       // Current playback state (if running)
  saveSequence,      // Save new sequence
  updateSequence,    // Update existing
  deleteSequence,    // Delete from library
  run,               // Start playback
  abort,             // Stop playback
} = useSequencer();
```

## Common Pitfalls

1. **HMR doesn't reset useState initializers** - Changing default values requires page refresh
2. **Serial ports need lock release** - Close transport before rescanning
3. **USB-TMC needs kernel driver detach** - Handle LIBUSB_ERROR_ACCESS
4. **Mode changes affect setpoints** - Fetch new setpoint after mode change API call
5. **SCPI command timing** - Serial devices need delay between commands (50ms typical)

## WebSocket Architecture

### Key Principles

- **Server is single source of truth** - All state lives on server
- **Client is dumb cache** - Receives full state on connect, accumulates incremental updates
- **Pure WebSocket for everything** - Discovery, actions, updates all via WebSocket
- **Multi-device subscription** - Client can subscribe to multiple devices, all messages tagged with deviceId

### Server Components

**DeviceSession** (`server/sessions/DeviceSession.ts`)
- One per device, starts polling immediately when created
- Polls device every 250ms via `driver.getStatus()`
- Maintains history buffer (configurable window, default 30 min)
- Continues polling regardless of subscriber count
- Notifies subscribers on state changes
- Handles server-side debounce for setValue calls

**OscilloscopeSession** (`server/sessions/OscilloscopeSession.ts`)
- Specialized session for oscilloscopes (different from DeviceSession)
- **Auto-streaming**: Automatically starts streaming enabled channels on first status poll
- Default measurements calculated locally from waveform data (VPP, FREQ, VAVG)
- Streams continue regardless of subscriber count (like DeviceSession polling)
- On reconnect, resumes streaming for previously active channels
- On-demand screenshot fetches still available

**SessionManager** (`server/sessions/SessionManager.ts`)
- Creates and manages DeviceSession and OscilloscopeSession instances
- One session per device (type determined by device type)
- Provides device summaries for listing
- Routes client subscriptions and actions to appropriate session type

**WebSocketHandler** (`server/websocket/WebSocketHandler.ts`)
- Handles WebSocket connections and message routing
- Manages client subscriptions (client -> Set<deviceId>)
- Routes client messages to appropriate DeviceSession
- Cleans up on client disconnect

### Client Components

**WebSocket Manager** (`client/src/websocket.ts`)
- Singleton managing WebSocket connection
- Uses Vite proxy (`/ws`) - works for both local dev and remote device access
- Reconnection with exponential backoff (1s, 2s, 4s... max 30s)
- Message queuing during reconnection
- Hooks listen for connection state changes and re-subscribe automatically

**useDeviceSocket Hook** (`client/src/hooks/useDeviceSocket.ts`)
- For PSU/Load devices - dumb mirror of server state
- No local state management, just mirrors what server pushes
- Returns: state, connectionState, isSubscribed, error, and action methods

**useOscilloscopeSocket Hook** (`client/src/hooks/useOscilloscopeSocket.ts`)
- For oscilloscope devices - similar pattern to useDeviceSocket
- Handles oscilloscope-specific state (status, waveform, screenshot)
- Returns: state, waveform, screenshot, and oscilloscope action methods (run, stop, getWaveform, etc.)

**useDeviceList Hook** (`client/src/hooks/useDeviceList.ts`)
- Device discovery via WebSocket
- Re-requests device list on reconnect
- Returns: devices, isLoading, error, refresh, scan

### Connection Resilience

When the WebSocket connection drops:

1. **WebSocket Manager** detects disconnect and begins reconnection with exponential backoff
2. **UI stays visible** - Panels show cached data with red "disconnected" status indicator
3. **On reconnect**:
   - `useDeviceList` re-requests device list
   - `useDeviceSocket` and `useOscilloscopeSocket` re-subscribe to their devices
   - Server resumes streaming (oscilloscope) or polling (PSU/Load) data
4. **Status indicator** returns to green when fully reconnected

### Message Protocol

Client -> Server:
- `getDevices` - Request device list
- `scan` - Trigger device rescan
- `subscribe { deviceId }` - Subscribe to device updates
- `unsubscribe { deviceId }` - Unsubscribe from device
- `setMode { deviceId, mode }` - Change device mode
- `setOutput { deviceId, enabled }` - Enable/disable output
- `setValue { deviceId, name, value, immediate? }` - Set value (debounced by default)

Server -> Client:
- `deviceList { devices }` - List of available devices
- `subscribed { deviceId, state }` - Full state on subscription
- `unsubscribed { deviceId }` - Unsubscribe confirmation
- `measurement { deviceId, update }` - Incremental measurement update
- `field { deviceId, field, value }` - Single field changed
- `error { deviceId?, code, message }` - Error notification
- `scopeWaveform { deviceId, channel, waveform }` - Waveform data response
- `scopeMeasurement { deviceId, channel, measurementType, value }` - Measurement response
- `scopeScreenshot { deviceId, data }` - Screenshot PNG as base64

### Oscilloscope Messages

Client -> Server:
- `scopeRun { deviceId }` - Start acquisition
- `scopeStop { deviceId }` - Stop acquisition
- `scopeSingle { deviceId }` - Single trigger mode
- `scopeAutoSetup { deviceId }` - Auto-configure for signal
- `scopeGetScreenshot { deviceId }` - Request screenshot
- `scopeStartStreaming { deviceId, channels, intervalMs, measurements? }` - Start/restart streaming
- `scopeStopStreaming { deviceId }` - Stop streaming
- `scopeSetTimebaseScale { deviceId, scale }` - Set timebase
- `scopeSetTriggerLevel { deviceId, level }` - Set trigger level
- `scopeSetChannelEnabled { deviceId, channel, enabled }` - Enable/disable channel

Note: Waveforms stream automatically on connection. `scopeStartStreaming` is used to change channels or measurements.

### Data Flow

```
[On Subscribe]
Client                          Server                         Device
   |-- subscribe(deviceId) -->    |                               |
   |<-- subscribed(full state) -- |  (includes complete history)  |

[Ongoing - Server polls device, pushes to clients]
Client                          Server                         Device
   |                              |<-- poll status (250ms) ------>|
   |<-- measurement(delta) -----  |                               |

[State Changes - Server does optimistic update]
Client                          Server                         Device
   |-- setMode(CC) ------------>  |                               |
   |                              | (1) Update local state        |
   |<-- field(mode, CC) --------  | (2) Broadcast immediately     |
   |                              | (3) Send SCPI command ------->|
```

## Testing Strategy

- Mock transports for driver unit tests
- Mock API for React component tests
- Real hardware for integration tests (automated)
- Type safety enforced by shared types

### WebSocket Integration Testing

**Test Client Utility** (`server/websocket/__tests__/TestClient.ts`)

A typed test client for WebSocket communication that provides:
- `connect()` / `close()` - Connection management
- `send(ClientMessage)` - Type-safe message sending
- `waitFor(type, timeoutMs)` - Wait for specific message type
- `waitForMatch(predicate, timeoutMs)` - Wait for message matching predicate
- `request(message, responseType, timeoutMs)` - Send and wait pattern

```typescript
const client = createTestClient('ws://localhost:3001/ws');
await client.connect();

// Request-response pattern
const response = await client.request({ type: 'getDevices' }, 'deviceList');
expect(response.devices.length).toBeGreaterThan(0);

// Subscribe and wait for streaming data
client.send({ type: 'subscribe', deviceId: device.id });
const subscribed = await client.waitFor('subscribed');
const measurement = await client.waitFor('measurement', 1000);

client.close();
```

**Integration Test Setup**

Tests run against a live server with real hardware:
1. Start server with `npm run dev` in background
2. Tests connect to `ws://localhost:3001/ws`
3. Tests use actual Rigol DL3021 and Matrix WPS300S devices

**Key Testing Patterns**

1. **Safe value testing** - When testing setValue, use values within device limits:
   ```typescript
   const safeValue = capabilities.modes[mode].min + 0.01;
   ```

2. **Timing considerations** - Measurements stream at 250ms intervals:
   - Use `waitFor('measurement', 500)` to catch at least one update
   - Don't add arbitrary delays - understand the underlying timing

3. **Subscription lifecycle** - Always unsubscribe in test cleanup:
   ```typescript
   afterEach(async () => {
     client.send({ type: 'unsubscribe', deviceId: subscribedDevice });
     await client.waitFor('unsubscribed');
     client.close();
   });
   ```

4. **Error scenario testing** - Hardware may handle invalid values differently:
   - Some devices clamp values silently
   - Some return errors
   - Test for both outcomes

### Test File Structure

```
server/websocket/__tests__/
├── TestClient.ts          # Typed WebSocket test client
├── TestClient.test.ts     # Unit tests for test client (mock WebSocket)
└── integration.test.ts    # Live hardware integration tests
```

**Integration Test Coverage**:
- Device Discovery: getDevices, scan
- Subscription Lifecycle: subscribe, unsubscribe, full state receipt
- Measurement Streaming: continuous updates, stop on unsubscribe
- Device Actions: setMode, setOutput, setValue (immediate + debounced)
- Error Handling: unknown device, invalid message format
- Multi-client: simultaneous connections, independent subscriptions
