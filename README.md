# Lab Controller

A web-based control interface for lab equipment including power supplies, electronic loads, and oscilloscopes.

**[Try the Interactive Demo →](https://jvanderberg.github.io/signal-drift/)** — runs entirely in your browser with simulated devices.

## Supported Devices

- **Rigol DL3021** - Electronic Load (USB-TMC)
- **Matrix WPS300S** - Power Supply (Serial/USB)
- **Rigol DHO800/900 Series** - Oscilloscopes (USB-TMC)

## Installation

There are three ways to run Signal Drift depending on your needs:

| Method | Best For | Devices Connect To |
|--------|----------|-------------------|
| [Local Usage](#local-usage) | Personal use on your workstation | Your computer |
| [Server Installation](#server-installation) | Always-on access from any device | The server |
| [Development](#development) | Contributing or modifying code | Your computer |

---

### Local Usage

Run Signal Drift on your local machine with USB-connected lab equipment.

**Prerequisites:**
- Node.js 18+
- Lab equipment connected via USB

**Setup:**
```bash
git clone https://github.com/jvanderberg/signal-drift.git
cd signal-drift
npm install
npm run build:client
```

**Run:**
```bash
npm start
```

Open http://localhost:3001 in your browser. Your connected devices will appear automatically.

**Accessing from other devices on your network:**
1. Find your computer's IP address (e.g., `192.168.1.100`)
2. Open `http://192.168.1.100:3001` on the other device
3. Ensure port 3001 is accessible through your firewall

---

### Server Installation

Install Signal Drift as a system service on a dedicated machine (e.g., Raspberry Pi, lab PC). The service starts at boot and is accessible from any device on your network.

**Supported platforms:**
- **Linux**: Debian/Ubuntu, Fedora/RHEL, Arch (systemd service)
- **macOS**: Requires Homebrew (launchd service)

**Install:**
```bash
git clone https://github.com/jvanderberg/signal-drift.git
cd signal-drift
./scripts/install.sh
```

The script installs dependencies, builds from source, and installs to `/opt/signal-drift`.

**Access:** Open `http://<server-ip>:3001` from any device on your network.

**Managing the service:**
```bash
# Linux
journalctl -u signal-drift -f          # View logs
sudo systemctl restart signal-drift    # Restart
sudo systemctl status signal-drift     # Check status

# macOS
tail -f ~/Library/Logs/signal-drift.log  # View logs

# Update or uninstall (both platforms)
./scripts/install.sh                   # Re-run to update
./scripts/install.sh --uninstall       # Uninstall
```

**Configuration (environment variables):**
- `SIGNAL_DRIFT_PORT` - Server port (default: 3001)
- `SIGNAL_DRIFT_INSTALL_DIR` - Install location (default: /opt/signal-drift)
- `SIGNAL_DRIFT_DATA_DIR` - Data directory (platform default)

---

### Development

For contributing or modifying Signal Drift. Uses hot-reloading for rapid iteration.

**Prerequisites:**
- Node.js 18+
- Lab equipment via USB (or use simulated devices)

**Setup:**
```bash
git clone https://github.com/jvanderberg/signal-drift.git
cd signal-drift
npm install
cd client && npm install && cd ..
```

**Run (two terminals):**
```bash
# Terminal 1: Backend server with hot reload
npm run dev

# Terminal 2: Frontend dev server with HMR
npm run dev:client
```

Open http://localhost:5173 in your browser. The Vite dev server proxies API requests to the backend.

**Without hardware (simulated devices):**
```bash
USE_SIMULATED_DEVICES=true npm run dev
```

See [Development](#development-1) below for testing, building, and project structure.

---

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

### Dashboard Layout

The dashboard uses a draggable, resizable grid layout:

- **Drag to Reposition** - Click and drag panel headers to move them
- **Resize Panels** - Drag the corner/edge handles to resize
- **Collision Prevention** - Panels automatically avoid overlapping
- **Persistent Layout** - Your layout is saved and restored on refresh
- **Responsive** - Layout adapts to different screen sizes

### Multiple Devices

Open multiple devices simultaneously - each gets its own panel.

## Architecture

See [DESIGN.md](./DESIGN.md) for detailed architecture documentation.

### Key Components

```
signal-drift/
├── server/           # Node.js backend
│   ├── index.ts      # HTTP + WebSocket server
│   ├── sessions/     # Device session management
│   ├── devices/      # Device drivers and transports
│   ├── sequences/    # Sequence library and execution
│   ├── triggers/     # Trigger script engine
│   ├── db/           # SQLite persistence layer
│   └── websocket/    # WebSocket handler
├── client/           # React frontend
│   ├── src/
│   │   ├── components/   # UI components
│   │   ├── stores/       # Zustand state stores
│   │   ├── hooks/        # WebSocket hooks (thin wrappers)
│   │   └── websocket.ts  # Connection manager
├── demo/             # Standalone browser demo
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
- **Dashboard**: `dashboardLayoutGet`, `dashboardLayoutSave`, `dashboardLayoutClear`

### Resilience

- **Auto-reconnect** - WebSocket reconnects with exponential backoff
- **State preservation** - UI stays visible during disconnection (with red status indicator)
- **Re-subscription** - Hooks automatically re-subscribe when connection is restored

## Development

### Testing

```bash
npm test              # Watch mode
npm run test:run      # Single run
npm run test:e2e      # End-to-end tests (requires running server)
npm run test:e2e:demo # Demo-specific e2e tests
```

### Building

```bash
npm run build:client  # Build production client
npm run demo          # Build demo for GitHub Pages (demo/dist/)
```

The demo runs entirely in the browser with a simulated WebSocket server.

### Code Conventions

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
- For local/server installation: ensure port 3001 is accessible
- For development mode: ensure port 5173 (Vite dev server) is accessible

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

Run without physical hardware using `USE_SIMULATED_DEVICES=true npm run dev` (see [Development](#development) setup). This creates virtual PSU and Load devices that respond to commands and generate realistic measurements. See `.env.example` for additional simulation parameters.
