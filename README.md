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

- Check USB connection
- Ensure no other software is using the device
- Try unplugging and reconnecting
- Click **Scan** to rescan

### Permission Errors (Linux)

USB-TMC devices may need udev rules:

```bash
# /etc/udev/rules.d/99-usbtmc.rules
SUBSYSTEM=="usb", ATTR{idVendor}=="1ab1", MODE="0666"
```

### WebSocket Connection Failed

- Ensure the server is running (`npm run dev`)
- Check that port 3001 isn't blocked by firewall
- For remote access, ensure port 5173 is accessible
