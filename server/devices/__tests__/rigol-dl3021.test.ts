import { describe, it, expect, beforeEach } from 'vitest';
import { createMockTransport, MockTransport } from './mock-transport.js';
import { createRigolDL3021 } from '../drivers/rigol-dl3021.js';
import type { DeviceDriver } from '../types.js';

describe('Rigol DL3021 Driver', () => {
  let transport: MockTransport;
  let driver: DeviceDriver;

  beforeEach(() => {
    transport = createMockTransport({
      responses: {
        '*IDN?': 'RIGOL TECHNOLOGIES,DL3021,DL3A123456789,00.01.02.03.04',
        ':SOUR:FUNC?': 'CC',
        ':SOUR:INP:STAT?': 'ON',
        ':SOUR:CURR:LEV?': '1.500',
        ':SOUR:VOLT:LEV?': '12.000',
        ':SOUR:RES:LEV?': '100.0',
        ':SOUR:POW:LEV?': '50.000',
        ':MEAS:VOLT?': '12.345',
        ':MEAS:CURR?': '1.234',
        ':MEAS:POW?': '15.234',
        ':MEAS:RES?': '10.0',
      },
    });
    driver = createRigolDL3021(transport);
  });

  describe('Device Info', () => {
    it('should have correct device type', () => {
      expect(driver.info.type).toBe('electronic-load');
    });

    it('should have correct manufacturer', () => {
      expect(driver.info.manufacturer).toBe('Rigol');
    });

    it('should have correct model', () => {
      expect(driver.info.model).toBe('DL3021');
    });
  });

  describe('Capabilities', () => {
    it('should support CC, CV, CR, CP modes', () => {
      expect(driver.capabilities.modes).toEqual(['CC', 'CV', 'CR', 'CP']);
    });

    it('should have settable modes', () => {
      expect(driver.capabilities.modesSettable).toBe(true);
    });

    it('should have output descriptors for each mode', () => {
      const outputs = driver.capabilities.outputs;

      const current = outputs.find(o => o.name === 'current');
      expect(current).toBeDefined();
      expect(current!.unit).toBe('A');
      expect(current!.modes).toEqual(['CC']);

      const voltage = outputs.find(o => o.name === 'voltage');
      expect(voltage).toBeDefined();
      expect(voltage!.unit).toBe('V');
      expect(voltage!.modes).toEqual(['CV']);

      const resistance = outputs.find(o => o.name === 'resistance');
      expect(resistance).toBeDefined();
      expect(resistance!.unit).toBe('Ω');
      expect(resistance!.modes).toEqual(['CR']);

      const power = outputs.find(o => o.name === 'power');
      expect(power).toBeDefined();
      expect(power!.unit).toBe('W');
      expect(power!.modes).toEqual(['CP']);
    });

    it('should have measurement descriptors', () => {
      const measurements = driver.capabilities.measurements;

      expect(measurements.find(m => m.name === 'voltage')).toBeDefined();
      expect(measurements.find(m => m.name === 'current')).toBeDefined();
      expect(measurements.find(m => m.name === 'power')).toBeDefined();
      expect(measurements.find(m => m.name === 'resistance')).toBeDefined();
    });

    it('should support list mode', () => {
      expect(driver.capabilities.listMode).toBeDefined();
      expect(driver.capabilities.listMode!.maxSteps).toBe(512);
      expect(driver.capabilities.listMode!.supportedModes).toEqual(['CC', 'CV', 'CR', 'CP']);
    });
  });

  describe('probe()', () => {
    it('should return true for valid Rigol DL3021 response', async () => {
      await transport.open();
      const result = await driver.probe();
      expect(result).toBe(true);
      expect(transport.sentCommands).toContain('*IDN?');
    });

    it('should return false for non-Rigol device', async () => {
      transport = createMockTransport({
        responses: { '*IDN?': 'Some Other Device' },
      });
      driver = createRigolDL3021(transport);
      await transport.open();
      const result = await driver.probe();
      expect(result).toBe(false);
    });

    it('should extract serial number from IDN response', async () => {
      await transport.open();
      await driver.probe();
      expect(driver.info.serial).toBe('DL3A123456789');
    });
  });

  describe('connect() / disconnect()', () => {
    it('should open transport on connect', async () => {
      expect(transport.isOpen()).toBe(false);
      await driver.connect();
      expect(transport.isOpen()).toBe(true);
    });

    it('should close transport on disconnect', async () => {
      await driver.connect();
      expect(transport.isOpen()).toBe(true);
      await driver.disconnect();
      expect(transport.isOpen()).toBe(false);
    });
  });

  describe('getStatus()', () => {
    beforeEach(async () => {
      await driver.connect();
    });

    it('should return current mode', async () => {
      const status = await driver.getStatus();
      expect(status.mode).toBe('CC');
    });

    it('should return output enabled state', async () => {
      const status = await driver.getStatus();
      expect(status.outputEnabled).toBe(true);
    });

    it('should return setpoints for current mode', async () => {
      const status = await driver.getStatus();
      expect(status.setpoints.current).toBe(1.5);
    });

    it('should return measurements', async () => {
      const status = await driver.getStatus();
      expect(status.measurements.voltage).toBeCloseTo(12.345);
      expect(status.measurements.current).toBeCloseTo(1.234);
      expect(status.measurements.power).toBeCloseTo(15.234);
    });
  });

  describe('setMode()', () => {
    beforeEach(async () => {
      await driver.connect();
    });

    it('should send correct command for CC mode', async () => {
      transport.reset();
      await driver.setMode('CC');
      expect(transport.sentCommands).toContain(':SOUR:FUNC CURR');
    });

    it('should send correct command for CV mode', async () => {
      transport.reset();
      await driver.setMode('CV');
      expect(transport.sentCommands).toContain(':SOUR:FUNC VOLT');
    });

    it('should send correct command for CR mode', async () => {
      transport.reset();
      await driver.setMode('CR');
      expect(transport.sentCommands).toContain(':SOUR:FUNC RES');
    });

    it('should send correct command for CP mode', async () => {
      transport.reset();
      await driver.setMode('CP');
      expect(transport.sentCommands).toContain(':SOUR:FUNC POW');
    });

    it('should throw for invalid mode', async () => {
      await expect(driver.setMode('INVALID')).rejects.toThrow();
    });
  });

  describe('setValue()', () => {
    beforeEach(async () => {
      await driver.connect();
    });

    it('should send correct command for current', async () => {
      transport.reset();
      await driver.setValue('current', 2.5);
      expect(transport.sentCommands).toContain(':SOUR:CURR:LEV 2.5');
    });

    it('should send correct command for voltage', async () => {
      transport.reset();
      await driver.setValue('voltage', 24.0);
      expect(transport.sentCommands).toContain(':SOUR:VOLT:LEV 24');
    });

    it('should send correct command for resistance', async () => {
      transport.reset();
      await driver.setValue('resistance', 100);
      expect(transport.sentCommands).toContain(':SOUR:RES:LEV 100');
    });

    it('should send correct command for power', async () => {
      transport.reset();
      await driver.setValue('power', 50);
      expect(transport.sentCommands).toContain(':SOUR:POW:LEV 50');
    });

    it('should throw for invalid value name', async () => {
      await expect(driver.setValue('invalid', 1)).rejects.toThrow();
    });
  });

  describe('setOutput()', () => {
    beforeEach(async () => {
      await driver.connect();
    });

    it('should send ON command', async () => {
      transport.reset();
      await driver.setOutput(true);
      expect(transport.sentCommands).toContain(':SOUR:INP:STAT ON');
    });

    it('should send OFF command', async () => {
      transport.reset();
      await driver.setOutput(false);
      expect(transport.sentCommands).toContain(':SOUR:INP:STAT OFF');
    });
  });

  describe('List Mode', () => {
    beforeEach(async () => {
      await driver.connect();
    });

    it('should have uploadList method', () => {
      expect(driver.uploadList).toBeDefined();
    });

    it('should have startList method', () => {
      expect(driver.startList).toBeDefined();
    });

    it('should have stopList method', () => {
      expect(driver.stopList).toBeDefined();
    });

    it('should upload list steps with 0-based indexing', async () => {
      transport.reset();
      await driver.uploadList!('CC', [
        { value: 1.0, duration: 0.1 },
        { value: 2.0, duration: 0.2 },
        { value: 1.5, duration: 0.15 },
      ]);

      // Should set mode, range, and step count
      expect(transport.sentCommands.some(c => c.includes(':SOUR:LIST:MODE'))).toBe(true);
      expect(transport.sentCommands.some(c => c.includes(':SOUR:LIST:RANG'))).toBe(true);
      expect(transport.sentCommands.some(c => c.includes(':SOUR:LIST:STEP'))).toBe(true);

      // Verify 0-based indexing (step 0, 1, 2 not 1, 2, 3)
      expect(transport.sentCommands.some(c => c.includes(':SOUR:LIST:LEV 0,'))).toBe(true);
      expect(transport.sentCommands.some(c => c.includes(':SOUR:LIST:LEV 1,'))).toBe(true);
      expect(transport.sentCommands.some(c => c.includes(':SOUR:LIST:LEV 2,'))).toBe(true);
    });

    it('should start list execution with trigger setup', async () => {
      transport.reset();
      await driver.startList!();
      expect(transport.sentCommands.some(c => c.includes(':SOUR:FUNC:MODE LIST'))).toBe(true);
      expect(transport.sentCommands.some(c => c.includes(':TRIG:SOUR BUS'))).toBe(true);
      expect(transport.sentCommands.some(c => c.includes(':TRIG'))).toBe(true);
    });

    it('should stop list execution', async () => {
      transport.reset();
      await driver.stopList!();
      // Should either turn off input or switch back to normal mode
      expect(
        transport.sentCommands.some(c =>
          c.includes(':SOUR:INP:STAT OFF') ||
          c.includes(':SOUR:FUNC:MODE FIX')
        )
      ).toBe(true);
    });
  });
});
