# Rigol Oscilloscope Driver Implementation Plan

## Overview

Add support for Rigol DS1000Z/DS2000 series oscilloscopes to the lab-controller system. The driver will enable remote control and automated measurements, complementing the existing PSU and electronic load drivers for boost converter testing.

## Goals

1. **Remote control** - Run/stop, trigger settings, channel configuration
2. **Automated measurements** - Query scalar measurements (Vpp, Vavg, frequency, rise time, etc.)
3. **Triggered captures** - Acquire waveform data after trigger events for analysis/logging
4. **Test coordination** - Enable automated test sequences (e.g., step load → capture transient)

## Non-Goals

- Mirroring scope's on-screen display configuration
- Support for non-Rigol oscilloscopes (initially)

---

## Design Decisions

### Decision 1: New Device Type or Extended Interface?

**Options:**
- A) Add `'oscilloscope'` to `DeviceType`, create `OscilloscopeDriver` interface
- B) Extend `DeviceDriver` with optional oscilloscope methods
- C) Completely separate system

**Recommendation:** Option A - New device type with dedicated interface

**Rationale:**
- Oscilloscope concepts don't map to PSU/load paradigm
- Clean separation, no awkward optional methods
- UI can render different components based on device type

### Decision 2: Shared Types Strategy

The current `DeviceStatus` assumes:
```typescript
interface DeviceStatus {
  mode: string;           // CC, CV, etc. - doesn't fit oscilloscope
  outputEnabled: boolean; // Oscilloscope has run/stop, not output enable
  setpoints: Record<string, number>;
  measurements: Record<string, number>;
}
```

**Proposal:** Create parallel oscilloscope types:
```typescript
interface OscilloscopeStatus {
  running: boolean;
  triggerStatus: 'armed' | 'triggered' | 'stopped' | 'auto';
  channels: ChannelStatus[];
  timebase: TimebaseStatus;
  trigger: TriggerStatus;
  measurements: OscilloscopeMeasurement[];
}
```

### Decision 3: Waveform Data Handling

**Options:**
- A) Include waveform data in status polling (expensive)
- B) Separate explicit `getWaveform()` method (on-demand)
- C) Event-based: capture on trigger, emit waveform event

**Recommendation:** Option B - Explicit method, not polled

**Rationale:**
- Waveform transfers are slow (seconds for large captures)
- User/automation decides when to capture
- Polling should be fast (measurements only)

### Decision 4: Measurement Strategy

**Options:**
- A) Driver manages measurement config - track what's added, mirror scope display
- B) Query on-demand, stateless - just query specific measurements directly

**Decision:** Option B - Stateless queries

**Rationale:**
- Configuring the scope's on-screen measurements is clunky, limited space
- `:MEAS:VPP? CHAN1` works whether or not VPP is shown on scope display
- No state to track, no desync if user manually changes scope
- Driver just queries what it's asked for

The driver will have a configurable list of measurements to poll (e.g., `['VPP', 'FREQ']`) and query each for enabled channels. No `addMeasurement()`/`clearMeasurements()` needed.

### Decision 5: Screenshot vs Waveform Rendering

**Screenshot (`:DISP:DATA?`):**
- Returns PNG/BMP of scope display
- Useful for documentation, "save what I'm seeing"
- Driver exposes `getScreenshot()` → returns Buffer
- UI provides download button, not primary display

**Waveform Data (`:WAV:DATA?`):**
- Returns raw samples + scaling preamble
- UI renders waveforms in custom chart component
- Full control over visualization (zoom, pan, overlay, styling)
- Can integrate with PSU/load data on same timeline

**Decision:** UI focuses on waveform data rendering. Screenshot is a download utility.

### Decision 6: WebSocket Protocol Extension

Current protocol uses `measurement` updates with scalar values.

**Decision:** WebSocket for everything, no REST endpoints.

New message types needed:
- `getWaveform { deviceId, channel }` → `waveformData { deviceId, channel, data: WaveformData }`
- `getScreenshot { deviceId }` → `screenshotData { deviceId, png: base64 }`
- `setWaveformStreaming { deviceId, enabled, channels?, interval? }` → enables continuous waveform push

### Decision 7: Waveform Streaming - Don't Rule It Out

USB-TMC is request-response, but even 1fps waveform updates could be useful for:
- Monitoring a signal while adjusting PSU/load
- Watching for transients without manual refresh
- Poor man's remote scope display

