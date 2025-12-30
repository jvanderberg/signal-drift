/**
 * Device Scanner
 * Scans for USB and serial devices, probes them, and registers with the registry
 *
 * - First discovery: creates new device and session
 * - Reconnection: creates new transport/driver for existing disconnected session
 * - Uses mutex to prevent concurrent scans
 */

import usb from 'usb';
import { SerialPort } from 'serialport';
import type { DeviceRegistry } from './registry.js';
import type { SessionManager } from '../sessions/SessionManager.js';
import type { DriverRegistration, SerialOptions, OscilloscopeDriverRegistration } from './types.js';
import { createUSBTMCTransport } from './transports/usbtmc.js';
import { createSerialTransport, SerialConfig } from './transports/serial.js';

// Default baud rates to try during auto-detection (most common first)
const DEFAULT_BAUD_RATES = [115200, 9600, 57600, 38400, 19200];

// Rigol vendor ID - devices with this vendor need quirk mode for binary transfers
const RIGOL_VENDOR_ID = 0x1ab1;

/**
 * Try to probe a serial device at different baud rates
 * Returns the working config or null if none work
 */
async function autoDetectSerialConfig(
  portPath: string,
  registration: DriverRegistration
): Promise<SerialConfig | null> {
  const serialOpts = registration.serialOptions ?? {};
  const baudRates = serialOpts.baudRates ?? DEFAULT_BAUD_RATES;
  const commandDelay = serialOpts.commandDelay ?? 50;
  const timeout = serialOpts.timeout ?? 2000;

  // If a specific baud rate is set, only try that one
  if (serialOpts.baudRate) {
    return {
      path: portPath,
      baudRate: serialOpts.baudRate,
      commandDelay,
      timeout,
    };
  }

  // Try each baud rate
  for (const baudRate of baudRates) {
    const config: SerialConfig = {
      path: portPath,
      baudRate,
      commandDelay,
      timeout: 500, // Use shorter timeout during detection
    };

    const transport = createSerialTransport(config);
    const driver = registration.create(transport);

    const openResult = await transport.open();
    if (!openResult.ok) continue;

    const probeResult = await driver.probe();
    await transport.close(); // Ignore close errors

    if (probeResult.ok) {
      console.log(`[Scanner] Auto-detected baud rate ${baudRate} for ${portPath}`);
      return { ...config, timeout }; // Return with normal timeout
    }
  }

  return null;
}

// Mutex to prevent concurrent scans
let scanLock: Promise<void> = Promise.resolve();

