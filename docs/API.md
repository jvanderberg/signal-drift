# Lab Controller WebSocket API Reference

All real-time communication uses WebSocket. The REST API is deprecated and maintained only for backward compatibility.

## Connection

**Endpoint:** `ws://localhost:3001/ws`

**Via Vite Proxy (development):** `ws://localhost:5173/ws`

The client should connect to the WebSocket endpoint on startup. The connection supports automatic reconnection with exponential backoff.

```javascript
const ws = new WebSocket('ws://localhost:3001/ws');

ws.onopen = () => {
  console.log('Connected');
  ws.send(JSON.stringify({ type: 'getDevices' }));
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Received:', message);
};
```

---

## Message Format

All messages are JSON objects with a `type` field.

**Client → Server:** `ClientMessage`
**Server → Client:** `ServerMessage`

---

## Device Discovery

### Get Device List

Request the current list of connected devices.

**Request:**
```json
{ "type": "getDevices" }
```

**Response:**
```json
{
  "type": "deviceList",
  "devices": [
    {
      "id": "rigol-dl3021-DL3A123456789",
      "info": {
        "id": "rigol-dl3021-DL3A123456789",
        "type": "electronic-load",
        "manufacturer": "Rigol",
        "model": "DL3021",
        "serial": "DL3A123456789"
      },
      "capabilities": {
        "deviceClass": "load",
        "features": { "listMode": true },
        "modes": ["CC", "CV", "CR", "CP"],
        "modesSettable": true,
        "outputs": [...],
        "measurements": [...]
      },
      "connectionStatus": "connected"
    }
  ]
}
```

### Scan for Devices

Trigger a manual rescan for connected devices. Useful after connecting new hardware.

**Request:**
```json
{ "type": "scan" }
```

**Response:** `deviceList` message with updated device list.

---

## Device Subscription

### Subscribe to Device

Subscribe to real-time updates from a device. Returns full state on subscription.

**Request:**
```json
{
  "type": "subscribe",
  "deviceId": "rigol-dl3021-DL3A123456789"
}
```

**Response:**
```json
{
  "type": "subscribed",
  "deviceId": "rigol-dl3021-DL3A123456789",
  "state": {
    "info": {...},
    "capabilities": {...},
    "connectionStatus": "connected",
    "consecutiveErrors": 0,
    "mode": "CC",
    "outputEnabled": false,
    "setpoints": {
      "current": 1.0,
      "voltage": 30.0,
      "resistance": 100.0,
      "power": 50.0
    },
    "measurements": {
      "voltage": 12.48,
      "current": 0.0,
      "power": 0.0,
      "resistance": 9999999
    },
    "history": {
      "timestamps": [1704307200000, 1704307200250, ...],
      "voltage": [12.48, 12.47, ...],
      "current": [0.0, 0.0, ...],
      "power": [0.0, 0.0, ...],
      "resistance": [9999999, 9999999, ...]
    },
    "lastUpdated": 1704307200500
  }
}
```

### Unsubscribe from Device

Stop receiving updates from a device.

**Request:**
```json
{
  "type": "unsubscribe",
  "deviceId": "rigol-dl3021-DL3A123456789"
}
```

**Response:**
```json
{
  "type": "unsubscribed",
  "deviceId": "rigol-dl3021-DL3A123456789"
}
```

---

## Device Control

### Set Mode

Change the operating mode of a device.

**Request:**
```json
{
  "type": "setMode",
  "deviceId": "rigol-dl3021-DL3A123456789",
  "mode": "CV"
}
```

**Response:** `field` message confirming mode change.
```json
{
  "type": "field",
  "deviceId": "rigol-dl3021-DL3A123456789",
  "field": "mode",
  "value": "CV"
}
```

**Valid Modes:**
| Device Class | Modes |
|--------------|-------|
| PSU | `CV`, `CC` |
| Load | `CC`, `CV`, `CR`, `CP` |

### Set Output

Enable or disable device output.

**Request:**
```json
{
  "type": "setOutput",
  "deviceId": "rigol-dl3021-DL3A123456789",
  "enabled": true
}
```

**Response:** `field` message confirming output state.

### Set Value

Set a device setpoint (voltage, current, resistance, power).

**Request:**
```json
{
  "type": "setValue",
  "deviceId": "rigol-dl3021-DL3A123456789",
  "name": "current",
  "value": 1.5,
  "immediate": false
}
```

