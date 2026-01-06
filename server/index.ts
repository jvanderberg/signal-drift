/**
 * Lab Controller Server
 * Express server with WebSocket support for controlling lab equipment
 */

import { createServer } from 'http';
import { resolve } from 'path';
import { existsSync } from 'fs';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createDeviceRegistry } from './devices/registry.js';
import { createDeviceRoutes } from './api/devices.js';
import { createRigolDL3021 } from './devices/drivers/rigol-dl3021.js';
import { createMatrixWPS300S } from './devices/drivers/matrix-wps300s.js';
import { createRigolOscilloscope } from './devices/drivers/rigol-oscilloscope.js';
import { scanDevices, stopScanner } from './devices/scanner.js';
import { createSimulatedDevices } from './devices/simulation/index.js';
import { createSessionManager } from './sessions/SessionManager.js';
import { createWebSocketHandler } from './websocket/WebSocketHandler.js';
import { createSequenceManager } from './sequences/SequenceManager.js';
import { createTriggerScriptManager } from './triggers/TriggerScriptManager.js';
import {
  createDatabase,
  createSequenceStoreSqlite,
  createTriggerScriptStoreSqlite,
  createDeviceAliasStore,
  createSettingsManager,
  createDashboardLayoutStore,
} from './db/index.js';

// Configuration (defaults, overridable by ENV)
const PORT = parseInt(process.env.PORT || '3001', 10);
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL || '250', 10);
const HISTORY_WINDOW_MS = parseInt(process.env.HISTORY_WINDOW || String(30 * 60 * 1000), 10);
const SCAN_INTERVAL_MS = parseInt(process.env.SCAN_INTERVAL || '10000', 10);
const USE_SIMULATED_DEVICES = process.env.USE_SIMULATED_DEVICES === 'true';

// Scan interval handle for cleanup during shutdown
let scanIntervalHandle: ReturnType<typeof setInterval> | null = null;

// Create registry and register drivers
const registry = createDeviceRegistry();

// Register Rigol DL3021 (USB-TMC)
registry.registerDriver({
  create: createRigolDL3021,
  transportType: 'usbtmc',
  match: { vendorId: 0x1AB1, productId: 0x0E11 },
});

// Register Matrix WPS300S (Serial)
// Uses USB-serial adapter (CH340), requires 50ms command delay
// No pathPattern - will probe all serial ports
registry.registerDriver({
  create: createMatrixWPS300S,
  transportType: 'serial',
  match: {},
  serialOptions: {
    baudRate: 115200,      // Known baud rate for Matrix PSU
    commandDelay: 50,      // Required delay between commands
    timeout: 2000,
  },
});

// Register Rigol Oscilloscopes (USB-TMC)
// Matches all Rigol DS/MSO series by IDN response pattern
registry.registerOscilloscopeDriver({
  create: createRigolOscilloscope,
  transportType: 'usbtmc',
  match: {
    vendorId: 0x1AB1,              // Rigol vendor ID
    manufacturer: /RIGOL/i,        // Match RIGOL in manufacturer
    model: /^(DS|MSO)/,            // Match DS* or MSO* models
  },
  specificity: 1,  // Base driver, more specific ones can override
});

// Create Express app
const app = express();
app.use(cors());
app.use(express.json());

// Mount device API (for backward compatibility)
app.use('/api/devices', createDeviceRoutes(registry));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    devices: registry.getDevices().length,
    oscilloscopes: registry.getOscilloscopes().length,
    sessions: sessionManager.getSessionCount(),
    wsClients: wsHandler?.getClientCount() ?? 0,
  });
});

// Serve static frontend from client/dist
const clientDistPath = resolve('client/dist');
const indexHtmlPath = resolve(clientDistPath, 'index.html');

console.log('Static file serving:');
console.log(`  Working directory: ${process.cwd()}`);
console.log(`  clientDistPath: ${clientDistPath}`);
console.log(`  clientDistPath exists: ${existsSync(clientDistPath)}`);
console.log(`  indexHtmlPath: ${indexHtmlPath}`);
console.log(`  indexHtmlPath exists: ${existsSync(indexHtmlPath)}`);

