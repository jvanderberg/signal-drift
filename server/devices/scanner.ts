/**
 * Device Scanner
 * Scans for USB and serial devices, probes them, and registers with the registry
 */

import usb from 'usb';
import { SerialPort } from 'serialport';
import type { DeviceRegistry } from './registry.js';
import { createUSBTMCTransport } from './transports/usbtmc.js';
import { createSerialTransport } from './transports/serial.js';

export interface ScanResult {
  found: number;
  devices: Array<{
    id: string;
    type: string;
    manufacturer: string;
    model: string;
  }>;
}

export async function scanDevices(registry: DeviceRegistry): Promise<ScanResult> {
  const result: ScanResult = {
    found: 0,
    devices: [],
  };

  // Close existing connections and clear devices before scanning
  await registry.clearDevices();

  // Scan USB-TMC devices
  const usbDevices = usb.getDeviceList();
  for (const usbDevice of usbDevices) {
    const vendorId = usbDevice.deviceDescriptor.idVendor;
    const productId = usbDevice.deviceDescriptor.idProduct;

    const registration = registry.matchUSBDevice(vendorId, productId);
    if (registration) {
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