**Approach:**
- Benchmark actual transfer times during Phase 1 (measure `:WAV:DATA?` round-trip)
- If feasible (>0.5fps for 1200 points), add optional streaming mode
- Session can enable/disable waveform streaming per channel
- Streaming runs alongside measurement polling, doesn't block it

**Test during implementation:**
- Time to fetch 1200 points (screen buffer, NORM mode)
- Time to fetch 12000 points
- Time to fetch from multiple channels sequentially
- Impact on measurement polling latency

### Decision 8: One Driver, Assume Baseline Compatibility

Rather than separate drivers for DS1000Z, DS2000, MSO5000, etc:
- Single `rigol-oscilloscope.ts` driver
- Assume baseline SCPI compatibility across models
- Probe with `*IDN?`, parse model from response
- If a command fails on a specific model, handle gracefully
- Can add model-specific quirks later if needed

---

## Type Definitions (Proposed)

### Device Types

```typescript
// shared/types.ts additions

type DeviceType = 'power-supply' | 'electronic-load' | 'oscilloscope';

interface ChannelConfig {
  enabled: boolean;
  scale: number;      // V/div
  offset: number;     // V
  coupling: 'AC' | 'DC' | 'GND';
  probe: number;      // 1x, 10x, 100x
  bwLimit: boolean;
}

interface TimebaseConfig {
  scale: number;      // s/div
  offset: number;     // s (horizontal position)
  mode: 'main' | 'zoom' | 'roll';
}

interface TriggerConfig {
  source: string;     // 'CHAN1', 'CHAN2', 'EXT', 'LINE'
  mode: 'edge' | 'pulse' | 'slope' | 'video';
  coupling: 'AC' | 'DC' | 'LFReject' | 'HFReject';
  level: number;      // V
  edge: 'rising' | 'falling' | 'either';
  sweep: 'auto' | 'normal' | 'single';
}

interface OscilloscopeMeasurement {
  channel: string;
  type: string;       // 'VPP', 'VAVG', 'FREQ', 'PERIOD', 'RISE', 'FALL', etc.
  value: number;
  unit: string;
}

interface OscilloscopeStatus {
  running: boolean;
  triggerStatus: 'armed' | 'triggered' | 'stopped' | 'auto' | 'wait';
  sampleRate: number;
  memoryDepth: number;
  channels: Record<string, ChannelConfig>;  // 'CHAN1' -> config
  timebase: TimebaseConfig;
  trigger: TriggerConfig;
  measurements: OscilloscopeMeasurement[];
}

interface WaveformData {
  channel: string;
  points: number[];           // Raw sample values (after scaling)
  xIncrement: number;         // Time between samples
  xOrigin: number;            // Time of first sample
  yIncrement: number;         // Voltage per LSB
  yOrigin: number;            // Voltage offset
  yReference: number;         // Reference point
}
```

### Driver Interface

```typescript
// server/devices/types.ts additions

interface OscilloscopeDriver {
  info: DeviceInfo;
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

interface OscilloscopeCapabilities {
  channels: number;                    // 2 or 4
  bandwidth: number;                   // MHz
  maxSampleRate: number;               // Sa/s
  maxMemoryDepth: number;              // points
  supportedMeasurements: string[];     // ['VPP', 'VAVG', 'FREQ', ...]
  hasAWG: boolean;                     // Built-in arbitrary waveform generator
}
```

---

## Implementation Phases

### Phase 1: Core Driver (TDD)

**Files to create:**
- `server/devices/drivers/rigol-oscilloscope.ts`
- `server/devices/__tests__/rigol-oscilloscope.test.ts`

**Test cases to write first:**

1. **Probe identification**
   - Test: `*IDN?` returns "RIGOL TECHNOLOGIES,DS1054Z,..." → probe returns true, parses model/serial
   - Test: `*IDN?` returns "RIGOL TECHNOLOGIES,DS2072A,..." → probe returns true (different model)
   - Test: `*IDN?` returns "RIGOL TECHNOLOGIES,DL3021,..." → probe returns false (not oscilloscope)
   - Test: `*IDN?` returns non-Rigol → probe returns false
   - Test: `*IDN?` times out → probe returns false

2. **Basic status parsing**
   - Test: Parse run/stop state from `:TRIG:STAT?` response
   - Test: Parse channel enabled from `:CHAN1:DISP?`
   - Test: Parse timebase scale from `:TIM:SCAL?`
   - Test: Parse trigger level from `:TRIG:EDG:LEV?`

