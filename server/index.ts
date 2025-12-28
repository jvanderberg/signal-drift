/**
 * Lab Controller Server
 * Express server for controlling lab equipment
 */

import express from 'express';
import cors from 'cors';
import { createDeviceRegistry } from './devices/registry.js';
import { createDeviceRoutes } from './api/devices.js';
import { createRigolDL3021 } from './devices/drivers/rigol-dl3021.js';
import { createMatrixWPS300S } from './devices/drivers/matrix-wps300s.js';
import { scanDevices } from './devices/scanner.js';

const PORT = process.env.PORT || 3001;

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

// Mount device API
app.use('/api/devices', createDeviceRoutes(registry));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', devices: registry.getDevices().length });
});

// Start server
async function start() {
  console.log('Lab Controller Server starting...');
  console.log('Scanning for devices...');

  try {
    const result = await scanDevices(registry);
    console.log(`Found ${result.found} device(s):`);
    for (const device of result.devices) {
      console.log(`  - ${device.manufacturer} ${device.model} (${device.type})`);
    }
  } catch (err) {
    console.error('Device scan failed:', err);
  }

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('API endpoints:');
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

start();
