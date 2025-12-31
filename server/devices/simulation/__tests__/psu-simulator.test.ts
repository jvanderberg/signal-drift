import { describe, it, expect, beforeEach } from 'vitest';
import { createPsuSimulator, type PsuSimulator } from '../psu-simulator.js';
import { createVirtualConnection, type VirtualConnection } from '../virtual-connection.js';

describe('PsuSimulator', () => {
  let conn: VirtualConnection;
  let psu: PsuSimulator;

  // Config for deterministic tests - disable all noise sources
  const deterministicConfig = { measurementStabilityPPM: 0, measurementNoiseFloorMv: 0 };

  beforeEach(() => {
    conn = createVirtualConnection(deterministicConfig);
    psu = createPsuSimulator(conn);
  });

  describe('Voltage Commands', () => {
    it('should respond to VOLT? query', () => {
      const response = psu.handleCommand('VOLT?');
      expect(response).toBe('0.000');
    });

    it('should set voltage with VOLT command', () => {
      psu.handleCommand('VOLT 12.5');
      const response = psu.handleCommand('VOLT?');
      expect(response).toBe('12.500');
    });

    it('should handle VOLT command case-insensitively', () => {
      psu.handleCommand('volt 24.0');
      const response = psu.handleCommand('VOLT?');
      expect(response).toBe('24.000');
    });

    it('should reject voltage outside valid range', () => {
      psu.handleCommand('VOLT 100'); // Max is 80V
      const response = psu.handleCommand('VOLT?');
      expect(response).toBe('0.000'); // Should not change
    });

    it('should reject negative voltage', () => {
      psu.handleCommand('VOLT 12');
      psu.handleCommand('VOLT -5');
      const response = psu.handleCommand('VOLT?');
      expect(response).toBe('12.000'); // Should not change
    });

    it('should update virtual connection voltage', () => {
      psu.handleCommand('VOLT 15');
      psu.handleCommand('OUTP ON');
      expect(conn.getPsuVoltage()).toBe(15);
    });
  });

  describe('Current Commands', () => {
    it('should respond to CURR? query', () => {
      const response = psu.handleCommand('CURR?');
      expect(response).toBe('10.000'); // Default limit
    });

    it('should set current limit with CURR command', () => {
      psu.handleCommand('CURR 2.5');
      const response = psu.handleCommand('CURR?');
      expect(response).toBe('2.500');
    });

    it('should reject current outside valid range', () => {
      psu.handleCommand('CURR 5');
      psu.handleCommand('CURR 15'); // Max is 10A
      const response = psu.handleCommand('CURR?');
      expect(response).toBe('5.000'); // Should not change
    });

    it('should reject negative current', () => {
      psu.handleCommand('CURR 3');
      psu.handleCommand('CURR -1');
      const response = psu.handleCommand('CURR?');
      expect(response).toBe('3.000'); // Should not change
    });

    it('should update virtual connection current limit', () => {
      psu.handleCommand('CURR 3.5');
      // Would need load to verify, but connection state should be updated
      psu.handleCommand('VOLT 12');
      psu.handleCommand('OUTP ON');
      conn.setLoadMode('CC');
      conn.setLoadSetpoint(10); // Exceed limit
      conn.setLoadInputEnabled(true);
      expect(conn.getPsuCurrent()).toBeCloseTo(3.5, 1);
    });
  });

  describe('Output Commands', () => {
    it('should respond to OUTP? query when off', () => {
      const response = psu.handleCommand('OUTP?');
      expect(response).toBe('0');
    });

    it('should enable output with OUTP ON', () => {
      psu.handleCommand('OUTP ON');
      const response = psu.handleCommand('OUTP?');
      expect(response).toBe('1');
    });

    it('should enable output with OUTP 1', () => {
      psu.handleCommand('OUTP 1');
      const response = psu.handleCommand('OUTP?');
      expect(response).toBe('1');
    });

    it('should disable output with OUTP OFF', () => {
      psu.handleCommand('OUTP ON');
      psu.handleCommand('OUTP OFF');
      const response = psu.handleCommand('OUTP?');
      expect(response).toBe('0');
    });

    it('should disable output with OUTP 0', () => {
      psu.handleCommand('OUTP ON');
      psu.handleCommand('OUTP 0');
      const response = psu.handleCommand('OUTP?');
      expect(response).toBe('0');
    });

    it('should handle case-insensitive output command', () => {
      psu.handleCommand('outp on');
      expect(psu.handleCommand('OUTP?')).toBe('1');
      psu.handleCommand('OUTP off');
      expect(psu.handleCommand('OUTP?')).toBe('0');
    });
  });

  describe('Measurement Commands', () => {
    beforeEach(() => {
      psu.handleCommand('VOLT 12');
      psu.handleCommand('CURR 5');
      psu.handleCommand('OUTP ON');
      conn.setLoadMode('CC');
      conn.setLoadSetpoint(2.0);
      conn.setLoadInputEnabled(true);
    });

    it('should respond to MEAS:VOLT? with actual voltage', () => {
      const response = psu.handleCommand('MEAS:VOLT?');
      expect(response).not.toBeNull();
      expect(parseFloat(response!)).toBeCloseTo(12, 0);
    });

    it('should respond to MEAS:CURR? with actual current', () => {
      const response = psu.handleCommand('MEAS:CURR?');
      expect(response).not.toBeNull();
      expect(parseFloat(response!)).toBeCloseTo(2.0, 1);
    });

    it('should return 0 voltage when output disabled', () => {
      psu.handleCommand('OUTP OFF');
      const response = psu.handleCommand('MEAS:VOLT?');
      expect(response).toBe('0.000');
    });

    it('should return 0 current when output disabled', () => {
      psu.handleCommand('OUTP OFF');
      const response = psu.handleCommand('MEAS:CURR?');
      expect(response).toBe('0.0000');
    });
  });

  describe('Write Commands', () => {
    it('should return null for write commands', () => {
      expect(psu.handleCommand('VOLT 12')).toBeNull();
      expect(psu.handleCommand('CURR 5')).toBeNull();
      expect(psu.handleCommand('OUTP ON')).toBeNull();
    });
  });

  describe('Unknown Commands', () => {
    it('should return empty string for unknown commands', () => {
      const response = psu.handleCommand('INVALID:CMD?');
      expect(response).toBe('');
    });

    it('should return empty string for partial commands', () => {
      const response = psu.handleCommand('VOL');
      expect(response).toBe('');
    });
  });

  describe('Command Parsing', () => {
    it('should handle commands with whitespace', () => {
      psu.handleCommand('  VOLT 12  ');
      expect(psu.handleCommand('VOLT?')).toBe('12.000');
    });

    it('should handle decimal values', () => {
      psu.handleCommand('VOLT 12.345');
      expect(psu.handleCommand('VOLT?')).toBe('12.345');
    });

    it('should handle integer values', () => {
      psu.handleCommand('VOLT 24');
      expect(psu.handleCommand('VOLT?')).toBe('24.000');
    });
  });
});
