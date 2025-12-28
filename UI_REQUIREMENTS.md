# Lab Controller UI Requirements

Extracted from existing Python/Flask web apps: `psu_web_app.py` and `web_app.py`.

## Core Architecture

### Polling & Connection
- **Sequential polling** - Each status query waits for the previous to complete before starting the next (no `setInterval`)
- **Retry logic** - `fetchWithRetry` with configurable retries and delay between attempts
- **Lock-aware** - Skip status update if server returns `busy` (lock contention)
- **Consecutive failure handling** - Force disconnect after 3 consecutive failures
- **Background tab throttling prevention** - Silent AudioContext oscillator to prevent Chrome from throttling timers

### Connection Management
- Connect/Disconnect button
- Connection status indicator (colored dot + text)
- Device name display (from `*IDN?` response for load, configured for PSU)
- Auto-read current device state on connect (setpoints, mode, output state)

## Display Components

### Status Readings Panel
- Large numeric displays with units
- **PSU**: Voltage (V), Current (A), Power (W)
- **Load**: Voltage (V), Current (A), Power (W), Resistance (Ω)
- Monospace font for values

### Live Chart
- Chart.js line chart
- Multiple data series (V, A, W, and Ω for load)
- Dual Y-axes (configurable per visible series)
- Legend with click-to-toggle visibility
- Auto-scaling Y-axis with minimum 10% range
- Configurable history window: 2, 5, 10, 20 minutes
- Target/setpoint reference line (dashed, matches active mode)
- CSV download button

### Input/Output State
- Large indicator with colored dot (green = ON, gray = OFF)
- ON/OFF buttons
- Visual feedback when button is "active" (opacity change)
- Mode indicator badge (CV/CC for PSU)

## Control Components

### Digit Spinner
- Individual digit columns with +/- buttons per digit
- Decimal point positioning based on mode/unit
- Visual feedback on digit change (background flash)
- Immediate apply on digit change when connected
- Value limits enforced (clamped to min/max)

**Digit Formats:**
- CC (Current): `XX.XXX` A (max 40A for load, 10A for PSU)
- CV (Voltage): `XXX.XXX` V (max 150V for load, 80V for PSU)
- CP (Power): `XXX.XXX` W (max 200W for load, 300W for PSU)
- CR (Resistance): `XXXXX.XXX` Ω (max 15000Ω)

### Mode Selector (Load only)
- Dropdown with CC, CV, CR, CP options
- Mode change turns off input for safety
- Fetches current setpoint for new mode from device

### Preset System (PSU only)
- Preset dropdown to load saved configurations
- Save current values as preset (prompts for name)
- Manage presets modal:
  - List view with name + values
  - Edit preset (name, voltage, current)
  - Delete preset with confirmation
- localStorage persistence (`psuPresets`)

## Waveform Tab (Load only)

### Waveform Configuration
- Pattern selector: Sine, Triangle, Square, Sawtooth
- Mode selector: CC, CV, CR, CP
- Min/Max value inputs
- Period (seconds) input
- Steps (2-512) input
- Live preview chart updates on any change

### Waveform Controls
- Upload button - Uploads list to device
- Start button - Enables input and triggers list
- Stop button - Disables input

## Safety Features

### Safety Limits Settings
- Modal dialog accessed via gear icon
- Configurable limits:
  - Max Power (W)
  - Max Current (A)
  - Max Voltage (V)
- localStorage persistence (`loadControllerLimits`, `psuControllerLimits`)

### Limit Enforcement
- **Pre-turn-on check**: Estimate if turning on would exceed limits based on current readings
- **Live monitoring**: Auto-disable if limits exceeded while running
- **Setpoint warning**: Toast warning when setpoint approaches/exceeds limits
- Block dangerous operations with error toast

## Toast Notifications
- Success (green), Error (red), Info (blue) styles
- Slide-in/slide-out animation
- Auto-dismiss after duration (default 3s, configurable)
- Stacked in top-right corner

## Visual Design

### Theme Detection
- Auto-detect platform preference via `prefers-color-scheme` media query
- Respect system light/dark mode setting
- Optional manual override (stored in localStorage)
- Listen for system theme changes and update in real-time

### Color Scheme (Dark Theme)
- Background: `#1a1a2e` (body), `#16213e` (panels), `#0f0f23` (readings)
- Accent: `#ff9f43` (PSU), `#00d4ff` (Load)
- Success: `#2ed573`
- Danger: `#ff4757`
- Text: `#eee` (primary), `#888` (secondary), `#666` (muted)
- Borders: `#333`, `#444`

### Color Scheme (Light Theme)
- Background: `#f5f5f7` (body), `#ffffff` (panels), `#e8e8ed` (readings)
- Accent: `#e67e22` (PSU), `#0099cc` (Load) - slightly darker for contrast
- Success: `#27ae60`
- Danger: `#e74c3c`
- Text: `#1a1a1a` (primary), `#666666` (secondary), `#999999` (muted)
- Borders: `#d0d0d0`, `#e0e0e0`

### Typography
- System font stack: `-apple-system, BlinkMacSystemFont, sans-serif`
- Monospace for values: `'Courier New', monospace`
- Readings: 32px bold
- Inputs: 16px
- Labels: 12px uppercase

### Layout
- Max-width container: 900px centered
- Panel padding: 20-25px
- Border radius: 4-8px
- Grid layouts for responsive arrangement

## API Endpoints

### Common
- `GET /status` - Poll device readings + state
- `POST /output` or `POST /start/stop` - Enable/disable output

### PSU Specific
- `POST /apply` - Set voltage + current

### Load Specific
- `POST /set_mode` - Change operating mode
- `POST /apply_live` - Set mode + value, optionally turn on
- `POST /upload` - Upload waveform list
- `GET /read_list` - Read current list from device

## State Management

### Client State
```javascript
let isConnected = false;
let pollInterval = null;  // Not used with sequential polling
let historyData = { timestamps: [], voltage: [], current: [], power: [], ... };
let historyWindowMinutes = 2;
let consecutiveFailures = 0;
let currentSetpoint = 0;
let currentMode = 'CC';
let inputIsOn = false;
let lastReadings = { voltage: 0, current: 0, power: 0 };
let limits = { maxPower: 300, maxCurrent: 40, maxVoltage: 150 };
let presets = [];  // PSU only
let updatesInFlight = 0;  // Prevent setpoint sync during user edits
```

### Synchronization
- Read device state on connect
- Sync setpoint display if device reports different value (load may reject invalid values)
- Sync mode if changed on device front panel
- Skip sync while user updates are "in flight"

## Keyboard/Mouse Interactions
- Digit +/- buttons respond to click
- Input fields support direct number entry
- Dropdowns for mode/pattern/preset selection
- Modal overlays close on backdrop click

## Error Handling
- Connection failures trigger auto-disconnect after 3 tries
- Device errors shown as toast notifications
- "Lock busy" responses silently skipped
- Connection reset on any SCPI error

## Performance Considerations
- Sequential polling prevents request queue buildup
- Minimal DOM updates (only changed values)
- Chart updates with `'none'` animation mode for performance
- History data trimmed to window size
- Debounced digit adjustments (visual flash provides feedback)
