/**
 * USB-TMC (Test & Measurement Class) Transport
 * Implements the USB-TMC protocol for SCPI communication
 */

import usb from 'usb';
import type { Transport } from '../types.js';
import type { Result } from '../../../shared/types.js';
import { Ok, Err } from '../../../shared/types.js';

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
  // Enable Rigol quirk mode for binary reads (DS1000Z series, etc.)
  // Rigol's USBTMC headers report incorrect transferSize, causing data corruption.
  // This mode ignores transferSize and uses IEEE block headers instead.
  // See: server/devices/docs/rigol-usbtmc-quirk.md
  rigolQuirk?: boolean;
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
  if (response.length < 12) {
    throw new Error(`USBTMC response too short: ${response.length} bytes (need at least 12)`);
  }
  const transferSize = response.readUInt32LE(4);
  const data = response.subarray(12, 12 + transferSize);
  return data.toString('ascii').trim();
}

// Parse binary response - returns raw Buffer
export function parseDevDepMsgInBinary(response: Buffer): { data: Buffer; eom: boolean } {
  if (response.length < 12) {
    throw new Error(`USBTMC binary response too short: ${response.length} bytes (need at least 12)`);
  }
  const transferSize = response.readUInt32LE(4);
  const bmTransferAttributes = response[8];
  const eom = (bmTransferAttributes & 0x01) !== 0;  // EOM bit
  const data = response.subarray(12, 12 + transferSize);
  return { data, eom };
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
  const { timeout = 2000, rigolQuirk = false } = config;
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
    async open(): Promise<Result<void, Error>> {
      if (opened) return Ok(undefined);

      try {
        device.open();
      } catch (e) {
        return Err(e instanceof Error ? e : new Error(String(e)));
      }

      try {
        if (!device.interfaces || device.interfaces.length === 0) {
          device.close();
          return Err(new Error('No interfaces found on device'));
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
          device.close();
          return Err(new Error('Could not find bulk endpoints'));
        }

        opened = true;
        disconnected = false;
        disconnectError = null;
        return Ok(undefined);
      } catch (err) {
        // Clean up on partial open failure
        try {
          device.close();
        } catch {
          // Ignore close errors during cleanup
        }
        return Err(err instanceof Error ? err : new Error(String(err)));
      }
    },

    async close(): Promise<Result<void, Error>> {
      if (!opened && !disconnected) return Ok(undefined);

      // Acquire lock to wait for any in-flight operations
      await withLock(async () => {
        try {
          if (iface) {
            iface.release(true);
          }
          device.close();
        } catch {
          // Ignore close errors
        }

        bulkInEndpoint = null;
        bulkOutEndpoint = null;
        iface = null;
        opened = false;
        disconnected = false;
        disconnectError = null;
      });
      return Ok(undefined);
    },

    async query(cmd: string): Promise<Result<string, Error>> {
      return withLock(async () => {
        // Check for disconnection before attempting query
        if (disconnected) {
          return Err(disconnectError || new Error('USB device disconnected'));
        }

        try {
          // Send command
          const outBuf = buildDevDepMsgOut(cmd + '\n', nextTag());
          await transferOut(outBuf);

          // Request response
          const reqBuf = buildRequestDevDepMsgIn(1024, nextTag());
          await transferOut(reqBuf);

          // Read response
          const response = await transferIn(1024);

          return Ok(parseDevDepMsgIn(response));
        } catch (e) {
          return Err(e instanceof Error ? e : new Error(String(e)));
        }
      });
    },

    async write(cmd: string): Promise<Result<void, Error>> {
      return withLock(async () => {
        // Check for disconnection before attempting write
        if (disconnected) {
          return Err(disconnectError || new Error('USB device disconnected'));
        }

        try {
          const outBuf = buildDevDepMsgOut(cmd + '\n', nextTag());
          await transferOut(outBuf);
          return Ok(undefined);
        } catch (e) {
          return Err(e instanceof Error ? e : new Error(String(e)));
        }
      });
    },

    async queryBinary(cmd: string): Promise<Result<Buffer, Error>> {
      return withLock(async () => {
        if (disconnected) {
          return Err(disconnectError || new Error('USB device disconnected'));
        }

        try {
          // Send command
          const outBuf = buildDevDepMsgOut(cmd + '\n', nextTag());
          await transferOut(outBuf);

          // Rigol DS1000Z USBTMC Quirk Mode
          //
          // PROBLEM: Rigol's USBTMC header lies about transferSize. If we trust it,
          // we stop reading too early, leaving bytes in the USB buffer. These leftover
          // bytes corrupt the next response, causing waveform data corruption.
          //
          // SOLUTION: Ignore transferSize. For each REQUEST, read until we get a short
          // USB packet (< 64 bytes), which indicates the device finished responding.
          // Use the IEEE 488.2 block header (#9XXXXXXXXX) to know total expected length.
          //
          // See: server/devices/docs/rigol-usbtmc-quirk.md for full analysis
          if (rigolQuirk) {
            const allData: Buffer[] = [];
            let totalDataBytes = 0;
            let expectedDataLength = 0;
            let ieeeHeaderLen = 0;

            for (let reqNum = 0; reqNum < 100; reqNum++) {
              const reqBuf = buildRequestDevDepMsgIn(64 * 1024, nextTag());
              await transferOut(reqBuf);

              // Read until short packet - this fully drains the response buffer
              const chunks: Buffer[] = [];
              let totalRead = 0;
              for (let i = 0; i < 1000; i++) {
                const pkt = await transferIn(512);
                if (pkt.length === 0) break;
                chunks.push(pkt);
                totalRead += pkt.length;
                if (pkt.length < 64) break;  // Short packet = end of response
              }
              if (totalRead === 0) break;

              // Strip USBTMC header (12 bytes) - ignore its lying transferSize
              const response = Buffer.concat(chunks);
              const payload = response.subarray(12);
              allData.push(payload);
              totalDataBytes += payload.length;

              // Parse IEEE block header from first response: #NXXXXXXXX
              if (expectedDataLength === 0 && allData[0].length >= 2 && allData[0][0] === 0x23) {
                const numDigits = parseInt(String.fromCharCode(allData[0][1]), 10);
                if (numDigits > 0 && numDigits <= 9 && allData[0].length >= 2 + numDigits) {
                  expectedDataLength = parseInt(allData[0].subarray(2, 2 + numDigits).toString('ascii'), 10);
                  ieeeHeaderLen = 2 + numDigits;
                }
              }

              // Done when we have all bytes per IEEE header
              if (expectedDataLength > 0 && totalDataBytes >= ieeeHeaderLen + expectedDataLength) break;
            }

            const combined = Buffer.concat(allData);
            return Ok(combined.subarray(0, ieeeHeaderLen + expectedDataLength));
          }

          // Standard mode: Collect data from multiple USBTMC messages until EOM
          const allData: Buffer[] = [];
          let eom = false;

          while (!eom) {
            // Request data
            const reqBuf = buildRequestDevDepMsgIn(64 * 1024, nextTag());
            await transferOut(reqBuf);

            // Read one USBTMC message (may span multiple USB packets)
            const msgChunks: Buffer[] = [];
            let msgBytes = 0;
            let transferSize = 0;
            let headerParsed = false;

            // Read USB packets until we have the full USBTMC message
            for (let i = 0; i < 1000; i++) {
              const chunk = await transferIn(512);
              if (chunk.length === 0) break;
              msgChunks.push(chunk);
              msgBytes += chunk.length;

              // Parse USBTMC header from first 12 bytes
              if (!headerParsed && msgBytes >= 12) {
                const combined = Buffer.concat(msgChunks);
                transferSize = combined.readUInt32LE(4);
                eom = (combined[8] & 0x01) !== 0;
                headerParsed = true;
              }

              // Check if we have all data for this message
              if (headerParsed && msgBytes >= transferSize + 12) break;
            }

            // Extract data (skip 12-byte USBTMC header)
            const msgData = Buffer.concat(msgChunks);
            if (transferSize > 0) {
              allData.push(msgData.subarray(12, 12 + transferSize));
            }
          }

          return Ok(Buffer.concat(allData));
        } catch (e) {
          return Err(e instanceof Error ? e : new Error(String(e)));
        }
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
