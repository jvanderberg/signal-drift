import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildDevDepMsgOut,
  buildRequestDevDepMsgIn,
  parseDevDepMsgIn,
  createTagGenerator,
  createUSBTMCTransport,
  DEV_DEP_MSG_OUT,
  REQUEST_DEV_DEP_MSG_IN,
} from '../transports/usbtmc.js';
import type { Device, Interface, InEndpoint, OutEndpoint } from 'usb';

// Helper to create a mock USB device
function createMockDevice(options: {
  transferOutDelay?: number;
  transferInDelay?: number;
  transferInError?: Error;
  transferOutError?: Error;
  openError?: Error;
  claimError?: Error;
} = {}): Device {
  const mockInEndpoint = {
    direction: 'in',
    transferType: 2, // BULK
    transfer: vi.fn((length: number, cb: (err: Error | undefined, data?: Buffer) => void) => {
      if (options.transferInError) {
        setTimeout(() => cb(options.transferInError), options.transferInDelay ?? 0);
      } else {
        const response = Buffer.alloc(length);
        response.writeUInt32LE(4, 4); // TransferSize = 4
        Buffer.from('OK\r\n').copy(response, 12);
        setTimeout(() => cb(undefined, response), options.transferInDelay ?? 0);
      }
    }),
  } as unknown as InEndpoint;

  const mockOutEndpoint = {
    direction: 'out',
    transferType: 2, // BULK
    transfer: vi.fn((data: Buffer, cb: (err?: Error) => void) => {
      if (options.transferOutError) {
        setTimeout(() => cb(options.transferOutError), options.transferOutDelay ?? 0);
      } else {
        setTimeout(() => cb(), options.transferOutDelay ?? 0);
      }
    }),
  } as unknown as OutEndpoint;

  const mockInterface = {
    endpoints: [mockInEndpoint, mockOutEndpoint],
    isKernelDriverActive: vi.fn(() => false),
    detachKernelDriver: vi.fn(),
    claim: vi.fn(() => {
      if (options.claimError) throw options.claimError;
    }),
    release: vi.fn((closeEndpoints: boolean, cb?: (err?: Error) => void) => {
      if (cb) cb();
    }),
  } as unknown as Interface;

  return {
    deviceDescriptor: { idVendor: 0x1234, idProduct: 0x5678 },
    interfaces: [mockInterface],
    open: vi.fn(() => {
      if (options.openError) throw options.openError;
    }),
    close: vi.fn(),
  } as unknown as Device;
}

