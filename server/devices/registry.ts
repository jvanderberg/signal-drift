/**
 * Device Registry
 * Manages device driver registration and discovery
 */

import type { DeviceDriver, DriverRegistration } from './types.js';

export interface DeviceRegistry {
  registerDriver(registration: DriverRegistration): void;
  getRegistrations(): DriverRegistration[];
  matchUSBDevice(vendorId: number, productId: number): DriverRegistration | undefined;
  matchSerialPort(path: string): DriverRegistration | undefined;

  addDevice(driver: DeviceDriver): void;
  removeDevice(id: string): void;
  getDevice(id: string): DeviceDriver | undefined;
  getDevices(): DeviceDriver[];
  clearDevices(): Promise<void>;
}

export function createDeviceRegistry(): DeviceRegistry {
  const registrations: DriverRegistration[] = [];
  const devices: Map<string, DeviceDriver> = new Map();

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

    addDevice(driver: DeviceDriver): void {
      devices.set(driver.info.id, driver);
    },

    removeDevice(id: string): void {
      devices.delete(id);
    },

    getDevice(id: string): DeviceDriver | undefined {
      return devices.get(id);
    },

    getDevices(): DeviceDriver[] {
      return [...devices.values()];
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
