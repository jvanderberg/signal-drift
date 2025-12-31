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
