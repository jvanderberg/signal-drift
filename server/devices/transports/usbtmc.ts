/**
 * USB-TMC (Test & Measurement Class) Transport
 * Implements the USB-TMC protocol for SCPI communication
 */

import usb from 'usb';
import type { Transport } from '../types.js';

// USB-TMC Message IDs
export const DEV_DEP_MSG_OUT = 1;
export const REQUEST_DEV_DEP_MSG_IN = 2;

// Fatal USB errors that indicate device disconnection
const FATAL_USB_ERRORS = [
  'LIBUSB_ERROR_NO_DEVICE',
  'LIBUSB_ERROR_IO',
  'LIBUSB_ERROR_PIPE',
  'LIBUSB_TRANSFER_NO_DEVICE',
];

export interface USBTMCDevice {
  vendorId: number;
  productId: number;
  device: usb.Device;
}

export interface USBTMCConfig {
  timeout?: number;  // Query timeout in ms (default: 2000)
}

// Exported for testing
export function buildDevDepMsgOut(message: string, bTag: number): Buffer {
  const msgBytes = Buffer.from(message, 'ascii');

  // Header: 12 bytes + message + padding to 4-byte boundary
  const paddedLen = Math.ceil((12 + msgBytes.length) / 4) * 4;
  const buf = Buffer.alloc(paddedLen);

  buf[0] = DEV_DEP_MSG_OUT;      // MsgID
  buf[1] = bTag;                  // bTag
  buf[2] = ~bTag & 0xFF;         // bTagInverse
  buf[3] = 0;                     // Reserved
  buf.writeUInt32LE(msgBytes.length, 4);  // TransferSize
  buf[8] = 0x01;                  // bmTransferAttributes (EOM)
  buf[9] = 0;                     // Reserved
  buf[10] = 0;                    // Reserved
  buf[11] = 0;                    // Reserved
  msgBytes.copy(buf, 12);

  return buf;
}

// Exported for testing
export function buildRequestDevDepMsgIn(maxLength: number, bTag: number): Buffer {
  const buf = Buffer.alloc(12);

  buf[0] = REQUEST_DEV_DEP_MSG_IN;  // MsgID
  buf[1] = bTag;                     // bTag
  buf[2] = ~bTag & 0xFF;            // bTagInverse
  buf[3] = 0;                        // Reserved
  buf.writeUInt32LE(maxLength, 4);   // TransferSize
  buf[8] = 0;                        // bmTransferAttributes
  buf[9] = 0;                        // TermChar
  buf[10] = 0;                       // Reserved
  buf[11] = 0;                       // Reserved

  return buf;
}

// Exported for testing - parse response from device
export function parseDevDepMsgIn(response: Buffer): string {
  const transferSize = response.readUInt32LE(4);
  const data = response.subarray(12, 12 + transferSize);
  return data.toString('ascii').trim();
}

// Tag generator - cycles 1-255
export function createTagGenerator(): () => number {
  let bTag = 0;
  return () => {
    bTag = (bTag % 255) + 1;
    return bTag;
  };
}

