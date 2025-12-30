import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockTransport } from './mock-transport.js';
import {
  createDeviceRegistry,
  registerDriver,
  type DeviceRegistry,
} from '../registry.js';
import type { DeviceDriver, Transport, DriverRegistration } from '../types.js';

// Mock driver factory for testing
function createMockDriver(id: string, probeShouldSucceed = true): DeviceDriver {
  const transport = createMockTransport({
    responses: { '*IDN?': 'MOCK,Device,12345' },
  });

  return {
    info: {
      id,
      type: 'electronic-load',
      manufacturer: 'Mock',
      model: 'Device',
    },
    capabilities: {
      deviceClass: 'load',
      features: {},
      modes: ['CC'],
      modesSettable: true,
      outputs: [],
      measurements: [],
    },
    async probe() {
      return probeShouldSucceed;
    },
    async connect() {
      await transport.open();
    },
    async disconnect() {
      await transport.close();
    },
    async getStatus() {
      return {
        mode: 'CC',
        outputEnabled: false,
        setpoints: {},
        measurements: {},
      };
    },
    async setMode() {},
    async setValue() {},
    async setOutput() {},
  };
}

describe('Device Registry', () => {
  let registry: DeviceRegistry;

  beforeEach(() => {
    registry = createDeviceRegistry();
  });

  describe('registerDriver()', () => {
    it('should add a driver registration', () => {
      const registration: DriverRegistration = {
        create: () => createMockDriver('test-1'),
        transportType: 'usbtmc',
        match: { vendorId: 0x1234, productId: 0x5678 },
      };

      registry.registerDriver(registration);
      expect(registry.getRegistrations().length).toBe(1);
    });

    it('should allow multiple registrations', () => {
      registry.registerDriver({
        create: () => createMockDriver('test-1'),
        transportType: 'usbtmc',
        match: { vendorId: 0x1234, productId: 0x5678 },
      });

      registry.registerDriver({
        create: () => createMockDriver('test-2'),
        transportType: 'serial',
        match: { pathPattern: /usbserial/i },
      });

      expect(registry.getRegistrations().length).toBe(2);
    });
  });

  describe('matchUSBDevice()', () => {
    it('should match by vendor and product ID', () => {
      const registration: DriverRegistration = {
        create: () => createMockDriver('test-1'),
        transportType: 'usbtmc',
        match: { vendorId: 0x1AB1, productId: 0x0E11 },
      };

      registry.registerDriver(registration);

      const match = registry.matchUSBDevice(0x1AB1, 0x0E11);
      expect(match).toBe(registration);
    });

    it('should return undefined for no match', () => {
      registry.registerDriver({
        create: () => createMockDriver('test-1'),
        transportType: 'usbtmc',
        match: { vendorId: 0x1234, productId: 0x5678 },
      });

      const match = registry.matchUSBDevice(0xFFFF, 0xFFFF);
      expect(match).toBeUndefined();
    });

    it('should only match usbtmc transport types', () => {
      registry.registerDriver({
        create: () => createMockDriver('test-1'),
        transportType: 'serial',
        match: { vendorId: 0x1234, productId: 0x5678 },
      });

      const match = registry.matchUSBDevice(0x1234, 0x5678);
      expect(match).toBeUndefined();
    });
  });

  describe('matchSerialPort()', () => {
    it('should match by path pattern', () => {
      const registration: DriverRegistration = {
        create: () => createMockDriver('test-1'),
        transportType: 'serial',
        match: { pathPattern: /usbserial/i },
      };

      registry.registerDriver(registration);

      const match = registry.matchSerialPort('/dev/cu.usbserial-1234');
      expect(match).toBe(registration);
    });

    it('should return undefined for no match', () => {
      registry.registerDriver({
        create: () => createMockDriver('test-1'),
        transportType: 'serial',
        match: { pathPattern: /usbserial/i },
      });

      const match = registry.matchSerialPort('/dev/ttyACM0');
      expect(match).toBeUndefined();
    });

    it('should only match serial transport types', () => {
      registry.registerDriver({
        create: () => createMockDriver('test-1'),
        transportType: 'usbtmc',
        match: { pathPattern: /usbserial/i },
      });

      const match = registry.matchSerialPort('/dev/cu.usbserial-1234');
      expect(match).toBeUndefined();
    });
  });

  describe('Device Management', () => {
    it('should add and retrieve connected devices', () => {
      const driver = createMockDriver('device-1');
      registry.addDevice(driver);

      const devices = registry.getDevices();
      expect(devices.length).toBe(1);
      expect(devices[0].info.id).toBe('device-1');
    });

    it('should get device by id', () => {
      const driver = createMockDriver('device-1');
      registry.addDevice(driver);

      const device = registry.getDevice('device-1');
      expect(device).toBe(driver);
    });

    it('should return undefined for unknown device id', () => {
      const device = registry.getDevice('nonexistent');
      expect(device).toBeUndefined();
    });

    it('should remove device by id', async () => {
      const driver = createMockDriver('device-1');
      registry.addDevice(driver);

      await registry.removeDevice('device-1');
      expect(registry.getDevices().length).toBe(0);
    });

    it('should clear all devices', async () => {
      registry.addDevice(createMockDriver('device-1'));
      registry.addDevice(createMockDriver('device-2'));

      await registry.clearDevices();
      expect(registry.getDevices().length).toBe(0);
    });
  });
});
