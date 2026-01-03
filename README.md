# Lab Controller

A web-based control interface for lab equipment including power supplies, electronic loads, and oscilloscopes.

## Supported Devices

- **Rigol DL3021** - Electronic Load (USB-TMC)
- **Matrix WPS300S** - Power Supply (Serial/USB)
- **Rigol DHO800/900 Series** - Oscilloscopes (USB-TMC)

## Quick Start

### Prerequisites

- Node.js 18+
- Connected lab equipment via USB

### Installation

```bash
npm install
cd client && npm install && cd ..
```

### Running

Start the server and client in separate terminals:

```bash
# Terminal 1: Start the backend server
npm run dev

# Terminal 2: Start the frontend dev server
npm run dev:client
```

Open http://localhost:5173 in your browser.

### Accessing from Other Devices

The client dev server binds to all interfaces (`0.0.0.0`). To access from a phone or another computer on your network:

1. Find your computer's IP address (e.g., `192.168.1.100`)
2. Open `http://192.168.1.100:5173` on the other device

The WebSocket connection uses the Vite proxy, so only port 5173 needs to be accessible.

## Usage

### Device Discovery

On launch, the app scans for connected devices. Click **Scan** to rescan if you connect new equipment.

### Power Supply / Electronic Load

- **Mode Selection** - Choose operating mode (CC, CV, CR, CP for loads)
- **Setpoint Control** - Use the digit spinners to adjust values; changes apply immediately
- **Output Toggle** - Enable/disable output with the power button
- **Live Chart** - View real-time voltage, current, and power measurements
- **History Window** - Adjust the chart time window (2, 5, 10, 20 minutes)

### Oscilloscope

- **Auto-streaming** - Waveforms stream automatically when connected
- **Channel Controls** - Click channel buttons to toggle display and adjust settings
- **Timebase** - Use the +/- controls at the top of the waveform display
- **Trigger** - Drag the trigger indicator or use the settings popover
- **Measurements** - Click the + button on the stats bar to select measurements

### Sequencer

The sequencer generates waveforms and plays them on power supplies or electronic loads:

- **Waveform Types** - Sine, triangle, ramp, square, random walk, or arbitrary (CSV)
- **Modifiers** - Scale, offset, and min/max clamping for safety limits
- **Pre/Post Values** - Set values before starting and after completing
- **Repeat Modes** - Once, fixed count, or continuous looping
- **Real-time Preview** - Chart shows waveform shape before running
- **Playback Controls** - Start, pause, resume, abort with progress tracking

To use:
1. Open the Sequencer panel from the sidebar
2. Create a new sequence or select from the library
3. Choose a target device and parameter (voltage, current, etc.)
4. Configure repeat mode and click Run

### Trigger Scripts

Trigger scripts enable reactive automation: "when X happens, do Y". They complement sequences by adding event-driven control.

**Conditions** (when to fire):
- **Time-based** - At a specific time after script starts (e.g., "at t=10s")
- **Value-based** - When a device measurement crosses a threshold (e.g., "when current > 2A")

**Actions** (what to do):
- **Set Value** - Change a device setpoint (voltage, current, etc.)
- **Set Output** - Turn device output on/off
- **Set Mode** - Change operating mode (CC, CV, CR, CP)
- **Start/Stop Sequence** - Control sequence playback

**Repeat modes**:
- **Once** - Fire only the first time condition is met
- **Repeat** - Fire every time condition becomes true (with optional debounce)

To use:
1. Open the Triggers panel from the sidebar
2. Create a new script or select from the library
3. Add triggers with conditions and actions
4. Click Run to start monitoring

**Note**: Only one sequence can run at a time. If a trigger starts a new sequence, any running sequence is aborted first.

### Multiple Devices

Open multiple devices simultaneously - each gets its own panel. Panels share rows (max 2 per row) and a single device takes full width.

## Architecture

See [DESIGN.md](./DESIGN.md) for detailed architecture documentation.

### Key Components

```
lab-controller/
├── server/           # Node.js backend
│   ├── index.ts      # HTTP + WebSocket server
│   ├── sessions/     # Device session management
│   ├── devices/      # Device drivers and transports
│   ├── sequences/    # Sequence library and execution
│   ├── triggers/     # Trigger script engine
│   └── websocket/    # WebSocket handler
├── client/           # React frontend
│   ├── src/
│   │   ├── components/   # UI components
│   │   ├── hooks/        # WebSocket hooks
│   │   └── websocket.ts  # Connection manager
└── shared/           # Shared TypeScript types
```

### WebSocket Protocol

All communication uses WebSocket (no REST API for real-time operations):

