# Rigol DS1000Z USBTMC Waveform Corruption Fix

## Problem

Waveform data from Rigol DS1202Z-E oscilloscope via USBTMC showed corruption at byte position 688. The value at position 688 displayed ~-2.76V when surrounding values were ~+3.3V, causing a 6V spike in the waveform display.

## Root Cause

The Rigol DS1000Z series has a USBTMC protocol quirk: **the `transferSize` field in the USBTMC header is incorrect**.

### What Was Happening

1. We send a `REQUEST_DEV_DEP_MSG_IN` to request waveform data
2. Rigol responds with a USBTMC message header claiming `transferSize=500`
3. We read 500 bytes and stop (trusting the header)
4. **But Rigol actually sent ~700 bytes** - the remaining ~200 bytes stay in the USB buffer
5. We send the next REQUEST
6. We start reading the new response, but **the old 200 bytes are still in the buffer**
7. These leftover bytes get concatenated with the new response
8. The data is now misaligned, with a newline character (0x0a) appearing at position 688

### Debug Evidence

```
MSG 0: transferSize=500 (LIE - actually sent ~700 bytes)
  Waveform positions 0-488: values 73-76 (0x49-0x4c) = ~0V

MSG 2: transferSize=712
  First 24 bytes: a2 a4 a3 a3... = ~3.3V values

Byte 688 = 0x0a (newline!) - this is the message terminator that got included as data
Byte 689 = 0xa2 (162) - start of actual MSG 2 data
```

The newline at position 688 converted to voltage:
```
voltage = (10 - 100 - 128) * 0.04 = -8.72V  (displayed as ~-2.76V with different scaling)
```

## Solution

**Don't trust `transferSize`. Read until short packet, then use IEEE block header for total length.**

For each REQUEST:
1. Send REQUEST_DEV_DEP_MSG_IN
2. Read USB packets until we receive a **short packet** (< 64 bytes)
   - Short packet = device is done responding to THIS request
   - This fully drains the USB buffer before the next REQUEST
3. Strip the 12-byte USBTMC header (ignore its `transferSize`)
4. Concatenate the payload
5. Repeat until we have all bytes per the IEEE 488.2 block header (`#9000001200`)

### Key Insight

The python-usbtmc library documents similar Rigol quirks but for different product IDs (0x04ce, 0x0588). The DS1000Z series (PID 0x0517) has the **same quirks** but wasn't in their list.

## References

- [python-usbtmc Rigol quirk handling](https://github.com/python-ivi/python-usbtmc/blob/master/usbtmc/usbtmc.py)
- USB-TMC Specification (USB Test & Measurement Class)
- IEEE 488.2 Block Data Format (`#NXXXXXXXX...data...`)

## Test Results

Before fix:
```
Points 685-694: -0.12, -0.20, -0.24, -2.76, 3.40, 3.32, 3.40, 3.32, 3.36, 3.32
Max voltage jump: 6.160V at 688->689
```

After fix:
```
Points 685-694: 3.32, 3.40, 3.36, 3.40, 3.32, 3.40, 3.32, 3.40, 3.36, 3.40
Max voltage jump: 0.080V at 688->689
```