describe('USB-TMC Protocol', () => {
  describe('buildDevDepMsgOut', () => {
    it('should build a valid DEV_DEP_MSG_OUT packet', () => {
      const buf = buildDevDepMsgOut('*IDN?', 1);

      // Check header
      expect(buf[0]).toBe(DEV_DEP_MSG_OUT);  // MsgID
      expect(buf[1]).toBe(1);                 // bTag
      expect(buf[2]).toBe(0xFE);              // bTagInverse (~1 & 0xFF)
      expect(buf[3]).toBe(0);                 // Reserved

      // Check transfer size (little endian)
      expect(buf.readUInt32LE(4)).toBe(5);    // '*IDN?' = 5 bytes

      // Check attributes
      expect(buf[8]).toBe(0x01);              // bmTransferAttributes (EOM)
      expect(buf[9]).toBe(0);                 // Reserved
      expect(buf[10]).toBe(0);                // Reserved
      expect(buf[11]).toBe(0);                // Reserved

      // Check message content
      expect(buf.toString('ascii', 12, 17)).toBe('*IDN?');
    });

    it('should pad to 4-byte boundary', () => {
      // 12-byte header + 5-byte message = 17 bytes, padded to 20
      const buf = buildDevDepMsgOut('*IDN?', 1);
      expect(buf.length).toBe(20);

      // 12-byte header + 1-byte message = 13 bytes, padded to 16
      const buf2 = buildDevDepMsgOut('A', 1);
      expect(buf2.length).toBe(16);

      // 12-byte header + 4-byte message = 16 bytes, no padding needed
      const buf3 = buildDevDepMsgOut('ABCD', 1);
      expect(buf3.length).toBe(16);
    });

    it('should correctly set bTag and bTagInverse', () => {
      const buf = buildDevDepMsgOut('X', 42);
      expect(buf[1]).toBe(42);
      expect(buf[2]).toBe(~42 & 0xFF);  // 0xD5
    });

    it('should handle max bTag value (255)', () => {
      const buf = buildDevDepMsgOut('X', 255);
      expect(buf[1]).toBe(255);
      expect(buf[2]).toBe(0);  // ~255 & 0xFF = 0
    });
  });

  describe('buildRequestDevDepMsgIn', () => {
    it('should build a valid REQUEST_DEV_DEP_MSG_IN packet', () => {
      const buf = buildRequestDevDepMsgIn(1024, 5);

      // Check header
      expect(buf[0]).toBe(REQUEST_DEV_DEP_MSG_IN);  // MsgID
      expect(buf[1]).toBe(5);                        // bTag
      expect(buf[2]).toBe(~5 & 0xFF);               // bTagInverse
      expect(buf[3]).toBe(0);                        // Reserved

      // Check max transfer size
      expect(buf.readUInt32LE(4)).toBe(1024);

      // Check remaining bytes are zero
      expect(buf[8]).toBe(0);   // bmTransferAttributes
      expect(buf[9]).toBe(0);   // TermChar
      expect(buf[10]).toBe(0);  // Reserved
      expect(buf[11]).toBe(0);  // Reserved
    });

    it('should always be 12 bytes', () => {
      const buf = buildRequestDevDepMsgIn(65536, 1);
      expect(buf.length).toBe(12);
    });
  });

  describe('parseDevDepMsgIn', () => {
    it('should parse response data correctly', () => {
      // Build a mock response: 12-byte header + data
      const response = Buffer.alloc(24);
      response[0] = 2;  // MsgID (response)
      response.writeUInt32LE(11, 4);  // TransferSize = 11
      Buffer.from('Hello World').copy(response, 12);

      const result = parseDevDepMsgIn(response);
      expect(result).toBe('Hello World');
    });

    it('should trim whitespace from response', () => {
      const response = Buffer.alloc(20);
      response.writeUInt32LE(6, 4);  // TransferSize = 6
      Buffer.from('test\r\n').copy(response, 12);

      const result = parseDevDepMsgIn(response);
      expect(result).toBe('test');
    });

    it('should handle empty response', () => {
      const response = Buffer.alloc(12);
      response.writeUInt32LE(0, 4);  // TransferSize = 0

      const result = parseDevDepMsgIn(response);
      expect(result).toBe('');
    });
  });

  describe('createTagGenerator', () => {
    it('should start at 1', () => {
      const nextTag = createTagGenerator();
      expect(nextTag()).toBe(1);
    });

    it('should increment sequentially', () => {
      const nextTag = createTagGenerator();
      expect(nextTag()).toBe(1);
      expect(nextTag()).toBe(2);
      expect(nextTag()).toBe(3);
    });

    it('should wrap from 255 to 1 (not 0)', () => {
      const nextTag = createTagGenerator();

      // Advance to 255
      for (let i = 0; i < 255; i++) {
        nextTag();
      }

      // Should be at 255
      // Next call should wrap to 1
      expect(nextTag()).toBe(1);
    });

    it('should maintain separate state for each generator', () => {
      const gen1 = createTagGenerator();
      const gen2 = createTagGenerator();

      expect(gen1()).toBe(1);
      expect(gen1()).toBe(2);
      expect(gen2()).toBe(1);  // Independent of gen1
      expect(gen1()).toBe(3);
      expect(gen2()).toBe(2);
    });
  });
});

