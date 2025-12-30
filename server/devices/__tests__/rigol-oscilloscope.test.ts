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
    it('should return Ok for DS1054Z', async () => {
      await transport.open();
      const result = await driver.probe();
      expect(result.ok).toBe(true);
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

    it('should return Ok for DS2072A', async () => {
      transport = createMockTransport({
        responses: {
          '*IDN?': 'RIGOL TECHNOLOGIES,DS2072A,DS2D123456789,00.03.02',
        },
      });
      driver = createRigolOscilloscope(transport);
      await transport.open();
      const result = await driver.probe();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.model).toBe('DS2072A');
      }
    });

    it('should return Ok for MSO5074', async () => {
      transport = createMockTransport({
        responses: {
          '*IDN?': 'RIGOL TECHNOLOGIES,MSO5074,MS5A123456789,00.01.02.03',
        },
      });
      driver = createRigolOscilloscope(transport);
      await transport.open();
      const result = await driver.probe();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.model).toBe('MSO5074');
      }
    });

    it('should return Err for non-oscilloscope Rigol device (DL3021)', async () => {
      transport = createMockTransport({
        responses: {
          '*IDN?': 'RIGOL TECHNOLOGIES,DL3021,DL3A123456789,00.01.02.03.04',
        },
      });
      driver = createRigolOscilloscope(transport);
      await transport.open();
      const result = await driver.probe();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reason).toBe('wrong_device');
      }
    });

    it('should return Err for non-Rigol device', async () => {
      transport = createMockTransport({
        responses: {
          '*IDN?': 'KEYSIGHT TECHNOLOGIES,DSOX1102G,MY12345678,01.20.0000',
        },
      });
      driver = createRigolOscilloscope(transport);
      await transport.open();
      const result = await driver.probe();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reason).toBe('wrong_device');
      }
    });

    it('should return Err on timeout/error', async () => {
      transport = createMockTransport({
        responses: {},  // No response configured
      });
      driver = createRigolOscilloscope(transport);
      await transport.open();
      const result = await driver.probe();
      expect(result.ok).toBe(false);
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

    it('should return running state based on trigger status', async () => {
      const result = await driver.getStatus();
      expect(result.ok).toBe(true);
      if (result.ok) {
        // TD (triggered) means running
        expect(result.value.running).toBe(true);
      }
    });

    it('should parse trigger status', async () => {
      const result = await driver.getStatus();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.triggerStatus).toBe('triggered');
      }
    });

    it('should parse WAIT trigger status', async () => {
      transport = createMockTransport({
        responses: { ...defaultResponses, ':TRIG:STAT?': 'WAIT' },
      });
      driver = createRigolOscilloscope(transport);
      await driver.connect();
      const result = await driver.getStatus();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.triggerStatus).toBe('wait');
      }
    });

    it('should parse STOP trigger status', async () => {
      transport = createMockTransport({
        responses: { ...defaultResponses, ':TRIG:STAT?': 'STOP' },
      });
      driver = createRigolOscilloscope(transport);
      await driver.connect();
      const result = await driver.getStatus();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.triggerStatus).toBe('stopped');
        expect(result.value.running).toBe(false);
      }
    });

    it('should parse AUTO trigger status', async () => {
      transport = createMockTransport({
        responses: { ...defaultResponses, ':TRIG:STAT?': 'AUTO' },
      });
      driver = createRigolOscilloscope(transport);
      await driver.connect();
      const result = await driver.getStatus();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.triggerStatus).toBe('auto');
      }
    });

    it('should parse sample rate', async () => {
      const result = await driver.getStatus();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sampleRate).toBe(1e9);
      }
    });

    it('should parse memory depth', async () => {
      const result = await driver.getStatus();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.memoryDepth).toBe(12000000);
      }
    });

    it('should parse channel enabled state', async () => {
      const result = await driver.getStatus();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.channels['CHAN1'].enabled).toBe(true);
        expect(result.value.channels['CHAN2'].enabled).toBe(false);
      }
    });

    it('should parse channel scale', async () => {
      const result = await driver.getStatus();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.channels['CHAN1'].scale).toBe(1.0);
      }
    });

    it('should parse channel offset', async () => {
      const result = await driver.getStatus();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.channels['CHAN1'].offset).toBe(0);
      }
    });

    it('should parse channel coupling', async () => {
      const result = await driver.getStatus();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.channels['CHAN1'].coupling).toBe('DC');
      }
    });

    it('should parse channel probe ratio', async () => {
      const result = await driver.getStatus();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.channels['CHAN1'].probe).toBe(10);
      }
    });

    it('should parse timebase scale', async () => {
      const result = await driver.getStatus();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.timebase.scale).toBe(0.001);  // 1ms/div
      }
    });

    it('should parse timebase offset', async () => {
      const result = await driver.getStatus();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.timebase.offset).toBe(0);
      }
    });

    it('should parse trigger source', async () => {
      const result = await driver.getStatus();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.trigger.source).toBe('CHAN1');
      }
    });

    it('should parse trigger level', async () => {
      const result = await driver.getStatus();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.trigger.level).toBe(1.5);
      }
    });

    it('should parse trigger edge (rising)', async () => {
      const result = await driver.getStatus();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.trigger.edge).toBe('rising');
      }
    });

    it('should parse trigger edge (falling)', async () => {
      transport = createMockTransport({
        responses: { ...defaultResponses, ':TRIG:EDG:SLOP?': 'NEG' },
      });
      driver = createRigolOscilloscope(transport);
      await driver.connect();
      const result = await driver.getStatus();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.trigger.edge).toBe('falling');
      }
    });

    it('should parse trigger sweep mode', async () => {
      const result = await driver.getStatus();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.trigger.sweep).toBe('auto');
      }
    });
  });

  describe('Control Commands', () => {
    beforeEach(async () => {
      await driver.connect();
    });

    it('should send :RUN command', async () => {
      transport.reset();
      const result = await driver.run();
      expect(result.ok).toBe(true);
      expect(transport.sentCommands).toContain(':RUN');
    });

    it('should send :STOP command', async () => {
      transport.reset();
      const result = await driver.stop();
      expect(result.ok).toBe(true);
      expect(transport.sentCommands).toContain(':STOP');
    });

    it('should send :SING command', async () => {
      transport.reset();
      const result = await driver.single();
      expect(result.ok).toBe(true);
      expect(transport.sentCommands).toContain(':SING');
    });

    it('should send :AUT command for auto setup', async () => {
      transport.reset();
      const result = await driver.autoSetup();
      expect(result.ok).toBe(true);
      expect(transport.sentCommands).toContain(':AUT');
    });

    it('should send :TFOR command for force trigger', async () => {
      transport.reset();
      const result = await driver.forceTrigger();
      expect(result.ok).toBe(true);
      expect(transport.sentCommands).toContain(':TFOR');
    });
  });

  describe('Channel Configuration', () => {
    beforeEach(async () => {
      await driver.connect();
    });

    it('should enable channel', async () => {
      transport.reset();
      const result = await driver.setChannelEnabled('CHAN1', true);
      expect(result.ok).toBe(true);
      expect(transport.sentCommands).toContain(':CHAN1:DISP ON');
    });

    it('should disable channel', async () => {
      transport.reset();
      const result = await driver.setChannelEnabled('CHAN2', false);
      expect(result.ok).toBe(true);
      expect(transport.sentCommands).toContain(':CHAN2:DISP OFF');
    });

    it('should set channel scale', async () => {
      transport.reset();
      const result = await driver.setChannelScale('CHAN1', 0.5);
      expect(result.ok).toBe(true);
      expect(transport.sentCommands).toContain(':CHAN1:SCAL 0.5');
    });

    it('should set channel offset', async () => {
      transport.reset();
      const result = await driver.setChannelOffset('CHAN1', -2.5);
      expect(result.ok).toBe(true);
      expect(transport.sentCommands).toContain(':CHAN1:OFFS -2.5');
    });

    it('should set channel coupling', async () => {
      transport.reset();
      const result = await driver.setChannelCoupling('CHAN1', 'AC');
      expect(result.ok).toBe(true);
      expect(transport.sentCommands).toContain(':CHAN1:COUP AC');
    });

    it('should set channel probe ratio', async () => {
      transport.reset();
      const result = await driver.setChannelProbe('CHAN1', 100);
      expect(result.ok).toBe(true);
      expect(transport.sentCommands).toContain(':CHAN1:PROB 100');
    });
  });

  describe('Timebase Configuration', () => {
    beforeEach(async () => {
      await driver.connect();
    });

    it('should set timebase scale', async () => {
      transport.reset();
      const result = await driver.setTimebaseScale(0.001);  // 1ms/div
      expect(result.ok).toBe(true);
      expect(transport.sentCommands).toContain(':TIM:SCAL 0.001');
    });

    it('should set timebase offset', async () => {
      transport.reset();
      const result = await driver.setTimebaseOffset(0.005);  // 5ms offset
      expect(result.ok).toBe(true);
      expect(transport.sentCommands).toContain(':TIM:OFFS 0.005');
    });
  });

  describe('Trigger Configuration', () => {
    beforeEach(async () => {
      await driver.connect();
    });

    it('should set trigger source', async () => {
      transport.reset();
      const result = await driver.setTriggerSource('CHAN2');
      expect(result.ok).toBe(true);
      expect(transport.sentCommands).toContain(':TRIG:EDG:SOUR CHAN2');
    });

    it('should set trigger level', async () => {
      transport.reset();
      const result = await driver.setTriggerLevel(2.5);
      expect(result.ok).toBe(true);
      expect(transport.sentCommands).toContain(':TRIG:EDG:LEV 2.5');
    });

    it('should set trigger edge to rising', async () => {
      transport.reset();
      const result = await driver.setTriggerEdge('rising');
      expect(result.ok).toBe(true);
      expect(transport.sentCommands).toContain(':TRIG:EDG:SLOP POS');
    });

    it('should set trigger edge to falling', async () => {
      transport.reset();
      const result = await driver.setTriggerEdge('falling');
      expect(result.ok).toBe(true);
      expect(transport.sentCommands).toContain(':TRIG:EDG:SLOP NEG');
    });

    it('should set trigger sweep mode', async () => {
      transport.reset();
      const result = await driver.setTriggerSweep('normal');
      expect(result.ok).toBe(true);
      expect(transport.sentCommands).toContain(':TRIG:SWE NORM');
    });

    it('should set trigger sweep to single', async () => {
      transport.reset();
      const result = await driver.setTriggerSweep('single');
      expect(result.ok).toBe(true);
      expect(transport.sentCommands).toContain(':TRIG:SWE SING');
    });
  });

  describe('Measurements (Stateless Queries)', () => {
    beforeEach(async () => {
      await driver.connect();
    });

    it('should query VPP measurement', async () => {
      transport.reset();
      const result = await driver.getMeasurement('CHAN1', 'VPP');
      expect(transport.sentCommands).toContain(':MEAS:VPP? CHAN1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeCloseTo(3.28);
      }
    });

    it('should query VAVG measurement', async () => {
      transport.reset();
      const result = await driver.getMeasurement('CHAN1', 'VAVG');
      expect(transport.sentCommands).toContain(':MEAS:VAVG? CHAN1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeCloseTo(1.65);
      }
    });

    it('should query FREQ measurement', async () => {
      transport.reset();
      const result = await driver.getMeasurement('CHAN1', 'FREQ');
      expect(transport.sentCommands).toContain(':MEAS:FREQ? CHAN1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeCloseTo(1000);
      }
    });

    it('should return null for invalid measurement (****)', async () => {
      transport.reset();
      const result = await driver.getMeasurement('CHAN2', 'VPP');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('should return null for overflow measurement (9.9E37)', async () => {
      transport = createMockTransport({
        responses: { ...defaultResponses, ':MEAS:VPP? CHAN1': '9.9E37' },
      });
      driver = createRigolOscilloscope(transport);
      await driver.connect();
      const result = await driver.getMeasurement('CHAN1', 'VPP');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('should query multiple measurements', async () => {
      transport.reset();
      const result = await driver.getMeasurements('CHAN1', ['VPP', 'VAVG', 'FREQ']);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.VPP).toBeCloseTo(3.28);
        expect(result.value.VAVG).toBeCloseTo(1.65);
        expect(result.value.FREQ).toBeCloseTo(1000);
      }
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
      const result = await driver.getMeasurements('CHAN1', ['VPP', 'RISE']);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.VPP).toBeCloseTo(3.28);
        expect(result.value.RISE).toBeNull();
      }
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
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.channel).toBe('CHAN1');
        expect(result.value.points.length).toBeGreaterThan(0);
        expect(typeof result.value.xIncrement).toBe('number');
        expect(typeof result.value.yIncrement).toBe('number');
      }
    });

    it('should parse TMC block format header', async () => {
      // TMC format: #NXXXXXXXX...data...
      // #9000000100 = 9 digits, 100 bytes of data
      const waveformData = createMockWaveformData(100);
      transport.binaryResponses[':WAV:DATA?'] = waveformData;

      const result = await driver.getWaveform('CHAN1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.points.length).toBe(100);
      }
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
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(Buffer.isBuffer(result.value)).toBe(true);
        expect(result.value.length).toBeGreaterThan(0);
      }
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