**Parameters:**
| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Parameter name: `voltage`, `current`, `resistance`, `power` |
| `value` | number | New value |
| `immediate` | boolean | If `false` (default), debounced ~100ms for UI spinners. If `true`, executed immediately for programmatic control. |

**Response:** `field` message with updated setpoints.

---

## Measurement Updates

After subscribing, you'll receive periodic measurement updates:

```json
{
  "type": "measurement",
  "deviceId": "rigol-dl3021-DL3A123456789",
  "update": {
    "timestamp": 1704307200750,
    "measurements": {
      "voltage": 12.52,
      "current": 1.48,
      "power": 18.53,
      "resistance": 8.46
    }
  }
}
```

Updates are sent at the polling interval (default: 250ms).

---

## Oscilloscope API

### Run/Stop Acquisition

**Run:**
```json
{ "type": "scopeRun", "deviceId": "..." }
```

**Stop:**
```json
{ "type": "scopeStop", "deviceId": "..." }
```

**Single Trigger:**
```json
{ "type": "scopeSingle", "deviceId": "..." }
```

**Auto Setup:**
```json
{ "type": "scopeAutoSetup", "deviceId": "..." }
```

### Waveform Streaming

Start streaming waveform data for specified channels.

**Request:**
```json
{
  "type": "scopeStartStreaming",
  "deviceId": "...",
  "channels": ["CHAN1", "CHAN2"],
  "intervalMs": 100,
  "measurements": ["VPP", "FREQ"]
}
```

**Response (repeating):**
```json
{
  "type": "scopeWaveform",
  "deviceId": "...",
  "channel": "CHAN1",
  "waveform": {
    "channel": "CHAN1",
    "points": [0.12, 0.15, 0.18, ...],
    "xIncrement": 0.0000001,
    "xOrigin": -0.0006,
    "yIncrement": 0.04,
    "yOrigin": 0,
    "yReference": 128
  }
}
```

**Stop Streaming:**
```json
{ "type": "scopeStopStreaming", "deviceId": "..." }
```

### Channel Settings

**Enable/Disable Channel:**
```json
{
  "type": "scopeSetChannelEnabled",
  "deviceId": "...",
  "channel": "CHAN1",
  "enabled": true
}
```

**Set Channel Scale (V/div):**
```json
{
  "type": "scopeSetChannelScale",
  "deviceId": "...",
  "channel": "CHAN1",
  "scale": 1.0
}
```

**Set Channel Offset:**
```json
{
  "type": "scopeSetChannelOffset",
  "deviceId": "...",
  "channel": "CHAN1",
  "offset": 0.0
}
```

**Set Channel Coupling:**
```json
{
  "type": "scopeSetChannelCoupling",
  "deviceId": "...",
  "channel": "CHAN1",
  "coupling": "DC"
}
```
Valid values: `AC`, `DC`, `GND`

**Set Probe Ratio:**
```json
{
  "type": "scopeSetChannelProbe",
  "deviceId": "...",
  "channel": "CHAN1",
  "ratio": 10
}
```

**Set Bandwidth Limit:**
```json
{
  "type": "scopeSetChannelBwLimit",
  "deviceId": "...",
  "channel": "CHAN1",
  "enabled": true
}
```

### Timebase Settings

**Set Timebase Scale (s/div):**
```json
{
  "type": "scopeSetTimebaseScale",
  "deviceId": "...",
  "scale": 0.001
}
```

**Set Timebase Offset:**
```json
{
  "type": "scopeSetTimebaseOffset",
  "deviceId": "...",
  "offset": 0.0
}
```

### Trigger Settings

**Set Trigger Source:**
```json
{
  "type": "scopeSetTriggerSource",
  "deviceId": "...",
  "source": "CHAN1"
}
```

**Set Trigger Level:**
```json
{
  "type": "scopeSetTriggerLevel",
  "deviceId": "...",
  "level": 1.5
}
```

**Set Trigger Edge:**
```json
{
  "type": "scopeSetTriggerEdge",
  "deviceId": "...",
  "edge": "rising"
}
```
Valid values: `rising`, `falling`, `either`

**Set Trigger Sweep:**
```json
{
  "type": "scopeSetTriggerSweep",
  "deviceId": "...",
  "sweep": "auto"
}
```
Valid values: `auto`, `normal`, `single`

### Screenshot

**Request:**
```json
{ "type": "scopeGetScreenshot", "deviceId": "..." }
```

