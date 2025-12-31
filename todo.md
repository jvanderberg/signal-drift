# TODO

## Oscilloscope Capture Optimization

Current: ~3fps for 2 channels

### Problem
Each `getWaveform()` call does 8 round trips:
```
:WAV:SOUR      → set channel
:WAV:MODE NORM → set mode (same every time)
:WAV:FORM BYTE → set format (same every time)
:WAV:STAR/STOP → range
:WAV:PRE?      → preamble (only changes with timebase)
:WAV:YOR?      → Y origin (only changes with V/div)
:WAV:YREF?     → Y reference (only changes with V/div)
:WAV:DATA?     → actual data
```

2 channels × 8 commands = 16 round trips at ~20ms each = 320ms/frame

### Solution
Cache settings that don't change frequently:

1. Set `:WAV:MODE NORM` and `:WAV:FORM BYTE` once when streaming starts
2. Cache PRE/YOR/YREF per channel, only refresh when timebase/voltage scale changes
3. Per frame: just SOUR + DATA? (2 commands per channel)

Result: 16 → 4 round trips, should roughly double framerate to 6-7fps

### Implementation
- Add `preambleCache` map in oscilloscope driver
- Add `initializeWaveformFormat()` call at streaming start
- Invalidate cache when user changes scale (or refresh every N seconds as fallback)

---

## Config-Driven SCPI Drivers

Instead of writing code for each device, describe devices declaratively.

### Concept
```yaml
# drivers/configs/matrix-wps300s.yaml
name: Matrix WPS300S
class: psu

match:
  method: probe          # or 'idn' for *IDN? matching
  probeCommand: "VOLT?"
  probeExpect: numeric

info:
  manufacturer: Matrix
  model: WPS300S

channels:
  - { id: CH1, prefix: "" }

capabilities:
  modes: [CV, CC]
  modesSettable: false
  modesQueryable: false
  voltageRange: [0, 80]
  currentRange: [0, 10]

commands:
  getVoltageSetpoint: "{prefix}VOLT?"
  getCurrentSetpoint: "{prefix}CURR?"
  getMeasuredVoltage: "{prefix}MEAS:VOLT?"
  getMeasuredCurrent: "{prefix}MEAS:CURR?"
  getOutputState: "{prefix}OUTP?"
  setVoltage: "{prefix}VOLT {value}"
  setCurrent: "{prefix}CURR {value}"
  setOutput: "{prefix}OUTP {value}"

parsing:
  outputState: { "1": true, "0": false, "ON": true, "OFF": false }

quirks:
  commandDelayMs: 50
  inferModeFromMeasurements: true
  verifySetValue: true
```

### Benefits
- Add new devices without writing code
- Community can contribute drivers via config files
- Self-documenting device support
- Easier to validate and test

### Scope
- Good fit: PSUs, electronic loads, DMMs (simple command/response)
- Needs code: Oscilloscopes (binary waveform parsing, streaming)
- Hybrid approach: Config for simple devices, code for complex ones

### Implementation
1. Define JSON schema for driver configs
2. Create `drivers/configs/` directory for YAML files
3. Build generic driver factory that loads configs
4. Loader scans configs at startup, registers drivers
5. Validation at load time (schema + command syntax check)

---

## Software AWG / Sequencer

Software-driven arbitrary waveform control for any settable device parameter.

### Concept
Send setpoint commands at timed intervals to create waveforms. Works with any device, no hardware list mode required.

```
Fixed intervals, waveform shape in values:
Time:  0     100    200    300    400    500ms
       │      │      │      │      │      │
Value: 5.0   7.1    9.0    7.1    5.0    7.1
```

### Constraints
- USB/serial latency: ~20-50ms per command
- Practical max frequency: ~5-10 Hz
- Slower devices further limited (e.g., Matrix PSU with 50ms command delay)

### Waveform Definition

**Standard shapes:**
- Sine, triangle, ramp, square, steps
- Parameters: min, max, points per cycle, interval

**Arbitrary upload (CSV):**
```csv
# Dwell time format (industry standard)
value, dwell_ms
5.0, 100
10.0, 500
0.0, 100
```

### Parameters
- Target device + parameter (whitelisted in driver config)
- Waveform type or arbitrary data
- Interval (fixed ms between points)
- Interpolation: step (hold) or linear (ramp between points)

### Repeat Behavior
- Once
- N times
- Continuous (until stopped)

### Triggers

**Start when:**
- Immediately
- Output enabled
- Measurement threshold (e.g., "when current > 1A")
- Manual button

**Run until:**
- Waveform complete
- N cycles
- Measurement threshold (e.g., "stop if voltage < 2V")
- Manual stop

