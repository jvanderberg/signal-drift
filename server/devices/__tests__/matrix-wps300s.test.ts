import { describe, it, expect, beforeEach } from 'vitest';
import { createMockTransport, MockTransport } from './mock-transport.js';
import { createMatrixWPS300S } from '../drivers/matrix-wps300s.js';
import type { DeviceDriver } from '../types.js';

describe('Matrix WPS300S Driver', () => {
  let transport: MockTransport;
  let driver: DeviceDriver;

  beforeEach(() => {
    transport = createMockTransport({
      responses: {
        'VOLT?': '12.000',        // Voltage setpoint
        'CURR?': '1.0000',        // Current limit
        'OUTP?': '1',             // Output on (returns "0" or "1", not "ON"/"OFF")
        'MEAS:VOLT?': '12.345',   // Actual measured voltage
        'MEAS:CURR?': '1.2340',   // Actual measured current
      },
    });
    driver = createMatrixWPS300S(transport);
  });

  describe('Device Info', () => {
    it('should have correct device type', () => {
      expect(driver.info.type).toBe('power-supply');
    });

    it('should have correct manufacturer', () => {
      expect(driver.info.manufacturer).toBe('Matrix');
    });

    it('should have correct model', () => {
      expect(driver.info.model).toBe('WPS300S');
    });
  });

  describe('Capabilities', () => {
    it('should support CV and CC modes', () => {
      expect(driver.capabilities.modes).toEqual(['CV', 'CC']);
    });

    it('should NOT have settable modes (auto-detected)', () => {
      expect(driver.capabilities.modesSettable).toBe(false);
    });

    it('should have voltage and current outputs', () => {
      const outputs = driver.capabilities.outputs;

      const voltage = outputs.find(o => o.name === 'voltage');
      expect(voltage).toBeDefined();
      expect(voltage!.unit).toBe('V');
      expect(voltage!.max).toBe(80);

      const current = outputs.find(o => o.name === 'current');
      expect(current).toBeDefined();
      expect(current!.unit).toBe('A');
      expect(current!.max).toBe(10);
    });

    it('should have measurement descriptors', () => {
      const measurements = driver.capabilities.measurements;

      expect(measurements.find(m => m.name === 'voltage')).toBeDefined();
      expect(measurements.find(m => m.name === 'current')).toBeDefined();
      expect(measurements.find(m => m.name === 'power')).toBeDefined();
    });

    it('should NOT have list mode capability', () => {
      expect(driver.capabilities.listMode).toBeUndefined();
    });
  });

  describe('probe()', () => {
    it('should return Ok with DeviceInfo when device responds to VOLT?', async () => {
      await transport.open();
      const result = await driver.probe();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.model).toBe('WPS300S');
      }
      expect(transport.sentCommands).toContain('VOLT?');
    });

    it('should return Err when device does not respond', async () => {
      transport = createMockTransport({
        responses: {},
        defaultResponse: '',
      });
      driver = createMatrixWPS300S(transport);
      await transport.open();
      const result = await driver.probe();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reason).toBe('wrong_device');
      }
    });
  });

  describe('connect() / disconnect()', () => {
    it('should open transport on connect', async () => {
      expect(transport.isOpen()).toBe(false);
      const result = await driver.connect();
      expect(result.ok).toBe(true);
      expect(transport.isOpen()).toBe(true);
    });

    it('should close transport on disconnect', async () => {
      await driver.connect();
      expect(transport.isOpen()).toBe(true);
      const result = await driver.disconnect();
      expect(result.ok).toBe(true);
      expect(transport.isOpen()).toBe(false);
    });
  });

  describe('getStatus()', () => {
    beforeEach(async () => {
      await driver.connect();
    });

    it('should return CV mode (mode cannot be queried, defaults to CV)', async () => {
      const result = await driver.getStatus();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.mode).toBe('CV');
      }
    });

    it('should return output enabled state when "1"', async () => {
      const result = await driver.getStatus();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outputEnabled).toBe(true);
      }
    });

    it('should return OFF state correctly when "0"', async () => {
      transport = createMockTransport({
        responses: {
          'VOLT?': '12.000',
          'CURR?': '1.0000',
          'OUTP?': '0',
          'MEAS:VOLT?': '0.000',
          'MEAS:CURR?': '0.0000',
        },
      });
      driver = createMatrixWPS300S(transport);
      await driver.connect();
      const result = await driver.getStatus();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outputEnabled).toBe(false);
      }
    });

    it('should return voltage and current setpoints', async () => {
      const result = await driver.getStatus();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.setpoints.voltage).toBeCloseTo(12.0);
        expect(result.value.setpoints.current).toBeCloseTo(1.0);
      }
    });

    it('should return actual measurements (separate from setpoints)', async () => {
      const result = await driver.getStatus();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.measurements.voltage).toBeCloseTo(12.345);
        expect(result.value.measurements.current).toBeCloseTo(1.234);
        // Power should be calculated from actual measurements
        expect(result.value.measurements.power).toBeCloseTo(12.345 * 1.234, 2);
      }
    });
  });

  describe('setMode()', () => {
    beforeEach(async () => {
      await driver.connect();
    });

    it('should be a no-op (mode is auto-detected)', async () => {
      transport.reset();
      const result = await driver.setMode('CC');
      expect(result.ok).toBe(true);
      // Should not send any command
      expect(transport.sentCommands.length).toBe(0);
    });
  });

  describe('setValue()', () => {
    beforeEach(async () => {
      await driver.connect();
    });

    it('should send correct command for voltage', async () => {
      transport.reset();
      const result = await driver.setValue('voltage', 24.5);
      expect(result.ok).toBe(true);
      expect(transport.sentCommands).toContain('VOLT 24.5');
    });

    it('should send correct command for current', async () => {
      transport.reset();
      const result = await driver.setValue('current', 2.5);
      expect(result.ok).toBe(true);
      expect(transport.sentCommands).toContain('CURR 2.5');
    });

    it('should return Err for invalid value name', async () => {
      const result = await driver.setValue('power', 100);
      expect(result.ok).toBe(false);
    });
  });

  describe('setOutput()', () => {
    beforeEach(async () => {
      await driver.connect();
    });

    it('should send ON command', async () => {
      transport.reset();
      const result = await driver.setOutput(true);
      expect(result.ok).toBe(true);
      expect(transport.sentCommands).toContain('OUTP ON');
    });

    it('should send OFF command', async () => {
      transport.reset();
      const result = await driver.setOutput(false);
      expect(result.ok).toBe(true);
      expect(transport.sentCommands).toContain('OUTP OFF');
    });
  });

  describe('List Mode', () => {
    it('should NOT have uploadList method', () => {
      expect(driver.uploadList).toBeUndefined();
    });

    it('should NOT have startList method', () => {
      expect(driver.startList).toBeUndefined();
    });

    it('should NOT have stopList method', () => {
      expect(driver.stopList).toBeUndefined();
    });
  });
});