**Response:**
```json
{
  "type": "scopeScreenshot",
  "deviceId": "...",
  "data": "iVBORw0KGgoAAAANSUhEUgAAA..."
}
```
Data is base64-encoded PNG.

---

## Sequence API

### List Sequences

**Request:**
```json
{ "type": "sequenceLibraryList" }
```

**Response:**
```json
{
  "type": "sequenceLibrary",
  "sequences": [
    {
      "id": "seq-123",
      "name": "Sine Wave Test",
      "unit": "V",
      "waveform": {
        "type": "sine",
        "min": 0,
        "max": 10,
        "pointsPerCycle": 20,
        "intervalMs": 100
      },
      "createdAt": 1704307200000,
      "updatedAt": 1704307200000
    }
  ]
}
```

### Save Sequence

**Request:**
```json
{
  "type": "sequenceLibrarySave",
  "definition": {
    "name": "My Sequence",
    "unit": "A",
    "waveform": {
      "type": "triangle",
      "min": 0,
      "max": 2,
      "pointsPerCycle": 10,
      "intervalMs": 200
    }
  }
}
```

**Response:**
```json
{
  "type": "sequenceLibrarySaved",
  "sequenceId": "seq-456"
}
```

### Run Sequence

**Request:**
```json
{
  "type": "sequenceRun",
  "config": {
    "sequenceId": "seq-123",
    "deviceId": "rigol-dl3021-DL3A123456789",
    "parameter": "voltage",
    "repeatMode": "count",
    "repeatCount": 3
  }
}
```

**Response (stream):**
```json
{ "type": "sequenceStarted", "state": {...} }
{ "type": "sequenceProgress", "state": {...} }
{ "type": "sequenceProgress", "state": {...} }
{ "type": "sequenceCompleted", "sequenceId": "seq-123" }
```

### Abort Sequence

**Request:**
```json
{ "type": "sequenceAbort" }
```

**Response:**
```json
{ "type": "sequenceAborted", "sequenceId": "seq-123" }
```

---

## Trigger Script API

### List Scripts

**Request:**
```json
{ "type": "triggerScriptLibraryList" }
```

**Response:**
```json
{
  "type": "triggerScriptLibrary",
  "scripts": [
    {
      "id": "script-123",
      "name": "Safety Shutdown",
      "triggers": [
        {
          "id": "trig-1",
          "condition": {
            "type": "value",
            "deviceId": "...",
            "parameter": "current",
            "operator": ">",
            "value": 5.0
          },
          "action": {
            "type": "setOutput",
            "deviceId": "...",
            "enabled": false
          },
          "repeatMode": "once",
          "debounceMs": 0
        }
      ],
      "createdAt": 1704307200000,
      "updatedAt": 1704307200000
    }
  ]
}
```

### Run Script

**Request:**
```json
{
  "type": "triggerScriptRun",
  "scriptId": "script-123"
}
```

**Response (stream):**
```json
{ "type": "triggerScriptStarted", "state": {...} }
{ "type": "triggerScriptProgress", "state": {...} }
{ "type": "triggerFired", "scriptId": "...", "triggerId": "trig-1", "triggerState": {...} }
```

### Stop Script

**Request:**
```json
{ "type": "triggerScriptStop" }
```

---

## Error Handling

Errors are returned as:

```json
{
  "type": "error",
  "deviceId": "...",
  "code": "DEVICE_NOT_FOUND",
  "message": "Device not found: invalid-id"
}
```

**Error Codes:**

| Code | Description |
|------|-------------|
| `DEVICE_NOT_FOUND` | The specified device ID doesn't exist |
| `NOT_SUBSCRIBED` | Tried to control a device without subscribing first |
| `INVALID_MESSAGE` | Message format was invalid |
| `DEVICE_ERROR` | Device returned an error |
| `SEQUENCE_ERROR` | Error during sequence execution |
| `TRIGGER_ERROR` | Error during trigger script execution |

---

## Best Practices

1. **Always subscribe before controlling** - You must subscribe to a device before sending control commands.

2. **Handle reconnection** - The WebSocket may disconnect. Re-subscribe to all devices after reconnecting.

3. **Use immediate=false for UI** - When building digit spinners or sliders, use debounced updates to avoid flooding the device.

4. **Use immediate=true for automation** - When running scripts or sequences, use immediate updates for precise timing.

5. **Check capabilities before control** - Not all devices support all modes. Check `capabilities.modes` before sending `setMode`.
