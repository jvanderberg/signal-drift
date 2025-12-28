import { describe, it, expect } from 'vitest';
import {
  buildDevDepMsgOut,
  buildRequestDevDepMsgIn,
  parseDevDepMsgIn,
  createTagGenerator,
  DEV_DEP_MSG_OUT,
  REQUEST_DEV_DEP_MSG_IN,
} from '../transports/usbtmc.js';

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
