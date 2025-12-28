/**
 * USB-TMC (Test & Measurement Class) Transport
 * Implements the USB-TMC protocol for SCPI communication
 */

import usb from 'usb';
import type { Transport } from '../types.js';

// USB-TMC Message IDs
export const DEV_DEP_MSG_OUT = 1;
export const REQUEST_DEV_DEP_MSG_IN = 2;

export interface USBTMCDevice {
  vendorId: number;
  productId: number;
  device: usb.Device;
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

export function createUSBTMCTransport(device: usb.Device): Transport {
  const nextTag = createTagGenerator();
  let bulkOutEndpoint: usb.OutEndpoint | null = null;
  let bulkInEndpoint: usb.InEndpoint | null = null;
  let iface: usb.Interface | null = null;
  let opened = false;

  function transferOut(data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!bulkOutEndpoint) {
        reject(new Error('Device not opened'));
        return;
      }
      bulkOutEndpoint.transfer(data, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  function transferIn(length: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      if (!bulkInEndpoint) {
        reject(new Error('Device not opened'));
        return;
      }
      bulkInEndpoint.transfer(length, (err, data) => {
        if (err) reject(err);
        else resolve(data as Buffer);
      });
    });
  }

  return {
    async open(): Promise<void> {
      if (opened) return;

      device.open();

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
    },

    async close(): Promise<void> {
      if (!opened) return;

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
    },

    async query(cmd: string): Promise<string> {
      // Send command
      const outBuf = buildDevDepMsgOut(cmd + '\n', nextTag());
      await transferOut(outBuf);

      // Request response
      const reqBuf = buildRequestDevDepMsgIn(1024, nextTag());
      await transferOut(reqBuf);

      // Read response
      const response = await transferIn(1024);

      return parseDevDepMsgIn(response);
    },

    async write(cmd: string): Promise<void> {
      const outBuf = buildDevDepMsgOut(cmd + '\n', nextTag());
      await transferOut(outBuf);
    },

    isOpen(): boolean {
      return opened;
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
