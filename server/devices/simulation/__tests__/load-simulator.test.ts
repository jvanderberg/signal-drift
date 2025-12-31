import { describe, it, expect, beforeEach } from 'vitest';
import { createLoadSimulator, type LoadSimulator } from '../load-simulator.js';
import { createVirtualConnection, type VirtualConnection } from '../virtual-connection.js';

describe('LoadSimulator', () => {
  let conn: VirtualConnection;
  let load: LoadSimulator;

  // Config for deterministic tests - disable all noise sources
  const deterministicConfig = { measurementStabilityPPM: 0, measurementNoiseFloorMv: 0 };

  beforeEach(() => {
    conn = createVirtualConnection(deterministicConfig);
    load = createLoadSimulator(conn);
  });

  describe('*IDN? Command', () => {
    it('should return identification string', () => {
      const response = load.handleCommand('*IDN?');
      expect(response).toContain('RIGOL TECHNOLOGIES');
      expect(response).toContain('DL3021');
    });

    it('should include serial number in IDN response', () => {
      const customLoad = createLoadSimulator(conn, 'DL3A999888777');
      const response = customLoad.handleCommand('*IDN?');
      expect(response).toContain('DL3A999888777');
    });
  });

  describe('Mode Commands', () => {
    it('should respond to :SOUR:FUNC? with current mode', () => {
      const response = load.handleCommand(':SOUR:FUNC?');
      expect(response).toBe('CURR'); // Default is CC
    });

    it('should set mode to CC', () => {
      load.handleCommand(':SOUR:FUNC CURR');
      expect(load.handleCommand(':SOUR:FUNC?')).toBe('CURR');
    });

    it('should set mode to CV', () => {
      load.handleCommand(':SOUR:FUNC VOLT');
      expect(load.handleCommand(':SOUR:FUNC?')).toBe('VOLT');
    });

    it('should set mode to CR', () => {
      load.handleCommand(':SOUR:FUNC RES');
      expect(load.handleCommand(':SOUR:FUNC?')).toBe('RES');
    });

    it('should set mode to CP', () => {
      load.handleCommand(':SOUR:FUNC POW');
      expect(load.handleCommand(':SOUR:FUNC?')).toBe('POW');
    });

    it('should handle alternate mode names', () => {
      load.handleCommand(':SOUR:FUNC CC');
      expect(load.handleCommand(':SOUR:FUNC?')).toBe('CURR');

      load.handleCommand(':SOUR:FUNC CV');
      expect(load.handleCommand(':SOUR:FUNC?')).toBe('VOLT');

      load.handleCommand(':SOUR:FUNC CURRENT');
      expect(load.handleCommand(':SOUR:FUNC?')).toBe('CURR');
    });

    it('should handle case-insensitive mode commands', () => {
      load.handleCommand(':sour:func volt');
      expect(load.handleCommand(':SOUR:FUNC?')).toBe('VOLT');
    });
  });

  describe('Input State Commands', () => {
    it('should respond to :SOUR:INP:STAT? when off', () => {
      expect(load.handleCommand(':SOUR:INP:STAT?')).toBe('OFF');
    });

    it('should enable input with :SOUR:INP:STAT ON', () => {
      load.handleCommand(':SOUR:INP:STAT ON');
      expect(load.handleCommand(':SOUR:INP:STAT?')).toBe('ON');
    });

    it('should enable input with :SOUR:INP:STAT 1', () => {
      load.handleCommand(':SOUR:INP:STAT 1');
      expect(load.handleCommand(':SOUR:INP:STAT?')).toBe('ON');
    });

    it('should disable input with :SOUR:INP:STAT OFF', () => {
      load.handleCommand(':SOUR:INP:STAT ON');
      load.handleCommand(':SOUR:INP:STAT OFF');
      expect(load.handleCommand(':SOUR:INP:STAT?')).toBe('OFF');
    });

    it('should handle short form :SOUR:INP ON', () => {
      load.handleCommand(':SOUR:INP ON');
      expect(load.handleCommand(':SOUR:INP:STAT?')).toBe('ON');
    });
  });

  describe('Current Setpoint Commands', () => {
    it('should respond to :SOUR:CURR:LEV?', () => {
      expect(load.handleCommand(':SOUR:CURR:LEV?')).toBe('0.0000');
    });

    it('should set current with :SOUR:CURR:LEV', () => {
      load.handleCommand(':SOUR:CURR:LEV 2.5');
      expect(load.handleCommand(':SOUR:CURR:LEV?')).toBe('2.5000');
    });

    it('should reject current outside valid range', () => {
      load.handleCommand(':SOUR:CURR:LEV 2');
      load.handleCommand(':SOUR:CURR:LEV 50'); // Max is 40A
      expect(load.handleCommand(':SOUR:CURR:LEV?')).toBe('2.0000');
    });

    it('should reject negative current', () => {
      load.handleCommand(':SOUR:CURR:LEV 2');
      load.handleCommand(':SOUR:CURR:LEV -1');
      expect(load.handleCommand(':SOUR:CURR:LEV?')).toBe('2.0000');
    });
  });

  describe('Voltage Setpoint Commands', () => {
    it('should respond to :SOUR:VOLT:LEV?', () => {
      expect(load.handleCommand(':SOUR:VOLT:LEV?')).toBe('0.000');
    });

    it('should set voltage with :SOUR:VOLT:LEV', () => {
      load.handleCommand(':SOUR:VOLT:LEV 24.5');
      expect(load.handleCommand(':SOUR:VOLT:LEV?')).toBe('24.500');
    });

    it('should reject voltage outside valid range', () => {
      load.handleCommand(':SOUR:VOLT:LEV 24');
      load.handleCommand(':SOUR:VOLT:LEV 200'); // Max is 150V
      expect(load.handleCommand(':SOUR:VOLT:LEV?')).toBe('24.000');
    });
  });

  describe('Resistance Setpoint Commands', () => {
    it('should respond to :SOUR:RES:LEV?', () => {
      expect(load.handleCommand(':SOUR:RES:LEV?')).toBe('1000.000');
    });

    it('should set resistance with :SOUR:RES:LEV', () => {
      load.handleCommand(':SOUR:RES:LEV 100.5');
      expect(load.handleCommand(':SOUR:RES:LEV?')).toBe('100.500');
    });

    it('should reject resistance outside valid range', () => {
      load.handleCommand(':SOUR:RES:LEV 100');
      load.handleCommand(':SOUR:RES:LEV 0.01'); // Min is 0.05
      expect(load.handleCommand(':SOUR:RES:LEV?')).toBe('100.000');

      load.handleCommand(':SOUR:RES:LEV 20000'); // Max is 15000
      expect(load.handleCommand(':SOUR:RES:LEV?')).toBe('100.000');
    });
  });

  describe('Power Setpoint Commands', () => {
    it('should respond to :SOUR:POW:LEV?', () => {
      expect(load.handleCommand(':SOUR:POW:LEV?')).toBe('0.000');
    });

    it('should set power with :SOUR:POW:LEV', () => {
      load.handleCommand(':SOUR:POW:LEV 50.5');
      expect(load.handleCommand(':SOUR:POW:LEV?')).toBe('50.500');
    });

    it('should reject power outside valid range', () => {
      load.handleCommand(':SOUR:POW:LEV 50');
      load.handleCommand(':SOUR:POW:LEV 250'); // Max is 200W
      expect(load.handleCommand(':SOUR:POW:LEV?')).toBe('50.000');
    });
  });

  describe('Measurement Commands', () => {
    beforeEach(() => {
      // Set up PSU to provide power
      conn.setPsuVoltage(12);
      conn.setPsuCurrentLimit(5);
      conn.setPsuOutputEnabled(true);

      // Set up load
      load.handleCommand(':SOUR:FUNC CURR');
      load.handleCommand(':SOUR:CURR:LEV 2');
      load.handleCommand(':SOUR:INP:STAT ON');
    });

    it('should respond to :MEAS:VOLT? with terminal voltage', () => {
      const response = load.handleCommand(':MEAS:VOLT?');
      expect(response).not.toBeNull();
      expect(parseFloat(response!)).toBeCloseTo(12, 0);
    });

    it('should respond to :MEAS:CURR? with drawn current', () => {
      const response = load.handleCommand(':MEAS:CURR?');
      expect(response).not.toBeNull();
      expect(parseFloat(response!)).toBeCloseTo(2, 0);
    });

    it('should respond to :MEAS:POW? with power', () => {
      const response = load.handleCommand(':MEAS:POW?');
      expect(response).not.toBeNull();
      expect(parseFloat(response!)).toBeCloseTo(24, 0); // ~12V * 2A
    });

    it('should respond to :MEAS:RES? with resistance', () => {
      const response = load.handleCommand(':MEAS:RES?');
      expect(response).not.toBeNull();
      expect(parseFloat(response!)).toBeCloseTo(6, 0); // ~12V / 2A
    });

    it('should return 0 resistance when no current flowing', () => {
      load.handleCommand(':SOUR:CURR:LEV 0');
      const response = load.handleCommand(':MEAS:RES?');
      // Real device shows 0 when measurement isn't meaningful
      expect(response).toBe('0.0000');
    });
  });

  describe('Error Queue', () => {
    it('should return no error from :SYST:ERR?', () => {
      const response = load.handleCommand(':SYST:ERR?');
      expect(response).toBe('0,No error');
    });
  });

  describe('List Mode Commands', () => {
    it('should set list mode with :SOUR:LIST:MODE', () => {
      load.handleCommand(':SOUR:LIST:MODE CURR');
      expect(load.handleCommand(':SOUR:LIST:MODE?')).toBe('CURR');
    });

    it('should accept :SOUR:LIST:RANG command', () => {
      // Should not throw
      expect(load.handleCommand(':SOUR:LIST:RANG 4')).toBeNull();
    });

    it('should accept :SOUR:LIST:STEP command', () => {
      expect(load.handleCommand(':SOUR:LIST:STEP 10')).toBeNull();
    });

    it('should accept :SOUR:LIST:COUN command', () => {
      expect(load.handleCommand(':SOUR:LIST:COUN 5')).toBeNull();
    });

    it('should accept :SOUR:LIST:LEV command', () => {
      load.handleCommand(':SOUR:LIST:STEP 3');
      expect(load.handleCommand(':SOUR:LIST:LEV 0,1.5')).toBeNull();
    });

    it('should accept :SOUR:LIST:WID command', () => {
      load.handleCommand(':SOUR:LIST:STEP 3');
      expect(load.handleCommand(':SOUR:LIST:WID 0,0.1')).toBeNull();
    });

    it('should accept :SOUR:LIST:SLEW command', () => {
      load.handleCommand(':SOUR:LIST:STEP 3');
      expect(load.handleCommand(':SOUR:LIST:SLEW 0,0.5')).toBeNull();
    });

    it('should switch to list mode with :SOUR:FUNC:MODE LIST', () => {
      expect(load.handleCommand(':SOUR:FUNC:MODE LIST')).toBeNull();
    });

    it('should switch to fixed mode with :SOUR:FUNC:MODE FIX', () => {
      expect(load.handleCommand(':SOUR:FUNC:MODE FIX')).toBeNull();
    });

    it('should accept trigger commands', () => {
      expect(load.handleCommand(':TRIG:SOUR BUS')).toBeNull();
      expect(load.handleCommand(':TRIG')).toBeNull();
    });
  });

  describe('Unknown Commands', () => {
    it('should return empty string for unknown commands', () => {
      const response = load.handleCommand(':UNKNOWN:CMD?');
      expect(response).toBe('');
    });
  });

  describe('Command Parsing Edge Cases', () => {
    it('should handle commands with leading colons', () => {
      load.handleCommand('::SOUR:FUNC VOLT');
      expect(load.handleCommand(':SOUR:FUNC?')).toBe('VOLT');
    });

    it('should handle commands without leading colons', () => {
      load.handleCommand('SOUR:FUNC VOLT');
      expect(load.handleCommand('SOUR:FUNC?')).toBe('VOLT');
    });

    it('should handle whitespace', () => {
      load.handleCommand('  :SOUR:FUNC VOLT  ');
      expect(load.handleCommand(':SOUR:FUNC?')).toBe('VOLT');
    });
  });

  describe('Virtual Connection Integration', () => {
    it('should update connection when mode changes', () => {
      conn.setPsuVoltage(12);
      conn.setPsuCurrentLimit(10);
      conn.setPsuOutputEnabled(true);

      load.handleCommand(':SOUR:FUNC CURR');
      load.handleCommand(':SOUR:CURR:LEV 3');
      load.handleCommand(':SOUR:INP:STAT ON');

      expect(conn.getLoadCurrent()).toBeCloseTo(3, 1);
    });

    it('should update connection when setpoint changes in active mode', () => {
      conn.setPsuVoltage(12);
      conn.setPsuCurrentLimit(10);
      conn.setPsuOutputEnabled(true);

      load.handleCommand(':SOUR:FUNC CURR');
      load.handleCommand(':SOUR:INP:STAT ON');

      load.handleCommand(':SOUR:CURR:LEV 2');
      expect(conn.getLoadCurrent()).toBeCloseTo(2, 1);

      load.handleCommand(':SOUR:CURR:LEV 4');
      expect(conn.getLoadCurrent()).toBeCloseTo(4, 1);
    });
  });
});
