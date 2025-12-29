import { describe, it, expect, beforeEach } from 'vitest';
import { createMockTransport, MockTransport } from './mock-transport.js';
import { createRigolOscilloscope } from '../drivers/rigol-oscilloscope.js';
import type { OscilloscopeDriver } from '../types.js';

describe('Rigol Oscilloscope Driver', () => {
  let transport: MockTransport;
  let driver: OscilloscopeDriver;

  // Default mock responses for a DS1054Z
  const defaultResponses: Record<string, string> = {
    '*IDN?': 'RIGOL TECHNOLOGIES,DS1054Z,DS1ZA123456789,00.04.04.SP3',
    ':TRIG:STAT?': 'TD',
    ':TRIG:SWE?': 'AUTO',
    ':ACQ:SRAT?': '1.00E+09',
    ':ACQ:MDEP?': '12000000',
    ':CHAN1:DISP?': '1',
    ':CHAN2:DISP?': '0',
    ':CHAN3:DISP?': '0',
    ':CHAN4:DISP?': '0',
    ':CHAN1:SCAL?': '1.00E+00',
    ':CHAN2:SCAL?': '1.00E+00',
    ':CHAN3:SCAL?': '1.00E+00',
    ':CHAN4:SCAL?': '1.00E+00',
    ':CHAN1:OFFS?': '0.00E+00',
    ':CHAN2:OFFS?': '0.00E+00',
    ':CHAN3:OFFS?': '0.00E+00',
    ':CHAN4:OFFS?': '0.00E+00',
    ':CHAN1:COUP?': 'DC',
    ':CHAN2:COUP?': 'DC',
    ':CHAN3:COUP?': 'DC',
    ':CHAN4:COUP?': 'DC',
    ':CHAN1:PROB?': '10',
    ':CHAN2:PROB?': '10',
    ':CHAN3:PROB?': '10',
    ':CHAN4:PROB?': '10',
    ':CHAN1:BWL?': 'OFF',
    ':CHAN2:BWL?': 'OFF',
    ':CHAN3:BWL?': 'OFF',
    ':CHAN4:BWL?': 'OFF',
    ':TIM:SCAL?': '1.00E-03',
    ':TIM:OFFS?': '0.00E+00',
    ':TIM:MODE?': 'MAIN',
    ':TRIG:MODE?': 'EDGE',
    ':TRIG:COUP?': 'DC',
    ':TRIG:EDG:SOUR?': 'CHAN1',
    ':TRIG:EDG:LEV?': '1.50E+00',
    ':TRIG:EDG:SLOP?': 'POS',
    ':MEAS:VPP? CHAN1': '3.28E+00',
    ':MEAS:VAVG? CHAN1': '1.65E+00',
    ':MEAS:FREQ? CHAN1': '1.00E+03',
    ':MEAS:VPP? CHAN2': '****',  // Invalid measurement (no signal)
    ':WAV:PRE?': '0,0,1200,1,1.000000e-08,-6.000000e-04,0,3.120000e-02,125,0',
  };

  beforeEach(() => {
    transport = createMockTransport({ responses: defaultResponses });
    driver = createRigolOscilloscope(transport);
  });

  describe('Device Info', () => {
    it('should have correct device type', () => {
      expect(driver.info.type).toBe('oscilloscope');
    });

    it('should have correct manufacturer', () => {
      expect(driver.info.manufacturer).toBe('Rigol');
    });

    it('should have empty model before probe', () => {
      expect(driver.info.model).toBe('');
    });
  });

  describe('Capabilities', () => {
    it('should have default channel count', () => {
      expect(driver.capabilities.channels).toBe(4);
    });

    it('should have supported measurements', () => {
      expect(driver.capabilities.supportedMeasurements).toContain('VPP');
      expect(driver.capabilities.supportedMeasurements).toContain('VAVG');
      expect(driver.capabilities.supportedMeasurements).toContain('FREQ');
    });
  });

  describe('probe()', () => {
    it('should return true for DS1054Z', async () => {
      await transport.open();
      const result = await driver.probe();
      expect(result).toBe(true);
      expect(transport.sentCommands).toContain('*IDN?');
    });

    it('should parse model from IDN response', async () => {
      await transport.open();
      await driver.probe();
      expect(driver.info.model).toBe('DS1054Z');
    });

    it('should parse serial from IDN response', async () => {
      await transport.open();
      await driver.probe();
      expect(driver.info.serial).toBe('DS1ZA123456789');
    });

    it('should generate correct device ID', async () => {
      await transport.open();
      await driver.probe();
      expect(driver.info.id).toBe('rigol-ds1054z-DS1ZA123456789');
    });

    it('should return true for DS2072A', async () => {
      transport = createMockTransport({
        responses: {
          '*IDN?': 'RIGOL TECHNOLOGIES,DS2072A,DS2D123456789,00.03.02',
        },
      });
      driver = createRigolOscilloscope(transport);
      await transport.open();
      const result = await driver.probe();
      expect(result).toBe(true);
      expect(driver.info.model).toBe('DS2072A');
    });

    it('should return true for MSO5074', async () => {
      transport = createMockTransport({
        responses: {
          '*IDN?': 'RIGOL TECHNOLOGIES,MSO5074,MS5A123456789,00.01.02.03',
        },
      });
      driver = createRigolOscilloscope(transport);
      await transport.open();
      const result = await driver.probe();
      expect(result).toBe(true);
      expect(driver.info.model).toBe('MSO5074');
    });

    it('should return false for non-oscilloscope Rigol device (DL3021)', async () => {
      transport = createMockTransport({
        responses: {
          '*IDN?': 'RIGOL TECHNOLOGIES,DL3021,DL3A123456789,00.01.02.03.04',
        },
      });
      driver = createRigolOscilloscope(transport);
      await transport.open();
      const result = await driver.probe();
      expect(result).toBe(false);
    });

    it('should return false for non-Rigol device', async () => {
      transport = createMockTransport({
        responses: {
          '*IDN?': 'KEYSIGHT TECHNOLOGIES,DSOX1102G,MY12345678,01.20.0000',
        },
      });
      driver = createRigolOscilloscope(transport);
      await transport.open();
      const result = await driver.probe();
      expect(result).toBe(false);
    });

    it('should return false on timeout/error', async () => {
      transport = createMockTransport({
        responses: {},  // No response configured
      });
      driver = createRigolOscilloscope(transport);
      await transport.open();
      const result = await driver.probe();
      expect(result).toBe(false);
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

    it('should return running state based on trigger status', async () => {
      const status = await driver.getStatus();
      // TD (triggered) means running
      expect(status.running).toBe(true);
    });

    it('should parse trigger status', async () => {
      const status = await driver.getStatus();
      expect(status.triggerStatus).toBe('triggered');
    });

    it('should parse WAIT trigger status', async () => {
      transport = createMockTransport({
        responses: { ...defaultResponses, ':TRIG:STAT?': 'WAIT' },
      });
      driver = createRigolOscilloscope(transport);
      await driver.connect();
      const status = await driver.getStatus();
      expect(status.triggerStatus).toBe('wait');
    });

    it('should parse STOP trigger status', async () => {
      transport = createMockTransport({
        responses: { ...defaultResponses, ':TRIG:STAT?': 'STOP' },
      });
      driver = createRigolOscilloscope(transport);
      await driver.connect();
      const status = await driver.getStatus();
      expect(status.triggerStatus).toBe('stopped');
      expect(status.running).toBe(false);
    });

    it('should parse AUTO trigger status', async () => {
      transport = createMockTransport({
        responses: { ...defaultResponses, ':TRIG:STAT?': 'AUTO' },
      });
      driver = createRigolOscilloscope(transport);
      await driver.connect();
      const status = await driver.getStatus();
      expect(status.triggerStatus).toBe('auto');
    });

    it('should parse sample rate', async () => {
      const status = await driver.getStatus();
      expect(status.sampleRate).toBe(1e9);
    });

    it('should parse memory depth', async () => {
      const status = await driver.getStatus();
      expect(status.memoryDepth).toBe(12000000);
    });

    it('should parse channel enabled state', async () => {
      const status = await driver.getStatus();
      expect(status.channels['CHAN1'].enabled).toBe(true);
      expect(status.channels['CHAN2'].enabled).toBe(false);
    });

    it('should parse channel scale', async () => {
      const status = await driver.getStatus();
      expect(status.channels['CHAN1'].scale).toBe(1.0);
    });

    it('should parse channel offset', async () => {
      const status = await driver.getStatus();
      expect(status.channels['CHAN1'].offset).toBe(0);
    });

    it('should parse channel coupling', async () => {
      const status = await driver.getStatus();
      expect(status.channels['CHAN1'].coupling).toBe('DC');
    });

    it('should parse channel probe ratio', async () => {
      const status = await driver.getStatus();
      expect(status.channels['CHAN1'].probe).toBe(10);
    });

    it('should parse timebase scale', async () => {
      const status = await driver.getStatus();
      expect(status.timebase.scale).toBe(0.001);  // 1ms/div
    });

    it('should parse timebase offset', async () => {
      const status = await driver.getStatus();
      expect(status.timebase.offset).toBe(0);
    });

    it('should parse trigger source', async () => {
      const status = await driver.getStatus();
      expect(status.trigger.source).toBe('CHAN1');
    });

    it('should parse trigger level', async () => {
      const status = await driver.getStatus();
      expect(status.trigger.level).toBe(1.5);
    });

    it('should parse trigger edge (rising)', async () => {
      const status = await driver.getStatus();
      expect(status.trigger.edge).toBe('rising');
    });

    it('should parse trigger edge (falling)', async () => {
      transport = createMockTransport({
        responses: { ...defaultResponses, ':TRIG:EDG:SLOP?': 'NEG' },
      });
      driver = createRigolOscilloscope(transport);
      await driver.connect();
      const status = await driver.getStatus();
      expect(status.trigger.edge).toBe('falling');
    });

    it('should parse trigger sweep mode', async () => {
      const status = await driver.getStatus();
      expect(status.trigger.sweep).toBe('auto');
    });
  });

  describe('Control Commands', () => {
    beforeEach(async () => {
      await driver.connect();
    });

    it('should send :RUN command', async () => {
      transport.reset();
      await driver.run();
      expect(transport.sentCommands).toContain(':RUN');
    });

    it('should send :STOP command', async () => {
      transport.reset();
      await driver.stop();
      expect(transport.sentCommands).toContain(':STOP');
    });

    it('should send :SING command', async () => {
      transport.reset();
      await driver.single();
      expect(transport.sentCommands).toContain(':SING');
    });

    it('should send :AUT command for auto setup', async () => {
      transport.reset();
      await driver.autoSetup();
      expect(transport.sentCommands).toContain(':AUT');
    });

    it('should send :TFOR command for force trigger', async () => {
      transport.reset();
      await driver.forceTrigger();
      expect(transport.sentCommands).toContain(':TFOR');
    });
  });

  describe('Channel Configuration', () => {
    beforeEach(async () => {
      await driver.connect();
    });

    it('should enable channel', async () => {
      transport.reset();
      await driver.setChannelEnabled('CHAN1', true);
      expect(transport.sentCommands).toContain(':CHAN1:DISP ON');
    });

    it('should disable channel', async () => {
      transport.reset();
      await driver.setChannelEnabled('CHAN2', false);
      expect(transport.sentCommands).toContain(':CHAN2:DISP OFF');
    });

    it('should set channel scale', async () => {
      transport.reset();
      await driver.setChannelScale('CHAN1', 0.5);
      expect(transport.sentCommands).toContain(':CHAN1:SCAL 0.5');
    });

    it('should set channel offset', async () => {
      transport.reset();
      await driver.setChannelOffset('CHAN1', -2.5);
      expect(transport.sentCommands).toContain(':CHAN1:OFFS -2.5');
    });

    it('should set channel coupling', async () => {
      transport.reset();
      await driver.setChannelCoupling('CHAN1', 'AC');
      expect(transport.sentCommands).toContain(':CHAN1:COUP AC');
    });

    it('should set channel probe ratio', async () => {
      transport.reset();
      await driver.setChannelProbe('CHAN1', 100);
      expect(transport.sentCommands).toContain(':CHAN1:PROB 100');
    });
  });

  describe('Timebase Configuration', () => {
    beforeEach(async () => {
      await driver.connect();
    });

    it('should set timebase scale', async () => {
      transport.reset();
      await driver.setTimebaseScale(0.001);  // 1ms/div
      expect(transport.sentCommands).toContain(':TIM:SCAL 0.001');
    });

    it('should set timebase offset', async () => {
      transport.reset();
      await driver.setTimebaseOffset(0.005);  // 5ms offset
      expect(transport.sentCommands).toContain(':TIM:OFFS 0.005');
    });
  });

  describe('Trigger Configuration', () => {
    beforeEach(async () => {
      await driver.connect();
    });

    it('should set trigger source', async () => {
      transport.reset();
      await driver.setTriggerSource('CHAN2');
      expect(transport.sentCommands).toContain(':TRIG:EDG:SOUR CHAN2');
    });

    it('should set trigger level', async () => {
      transport.reset();
      await driver.setTriggerLevel(2.5);
      expect(transport.sentCommands).toContain(':TRIG:EDG:LEV 2.5');
    });

    it('should set trigger edge to rising', async () => {
      transport.reset();
      await driver.setTriggerEdge('rising');
      expect(transport.sentCommands).toContain(':TRIG:EDG:SLOP POS');
    });

    it('should set trigger edge to falling', async () => {
      transport.reset();
      await driver.setTriggerEdge('falling');
      expect(transport.sentCommands).toContain(':TRIG:EDG:SLOP NEG');
    });

    it('should set trigger sweep mode', async () => {
      transport.reset();
      await driver.setTriggerSweep('normal');
      expect(transport.sentCommands).toContain(':TRIG:SWE NORM');
    });

    it('should set trigger sweep to single', async () => {
      transport.reset();
      await driver.setTriggerSweep('single');
      expect(transport.sentCommands).toContain(':TRIG:SWE SING');
    });
  });

  describe('Measurements (Stateless Queries)', () => {
    beforeEach(async () => {
      await driver.connect();
    });

    it('should query VPP measurement', async () => {
      transport.reset();
      const value = await driver.getMeasurement('CHAN1', 'VPP');
      expect(transport.sentCommands).toContain(':MEAS:VPP? CHAN1');
      expect(value).toBeCloseTo(3.28);
    });

    it('should query VAVG measurement', async () => {
      transport.reset();
      const value = await driver.getMeasurement('CHAN1', 'VAVG');
      expect(transport.sentCommands).toContain(':MEAS:VAVG? CHAN1');
      expect(value).toBeCloseTo(1.65);
    });

    it('should query FREQ measurement', async () => {
      transport.reset();
      const value = await driver.getMeasurement('CHAN1', 'FREQ');
      expect(transport.sentCommands).toContain(':MEAS:FREQ? CHAN1');
      expect(value).toBeCloseTo(1000);
    });

    it('should return null for invalid measurement (****)', async () => {
      transport.reset();
      const value = await driver.getMeasurement('CHAN2', 'VPP');
      expect(value).toBeNull();
    });

    it('should return null for overflow measurement (9.9E37)', async () => {
      transport = createMockTransport({
        responses: { ...defaultResponses, ':MEAS:VPP? CHAN1': '9.9E37' },
      });
      driver = createRigolOscilloscope(transport);
      await driver.connect();
      const value = await driver.getMeasurement('CHAN1', 'VPP');
      expect(value).toBeNull();
    });

    it('should query multiple measurements', async () => {
      transport.reset();
      const values = await driver.getMeasurements('CHAN1', ['VPP', 'VAVG', 'FREQ']);
      expect(values.VPP).toBeCloseTo(3.28);
      expect(values.VAVG).toBeCloseTo(1.65);
      expect(values.FREQ).toBeCloseTo(1000);
    });

    it('should handle mixed valid/invalid measurements', async () => {
      transport = createMockTransport({
        responses: {
          ...defaultResponses,
          ':MEAS:VPP? CHAN1': '3.28E+00',
          ':MEAS:RISE? CHAN1': '****',
        },
      });
      driver = createRigolOscilloscope(transport);
      await driver.connect();
      const values = await driver.getMeasurements('CHAN1', ['VPP', 'RISE']);
      expect(values.VPP).toBeCloseTo(3.28);
      expect(values.RISE).toBeNull();
    });
  });

  describe('Waveform Acquisition', () => {
    beforeEach(async () => {
      await driver.connect();
    });

    it('should set waveform source channel', async () => {
      transport.reset();
      // Create binary response for waveform data (TMC block format)
      const waveformData = createMockWaveformData(100);
      transport.binaryResponses[':WAV:DATA?'] = waveformData;

      await driver.getWaveform('CHAN1');
      expect(transport.sentCommands).toContain(':WAV:SOUR CHAN1');
    });

    it('should set waveform mode to NORM', async () => {
      transport.reset();
      const waveformData = createMockWaveformData(100);
      transport.binaryResponses[':WAV:DATA?'] = waveformData;

      await driver.getWaveform('CHAN1');
      expect(transport.sentCommands).toContain(':WAV:MODE NORM');
    });

    it('should set waveform format to BYTE', async () => {
      transport.reset();
      const waveformData = createMockWaveformData(100);
      transport.binaryResponses[':WAV:DATA?'] = waveformData;

      await driver.getWaveform('CHAN1');
      expect(transport.sentCommands).toContain(':WAV:FORM BYTE');
    });

    it('should query waveform preamble', async () => {
      transport.reset();
      const waveformData = createMockWaveformData(100);
      transport.binaryResponses[':WAV:DATA?'] = waveformData;

      await driver.getWaveform('CHAN1');
      expect(transport.sentCommands).toContain(':WAV:PRE?');
    });

    it('should return waveform data with scaling info', async () => {
      const waveformData = createMockWaveformData(100);
      transport.binaryResponses[':WAV:DATA?'] = waveformData;

      const result = await driver.getWaveform('CHAN1');
      expect(result.channel).toBe('CHAN1');
      expect(result.points.length).toBeGreaterThan(0);
      expect(typeof result.xIncrement).toBe('number');
      expect(typeof result.yIncrement).toBe('number');
    });

    it('should parse TMC block format header', async () => {
      // TMC format: #NXXXXXXXX...data...
      // #9000000100 = 9 digits, 100 bytes of data
      const waveformData = createMockWaveformData(100);
      transport.binaryResponses[':WAV:DATA?'] = waveformData;

      const result = await driver.getWaveform('CHAN1');
      expect(result.points.length).toBe(100);
    });

    it('should set start and count when provided', async () => {
      transport.reset();
      const waveformData = createMockWaveformData(500);
      transport.binaryResponses[':WAV:DATA?'] = waveformData;

      await driver.getWaveform('CHAN1', 100, 500);
      expect(transport.sentCommands).toContain(':WAV:STAR 100');
      expect(transport.sentCommands).toContain(':WAV:STOP 599');
    });
  });

  describe('Screenshot', () => {
    beforeEach(async () => {
      await driver.connect();
    });

    it('should query screenshot data', async () => {
      transport.reset();
      // Create a mock PNG buffer
      const pngData = createMockPngData();
      transport.binaryResponses[':DISP:DATA? ON,OFF,PNG'] = pngData;

      await driver.getScreenshot();
      expect(transport.sentCommands).toContain(':DISP:DATA? ON,OFF,PNG');
    });

    it('should return PNG buffer', async () => {
      const pngData = createMockPngData();
      transport.binaryResponses[':DISP:DATA? ON,OFF,PNG'] = pngData;

      const result = await driver.getScreenshot();
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });
  });
});

// Helper functions for creating mock binary data

function createMockWaveformData(numPoints: number): Buffer {
  // TMC block format: #NXXXXXXXX...data...
  // N = number of digits in length field
  // XXXXXXXX = length in ASCII digits
  const dataLength = numPoints;
  const lengthStr = dataLength.toString();
  const numDigits = lengthStr.length;

  // Build header: #N + length + data
  const header = Buffer.from(`#${numDigits}${lengthStr}`);
  const data = Buffer.alloc(numPoints);

  // Fill with sample waveform data (sine-ish pattern around 128)
  for (let i = 0; i < numPoints; i++) {
    data[i] = Math.floor(128 + 50 * Math.sin((i / numPoints) * 2 * Math.PI));
  }

  return Buffer.concat([header, data]);
}

function createMockPngData(): Buffer {
  // Minimal PNG header + some data
  const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const fakeImageData = Buffer.alloc(1000);
  return Buffer.concat([pngSignature, fakeImageData]);
}
