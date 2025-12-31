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