### Additional Features
- Pre/post values (set before start, after complete)
- Scaling (multiply all values by factor)
- Offset (add constant to all values)
- Max value clamp (safety limit)
- Max slew rate (protect DUT)
- Save/load named sequences to library

### Driver Config
```yaml
awgAllowed:
  - voltage
  - current
# Whitelist sensible parameters only
```

### Implementation
1. AWG controller wraps device session
2. Timer-based execution of setpoints
3. WebSocket events for progress/status
4. API for upload, start, stop, pause
5. UI for waveform config and visualization
6. Sequence library (save/load)

---

## Click-to-Measure (Oscilloscope)

Replace clunky hardware cursors with intuitive click-based measurements.

### Concept
Click two points on the waveform, get instant measurements. No cursor modes, no knob nudging, no separate readout panels.

### Interaction
1. Click point A on waveform → mark it
2. Click point B on waveform → show measurements

**Displays:**
- V₁, V₂, ΔV
- T₁, T₂, ΔT
- Slew rate (ΔV/ΔT) in V/s or V/ms
- Frequency (1/ΔT)

### Additional Interactions
- Hover: show instantaneous V/T at cursor position
- Drag: select range (alternative to two clicks)
- Click-drag on waveform: quick slope measurement
- Right-click: pin measurement (keep visible)
- ESC or click elsewhere: clear measurement

### UI
- Overlay on waveform canvas
- Minimal, non-intrusive display
- Lines connecting measured points
- Values near the selection, not in a separate panel

### Implementation
1. Canvas click handlers for point selection
2. Find nearest waveform sample to click coordinates
3. Calculate derived values (ΔV, ΔT, slew, freq)
4. Render overlay with measurement lines and values
5. State management for pinned measurements

---

## Reactive Triggers + Scripting

Event-driven automation using live device values. No polling loops, no explicit reads - values are already streaming.

### Concept
Combine reactive triggers with the sequencer for powerful automation without a general-purpose scripting language.

**Triggers** = "when X, do Y" (reactive)
**Sequences** = "do these steps" (imperative)
**Together** = automated test procedures, safety interlocks, conditional workflows

### Trigger Types

**Value triggers:**
```
when psu.voltage > 10:
  load.resistance = 20
```

**Time triggers (relative to script start):**
```
at t=0:      psu.output = on
at t=10s:    run sequence "ramp_up"
at t=100s:   snapshot
at t=120s:   end
```

**Event-relative time:**
```
when psu.output == on:
  at t+5s: run sequence "ramp"   # 5s after trigger fired
```

**Edge detection:**
```
when rising psu.current > 1:    # trigger on transition, not steady state
  log "current exceeded 1A"
```

### Trigger Modifiers
- `once` - fire only first time condition met
- `repeat` - fire every time (with debounce)
- `debounce: 100ms` - don't re-trigger within window
- `rising` / `falling` - edge detection

### Actions
- Set device value
- Start/stop/pause sequence
- Output on/off
- Snapshot (log all current values)
- Export data
- End script
- Alert/notification

### GUI Trigger Builder
```
┌─────────────────────────────────────────────────────┐
│ Trigger 1                                      [x]  │
├─────────────────────────────────────────────────────┤
│ WHEN: [psu.voltage ▼] [> ▼] [10 V    ]             │
│ THEN: [set value   ▼] [load.resistance] [20 Ω]    │
│       [x] Once  [ ] Repeat  Debounce: [100ms]      │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ Trigger 2 (time)                               [x]  │
├─────────────────────────────────────────────────────┤
│ AT:   [30 s] from start                            │
│ THEN: [snapshot ▼]                                 │
└─────────────────────────────────────────────────────┘

         [+ Add Trigger]    [▶ Run Script]
```

### Example: Automated Load Test
```
# Setup
at t=0:
  psu.voltage = 5
  psu.current = 2
  psu.output = on

# Ramp load after stabilization
at t=2s:
  run sequence "load_ramp"

# Safety interlock
when psu.current > 1.9:
  snapshot
  psu.output = off
  alert "Current limit reached"
  end

# Periodic logging
every 1s:
  snapshot

# End after 60s
at t=60s:
  psu.output = off
  export "load_test_results.csv"
  end
```

### Advanced Features
- Access to history: `psu.voltage.avg(1s) > 10`
- Multiple conditions: `when psu.voltage > 10 and load.current < 0.5`
- Trigger chaining: `when sequence "ramp" complete: run sequence "hold"`

### Implementation
1. Trigger engine evaluates conditions against live values
2. Time triggers use elapsed time from script start
3. Action dispatcher executes trigger actions
4. Integrates with sequencer for `run sequence` actions
5. GUI builder for no-code trigger creation
6. Save/load trigger sets
