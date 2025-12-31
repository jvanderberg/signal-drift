import { describe, it, expect, beforeEach } from 'vitest';
import { createVirtualConnection, type VirtualConnection } from '../virtual-connection.js';

describe('VirtualConnection', () => {
  let conn: VirtualConnection;

  // Config for deterministic tests - disable all noise sources
  const deterministicConfig = { measurementStabilityPPM: 0, measurementNoiseFloorMv: 0 };

  beforeEach(() => {
    // Use deterministic config for most tests
    conn = createVirtualConnection(deterministicConfig);
  });

  describe('Initial State', () => {
    it('should start with PSU output disabled', () => {
      expect(conn.getPsuVoltage()).toBe(0);
      expect(conn.getPsuCurrent()).toBe(0);
    });

    it('should start with Load input disabled', () => {
      expect(conn.getLoadVoltage()).toBe(0);
      expect(conn.getLoadCurrent()).toBe(0);
    });

    it('should start in CV mode', () => {
      expect(conn.getPsuMode()).toBe('CV');
    });
  });

  describe('PSU Output Disabled', () => {
    it('should output 0V when disabled regardless of setpoint', () => {
      conn.setPsuVoltage(12.0);
      conn.setPsuCurrentLimit(5.0);
      // PSU disabled
      expect(conn.getPsuVoltage()).toBe(0);
      expect(conn.getLoadVoltage()).toBe(0);
    });

    it('should output 0 current when disabled', () => {
      conn.setPsuVoltage(12.0);
      conn.setLoadMode('CC');
      conn.setLoadSetpoint(1.0);
      conn.setLoadInputEnabled(true);
      // PSU disabled
      expect(conn.getPsuCurrent()).toBe(0);
      expect(conn.getLoadCurrent()).toBe(0);
    });
  });

  describe('Load Input Disabled', () => {
    it('should have voltage present but no current when load disabled', () => {
      conn.setPsuVoltage(12.0);
      conn.setPsuOutputEnabled(true);
      conn.setLoadMode('CC');
      conn.setLoadSetpoint(1.0);
      // Load disabled

      expect(conn.getPsuVoltage()).toBe(12.0);
      expect(conn.getLoadVoltage()).toBe(12.0);
      expect(conn.getPsuCurrent()).toBe(0);
      expect(conn.getLoadCurrent()).toBe(0);
    });
  });

  describe('CC Mode (Constant Current)', () => {
    beforeEach(() => {
      conn.setPsuVoltage(12.0);
      conn.setPsuCurrentLimit(5.0);
      conn.setPsuOutputEnabled(true);
      conn.setLoadMode('CC');
      conn.setLoadInputEnabled(true);
    });

    it('should draw setpoint current when below PSU limit', () => {
      conn.setLoadSetpoint(2.0);
      expect(conn.getLoadCurrent()).toBeCloseTo(2.0, 2);
      expect(conn.getPsuCurrent()).toBeCloseTo(2.0, 2);
    });

    it('should be limited by PSU current limit', () => {
      conn.setLoadSetpoint(10.0); // Demand more than 5A limit
      expect(conn.getLoadCurrent()).toBeCloseTo(5.0, 2);
      expect(conn.getPsuCurrent()).toBeCloseTo(5.0, 2);
    });

    it('should transition PSU to CC mode when current limited', () => {
      conn.setLoadSetpoint(10.0); // Exceed PSU limit
      expect(conn.getPsuMode()).toBe('CC');
    });

    it('should stay in CV mode when below limit', () => {
      conn.setLoadSetpoint(2.0);
      expect(conn.getPsuMode()).toBe('CV');
    });

    it('should handle 0A setpoint', () => {
      conn.setLoadSetpoint(0);
      expect(conn.getLoadCurrent()).toBe(0);
      expect(conn.getPsuMode()).toBe('CV');
    });
  });

  describe('CV Mode (Constant Voltage)', () => {
    beforeEach(() => {
      conn.setPsuVoltage(12.0);
      conn.setPsuCurrentLimit(5.0);
      conn.setPsuOutputEnabled(true);
      conn.setLoadMode('CV');
      conn.setLoadInputEnabled(true);
    });

    it('should sink current when PSU voltage exceeds setpoint', () => {
      conn.setLoadSetpoint(10.0); // Load wants 10V, PSU provides 12V
      // Current should be proportional to voltage difference: gain * (12 - 10) = 10 * 2 = 20A
      // But limited by PSU to 5A
      expect(conn.getLoadCurrent()).toBeCloseTo(5.0, 2);
    });

    it('should sink no current when PSU voltage below setpoint', () => {
      conn.setLoadSetpoint(15.0); // Load wants 15V, PSU only provides 12V
      expect(conn.getLoadCurrent()).toBe(0);
    });

    it('should sink proportional current based on voltage difference', () => {
      // Default gain is 10 A/V
      conn = createVirtualConnection({ ...deterministicConfig, loadCvGain: 10 });
      conn.setPsuVoltage(12.0);
      conn.setPsuCurrentLimit(50.0); // High limit to not interfere
      conn.setPsuOutputEnabled(true);
      conn.setLoadMode('CV');
      conn.setLoadSetpoint(11.0); // 1V difference
      conn.setLoadInputEnabled(true);

      // Current = gain * delta = 10 * 1 = 10A
      expect(conn.getLoadCurrent()).toBeCloseTo(10.0, 1);
    });

    it('should handle 0V setpoint', () => {
      conn.setLoadSetpoint(0);
      expect(conn.getLoadCurrent()).toBe(0);
    });
  });

  describe('CR Mode (Constant Resistance)', () => {
    beforeEach(() => {
      conn.setPsuVoltage(12.0);
      conn.setPsuCurrentLimit(5.0);
      conn.setPsuOutputEnabled(true);
      conn.setLoadMode('CR');
      conn.setLoadInputEnabled(true);
    });

    it('should draw current based on V/R', () => {
      conn.setLoadSetpoint(12.0); // 12 ohms
      // I = V / (R + Rout) = 12 / (12 + 0.05) ≈ 0.996A
      expect(conn.getLoadCurrent()).toBeCloseTo(0.996, 2);
    });

    it('should be limited by PSU current limit', () => {
      conn.setLoadSetpoint(1.0); // 1 ohm, would draw ~12A
      expect(conn.getLoadCurrent()).toBeCloseTo(5.0, 2);
      expect(conn.getPsuMode()).toBe('CC');
    });

    it('should handle very high resistance', () => {
      conn.setLoadSetpoint(10000); // 10k ohms
      expect(conn.getLoadCurrent()).toBeCloseTo(0.0012, 3);
    });

    it('should handle 0 resistance (safety)', () => {
      conn.setLoadSetpoint(0);
      expect(conn.getLoadCurrent()).toBe(0);
    });
  });

  describe('CP Mode (Constant Power)', () => {
    beforeEach(() => {
      conn.setPsuVoltage(12.0);
      conn.setPsuCurrentLimit(5.0);
      conn.setPsuOutputEnabled(true);
      conn.setLoadMode('CP');
      conn.setLoadInputEnabled(true);
    });

    it('should draw current to achieve power setpoint', () => {
      conn.setLoadSetpoint(24.0); // 24W at 12V = 2A
      // With output impedance droop, actual is slightly higher
      expect(conn.getLoadCurrent()).toBeCloseTo(2.0, 1);
    });

    it('should be limited by PSU current limit', () => {
      conn.setLoadSetpoint(100.0); // 100W would need ~8.3A
      expect(conn.getLoadCurrent()).toBeCloseTo(5.0, 2);
    });

    it('should handle 0W setpoint', () => {
      conn.setLoadSetpoint(0);
      expect(conn.getLoadCurrent()).toBe(0);
    });

    it('should handle 0V PSU voltage', () => {
      conn.setPsuVoltage(0);
      conn.setLoadSetpoint(24.0);
      expect(conn.getLoadCurrent()).toBe(0);
    });
  });

  describe('Voltage Droop', () => {
    beforeEach(() => {
      conn = createVirtualConnection({
        measurementStabilityPPM: 0,
        measurementNoiseFloorMv: 0,
        psuOutputImpedance: 0.1, // 0.1 ohm output impedance
      });
      conn.setPsuVoltage(12.0);
      conn.setPsuCurrentLimit(10.0);
      conn.setPsuOutputEnabled(true);
      conn.setLoadMode('CC');
      conn.setLoadInputEnabled(true);
    });

    it('should show gradual voltage droop under load', () => {
      // At 0A: V = 12V
      conn.setLoadSetpoint(0);
      expect(conn.getPsuVoltage()).toBe(12.0);

      // At 1A: V = 12 - 1*0.1 = 11.9V
      conn.setLoadSetpoint(1.0);
      expect(conn.getPsuVoltage()).toBeCloseTo(11.9, 2);

      // At 5A: V = 12 - 5*0.1 = 11.5V
      conn.setLoadSetpoint(5.0);
      expect(conn.getPsuVoltage()).toBeCloseTo(11.5, 2);
    });

    it('should have additional droop when PSU is current limited', () => {
      conn.setLoadSetpoint(15.0); // Demand 15A, PSU limited to 10A
      const voltage = conn.getPsuVoltage();
      // Should be less than 12 - 10*0.1 = 11V due to CC mode droop
      expect(voltage).toBeLessThan(11.0);
    });
  });

  describe('Power and Resistance Calculations', () => {
    beforeEach(() => {
      conn = createVirtualConnection(deterministicConfig);
      conn.setPsuVoltage(12.0);
      conn.setPsuCurrentLimit(5.0);
      conn.setPsuOutputEnabled(true);
      conn.setLoadMode('CC');
      conn.setLoadSetpoint(2.0);
      conn.setLoadInputEnabled(true);
    });

    it('should calculate power correctly', () => {
      // P = V * I, with slight droop: ~12 * 2 = ~24W
      expect(conn.getLoadPower()).toBeCloseTo(24.0, 0);
    });

    it('should calculate resistance correctly', () => {
      // R = V / I = ~12 / 2 = ~6 ohms
      expect(conn.getLoadResistance()).toBeCloseTo(6.0, 0);
    });

    it('should return 0 resistance when no current', () => {
      conn.setLoadSetpoint(0);
      expect(conn.getLoadResistance()).toBe(0);
    });
  });

  describe('Measurement Jitter', () => {
    it('should add jitter when measurementStabilityPPM > 0', () => {
      const jitterConn = createVirtualConnection({ measurementStabilityPPM: 1000 }); // 0.1%
      jitterConn.setPsuVoltage(12.0);
      jitterConn.setPsuOutputEnabled(true);
      jitterConn.setLoadInputEnabled(false);

      // Collect multiple readings
      const readings: number[] = [];
      for (let i = 0; i < 100; i++) {
        readings.push(jitterConn.getPsuVoltage());
      }

      // Should have variation
      const min = Math.min(...readings);
      const max = Math.max(...readings);
      expect(max - min).toBeGreaterThan(0);

      // All readings should be close to 12V (within 0.1% = 0.012V * some margin)
      for (const r of readings) {
        expect(r).toBeCloseTo(12.0, 1);
      }
    });

    it('should produce visible jitter at display resolution (3 decimal places) with default config', () => {
      // Real hardware wanders by 0.001-0.002V at typical voltages
      // Default config should produce visible jitter when rounded to 3 decimals
      const jitterConn = createVirtualConnection(); // Use defaults
      jitterConn.setPsuVoltage(4.0);
      jitterConn.setPsuOutputEnabled(true);
      jitterConn.setLoadInputEnabled(false);

      // Collect readings rounded to display precision (3 decimal places)
      const displayReadings = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const voltage = jitterConn.getPsuVoltage();
        displayReadings.add(voltage.toFixed(3));
      }

      // Should see at least 2 different values at display precision
      // (i.e., jitter should be visible, not hidden by rounding)
      expect(displayReadings.size).toBeGreaterThanOrEqual(2);
    });

    it('should produce 1-2mV variation at typical voltages (2-12V range)', () => {
      // User requirement: real hardware wanders by 0.001-0.002V
      const jitterConn = createVirtualConnection(); // Use defaults
      jitterConn.setPsuVoltage(2.0);
      jitterConn.setPsuOutputEnabled(true);
      jitterConn.setLoadInputEnabled(false);

      const readings: number[] = [];
      for (let i = 0; i < 100; i++) {
        readings.push(jitterConn.getPsuVoltage());
      }

      const min = Math.min(...readings);
      const max = Math.max(...readings);
      const range = max - min;

      // Should have at least 0.5mV variation (half of typical 1-2mV)
      expect(range).toBeGreaterThanOrEqual(0.0005);
      // But not excessive - should be less than 10mV
      expect(range).toBeLessThan(0.01);
    });

    it('should not add jitter to 0 values', () => {
      const jitterConn = createVirtualConnection({ measurementStabilityPPM: 1000 });
      // PSU disabled, voltage is 0
      for (let i = 0; i < 10; i++) {
        expect(jitterConn.getPsuVoltage()).toBe(0);
      }
    });

    it('should not add jitter when both noise sources are disabled', () => {
      const noJitterConn = createVirtualConnection({
        measurementStabilityPPM: 0,
        measurementNoiseFloorMv: 0,
      });
      noJitterConn.setPsuVoltage(12.0);
      noJitterConn.setPsuOutputEnabled(true);

      const readings: number[] = [];
      for (let i = 0; i < 10; i++) {
        readings.push(noJitterConn.getPsuVoltage());
      }

      // All readings should be identical
      const allSame = readings.every(r => r === readings[0]);
      expect(allSame).toBe(true);
    });
  });

  describe('Configuration', () => {
    it('should return resolved config via getConfig()', () => {
      const customConn = createVirtualConnection({
        measurementStabilityPPM: 200,
        psuOutputImpedance: 0.1,
      });
      const config = customConn.getConfig();
      expect(config.measurementStabilityPPM).toBe(200);
      expect(config.psuOutputImpedance).toBe(0.1);
      expect(config.loadCvGain).toBe(10); // Default
    });

    it('should use default config when none provided', () => {
      const defaultConn = createVirtualConnection();
      const config = defaultConn.getConfig();
      expect(config.measurementStabilityPPM).toBe(100);
      expect(config.psuOutputImpedance).toBe(0.05);
      expect(config.loadCvGain).toBe(10);
    });
  });

  describe('Edge Cases', () => {
    beforeEach(() => {
      conn = createVirtualConnection(deterministicConfig);
    });

    it('should handle negative voltage setpoint (clamp to 0)', () => {
      conn.setPsuVoltage(-5);
      conn.setPsuOutputEnabled(true);
      expect(conn.getPsuVoltage()).toBe(0);
    });

    it('should handle negative current limit (clamp to 0)', () => {
      conn.setPsuCurrentLimit(-5);
      conn.setPsuVoltage(12);
      conn.setPsuOutputEnabled(true);
      conn.setLoadMode('CC');
      conn.setLoadSetpoint(1.0);
      conn.setLoadInputEnabled(true);
      expect(conn.getLoadCurrent()).toBe(0);
    });

    it('should handle very small current values', () => {
      conn.setPsuVoltage(12);
      conn.setPsuCurrentLimit(10);
      conn.setPsuOutputEnabled(true);
      conn.setLoadMode('CC');
      conn.setLoadSetpoint(0.0001);
      conn.setLoadInputEnabled(true);
      expect(conn.getLoadCurrent()).toBeCloseTo(0.0001, 4);
    });

    it('should handle very large voltage values', () => {
      conn.setPsuVoltage(1000);
      conn.setPsuCurrentLimit(10);
      conn.setPsuOutputEnabled(true);
      conn.setLoadInputEnabled(false);
      expect(conn.getPsuVoltage()).toBe(1000);
    });
  });
});