3. **Control commands**
   - Test: `run()` sends `:RUN`
   - Test: `stop()` sends `:STOP`
   - Test: `single()` sends `:SING`
   - Test: `setChannelScale('CHAN1', 1.0)` sends `:CHAN1:SCAL 1.0`

4. **Measurement queries (stateless)**
   - Test: `getMeasurement('CHAN1', 'VPP')` sends `:MEAS:VPP? CHAN1`
   - Test: Parse numeric response "3.28E+00" → 3.28
   - Test: Handle "****" response → returns null
   - Test: `getMeasurements('CHAN1', ['VPP', 'FREQ'])` returns `{ VPP: 3.28, FREQ: 1000 }`

5. **Waveform acquisition**
   - Test: Correct command sequence for waveform read (`:WAV:SOUR`, `:WAV:MODE`, `:WAV:FORM`, `:WAV:PRE?`, `:WAV:DATA?`)
   - Test: Parse preamble response into scaling factors
   - Test: Parse TMC block format header (`#9000001200...`)
   - Test: Convert raw bytes to voltage values using preamble scaling

6. **Screenshot**
   - Test: `getScreenshot()` sends `:DISP:DATA? ON,OFF,PNG`
   - Test: Returns raw PNG buffer

7. **Transfer benchmarks** (with real hardware, informational)
   - Measure: Time to fetch 1200 points NORM mode
   - Measure: Time to fetch 12000 points
   - Measure: Time to fetch 120000 points (if supported)
   - Measure: Sequential fetch of 2 channels
   - Measure: Screenshot fetch time
   - Document results to inform streaming feasibility

### Phase 2: Scanner Integration

**Files to modify:**
- `server/devices/registry.ts`
- `server/devices/scanner.ts`

**Test cases:**

1. **USB device matching**
   - Test: Vendor 0x1AB1 (Rigol) triggers oscilloscope driver probe
   - Test: Probe differentiates oscilloscope (DS/MSO prefix) from other Rigol devices (DL, DP, etc.)

2. **Probe and register**
   - Test: Successful probe adds to registry with correct info
   - Test: Failed probe doesn't add device

### Phase 3: Types & Shared Code

**Files to modify:**
- `shared/types.ts` - Add oscilloscope types
- `server/devices/types.ts` - Add OscilloscopeDriver interface

**Considerations:**
- Ensure backward compatibility with existing PSU/Load code
- Consider union types for device-specific status

### Phase 4: Session & WebSocket

**Files to create/modify:**
- `server/sessions/OscilloscopeSession.ts` (new)
- `server/sessions/SessionManager.ts` (modify)
- `server/websocket/WebSocketHandler.ts` (modify)
- `shared/types.ts` - WebSocket message types

**New WebSocket messages:**

```typescript
// Client -> Server
| { type: 'scopeRun'; deviceId: string }
| { type: 'scopeStop'; deviceId: string }
| { type: 'scopeSingle'; deviceId: string }
| { type: 'scopeAutoSetup'; deviceId: string }
| { type: 'scopeSetChannel'; deviceId: string; channel: string; config: Partial<ChannelConfig> }
| { type: 'scopeSetTimebase'; deviceId: string; scale: number; offset?: number }
| { type: 'scopeSetTrigger'; deviceId: string; config: Partial<TriggerConfig> }
| { type: 'scopeGetWaveform'; deviceId: string; channel: string }
| { type: 'scopeGetScreenshot'; deviceId: string }
| { type: 'scopeSetStreaming'; deviceId: string; enabled: boolean; channels?: string[]; interval?: number }

// Server -> Client
| { type: 'scopeStatus'; deviceId: string; status: OscilloscopeStatus }
| { type: 'scopeWaveform'; deviceId: string; channel: string; data: WaveformData }
| { type: 'scopeScreenshot'; deviceId: string; png: string }  // base64
```

**Test cases:**

1. **Session polling**
   - Test: Session polls status at configured interval
   - Test: Measurement updates sent to subscribers
   - Test: Polling stops on unsubscribe

2. **Control actions**
   - Test: `scopeRun` message triggers `driver.run()`
   - Test: `scopeSetChannel` message triggers correct driver method

