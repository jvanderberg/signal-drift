# Changelog

All notable changes to Lab Controller will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Draggable, resizable dashboard layout** - Panels can be repositioned and resized with mouse drag
  - Collision prevention to avoid overlapping panels
  - Persistent layout saved to server database
  - Responsive breakpoints for different screen sizes
- **SQLite persistence layer** - Server-side database for durable storage
  - Sequences, trigger scripts, device aliases, and dashboard layout
  - Settings export/import support
- **Demo build script** (`npm run demo`) - Build standalone browser demo for GitHub Pages
- **E2E tests for demo** - Playwright tests for interactive demo features
- **Integration tests for React components** - Testing Library tests with mocked WebSocket
- **Raspberry Pi installation script** - Automated setup for embedded deployment
- Documentation completeness review with improvement recommendations
- Environment variable documentation (`.env.example`)
- WebSocket API reference (`docs/API.md`)
- Expanded troubleshooting guide
- Component-level JSDoc documentation

### Changed
- Migrated client state management from hooks to Zustand stores
- Added Zustand documentation to DESIGN.md
- Improved +/- adjustment button hover and click feedback with `active:scale` effects
- Resize handles only appear on individual handle hover (not entire panel)
- Reduced default panel height from 16 to 11 rows, minimum from 10 to 5 rows

### Fixed
- Widget overlap during drag/resize by enabling collision prevention
- Trigger widget sync after UI refresh - running script state now restored
- Demo dashboard widget addition - WebSocket message handlers were missing
- Integration test failures - TypeScript configuration and test selector fixes
- Resize handle cursor flickering - CSS specificity improvements

## [1.0.0] - 2024-01-03

### Added

#### Core Features
- Real-time control interface for lab equipment via WebSocket
- Support for Rigol DL3021 Electronic Load (USB-TMC)
- Support for Matrix WPS300S Power Supply (Serial/USB)
- Support for Rigol DHO800/900 Series Oscilloscopes (USB-TMC)

#### Device Control
- Mode selection (CC, CV, CR, CP for loads)
- Setpoint control via digit spinners with carry/borrow
- Output enable/disable toggle
- Real-time measurement display (voltage, current, power, resistance)
- Live measurement charts with configurable history window

#### Oscilloscope Features
- Auto-streaming waveform display
- Multi-channel support (up to 4 channels)
- Channel configuration (scale, offset, coupling, probe, bandwidth limit)
- Timebase and trigger controls
- Interactive trigger level adjustment via drag
- Local measurement calculation (VPP, VAVG, FREQ, etc.)
- Screenshot capture

#### Sequencer
- Waveform generation for PSU/Load devices
- Standard waveforms: sine, triangle, ramp, square
- Random walk waveform with configurable step size
- Arbitrary waveform from CSV data
- Modifiers: scale, offset, min/max clamping
- Pre/post values for safety
- Repeat modes: once, count, continuous
- Real-time preview chart
- Timer-based server-side execution (prevents drift)

#### Trigger Scripts
- Reactive automation: "when X happens, do Y"
- Value-based triggers: "when current > 2A"
- Time-based triggers: "at t=10s"
- Actions: setValue, setOutput, setMode, sequence control
- Repeat modes: once, repeat with debounce
- Server-side condition evaluation

#### Architecture
- WebSocket-first architecture (REST API deprecated)
- Shared TypeScript types between client and server
- Result pattern for error handling (no exceptions)
- Factory functions over classes
- Sequential polling (prevents request queue buildup)
- State separation (user vs device state)

#### Development
- Simulated devices for testing without hardware
- Comprehensive test suite (29 test files)
- DevContainer configuration for isolated development
- Electron desktop app packaging

### Technical Details

#### Supported Hardware
| Device | Protocol | Features |
|--------|----------|----------|
| Rigol DL3021 | USB-TMC | CC/CV/CR/CP modes, list mode |
| Matrix WPS300S | Serial | CV/CC modes |
| Rigol DHO800/900 | USB-TMC | Waveform streaming, measurements |

#### Environment
- Node.js 18+
- React 18 with TypeScript
- Vite development server
- Express backend with WebSocket (ws)
- Zustand for state management
- Chart.js for data visualization

---

## Version History

### Pre-1.0 Development

The project evolved through several phases:

1. **Initial Implementation** - Basic device control via REST API
2. **WebSocket Migration** - Real-time updates, subscription model
3. **Oscilloscope Integration** - Waveform streaming, measurements
4. **Sequencer** - Waveform generation, timer-based execution
5. **Trigger Scripts** - Reactive automation
6. **State Management** - Migration from hooks to Zustand

### Breaking Changes from Pre-release

If upgrading from a pre-release version:

1. **REST API Deprecated** - All real-time operations now use WebSocket
2. **State Structure Changed** - `DeviceSessionState` structure updated
3. **Zustand Migration** - Custom hooks now wrap Zustand stores

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidelines and coding standards.