app.use(express.static(clientDistPath));

// SPA fallback - serve index.html for all non-API routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }
  res.sendFile(indexHtmlPath);
});

// Create HTTP server (needed for WebSocket)
const server = createServer(app);

// Create session manager (without auto-sync, we'll handle scanning ourselves)
const sessionManager = createSessionManager(registry, {
  pollIntervalMs: POLL_INTERVAL_MS,
  historyWindowMs: HISTORY_WINDOW_MS,
});

// Initialize database and stores
const database = createDatabase();
const sequenceStore = createSequenceStoreSqlite(database);
const triggerScriptStore = createTriggerScriptStoreSqlite(database);
const deviceAliasStore = createDeviceAliasStore(database);
const dashboardLayoutStore = createDashboardLayoutStore(database);
const settingsManager = createSettingsManager(sequenceStore, triggerScriptStore, deviceAliasStore);

// Create sequence manager (for AWG/sequencing functionality) with SQLite store
const sequenceManager = createSequenceManager(sessionManager, sequenceStore);

// Create trigger script manager (for reactive automation) with SQLite store
const triggerScriptManager = createTriggerScriptManager(sessionManager, sequenceManager, triggerScriptStore);

// Create WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });
const wsHandler = createWebSocketHandler(
  wss,
  sessionManager,
  sequenceManager,
  triggerScriptManager,
  deviceAliasStore,
  settingsManager,
  dashboardLayoutStore
);

// Start server
async function start() {
  console.log('Lab Controller Server starting...');
  console.log(`  Poll interval: ${POLL_INTERVAL_MS}ms`);
  console.log(`  History window: ${HISTORY_WINDOW_MS / 1000 / 60} minutes`);
  console.log(`  Scan interval: ${SCAN_INTERVAL_MS / 1000} seconds`);
  console.log(`  Simulation mode: ${USE_SIMULATED_DEVICES ? 'ENABLED' : 'disabled'}`);
  console.log('');

  // Initialize sequence manager (loads persisted sequences)
  await sequenceManager.initialize();

  // Initialize trigger script manager (loads persisted trigger scripts)
  await triggerScriptManager.initialize();

  if (USE_SIMULATED_DEVICES) {
    // Create simulated devices instead of scanning for real hardware
    console.log('Creating simulated devices...');

    try {
      const { psuDriver, loadDriver, oscilloscopeDriver, connection } = createSimulatedDevices();

      // Log simulation configuration
      const simConfig = connection.getConfig();
      console.log('Simulation config:');
      console.log(`  Measurement stability: ${simConfig.measurementStabilityPPM} PPM`);
      console.log(`  Measurement noise floor: ${simConfig.measurementNoiseFloorMv} mV`);
      console.log(`  PSU output impedance: ${simConfig.psuOutputImpedance} ohms`);
      console.log(`  Load CV gain: ${simConfig.loadCvGain} A/V`);
      console.log(`  Boost target voltage: ${simConfig.boostTargetVoltage} V`);
      console.log(`  Boost switching frequency: ${simConfig.boostSwitchingFrequency / 1000} kHz`);

      // Open the simulated transports
      await psuDriver.connect();
      await loadDriver.connect();
      await oscilloscopeDriver.connect();

      // Probe to populate driver info
      await psuDriver.probe();
      await loadDriver.probe();
      await oscilloscopeDriver.probe();

      // Add to registry
      registry.addDevice(psuDriver);
      registry.addDevice(loadDriver);
      registry.addOscilloscope(oscilloscopeDriver);

      console.log('Simulated devices created:');
      console.log(`  - ${psuDriver.info.manufacturer} ${psuDriver.info.model} (${psuDriver.info.type})`);
      console.log(`  - ${loadDriver.info.manufacturer} ${loadDriver.info.model} (${loadDriver.info.type})`);
      console.log(`  - ${oscilloscopeDriver.info.manufacturer} ${oscilloscopeDriver.info.model} (${oscilloscopeDriver.info.type})`);
      console.log('');
      console.log('Boost converter simulation:');
      console.log('  CH1: PWM gate drive signal');
      console.log('  CH2: Switching node voltage');
      console.log('  CH3: Output voltage with ripple');
      console.log('  CH4: Input current waveform');

      // Sync session manager with simulated devices
      await sessionManager.syncDevices();
      console.log(`Created ${sessionManager.getSessionCount()} session(s)`);
    } catch (err) {
      console.error('Failed to create simulated devices:', err);
      process.exit(1);
    }

    // No periodic scanning needed for simulated devices
  } else {
    // Normal hardware scanning
    console.log('Scanning for devices...');

    try {
      const result = await scanDevices(registry, sessionManager);
      const totalDevices = registry.getDevices().length + registry.getOscilloscopes().length;
      console.log(`Found ${totalDevices} device(s):`);
      for (const device of result.devices) {
        console.log(`  - ${device.manufacturer} ${device.model} (${device.type})`);
      }

      // Sync session manager with found devices
      await sessionManager.syncDevices();
      console.log(`Created ${sessionManager.getSessionCount()} session(s)`);
    } catch (err) {
      console.error('Device scan failed:', err);
    }

    // Periodic scan for device changes (disconnect/reconnect)
    scanIntervalHandle = setInterval(async () => {
      try {
        // Scan for new devices or reconnect disconnected ones
        const result = await scanDevices(registry, sessionManager);

        // Sync sessions with newly found devices
        if (result.added > 0) {
          await sessionManager.syncDevices();
          console.log(`Added ${result.added} device(s)`);
        }

        // Broadcast if anything changed
        if (result.added > 0 || result.reconnected > 0) {
          wsHandler.broadcastDeviceList();
        }
      } catch (err) {
        console.error('Periodic scan failed:', err);
      }
    }, SCAN_INTERVAL_MS);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('');
    console.log('WebSocket endpoint: ws://localhost:' + PORT + '/ws');
    console.log('');
    console.log('REST API endpoints (deprecated, use WebSocket):');
    console.log('  GET  /api/devices          - List devices');
    console.log('  POST /api/devices/scan     - Rescan for devices');
    console.log('  GET  /api/devices/:id      - Get device info');
    console.log('  GET  /api/devices/:id/status - Get device status');
    console.log('  POST /api/devices/:id/mode   - Set mode');
    console.log('  POST /api/devices/:id/output - Enable/disable output');
    console.log('  POST /api/devices/:id/values - Set values');
    console.log('  POST /api/devices/:id/list   - Upload list');
    console.log('  POST /api/devices/:id/list/start - Start list');
    console.log('  POST /api/devices/:id/list/stop  - Stop list');
  });
}