3. **Waveform requests (on-demand)**
   - Test: `scopeGetWaveform` fetches and returns waveform data
   - Test: Large waveforms encoded correctly

4. **Waveform streaming (if benchmarks support it)**
   - Test: `scopeSetStreaming` enables periodic waveform push
   - Test: Streaming respects configured interval
   - Test: Streaming can be disabled
   - Test: Streaming doesn't block measurement polling

5. **Screenshot**
   - Test: `scopeGetScreenshot` returns base64 PNG

### Phase 5: Client UI (Separate Planning)

Not covered in this plan - requires separate UI design document.

---

## SCPI Command Reference

### Identification
```
*IDN?  →  "RIGOL TECHNOLOGIES,DS1054Z,DS1ZA123456789,00.04.04.SP3"
```

### Run Control
```
:RUN           # Start acquisition
:STOP          # Stop acquisition
:SING          # Single trigger mode
:TFOR          # Force trigger
:AUT           # Auto setup
```

### Trigger Status
```
:TRIG:STAT?    →  "TD" | "WAIT" | "RUN" | "AUTO" | "STOP"
```

### Channel Configuration
```
:CHAN1:DISP?       →  "0" | "1"
:CHAN1:DISP ON
:CHAN1:SCAL?       →  "1.00E+00" (V/div)
:CHAN1:SCAL 0.5
:CHAN1:OFFS?       →  "0.00E+00" (V)
:CHAN1:OFFS -2.5
:CHAN1:COUP?       →  "DC" | "AC" | "GND"
:CHAN1:COUP DC
:CHAN1:PROB?       →  "10" (probe ratio)
:CHAN1:PROB 10
```

### Timebase
```
:TIM:SCAL?         →  "1.00E-03" (s/div)
:TIM:SCAL 0.001
:TIM:OFFS?         →  "0.00E+00" (s)
:TIM:OFFS 0
```

### Trigger
```
:TRIG:MODE?        →  "EDGE" | "PULS" | "SLOP" | ...
:TRIG:EDG:SOUR?    →  "CHAN1" | "CHAN2" | "EXT" | ...
:TRIG:EDG:SOUR CHAN1
:TRIG:EDG:LEV?     →  "1.50E+00" (V)
:TRIG:EDG:LEV 1.5
:TRIG:EDG:SLOP?    →  "POS" | "NEG" | "RFAL"
:TRIG:EDG:SLOP POS
:TRIG:SWE?         →  "AUTO" | "NORM" | "SING"
:TRIG:SWE NORM
```

### Measurements
```
:MEAS:VPP? CHAN1   →  "3.28E+00" or "****" (invalid)
:MEAS:VAVG? CHAN1
:MEAS:VRMS? CHAN1
:MEAS:FREQ? CHAN1
:MEAS:PER? CHAN1
:MEAS:RISE? CHAN1
:MEAS:FALL? CHAN1
:MEAS:PDUTy? CHAN1 (duty cycle)
```

### Waveform Data
```
:WAV:SOUR CHAN1         # Select source
:WAV:MODE NORM          # NORM, MAX, RAW
:WAV:FORM BYTE          # BYTE, WORD, ASCii
:WAV:STAR 1             # Start point
:WAV:STOP 1200          # End point
:WAV:PRE?               # Get preamble (scaling info)
:WAV:DATA?              # Get data (TMC block format)
```

### Screenshot
```
:DISP:DATA? ON,OFF,PNG  # Get screenshot (format varies by model)
```

---

## Test File Structure

```
server/devices/__tests__/
├── mock-transport.ts              # Existing - reuse
├── rigol-oscilloscope.test.ts     # New - driver unit tests
└── rigol-oscilloscope.integration.ts # New - real hardware tests (manual)
```

### Mock Transport Extensions

May need to extend mock transport for:
- Binary response simulation (waveform data)
- TMC block format responses
- Response delays (for timeout testing)

---

## Open Questions

1. ~~**Model variations**~~ - RESOLVED: One driver, assume baseline compatibility. Parse model from `*IDN?`, handle quirks as discovered.

2. **Polling frequency** - PSU/load poll at 250ms. Oscilloscope status queries are heavier. What interval? Probably 500ms-1s for status, waveforms on-demand only.

3. **Waveform storage** - Should server cache last waveform? Or always fetch fresh? Leaning toward: don't cache, always fresh. Client can cache if needed.

