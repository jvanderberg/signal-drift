/**
 * Lab Controller Server
 * Express server with WebSocket support for controlling lab equipment
 */

import { createServer } from 'http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createDeviceRegistry } from './devices/registry.js';
import { createDeviceRoutes } from './api/devices.js';
import { createRigolDL3021 } from './devices/drivers/rigol-dl3021.js';
import { createMatrixWPS300S } from './devices/drivers/matrix-wps300s.js';
import { scanDevices } from './devices/scanner.js';
import { createSessionManager } from './sessions/SessionManager.js';
import { createWebSocketHandler } from './websocket/WebSocketHandler.js';

// Configuration (defaults, overridable by ENV)
const PORT = parseInt(process.env.PORT || '3001', 10);
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL || '250', 10);
const HISTORY_WINDOW_MS = parseInt(process.env.HISTORY_WINDOW || String(30 * 60 * 1000), 10);
const SCAN_INTERVAL_MS = parseInt(process.env.SCAN_INTERVAL || '10000', 10);

// Create registry and register drivers
const registry = createDeviceRegistry();

// Register Rigol DL3021 (USB-TMC)
registry.registerDriver({
  create: createRigolDL3021,
  transportType: 'usbtmc',
  match: { vendorId: 0x1AB1, productId: 0x0E11 },
});

// Register Matrix WPS300S (Serial)
registry.registerDriver({
  create: createMatrixWPS300S,
  transportType: 'serial',
  match: { pathPattern: /usbserial/i },
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
    sessions: sessionManager.getSessionCount(),
    wsClients: wsHandler?.getClientCount() ?? 0,
  });
});

// Create HTTP server (needed for WebSocket)
const server = createServer(app);

// Create session manager (without auto-sync, we'll handle scanning ourselves)
const sessionManager = createSessionManager(registry, {
  pollIntervalMs: POLL_INTERVAL_MS,
  historyWindowMs: HISTORY_WINDOW_MS,
});

// Create WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });
const wsHandler = createWebSocketHandler(wss, sessionManager);

// Start server
async function start() {
  console.log('Lab Controller Server starting...');
  console.log(`  Poll interval: ${POLL_INTERVAL_MS}ms`);
  console.log(`  History window: ${HISTORY_WINDOW_MS / 1000 / 60} minutes`);
  console.log(`  Scan interval: ${SCAN_INTERVAL_MS / 1000} seconds`);
  console.log('');
  console.log('Scanning for devices...');

  try {
    const result = await scanDevices(registry, sessionManager);
    console.log(`Found ${result.found} device(s):`);
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
  setInterval(async () => {
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

  server.listen(PORT, () => {
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

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  wsHandler.close();
  sessionManager.stop();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Shutting down...');
  wsHandler.close();
  sessionManager.stop();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

start();