// Graceful shutdown - close all resources properly
async function stop(): Promise<void> {
  console.log('Shutting down server...');

  // Stop device scanner first (prevents new device connections during shutdown)
  stopScanner();
  if (scanIntervalHandle) {
    clearInterval(scanIntervalHandle);
    scanIntervalHandle = null;
    console.log('Stopped device scanner');
  }

  // Stop WebSocket handler (prevents new connections)
  wsHandler.close();

  // Stop sequence manager (saves pending changes)
  await sequenceManager.stop();

  // Stop trigger script manager (saves pending changes)
  await triggerScriptManager.shutdown();

  // Stop session polling and wait for in-flight operations
  await sessionManager.stop();

  // Close all device transports (USB, serial) - critical for clean shutdown
  console.log('Closing device transports...');
  await registry.clearDevices();

  // Close database connection
  console.log('Closing database...');
  database.close();

  // Close HTTP server with timeout
  console.log('Closing HTTP server...');
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      console.log('Server close timeout, forcing...');
      resolve();
    }, 5000);

    server.close(() => {
      clearTimeout(timeout);
      console.log('Server closed');
      resolve();
    });

    // Force-close any lingering connections
    server.closeAllConnections();
  });
}

// Graceful shutdown handler for CLI mode
function setupShutdownHandlers() {
  const shutdown = async () => {
    await stop();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Export for Electron integration
export { start as startServer, stop as stopServer };

// Auto-start when run directly (not imported)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  setupShutdownHandlers();
  start();
}