4. ~~**Measurement configuration**~~ - RESOLVED: Stateless queries. Session config specifies which measurements to poll (e.g., `['VPP', 'FREQ']`), driver queries them directly without touching scope's display config.

5. **Math channels** - Support MATH channel (FFT, etc.) or just analog channels? Defer - start with analog only, add MATH if needed.

---

## Dependencies

- Existing USB-TMC transport (no changes needed)
- Existing registry/scanner pattern
- Vitest for testing
- Mock transport for unit tests

---

## Estimated Effort

| Phase | Description | Relative Size |
|-------|-------------|---------------|
| 1 | Core driver + tests | Large |
| 2 | Scanner integration | Small |
| 3 | Types & shared code | Medium |
| 4 | Session & WebSocket | Medium |
| 5 | Client UI | Large (separate plan) |

---

## Implementation Status

### ✅ Completed (Phase 1 - Core Driver)
- ✅ Type definitions in `shared/types.ts` (OscilloscopeStatus, ChannelConfig, etc.)
- ✅ OscilloscopeDriver interface in `server/devices/types.ts`
- ✅ Mock transport extended for binary responses
- ✅ Driver implementation: `server/devices/drivers/rigol-oscilloscope.ts`
- ✅ Unit tests: `server/devices/__tests__/rigol-oscilloscope.test.ts` (70 tests)
- ✅ Integration test: `server/devices/__tests__/rigol-oscilloscope.integration.ts`

### ✅ Completed (Phase 2 - Scanner Integration)
- ✅ Pattern-based driver matching (manufacturer/model regex with specificity)
- ✅ Registry extended with oscilloscope methods
- ✅ Scanner updated to detect and register oscilloscopes
- ✅ Rigol DS/MSO driver registered in `server/index.ts`

### ✅ Completed (Phase 3 - Session & WebSocket)
- ✅ `OscilloscopeSession.ts` - State management with 500ms status polling
- ✅ SessionManager integration with oscilloscope-specific methods
- ✅ WebSocket message handlers for all oscilloscope operations:
  - `scopeRun`, `scopeStop`, `scopeSingle`, `scopeAutoSetup`
  - `scopeGetWaveform`, `scopeGetMeasurement`, `scopeGetScreenshot`
- ✅ Server message types: `scopeWaveform`, `scopeMeasurement`, `scopeScreenshot`

### ✅ Completed (Phase 4 - Client UI)
- ✅ `useOscilloscopeSocket.ts` - React hook for oscilloscope state via WebSocket
- ✅ `OscilloscopePanel.tsx` - Full oscilloscope control panel with:
  - Run/Stop/Single/Auto controls
  - Channel selection and status display
  - Waveform visualization (SVG canvas)
  - Timebase and trigger info display
  - Screenshot capture and display
- ✅ Updated `DeviceScanner.tsx` with oscilloscope icon
- ✅ Updated `EditableDeviceHeader.tsx` for oscilloscope type
- ✅ Updated `App.tsx` to route oscilloscopes to OscilloscopePanel

### Hardware Test Results (DS1202Z-E)

| Operation | Time | Notes |
|-----------|------|-------|
| Status query (full) | ~30ms | All channels, timebase, trigger |
| Single measurement | ~1ms | VPP, VAVG, FREQ, etc. |
| Screenshot | ~420ms | PNG format |
| Waveform (1200 pts) | ~50ms | TMC block parsing working |

### Known Issues / Future Work

1. **USB-TMC timeout cascade** - After one query times out, subsequent queries may also timeout. Need to implement buffer flush/reset between commands.

2. **Memory depth "AUTO"** - When scope is set to AUTO memory depth, `:ACQ:MDEP?` returns "AUTO" instead of a number. Driver returns 0 in this case.

3. **Measurement overflow** - Rigol scopes return 9.9E37 for invalid measurements. Driver correctly handles this as null.

4. **Channel/Timebase/Trigger configuration UI** - The UI currently displays settings but doesn't allow changing them. Future work to add configuration controls.

5. **Waveform streaming** - Currently on-demand only. Could add optional continuous streaming if performance allows.

## Next Steps

All initial implementation phases complete. Future enhancements:
1. Add channel/timebase/trigger configuration controls to UI
2. Add measurement display panel
3. Consider waveform streaming mode
4. Add support for MATH and FFT channels
5. Test with other Rigol oscilloscope models (DS2000, MSO5000, etc.)