export function createUSBTMCTransport(device: usb.Device, config: USBTMCConfig = {}): Transport {
  const { timeout = 2000 } = config;
  const nextTag = createTagGenerator();
  let bulkOutEndpoint: usb.OutEndpoint | null = null;
  let bulkInEndpoint: usb.InEndpoint | null = null;
  let iface: usb.Interface | null = null;
  let opened = false;
  let disconnected = false;
  let disconnectError: Error | null = null;

  // Mutex to prevent concurrent command/response interleaving
  let commandLock: Promise<void> = Promise.resolve();

  // Acquire lock for exclusive command access
  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const previousLock = commandLock;
    let releaseLock: () => void;
    commandLock = new Promise<void>(resolve => {
      releaseLock = resolve;
    });
    return previousLock.then(fn).finally(() => releaseLock());
  }

  // Check if an error indicates device disconnection
  function isFatalError(err: Error): boolean {
    return FATAL_USB_ERRORS.some(code => err.message.includes(code));
  }

  // Mark transport as disconnected
  function markDisconnected(err: Error): void {
    disconnected = true;
    disconnectError = err;
    opened = false;
  }

  function transferOut(data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!bulkOutEndpoint) {
        reject(new Error('Device not opened'));
        return;
      }
      bulkOutEndpoint.transfer(data, (err) => {
        if (err) {
          if (isFatalError(err)) {
            markDisconnected(err);
          }
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  function transferIn(length: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      if (!bulkInEndpoint) {
        reject(new Error('Device not opened'));
        return;
      }

      let settled = false;

      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`Timeout waiting for USB response after ${timeout}ms`));
        }
      }, timeout);

      bulkInEndpoint.transfer(length, (err, data) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);

        if (err) {
          if (isFatalError(err)) {
            markDisconnected(err);
          }
          reject(err);
        } else {
          resolve(data as Buffer);
        }
      });
    });
  }

  return {
    async open(): Promise<void> {
      if (opened) return;

      device.open();

      try {
        if (!device.interfaces || device.interfaces.length === 0) {
          throw new Error('No interfaces found on device');
        }

        iface = device.interfaces[0];

        if (iface.isKernelDriverActive()) {
          iface.detachKernelDriver();
        }
        iface.claim();

        // Find bulk endpoints (transfer type 2 = bulk)
        for (const endpoint of iface.endpoints) {
          if (endpoint.transferType === 2) {  // BULK
            if (endpoint.direction === 'in') {
              bulkInEndpoint = endpoint as usb.InEndpoint;
            } else if (endpoint.direction === 'out') {
              bulkOutEndpoint = endpoint as usb.OutEndpoint;
            }
          }
        }

        if (!bulkInEndpoint || !bulkOutEndpoint) {
          throw new Error('Could not find bulk endpoints');
        }

        opened = true;
        disconnected = false;
        disconnectError = null;
      } catch (err) {
        // Clean up on partial open failure
        try {
          device.close();
        } catch {
          // Ignore close errors during cleanup
        }
        throw err;
      }
    },

    async close(): Promise<void> {
      if (!opened && !disconnected) return;

      // Acquire lock to wait for any in-flight operations
      await withLock(async () => {
        try {
          if (iface) {
            iface.release(true);
          }
          device.close();
        } catch (e) {
          // Ignore close errors
        }

        bulkInEndpoint = null;
        bulkOutEndpoint = null;
        iface = null;
        opened = false;
        disconnected = false;
        disconnectError = null;
      });
    },

    async query(cmd: string): Promise<string> {
      return withLock(async () => {
        // Check for disconnection before attempting query
        if (disconnected) {
          throw disconnectError || new Error('USB device disconnected');
        }

        // Send command
        const outBuf = buildDevDepMsgOut(cmd + '\n', nextTag());
        await transferOut(outBuf);

        // Request response
        const reqBuf = buildRequestDevDepMsgIn(1024, nextTag());
        await transferOut(reqBuf);

        // Read response
        const response = await transferIn(1024);

        return parseDevDepMsgIn(response);
      });
    },

    async write(cmd: string): Promise<void> {
      return withLock(async () => {
        // Check for disconnection before attempting write
        if (disconnected) {
          throw disconnectError || new Error('USB device disconnected');
        }

        const outBuf = buildDevDepMsgOut(cmd + '\n', nextTag());
        await transferOut(outBuf);
      });
    },

    isOpen(): boolean {
      return opened && !disconnected;
    },
  };
}

// Helper to find USB-TMC devices
export function findUSBTMCDevices(): USBTMCDevice[] {
  const devices: USBTMCDevice[] = [];

  for (const device of usb.getDeviceList()) {
    devices.push({
      vendorId: device.deviceDescriptor.idVendor,
      productId: device.deviceDescriptor.idProduct,
      device,
    });
  }

  return devices;
}

export function findUSBTMCDevice(vendorId: number, productId: number): usb.Device | null {
  return usb.findByIds(vendorId, productId) || null;
}
