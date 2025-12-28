/**
 * Device Scanner
 * Scans for USB and serial devices, probes them, and registers with the registry
 *
 * - First discovery: creates new device and session
 * - Reconnection: creates new transport/driver for existing disconnected session
 */

import usb from 'usb';
import { SerialPort } from 'serialport';
import type { DeviceRegistry } from './registry.js';
import type { SessionManager } from '../sessions/SessionManager.js';
import { createUSBTMCTransport } from './transports/usbtmc.js';
import { createSerialTransport } from './transports/serial.js';

export interface ScanResult {
  found: number;
  added: number;
  reconnected: number;
  devices: Array<{
    id: string;
    type: string;
    manufacturer: string;
    model: string;
  }>;
}

export async function scanDevices(
  registry: DeviceRegistry,
  sessionManager?: SessionManager
): Promise<ScanResult> {
  const result: ScanResult = {
    found: 0,
    added: 0,
    reconnected: 0,
    devices: [],
  };

  // Get existing sessions to check for disconnected devices that need reconnection
  const existingDevices = registry.getDevices();

  // Scan USB-TMC devices
  const usbDevices = usb.getDeviceList();
  for (const usbDevice of usbDevices) {
    const vendorId = usbDevice.deviceDescriptor.idVendor;
    const productId = usbDevice.deviceDescriptor.idProduct;

    const registration = registry.matchUSBDevice(vendorId, productId);
    if (registration) {
      // Create a temporary driver just to get its static info (no transport needed for this)
      const dummyTransport = { open: async () => {}, close: async () => {}, query: async () => '', write: async () => {}, isOpen: () => false };
      const tempDriver = registration.create(dummyTransport as any);

      // Check if we already have a device with matching manufacturer/model
      const existing = existingDevices.find(d =>
        d.info.manufacturer === tempDriver.info.manufacturer &&
        d.info.model === tempDriver.info.model
      );

      if (existing) {
        // Check if session is disconnected and needs reconnection
        if (sessionManager?.isSessionDisconnected(existing.info.id)) {
          try {
            const transport = createUSBTMCTransport(usbDevice);
            const driver = registration.create(transport);

            await transport.open();
            const probeSuccess = await driver.probe();

            if (probeSuccess) {
              sessionManager.reconnectSession(existing.info.id, driver);
              result.reconnected++;
              console.log(`[Scanner] RECONNECTED: ${existing.info.id}`);
            } else {
              await transport.close();
            }
          } catch (err) {
            console.error(`Failed to reconnect USB device ${existing.info.id}:`, err);
          }
        }

        result.found++;
        result.devices.push({
          id: existing.info.id,
          type: existing.info.type,
          manufacturer: existing.info.manufacturer,
          model: existing.info.model,
        });
        continue;
      }

      try {
        const transport = createUSBTMCTransport(usbDevice);
        const driver = registration.create(transport);

        await transport.open();
        const probeSuccess = await driver.probe();

        if (probeSuccess) {
          // Keep transport open for use
          registry.addDevice(driver);
          result.devices.push({
            id: driver.info.id,
            type: driver.info.type,
            manufacturer: driver.info.manufacturer,
            model: driver.info.model,
          });
          result.found++;
          result.added++;
          console.log(`[Scanner] CONNECTED: ${driver.info.id} (${driver.info.manufacturer} ${driver.info.model})`);
        } else {
          await transport.close();
        }
      } catch (err) {
        console.error(`Failed to probe USB device ${vendorId.toString(16)}:${productId.toString(16)}:`, err);
      }
    }
  }

  // Scan serial ports
  try {
    const ports = await SerialPort.list();
    for (const port of ports) {
      const registration = registry.matchSerialPort(port.path);
      if (registration) {
        // Create a temporary driver just to get its static info
        const dummyTransport = { open: async () => {}, close: async () => {}, query: async () => '', write: async () => {}, isOpen: () => false };
        const tempDriver = registration.create(dummyTransport as any);

        // Check if we already have a device with matching manufacturer/model
        const existing = existingDevices.find(d =>
          d.info.manufacturer === tempDriver.info.manufacturer &&
          d.info.model === tempDriver.info.model
        );

        if (existing) {
          // Check if session is disconnected and needs reconnection
          if (sessionManager?.isSessionDisconnected(existing.info.id)) {
            try {
              const portPath = port.path.replace('/dev/tty.', '/dev/cu.');
              const transport = createSerialTransport({
                path: portPath,
                baudRate: 115200,
                commandDelay: 50,
              });
              const driver = registration.create(transport);

              await transport.open();
              const probeSuccess = await driver.probe();

              if (probeSuccess) {
                sessionManager.reconnectSession(existing.info.id, driver);
                result.reconnected++;
                console.log(`[Scanner] RECONNECTED: ${existing.info.id}`);
              } else {
                await transport.close();
              }
            } catch (err) {
              console.error(`Failed to reconnect serial device ${existing.info.id}:`, err);
            }
          }

          result.found++;
          result.devices.push({
            id: existing.info.id,
            type: existing.info.type,
            manufacturer: existing.info.manufacturer,
            model: existing.info.model,
          });
          continue;
        }

        try {
          // On macOS, use cu. instead of tty. for outgoing connections
          const portPath = port.path.replace('/dev/tty.', '/dev/cu.');

          const transport = createSerialTransport({
            path: portPath,
            baudRate: 115200,  // Recommended for Matrix PSU polling
            commandDelay: 50,
          });
          const driver = registration.create(transport);

          await transport.open();
          const probeSuccess = await driver.probe();

          if (probeSuccess) {
            // Keep transport open for use
            registry.addDevice(driver);
            result.devices.push({
              id: driver.info.id,
              type: driver.info.type,
              manufacturer: driver.info.manufacturer,
              model: driver.info.model,
            });
            result.found++;
            result.added++;
            console.log(`[Scanner] CONNECTED: ${driver.info.id} (${driver.info.manufacturer} ${driver.info.model})`);
          } else {
            await transport.close();
          }
        } catch (err) {
          console.error(`Failed to probe serial port ${port.path}:`, err);
        }
      }
    }
  } catch (err) {
    console.error('Failed to list serial ports:', err);
  }

  return result;
}
