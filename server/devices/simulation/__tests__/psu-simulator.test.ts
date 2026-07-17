import { describe, it, expect, beforeEach } from 'vitest';
import { createPsuSimulator, type PsuSimulator } from '../../../../shared/simulation/psu-simulator.js';
import { createVirtualConnection, type VirtualConnection } from '../../../../shared/simulation/virtual-connection.js';

describe('PsuSimulator', () => {
  let conn: VirtualConnection;
  let psu: PsuSimulator;

  // Config for deterministic tests - disable all noise sources and boost converter
  const deterministicConfig = {
    measurementStabilityPPM: 0,
    measurementNoiseFloorMv: 0,
    boostEnabled: false,  // Direct PSU-load connection
  };

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

  describe('CV Mode Behavior', () => {
    it('should maintain constant voltage regardless of load', () => {
      psu.handleCommand('VOLT 12');
      psu.handleCommand('CURR 5');
      psu.handleCommand('OUTP ON');

      // Light load - 1A
      conn.setLoadMode('CC');
      conn.setLoadSetpoint(1);
      conn.setLoadInputEnabled(true);

      expect(conn.getPsuVoltage()).toBeCloseTo(12, 1);
      expect(conn.getPsuMode()).toBe('CV');

      // Heavier load - 3A (still within limit)
      conn.setLoadSetpoint(3);
      expect(conn.getPsuVoltage()).toBeCloseTo(12, 1);
      expect(conn.getPsuMode()).toBe('CV');
    });

    it('should output exact setpoint voltage when in CV mode', () => {
      psu.handleCommand('VOLT 24.5');
      psu.handleCommand('CURR 10');
      psu.handleCommand('OUTP ON');

      conn.setLoadMode('CC');
      conn.setLoadSetpoint(2);
      conn.setLoadInputEnabled(true);

      const measuredVoltage = parseFloat(psu.handleCommand('MEAS:VOLT?')!);
      expect(measuredVoltage).toBeCloseTo(24.5, 1);
    });

    it('should deliver load current up to setpoint in CV mode', () => {
      psu.handleCommand('VOLT 12');
      psu.handleCommand('CURR 5');
      psu.handleCommand('OUTP ON');

      conn.setLoadMode('CC');
      conn.setLoadSetpoint(3);
      conn.setLoadInputEnabled(true);

      const measuredCurrent = parseFloat(psu.handleCommand('MEAS:CURR?')!);
      expect(measuredCurrent).toBeCloseTo(3, 1);
    });
  });

  describe('CC Mode Behavior (Current Limiting)', () => {
    it('should enter CC mode when load exceeds current limit', () => {
      psu.handleCommand('VOLT 12');
      psu.handleCommand('CURR 2'); // 2A limit
      psu.handleCommand('OUTP ON');

      conn.setLoadMode('CC');
      conn.setLoadSetpoint(5); // Request 5A but limited to 2A
      conn.setLoadInputEnabled(true);

      expect(conn.getPsuMode()).toBe('CC');
    });

    it('should limit current to setpoint in CC mode', () => {
      psu.handleCommand('VOLT 12');
      psu.handleCommand('CURR 2.5'); // 2.5A limit
      psu.handleCommand('OUTP ON');

      conn.setLoadMode('CC');
      conn.setLoadSetpoint(10); // Request 10A
      conn.setLoadInputEnabled(true);

      const measuredCurrent = parseFloat(psu.handleCommand('MEAS:CURR?')!);
      expect(measuredCurrent).toBeCloseTo(2.5, 1);
    });

    it('should reduce voltage in CC mode to maintain current limit', () => {
      psu.handleCommand('VOLT 12');
      psu.handleCommand('CURR 2');
      psu.handleCommand('OUTP ON');

      conn.setLoadMode('CC');
      conn.setLoadSetpoint(5); // Exceed limit
      conn.setLoadInputEnabled(true);

      // Voltage should drop below setpoint
      const measuredVoltage = parseFloat(psu.handleCommand('MEAS:VOLT?')!);
      expect(measuredVoltage).toBeLessThan(12);
    });

    it('should transition from CV to CC when load increases', () => {
      psu.handleCommand('VOLT 12');
      psu.handleCommand('CURR 3');
      psu.handleCommand('OUTP ON');

      conn.setLoadMode('CC');
      conn.setLoadInputEnabled(true);

      // Start with light load - CV mode
      conn.setLoadSetpoint(1);
      expect(conn.getPsuMode()).toBe('CV');

      // Increase beyond limit - CC mode
      conn.setLoadSetpoint(5);
      expect(conn.getPsuMode()).toBe('CC');
    });

    it('should transition from CC back to CV when load decreases', () => {
      psu.handleCommand('VOLT 12');
      psu.handleCommand('CURR 3');
      psu.handleCommand('OUTP ON');

      conn.setLoadMode('CC');
      conn.setLoadInputEnabled(true);

      // Start in CC mode
      conn.setLoadSetpoint(5);
      expect(conn.getPsuMode()).toBe('CC');

      // Reduce load - back to CV mode
      conn.setLoadSetpoint(1);
      expect(conn.getPsuMode()).toBe('CV');
    });
  });

  describe('Power Calculations', () => {
    it('should calculate power as V*I', () => {
      psu.handleCommand('VOLT 12');
      psu.handleCommand('CURR 10');
      psu.handleCommand('OUTP ON');

      conn.setLoadMode('CC');
      conn.setLoadSetpoint(2);
      conn.setLoadInputEnabled(true);

      // P = V*I = 12V * 2A = 24W
      const voltage = parseFloat(psu.handleCommand('MEAS:VOLT?')!);
      const current = parseFloat(psu.handleCommand('MEAS:CURR?')!);
      const expectedPower = voltage * current;

      expect(expectedPower).toBeCloseTo(24, 0);
    });
  });

  describe('Output Enable/Disable', () => {
    it('should not deliver power when output is off', () => {
      psu.handleCommand('VOLT 12');
      psu.handleCommand('CURR 5');
      psu.handleCommand('OUTP OFF');

      conn.setLoadMode('CC');
      conn.setLoadSetpoint(2);
      conn.setLoadInputEnabled(true);

      expect(parseFloat(psu.handleCommand('MEAS:VOLT?')!)).toBe(0);
      expect(parseFloat(psu.handleCommand('MEAS:CURR?')!)).toBe(0);
    });

    it('should start delivering power when output is enabled', () => {
      psu.handleCommand('VOLT 12');
      psu.handleCommand('CURR 5');

      conn.setLoadMode('CC');
      conn.setLoadSetpoint(2);
      conn.setLoadInputEnabled(true);

      // Output off - no power
      expect(parseFloat(psu.handleCommand('MEAS:CURR?')!)).toBe(0);

      // Enable output
      psu.handleCommand('OUTP ON');

      // Now delivering power
      expect(parseFloat(psu.handleCommand('MEAS:CURR?')!)).toBeCloseTo(2, 1);
    });

    it('should stop delivering power when output is disabled', () => {
      psu.handleCommand('VOLT 12');
      psu.handleCommand('CURR 5');
      psu.handleCommand('OUTP ON');

      conn.setLoadMode('CC');
      conn.setLoadSetpoint(2);
      conn.setLoadInputEnabled(true);

      // Verify power is flowing
      expect(parseFloat(psu.handleCommand('MEAS:CURR?')!)).toBeCloseTo(2, 1);

      // Disable output
      psu.handleCommand('OUTP OFF');

      // Power should stop
      expect(parseFloat(psu.handleCommand('MEAS:CURR?')!)).toBe(0);
    });
  });

  describe('Setpoint Changes While Active', () => {
    beforeEach(() => {
      psu.handleCommand('VOLT 12');
      psu.handleCommand('CURR 5');
      psu.handleCommand('OUTP ON');
      conn.setLoadMode('CC');
      conn.setLoadSetpoint(2);
      conn.setLoadInputEnabled(true);
    });

    it('should update voltage when setpoint changes', () => {
      expect(parseFloat(psu.handleCommand('MEAS:VOLT?')!)).toBeCloseTo(12, 1);

      psu.handleCommand('VOLT 24');

      expect(parseFloat(psu.handleCommand('MEAS:VOLT?')!)).toBeCloseTo(24, 1);
    });

    it('should update current limit when setpoint changes', () => {
      // Initially limited to 5A, drawing 2A
      expect(conn.getPsuMode()).toBe('CV');

      // Lower current limit below load
      psu.handleCommand('CURR 1');

      // Should now be in CC mode, limited to 1A
      expect(conn.getPsuMode()).toBe('CC');
      expect(parseFloat(psu.handleCommand('MEAS:CURR?')!)).toBeCloseTo(1, 1);
    });
  });

  describe('No Load Condition', () => {
    it('should output setpoint voltage with no load', () => {
      psu.handleCommand('VOLT 12');
      psu.handleCommand('CURR 5');
      psu.handleCommand('OUTP ON');

      // No load connected
      conn.setLoadInputEnabled(false);

      const voltage = parseFloat(psu.handleCommand('MEAS:VOLT?')!);
      expect(voltage).toBeCloseTo(12, 1);
    });

    it('should show zero current with no load', () => {
      psu.handleCommand('VOLT 12');
      psu.handleCommand('CURR 5');
      psu.handleCommand('OUTP ON');

      // No load
      conn.setLoadInputEnabled(false);

      const current = parseFloat(psu.handleCommand('MEAS:CURR?')!);
      expect(current).toBeCloseTo(0, 1);
    });
  });

  describe('Boundary Conditions', () => {
    it('should handle maximum voltage setpoint', () => {
      psu.handleCommand('VOLT 80'); // Max voltage
      psu.handleCommand('CURR 5');
      psu.handleCommand('OUTP ON');

      conn.setLoadMode('CC');
      conn.setLoadSetpoint(1);
      conn.setLoadInputEnabled(true);

      expect(parseFloat(psu.handleCommand('MEAS:VOLT?')!)).toBeCloseTo(80, 1);
    });

    it('should handle maximum current setpoint', () => {
      psu.handleCommand('VOLT 12');
      psu.handleCommand('CURR 10'); // Max current
      psu.handleCommand('OUTP ON');

      conn.setLoadMode('CC');
      conn.setLoadSetpoint(10);
      conn.setLoadInputEnabled(true);

      // Should be able to deliver full 10A
      expect(parseFloat(psu.handleCommand('MEAS:CURR?')!)).toBeCloseTo(10, 1);
    });

    it('should handle minimum non-zero values', () => {
      psu.handleCommand('VOLT 0.1');
      psu.handleCommand('CURR 0.1');
      psu.handleCommand('OUTP ON');

      conn.setLoadMode('CC');
      conn.setLoadSetpoint(0.05);
      conn.setLoadInputEnabled(true);

      expect(parseFloat(psu.handleCommand('MEAS:VOLT?')!)).toBeCloseTo(0.1, 1);
    });
  });
});
