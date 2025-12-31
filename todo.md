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
