import { describe, it, expect } from 'vitest';
import { ScpiParser } from '../scpi-parser.js';

describe('ScpiParser', () => {
  describe('parseNumber', () => {
    it('parses standard numeric responses', () => {
      expect(ScpiParser.parseNumber('1.234')).toEqual({ ok: true, value: 1.234 });
      expect(ScpiParser.parseNumber('-5.67')).toEqual({ ok: true, value: -5.67 });
      expect(ScpiParser.parseNumber('0')).toEqual({ ok: true, value: 0 });
      expect(ScpiParser.parseNumber('42')).toEqual({ ok: true, value: 42 });
    });

    it('parses scientific notation', () => {
      expect(ScpiParser.parseNumber('1.23E+06')).toEqual({ ok: true, value: 1.23e6 });
      expect(ScpiParser.parseNumber('-5.67E-03')).toEqual({ ok: true, value: -5.67e-3 });
      expect(ScpiParser.parseNumber('9.9E+00')).toEqual({ ok: true, value: 9.9 });
    });

    it('handles whitespace', () => {
      expect(ScpiParser.parseNumber('  1.234  ')).toEqual({ ok: true, value: 1.234 });
      expect(ScpiParser.parseNumber('\t42\n')).toEqual({ ok: true, value: 42 });
    });

    it('returns error for empty responses', () => {
      const result = ScpiParser.parseNumber('');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('empty response');
      }
    });

    it('returns error for Rigol invalid marker (****)', () => {
      const result = ScpiParser.parseNumber('****');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('invalid measurement (****)');
      }
    });

    it('returns error for Rigol overflow (9.9E37)', () => {
      const result = ScpiParser.parseNumber('9.9E37');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('overflow (9.9E37)');
      }
    });

    it('returns error for non-numeric responses', () => {
      const result = ScpiParser.parseNumber('AUTO');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('non-numeric response');
      }
    });
  });

  describe('parseNumberOr', () => {
    it('returns parsed number on success', () => {
      expect(ScpiParser.parseNumberOr('1.234', 0)).toBe(1.234);
    });

    it('returns default value on failure', () => {
      expect(ScpiParser.parseNumberOr('AUTO', 0)).toBe(0);
      expect(ScpiParser.parseNumberOr('****', -1)).toBe(-1);
      expect(ScpiParser.parseNumberOr('', 42)).toBe(42);
    });
  });

  describe('parseBool', () => {
    it('parses "1" as true', () => {
      expect(ScpiParser.parseBool('1')).toBe(true);
    });

    it('parses "0" as false', () => {
      expect(ScpiParser.parseBool('0')).toBe(false);
    });

    it('parses "ON" as true (case-insensitive)', () => {
      expect(ScpiParser.parseBool('ON')).toBe(true);
      expect(ScpiParser.parseBool('on')).toBe(true);
      expect(ScpiParser.parseBool('On')).toBe(true);
    });

    it('parses "OFF" as false', () => {
      expect(ScpiParser.parseBool('OFF')).toBe(false);
      expect(ScpiParser.parseBool('off')).toBe(false);
    });

    it('handles whitespace', () => {
      expect(ScpiParser.parseBool('  1  ')).toBe(true);
      expect(ScpiParser.parseBool('  ON\n')).toBe(true);
    });

    it('returns false for unknown values', () => {
      expect(ScpiParser.parseBool('true')).toBe(false);
      expect(ScpiParser.parseBool('yes')).toBe(false);
      expect(ScpiParser.parseBool('')).toBe(false);
    });
  });

  describe('parseEnum', () => {
    const triggerStatusMap: Record<string, string> = {
      TD: 'triggered',
      WAIT: 'wait',
      RUN: 'armed',
      AUTO: 'auto',
      STOP: 'stopped',
    };

    it('parses exact matches', () => {
      expect(ScpiParser.parseEnum('TD', triggerStatusMap)).toEqual({ ok: true, value: 'triggered' });
      expect(ScpiParser.parseEnum('WAIT', triggerStatusMap)).toEqual({ ok: true, value: 'wait' });
    });

    it('handles case-insensitive matching', () => {
      expect(ScpiParser.parseEnum('td', triggerStatusMap)).toEqual({ ok: true, value: 'triggered' });
      expect(ScpiParser.parseEnum('Wait', triggerStatusMap)).toEqual({ ok: true, value: 'wait' });
    });

    it('handles whitespace', () => {
      expect(ScpiParser.parseEnum('  TD  ', triggerStatusMap)).toEqual({ ok: true, value: 'triggered' });
    });

    it('returns error for unknown values', () => {
      const result = ScpiParser.parseEnum('UNKNOWN', triggerStatusMap);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('unknown value');
        expect(result.error).toContain('TD');
      }
    });
  });

  describe('parseEnumOr', () => {
    const modeMap: Record<string, string> = {
      CURR: 'CC',
      VOLT: 'CV',
    };

    it('returns mapped value on success', () => {
      expect(ScpiParser.parseEnumOr('CURR', modeMap, 'CC')).toBe('CC');
    });

    it('returns default value on failure', () => {
      expect(ScpiParser.parseEnumOr('UNKNOWN', modeMap, 'CC')).toBe('CC');
    });
  });

  describe('parseDefiniteLengthBlock', () => {
    it('parses valid block with single digit length', () => {
      // #15hello = 5 bytes of data "hello"
      const buffer = Buffer.from('#15hello');
      const result = ScpiParser.parseDefiniteLengthBlock(buffer);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.toString()).toBe('hello');
      }
    });

    it('parses valid block with multi-digit length', () => {
      // #212HelloWorld!! = 12 bytes of data
      const buffer = Buffer.from('#212HelloWorld!!');
      const result = ScpiParser.parseDefiniteLengthBlock(buffer);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.toString()).toBe('HelloWorld!!');
      }
    });

    it('parses binary data', () => {
      // Create buffer with binary data
      const header = Buffer.from('#14');
      const data = Buffer.from([0x00, 0x01, 0x02, 0x03]);
      const buffer = Buffer.concat([header, data]);

      const result = ScpiParser.parseDefiniteLengthBlock(buffer);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(data);
      }
    });

    it('handles large data lengths', () => {
      // #91000000001 followed by data
      const dataLength = 10;
      const header = Buffer.from(`#9${String(dataLength).padStart(9, '0')}`);
      const data = Buffer.alloc(dataLength, 0x42);
      const buffer = Buffer.concat([header, data]);

      const result = ScpiParser.parseDefiniteLengthBlock(buffer);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(dataLength);
      }
    });

    it('returns error for missing header', () => {
      const result = ScpiParser.parseDefiniteLengthBlock(Buffer.from('hello'));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('missing # header');
      }
    });

    it('returns error for buffer too short', () => {
      const result = ScpiParser.parseDefiniteLengthBlock(Buffer.from('#'));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('too short');
      }
    });

    it('returns error for invalid digit count', () => {
      const result = ScpiParser.parseDefiniteLengthBlock(Buffer.from('#X5hello'));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('invalid digit count');
      }
    });

    it('returns error for invalid length field', () => {
      const result = ScpiParser.parseDefiniteLengthBlock(Buffer.from('#2XXhello'));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('invalid length field');
      }
    });

    it('returns error when data is shorter than declared length', () => {
      // Declares 10 bytes but only has 5
      const result = ScpiParser.parseDefiniteLengthBlock(Buffer.from('#210hello'));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('too short');
      }
    });
  });

  describe('isErrorResponseOk', () => {
    it('returns true for standard no-error responses', () => {
      expect(ScpiParser.isErrorResponseOk('0,No error')).toBe(true);
      expect(ScpiParser.isErrorResponseOk('+0,No error')).toBe(true);
      expect(ScpiParser.isErrorResponseOk('0,"No error"')).toBe(true);
    });

    it('returns false for error responses', () => {
      expect(ScpiParser.isErrorResponseOk('-100,Command error')).toBe(false);
      expect(ScpiParser.isErrorResponseOk('-200,Execution error')).toBe(false);
      expect(ScpiParser.isErrorResponseOk('1,Some error')).toBe(false);
    });

    it('handles whitespace', () => {
      expect(ScpiParser.isErrorResponseOk('  0,No error  ')).toBe(true);
    });
  });

  describe('parseCsv', () => {
    it('parses comma-separated values', () => {
      expect(ScpiParser.parseCsv('a,b,c')).toEqual(['a', 'b', 'c']);
    });

    it('trims whitespace from each part', () => {
      expect(ScpiParser.parseCsv('  a , b , c  ')).toEqual(['a', 'b', 'c']);
    });

    it('handles IDN response format', () => {
      const idn = 'RIGOL TECHNOLOGIES,DS1054Z,DS1ZA123456789,00.04.04.SP3';
      const parts = ScpiParser.parseCsv(idn);
      expect(parts).toEqual([
        'RIGOL TECHNOLOGIES',
        'DS1054Z',
        'DS1ZA123456789',
        '00.04.04.SP3',
      ]);
    });
  });
});