- **Device discovery**: `getDevices`, `scan`
- **Subscriptions**: `subscribe`, `unsubscribe`
- **Device control**: `setMode`, `setOutput`, `setValue`
- **Oscilloscope**: `scopeRun`, `scopeStop`, `scopeGetWaveform`, etc.
- **Sequencer**: `sequenceRun`, `sequenceAbort`, `sequenceLibrary*`
- **Triggers**: `triggerScriptRun`, `triggerScriptStop`, `triggerScriptLibrary*`

### Resilience

- **Auto-reconnect** - WebSocket reconnects with exponential backoff
- **State preservation** - UI stays visible during disconnection (with red status indicator)
- **Re-subscription** - Hooks automatically re-subscribe when connection is restored

## Development

### Running Tests

```bash
npm test              # Watch mode
npm run test:run      # Single run
```

### Project Structure

- `shared/types.ts` - Single source of truth for API types
- Factory functions over classes for drivers and sessions
- Sequential polling (no setInterval) to prevent request queue buildup

## Troubleshooting

### Device Not Found

- Check USB connection - try a different port or cable
- Ensure no other software is using the device (NI MAX, Rigol software, etc.)
- Try unplugging and reconnecting the device
- Click **Scan** to trigger a manual rescan
- Check the server console for error messages

### Permission Errors (Linux)

USB-TMC devices require udev rules for non-root access:

```bash
# Create udev rules file
sudo nano /etc/udev/rules.d/99-usbtmc.rules

# Add these rules (adjust vendor IDs as needed)
# Rigol devices
SUBSYSTEM=="usb", ATTR{idVendor}=="1ab1", MODE="0666"
# Generic USB-TMC
SUBSYSTEM=="usb", ATTR{idProduct}=="*", ATTR{bInterfaceClass}=="fe", ATTR{bInterfaceSubClass}=="03", MODE="0666"

# Reload rules
sudo udevadm control --reload-rules
sudo udevadm trigger
```

For serial devices, add your user to the `dialout` group:

```bash
sudo usermod -aG dialout $USER
# Log out and back in for changes to take effect
```

### WebSocket Connection Failed

**Server not running:**
- Ensure the server is running (`npm run dev`)
- Check for errors in the server terminal

**Port conflicts:**
- Check that port 3001 isn't in use: `lsof -i :3001`
- Kill conflicting processes or change the port via `PORT=3002 npm run dev`

**Firewall issues:**
- For remote access, ensure port 5173 (Vite) is accessible
- The WebSocket proxies through Vite, so only 5173 needs to be open

**Connection keeps dropping:**
- Check network stability
- The UI shows a red indicator when disconnected
- Connections auto-reconnect with exponential backoff (max 30s)

### Device Disconnects During Operation

**USB power issues:**
- Use a powered USB hub for multiple devices
- Avoid USB extension cables

**Driver conflicts:**
- On Windows, ensure no other USBTMC driver is loaded
- On macOS, kernel extensions may need to be detached

### Measurements Not Updating

**Polling issues:**
- Check the server console for SCPI errors
- The device may be in an error state - power cycle it
- Reduce polling frequency if the device is slow: `POLL_INTERVAL=500 npm run dev`

**History not showing:**
- History requires subscription - ensure you're subscribed to the device
- Check that the history window is set correctly in the UI

### Oscilloscope Waveform Issues

**Waveforms not appearing:**
- Ensure channels are enabled (click channel buttons)
- Check that the scope is running (not stopped)
- Try Auto Setup to configure for the current signal

**Corrupted or noisy waveforms:**
- Some Rigol oscilloscopes have USB-TMC quirks (see `server/devices/docs/rigol-usbtmc-quirk.md`)
- Reduce the streaming interval if bandwidth is limited

**Measurements showing incorrect values:**
- Measurements are calculated locally from waveform data
- Ensure the waveform capture includes complete cycles
- Check probe attenuation settings

### Sequencer Issues

**Sequence not starting:**
- Ensure a device is selected
- Check that the parameter matches the device capabilities
- Verify the device output is in the correct mode

**Timing drift:**
- The sequencer uses server-side timing to prevent drift
- If running in a VM, clock accuracy may be affected
- Check server CPU usage - high load can cause timing issues

### Development Issues

**Tests failing:**
- Run `npm run test:run` for full test output
- Check that you're not running tests with real devices connected (unless intended)
- Use `USE_SIMULATED_DEVICES=true` for isolated testing

**TypeScript errors:**
- Run `npx tsc --noEmit` to check for type errors
- Shared types are in `shared/types.ts` - ensure consistency

**Hot reload not working:**
- Vite HMR doesn't reset `useState` initializers - refresh the page
- Some server changes require a full restart

### Using Simulated Devices

For development without hardware:

```bash
USE_SIMULATED_DEVICES=true npm run dev
```

This creates virtual PSU and Load devices that respond to commands and generate realistic measurements. See `.env.example` for simulation parameters.