async function withScanLock<T>(fn: () => Promise<T>): Promise<T> {
  const previousLock = scanLock;
  let releaseLock: () => void;
  scanLock = new Promise<void>(resolve => {
    releaseLock = resolve;
  });
  await previousLock;
  try {
    return await fn();
  } finally {
    releaseLock!();
  }
}

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
  // Use lock to prevent concurrent scans
  return withScanLock(async () => {
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
      const dummyTransport = { open: async () => ({ ok: true, value: undefined } as const), close: async () => ({ ok: true, value: undefined } as const), query: async () => ({ ok: true, value: '' } as const), write: async () => ({ ok: true, value: undefined } as const), isOpen: () => false };
      const tempDriver = registration.create(dummyTransport);

      // Check if we already have a device with matching manufacturer/model
      const existing = existingDevices.find(d =>
        d.info.manufacturer === tempDriver.info.manufacturer &&
        d.info.model === tempDriver.info.model
      );

      if (existing) {
        // Check if session is disconnected and needs reconnection
        if (sessionManager?.isSessionDisconnected(existing.info.id)) {
          const transport = createUSBTMCTransport(usbDevice, {
            rigolQuirk: vendorId === RIGOL_VENDOR_ID,
          });
          const driver = registration.create(transport);

          const openResult = await transport.open();
          if (openResult.ok) {
            const probeResult = await driver.probe();

            if (probeResult.ok) {
              sessionManager.reconnectSession(existing.info.id, driver);
              result.reconnected++;
              console.log(`[Scanner] RECONNECTED: ${existing.info.id}`);
            } else {
              await transport.close();
            }
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

      const transport = createUSBTMCTransport(usbDevice, {
        rigolQuirk: vendorId === RIGOL_VENDOR_ID,
      });
      const driver = registration.create(transport);

      const openResult = await transport.open();
      if (!openResult.ok) {
        console.error(`Failed to open USB device ${vendorId.toString(16)}:${productId.toString(16)}:`, openResult.error);
        continue;
      }

      const probeResult = await driver.probe();

      if (probeResult.ok) {
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
    }
  }

  // Scan for oscilloscopes (probe by vendor, match by IDN)
  const oscilloscopeRegs = registry.getOscilloscopeRegistrations();
  const scannedVendors = new Set<number>();

  for (const usbDevice of usbDevices) {
    const vendorId = usbDevice.deviceDescriptor.idVendor;
    const productId = usbDevice.deviceDescriptor.idProduct;

    // Skip if we already have a standard driver for this device
    if (registry.matchUSBDevice(vendorId, productId)) continue;

    // Check if any oscilloscope registration matches this vendor
    const matchingReg = oscilloscopeRegs.find(r =>
      r.transportType === 'usbtmc' && r.match.vendorId === vendorId
    );
    if (!matchingReg) continue;

    // Check if already registered as oscilloscope
    const existingScopes = registry.getOscilloscopes();
    const existingScope = existingScopes.find(s => {
      // Match by manufacturer/model pattern since we don't have serial yet
      return s.info.manufacturer.toUpperCase().includes('RIGOL');
    });

    if (existingScope) {
      // Check if session is disconnected and needs reconnection
      if (sessionManager?.isSessionDisconnected(existingScope.info.id)) {
        const transport = createUSBTMCTransport(usbDevice, {
          rigolQuirk: vendorId === RIGOL_VENDOR_ID,
        });
        const openResult = await transport.open();
        if (!openResult.ok) continue;

        // Query IDN to find correct driver
        const idnResult = await transport.query('*IDN?');
        if (!idnResult.ok) {
          await transport.close();
          continue;
        }

        const idn = idnResult.value;
        const parts = idn.split(',');
        if (parts.length >= 2) {
          const manufacturer = parts[0].trim();
          const model = parts[1].trim();
          const registration = registry.matchOscilloscopeIDN(manufacturer, model);

          if (registration) {
            const driver = registration.create(transport);
            const probeResult = await driver.probe();

            if (probeResult.ok) {
              sessionManager.reconnectOscilloscopeSession(existingScope.info.id, driver);
              result.reconnected++;
              console.log(`[Scanner] RECONNECTED: ${existingScope.info.id}`);
            } else {
              await transport.close();
            }
          } else {
            await transport.close();
          }
        } else {
          await transport.close();
        }
      }

      result.found++;
      result.devices.push({
        id: existingScope.info.id,
        type: existingScope.info.type,
        manufacturer: existingScope.info.manufacturer,
        model: existingScope.info.model,
      });
      continue;
    }

    const transport = createUSBTMCTransport(usbDevice, {
      rigolQuirk: vendorId === RIGOL_VENDOR_ID,
    });
    const openResult = await transport.open();
    if (!openResult.ok) continue;

    // Query IDN to identify the device
    const idnResult = await transport.query('*IDN?');
    if (!idnResult.ok) {
      await transport.close();
      continue;
    }

    const idn = idnResult.value;
    const parts = idn.split(',');
    if (parts.length < 2) {
      await transport.close();
      continue;
    }

    const manufacturer = parts[0].trim();
    const model = parts[1].trim();

    // Find most specific matching driver
    const registration = registry.matchOscilloscopeIDN(manufacturer, model);
    if (!registration) {
      await transport.close();
      continue;
    }

    // Create driver and probe
    const driver = registration.create(transport);
    const probeResult = await driver.probe();

    if (probeResult.ok) {
      registry.addOscilloscope(driver);
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
  }

  // Scan serial ports
  try {
    const ports = await SerialPort.list();
    for (const port of ports) {
      const registration = registry.matchSerialPort(port.path);
      if (registration) {
        // Create a temporary driver just to get its static info
        const dummyTransport = { open: async () => ({ ok: true, value: undefined } as const), close: async () => ({ ok: true, value: undefined } as const), query: async () => ({ ok: true, value: '' } as const), write: async () => ({ ok: true, value: undefined } as const), isOpen: () => false };
        const tempDriver = registration.create(dummyTransport);

        // Check if we already have a device with matching manufacturer/model
        const existing = existingDevices.find(d =>
          d.info.manufacturer === tempDriver.info.manufacturer &&
          d.info.model === tempDriver.info.model
        );

        if (existing) {
          // Check if session is disconnected and needs reconnection
          if (sessionManager?.isSessionDisconnected(existing.info.id)) {
            // On macOS, use cu. instead of tty. for outgoing connections
            const portPath = port.path.replace('/dev/tty.', '/dev/cu.');

            // Use driver-specific serial config or auto-detect
            const serialConfig = await autoDetectSerialConfig(portPath, registration);
            if (!serialConfig) {
              console.error(`[Scanner] No working baud rate found for ${portPath}`);
              continue;
            }

            const transport = createSerialTransport(serialConfig);
            const driver = registration.create(transport);

            const openResult = await transport.open();
            if (!openResult.ok) continue;

            const probeResult = await driver.probe();

            if (probeResult.ok) {
              sessionManager.reconnectSession(existing.info.id, driver);
              result.reconnected++;
              console.log(`[Scanner] RECONNECTED: ${existing.info.id}`);
            } else {
              await transport.close();
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

        // On macOS, use cu. instead of tty. for outgoing connections
        const portPath = port.path.replace('/dev/tty.', '/dev/cu.');

        // Use driver-specific serial config or auto-detect
        const serialConfig = await autoDetectSerialConfig(portPath, registration);
        if (!serialConfig) {
          console.log(`[Scanner] No working baud rate found for ${portPath}, skipping`);
          continue;
        }

        // Create transport with detected config (auto-detect already verified it works)
        const transport = createSerialTransport(serialConfig);
        const driver = registration.create(transport);

        const openResult = await transport.open();
        if (!openResult.ok) {
          console.error(`Failed to connect serial port ${port.path}:`, openResult.error);
          continue;
        }

        // Probe to populate driver info (like serial number)
        const probeResult = await driver.probe();
        if (!probeResult.ok) {
          await transport.close();
          console.log(`[Scanner] Probe failed for ${port.path}: ${probeResult.error.message}`);
          continue;
        }

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
        console.log(`[Scanner] CONNECTED: ${driver.info.id} (${driver.info.manufacturer} ${driver.info.model}) @ ${serialConfig.baudRate} baud`);
      }
    }
  } catch (err) {
    console.error('Failed to list serial ports:', err);
  }

    return result;
  });
}