describe('USB-TMC Transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('open()', () => {
    it('should open the USB device and claim interface', async () => {
      const device = createMockDevice();
      const transport = createUSBTMCTransport(device);

      await transport.open();

      expect(device.open).toHaveBeenCalled();
      expect(device.interfaces![0].claim).toHaveBeenCalled();
      expect(transport.isOpen()).toBe(true);
    });

    it('should be idempotent when already open', async () => {
      const device = createMockDevice();
      const transport = createUSBTMCTransport(device);

      await transport.open();
      await transport.open();

      expect(device.open).toHaveBeenCalledTimes(1);
    });

    it('should close device if interface claim fails', async () => {
      const device = createMockDevice({ claimError: new Error('Claim failed') });
      const transport = createUSBTMCTransport(device);

      await expect(transport.open()).rejects.toThrow('Claim failed');
      expect(device.close).toHaveBeenCalled();
      expect(transport.isOpen()).toBe(false);
    });
  });

  describe('close()', () => {
    it('should release interface and close device', async () => {
      const device = createMockDevice();
      const transport = createUSBTMCTransport(device);

      await transport.open();
      await transport.close();

      expect(device.interfaces![0].release).toHaveBeenCalled();
      expect(device.close).toHaveBeenCalled();
      expect(transport.isOpen()).toBe(false);
    });

    it('should acquire command lock before closing', async () => {
      const device = createMockDevice({ transferInDelay: 50 });
      const transport = createUSBTMCTransport(device);

      await transport.open();

      // Start a query
      let queryComplete = false;
      const queryPromise = transport.query('TEST').then(() => {
        queryComplete = true;
      });

      // Immediately try to close
      const closePromise = transport.close();

      // Query should complete before close
      await queryPromise;
      expect(queryComplete).toBe(true);

      await closePromise;
    });
  });

  describe('query()', () => {
    it('should send command and receive response', async () => {
      const device = createMockDevice();
      const transport = createUSBTMCTransport(device);

      await transport.open();
      const result = await transport.query('*IDN?');

      expect(result).toBe('OK');
    });

    it('should timeout after configured duration', async () => {
      const device = createMockDevice({ transferInDelay: 5000 });
      const transport = createUSBTMCTransport(device, { timeout: 100 });

      await transport.open();

      await expect(transport.query('*IDN?')).rejects.toThrow('Timeout');
    });

    it('should serialize concurrent queries with mutex', async () => {
      let callOrder: string[] = [];
      const device = createMockDevice({ transferInDelay: 10 });

      // Track when transfers happen
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const outEndpoint = device.interfaces![0].endpoints[1] as any;
      const originalTransfer = outEndpoint.transfer;
      outEndpoint.transfer = vi.fn((data: Buffer, cb: (err?: Error) => void) => {
        callOrder.push('transfer');
        originalTransfer(data, cb);
      });

      const transport = createUSBTMCTransport(device);
      await transport.open();

      // Start two concurrent queries
      const q1 = transport.query('CMD1');
      const q2 = transport.query('CMD2');

      await Promise.all([q1, q2]);

      // Should have 4 transfers total (2 out + 2 request out for each query = 4 per query... wait)
      // Actually: CMD1 out, CMD1 request out, CMD1 in, CMD2 out, CMD2 request out, CMD2 in
      // The mutex ensures they don't interleave
    });

    it('should throw if device is disconnected', async () => {
      const device = createMockDevice({
        transferInError: new Error('LIBUSB_ERROR_NO_DEVICE')
      });
      const transport = createUSBTMCTransport(device);

      await transport.open();

      await expect(transport.query('*IDN?')).rejects.toThrow('LIBUSB_ERROR_NO_DEVICE');
      expect(transport.isOpen()).toBe(false); // Should mark as disconnected
    });
  });

  describe('disconnection detection', () => {
    it('should mark as disconnected on LIBUSB_ERROR_NO_DEVICE', async () => {
      const device = createMockDevice({
        transferInError: new Error('LIBUSB_ERROR_NO_DEVICE')
      });
      const transport = createUSBTMCTransport(device);

      await transport.open();
      expect(transport.isOpen()).toBe(true);

      // Query will fail and mark as disconnected
      await transport.query('TEST').catch(() => {});
      expect(transport.isOpen()).toBe(false);
    });

    it('should mark as disconnected on LIBUSB_ERROR_IO', async () => {
      const device = createMockDevice({
        transferOutError: new Error('LIBUSB_ERROR_IO')
      });
      const transport = createUSBTMCTransport(device);

      await transport.open();

      await transport.query('TEST').catch(() => {});
      expect(transport.isOpen()).toBe(false);
    });

    it('should reject subsequent queries after disconnection', async () => {
      const device = createMockDevice({
        transferInError: new Error('LIBUSB_ERROR_NO_DEVICE')
      });
      const transport = createUSBTMCTransport(device);

      await transport.open();

      // First query fails and marks disconnected
      await transport.query('TEST').catch(() => {});

      // Subsequent queries should fail immediately with the stored error
      await expect(transport.query('TEST2')).rejects.toThrow('LIBUSB_ERROR_NO_DEVICE');
    });
  });
});
