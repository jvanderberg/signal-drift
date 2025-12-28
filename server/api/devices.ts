/**
 * Device API Routes
 * REST API for controlling lab equipment
 */

import { Router } from 'express';
import type { DeviceRegistry } from '../devices/registry.js';
import type { DeviceListResponse, ApiError, ListStep } from '../devices/types.js';
import { scanDevices } from '../devices/scanner.js';

export function createDeviceRoutes(registry: DeviceRegistry): Router {
  const router = Router();

  // GET /api/devices - List all connected devices
  router.get('/', (_req, res) => {
    const devices = registry.getDevices();
    const response: DeviceListResponse = {
      devices: devices.map(d => ({
        id: d.info.id,
        info: d.info,
        capabilities: d.capabilities,
        connected: true,
      })),
    };
    res.json(response);
  });

  // POST /api/devices/scan - Rescan for devices
  router.post('/scan', async (_req, res) => {
    try {
      await scanDevices(registry);
      // Return same format as GET /devices
      const devices = registry.getDevices();
      const response: DeviceListResponse = {
        devices: devices.map(d => ({
          id: d.info.id,
          info: d.info,
          capabilities: d.capabilities,
          connected: true,
        })),
      };
      res.json(response);
    } catch (err) {
      const error: ApiError = {
        error: 'SCAN_FAILED',
        message: err instanceof Error ? err.message : 'Unknown error',
      };
      res.status(500).json(error);
    }
  });

  // GET /api/devices/:id - Get device info & capabilities
  router.get('/:id', (req, res) => {
    const device = registry.getDevice(req.params.id);
    if (!device) {
      const error: ApiError = { error: 'NOT_FOUND', message: 'Device not found' };
      return res.status(404).json(error);
    }

    res.json({
      id: device.info.id,
      info: device.info,
      capabilities: device.capabilities,
      connected: true,
    });
  });

  // GET /api/devices/:id/status - Get current status
  router.get('/:id/status', async (req, res) => {
    const device = registry.getDevice(req.params.id);
    if (!device) {
      const error: ApiError = { error: 'NOT_FOUND', message: 'Device not found' };
      return res.status(404).json(error);
    }

    try {
      const status = await device.getStatus();
      res.json(status);
    } catch (err) {
      const error: ApiError = {
        error: 'STATUS_FAILED',
        message: err instanceof Error ? err.message : 'Unknown error',
      };
      res.status(500).json(error);
    }
  });

  // POST /api/devices/:id/mode - Set operating mode
  router.post('/:id/mode', async (req, res) => {
    const device = registry.getDevice(req.params.id);
    if (!device) {
      const error: ApiError = { error: 'NOT_FOUND', message: 'Device not found' };
      return res.status(404).json(error);
    }

    const { mode } = req.body;
    if (!mode || typeof mode !== 'string') {
      const error: ApiError = { error: 'INVALID_REQUEST', message: 'Mode is required' };
      return res.status(400).json(error);
    }

    try {
      await device.setMode(mode);
      res.json({ success: true });
    } catch (err) {
      const error: ApiError = {
        error: 'SET_MODE_FAILED',
        message: err instanceof Error ? err.message : 'Unknown error',
      };
      res.status(500).json(error);
    }
  });

  // POST /api/devices/:id/output - Enable/disable output
  router.post('/:id/output', async (req, res) => {
    const device = registry.getDevice(req.params.id);
    if (!device) {
      const error: ApiError = { error: 'NOT_FOUND', message: 'Device not found' };
      return res.status(404).json(error);
    }

    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      const error: ApiError = { error: 'INVALID_REQUEST', message: 'enabled (boolean) is required' };
      return res.status(400).json(error);
    }

    try {
      await device.setOutput(enabled);
      res.json({ success: true });
    } catch (err) {
      const error: ApiError = {
        error: 'SET_OUTPUT_FAILED',
        message: err instanceof Error ? err.message : 'Unknown error',
      };
      res.status(500).json(error);
    }
  });

  // POST /api/devices/:id/values - Set one or more values
  router.post('/:id/values', async (req, res) => {
    const device = registry.getDevice(req.params.id);
    if (!device) {
      const error: ApiError = { error: 'NOT_FOUND', message: 'Device not found' };
      return res.status(404).json(error);
    }

    const values = req.body;
    if (!values || typeof values !== 'object') {
      const error: ApiError = { error: 'INVALID_REQUEST', message: 'Values object is required' };
      return res.status(400).json(error);
    }

    try {
      for (const [name, value] of Object.entries(values)) {
        if (typeof value === 'number') {
          await device.setValue(name, value);
        }
      }
      res.json({ success: true });
    } catch (err) {
      const error: ApiError = {
        error: 'SET_VALUE_FAILED',
        message: err instanceof Error ? err.message : 'Unknown error',
      };
      res.status(500).json(error);
    }
  });

  // POST /api/devices/:id/list - Upload list (if device has listMode)
  router.post('/:id/list', async (req, res) => {
    const device = registry.getDevice(req.params.id);
    if (!device) {
      const error: ApiError = { error: 'NOT_FOUND', message: 'Device not found' };
      return res.status(404).json(error);
    }

    if (!device.uploadList || !device.capabilities.listMode) {
      const error: ApiError = { error: 'NOT_SUPPORTED', message: 'Device does not support list mode' };
      return res.status(400).json(error);
    }

    const { mode, steps, repeat } = req.body as { mode: string; steps: ListStep[]; repeat?: number };
    if (!mode || !Array.isArray(steps)) {
      const error: ApiError = { error: 'INVALID_REQUEST', message: 'mode and steps[] are required' };
      return res.status(400).json(error);
    }

    try {
      await device.uploadList(mode, steps, repeat);
      res.json({ success: true });
    } catch (err) {
      const error: ApiError = {
        error: 'UPLOAD_LIST_FAILED',
        message: err instanceof Error ? err.message : 'Unknown error',
      };
      res.status(500).json(error);
    }
  });

  // POST /api/devices/:id/list/start - Start list execution
  router.post('/:id/list/start', async (req, res) => {
    const device = registry.getDevice(req.params.id);
    if (!device) {
      const error: ApiError = { error: 'NOT_FOUND', message: 'Device not found' };
      return res.status(404).json(error);
    }

    if (!device.startList || !device.capabilities.listMode) {
      const error: ApiError = { error: 'NOT_SUPPORTED', message: 'Device does not support list mode' };
      return res.status(400).json(error);
    }

    try {
      await device.startList();
      res.json({ success: true });
    } catch (err) {
      const error: ApiError = {
        error: 'START_LIST_FAILED',
        message: err instanceof Error ? err.message : 'Unknown error',
      };
      res.status(500).json(error);
    }
  });

  // POST /api/devices/:id/list/stop - Stop list execution
  router.post('/:id/list/stop', async (req, res) => {
    const device = registry.getDevice(req.params.id);
    if (!device) {
      const error: ApiError = { error: 'NOT_FOUND', message: 'Device not found' };
      return res.status(404).json(error);
    }

    if (!device.stopList || !device.capabilities.listMode) {
      const error: ApiError = { error: 'NOT_SUPPORTED', message: 'Device does not support list mode' };
      return res.status(400).json(error);
    }

    try {
      await device.stopList();
      res.json({ success: true });
    } catch (err) {
      const error: ApiError = {
        error: 'STOP_LIST_FAILED',
        message: err instanceof Error ? err.message : 'Unknown error',
      };
      res.status(500).json(error);
    }
  });

  return router;
}
