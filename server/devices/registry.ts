/**
 * Device Registry
 * Manages device driver registration and discovery
 */

import type { DeviceDriver, DriverRegistration, OscilloscopeDriver, OscilloscopeDriverRegistration } from './types.js';

export interface DeviceRegistry {
  // Standard device drivers (PSU, loads)
  registerDriver(registration: DriverRegistration): void;
  getRegistrations(): DriverRegistration[];
  matchUSBDevice(vendorId: number, productId: number): DriverRegistration | undefined;
  matchSerialPort(path: string): DriverRegistration | undefined;

  // Oscilloscope drivers
  registerOscilloscopeDriver(registration: OscilloscopeDriverRegistration): void;
  getOscilloscopeRegistrations(): OscilloscopeDriverRegistration[];
  matchOscilloscopeUSB(vendorId: number, productId: number): OscilloscopeDriverRegistration | undefined;
  matchOscilloscopeIDN(manufacturer: string, model: string): OscilloscopeDriverRegistration | undefined;

  // Device management
  addDevice(driver: DeviceDriver): void;
  removeDevice(id: string): Promise<void>;
  getDevice(id: string): DeviceDriver | undefined;
  getDevices(): DeviceDriver[];

  // Oscilloscope management
  addOscilloscope(driver: OscilloscopeDriver): void;
  removeOscilloscope(id: string): Promise<void>;
  getOscilloscope(id: string): OscilloscopeDriver | undefined;
  getOscilloscopes(): OscilloscopeDriver[];

  clearDevices(): Promise<void>;
}

// Helper to match string or regex
function matchPattern(value: string, pattern: string | RegExp | undefined): boolean {
  if (!pattern) return true;  // No pattern = match all
  if (typeof pattern === 'string') return value.toUpperCase().includes(pattern.toUpperCase());
  return pattern.test(value);
}

export function createDeviceRegistry(): DeviceRegistry {
  const registrations: DriverRegistration[] = [];
  const oscilloscopeRegistrations: OscilloscopeDriverRegistration[] = [];
  const devices: Map<string, DeviceDriver> = new Map();
  const oscilloscopes: Map<string, OscilloscopeDriver> = new Map();

  return {
    registerDriver(registration: DriverRegistration): void {
      registrations.push(registration);
    },

    getRegistrations(): DriverRegistration[] {
      return [...registrations];
    },

    matchUSBDevice(vendorId: number, productId: number): DriverRegistration | undefined {
      return registrations.find(
        r =>
          r.transportType === 'usbtmc' &&
          r.match.vendorId === vendorId &&
          r.match.productId === productId
      );
    },

    matchSerialPort(path: string): DriverRegistration | undefined {
      return registrations.find(
        r =>
          r.transportType === 'serial' &&
          r.match.pathPattern?.test(path)
      );
    },

    // Oscilloscope registration
    registerOscilloscopeDriver(registration: OscilloscopeDriverRegistration): void {
      oscilloscopeRegistrations.push(registration);
    },

    getOscilloscopeRegistrations(): OscilloscopeDriverRegistration[] {
      return [...oscilloscopeRegistrations];
    },

    matchOscilloscopeUSB(vendorId: number, _productId: number): OscilloscopeDriverRegistration | undefined {
      // Return registrations that match the vendor (we'll probe to check model)
      return oscilloscopeRegistrations.find(
        r => r.transportType === 'usbtmc' && r.match.vendorId === vendorId
      );
    },

    // Match IDN response against registered oscilloscope drivers, return most specific
    matchOscilloscopeIDN(manufacturer: string, model: string): OscilloscopeDriverRegistration | undefined {
      const matches = oscilloscopeRegistrations.filter(r =>
        matchPattern(manufacturer, r.match.manufacturer) &&
        matchPattern(model, r.match.model)
      );
      if (matches.length === 0) return undefined;
      // Sort by specificity (higher wins), then return first
      matches.sort((a, b) => (b.specificity ?? 0) - (a.specificity ?? 0));
      return matches[0];
    },

    addDevice(driver: DeviceDriver): void {
      devices.set(driver.info.id, driver);
    },

    async removeDevice(id: string): Promise<void> {
      const device = devices.get(id);
      if (device) {
        try {
          await device.disconnect();
          console.log(`[Registry] Disconnected device: ${id}`);
        } catch (err) {
          console.error(`[Registry] Failed to disconnect ${id}:`, err);
        }
        devices.delete(id);
      }
    },

    getDevice(id: string): DeviceDriver | undefined {
      return devices.get(id);
    },

    getDevices(): DeviceDriver[] {
      return [...devices.values()];
    },

    // Oscilloscope device management
    addOscilloscope(driver: OscilloscopeDriver): void {
      oscilloscopes.set(driver.info.id, driver);
    },

    async removeOscilloscope(id: string): Promise<void> {
      const scope = oscilloscopes.get(id);
      if (scope) {
        try {
          await scope.disconnect();
          console.log(`[Registry] Disconnected oscilloscope: ${id}`);
        } catch (err) {
          console.error(`[Registry] Failed to disconnect oscilloscope ${id}:`, err);
        }
        oscilloscopes.delete(id);
      }
    },

    getOscilloscope(id: string): OscilloscopeDriver | undefined {
      return oscilloscopes.get(id);
    },

    getOscilloscopes(): OscilloscopeDriver[] {
      return [...oscilloscopes.values()];
    },

    async clearDevices(): Promise<void> {
      // Disconnect all devices before clearing
      for (const device of devices.values()) {
        try {
          await device.disconnect();
        } catch (err) {
          console.error(`Failed to disconnect ${device.info.id}:`, err);
        }
      }
      devices.clear();

      // Disconnect all oscilloscopes
      for (const scope of oscilloscopes.values()) {
        try {
          await scope.disconnect();
        } catch (err) {
          console.error(`Failed to disconnect oscilloscope ${scope.info.id}:`, err);
        }
      }
      oscilloscopes.clear();
    },
  };
}

// Convenience function for registering drivers
export function registerDriver(
  registry: DeviceRegistry,
  registration: DriverRegistration
): void {
  registry.registerDriver(registration);
}
