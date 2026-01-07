import { describe, it, expect, beforeEach } from 'vitest';
import { createOscilloscopeSimulator, type OscilloscopeSimulator } from '../../../../shared/simulation/oscilloscope-simulator.js';
import { createVirtualConnection, type VirtualConnection } from '../../../../shared/simulation/virtual-connection.js';
import { createPsuSimulator, type PsuSimulator } from '../../../../shared/simulation/psu-simulator.js';
import { createLoadSimulator, type LoadSimulator } from '../../../../shared/simulation/load-simulator.js';

describe('OscilloscopeSimulator', () => {
  let conn: VirtualConnection;
  let scope: OscilloscopeSimulator;
  let psu: PsuSimulator;
  let load: LoadSimulator;

  // Config with boost converter enabled for oscilloscope waveforms
  const boostConfig = {
    measurementStabilityPPM: 0,
    measurementNoiseFloorMv: 0,
    boostEnabled: true,
  };

  beforeEach(() => {
    conn = createVirtualConnection(boostConfig);
    scope = createOscilloscopeSimulator(conn, 'DS1ZA123456789');
    psu = createPsuSimulator(conn);
    load = createLoadSimulator(conn);
  });

  /**
   * Helper to set up an active boost converter circuit
   */
  function setupActiveCircuit() {
    psu.handleCommand('VOLT 12');
    psu.handleCommand('OUTP ON');
    load.handleCommand(':SOUR:INP:STAT ON');
    load.handleCommand(':SOUR:FUNC CURR');
    load.handleCommand(':SOUR:CURR:LEV 1.0');
  }

  describe('Identity', () => {
    it('should respond to *IDN? with device identification', () => {
      const response = scope.handleCommand('*IDN?');
      expect(response).toBe('RIGOL TECHNOLOGIES,DS1054Z,DS1ZA123456789,00.04.04.SP4');
    });

    it('should use custom serial number', () => {
      const customScope = createOscilloscopeSimulator(conn, 'CUSTOM001');
      const response = customScope.handleCommand('*IDN?');
      expect(response).toContain('CUSTOM001');
    });
  });

  describe('Channel Commands', () => {
    it('should query channel display state', () => {
      // All 4 channels enabled by default
      expect(scope.handleCommand(':CHAN1:DISP?')).toBe('1');
      expect(scope.handleCommand(':CHAN2:DISP?')).toBe('1');
      expect(scope.handleCommand(':CHAN3:DISP?')).toBe('1');
      expect(scope.handleCommand(':CHAN4:DISP?')).toBe('1');
    });

    it('should enable/disable channel display', () => {
      scope.handleCommand(':CHAN3:DISP ON');
      expect(scope.handleCommand(':CHAN3:DISP?')).toBe('1');

      scope.handleCommand(':CHAN3:DISP OFF');
      expect(scope.handleCommand(':CHAN3:DISP?')).toBe('0');

      scope.handleCommand(':CHAN4:DISP 1');
      expect(scope.handleCommand(':CHAN4:DISP?')).toBe('1');
    });

    it('should query and set channel scale', () => {
      expect(scope.handleCommand(':CHAN1:SCAL?')).toMatch(/2\.0+e\+0/i);  // 2V/div default

      scope.handleCommand(':CHAN1:SCAL 5');
      expect(parseFloat(scope.handleCommand(':CHAN1:SCAL?')!)).toBeCloseTo(5, 1);
    });

    it('should query and set channel offset', () => {
      expect(parseFloat(scope.handleCommand(':CHAN1:OFFS?')!)).toBe(0);

      scope.handleCommand(':CHAN1:OFFS 1.5');
      expect(parseFloat(scope.handleCommand(':CHAN1:OFFS?')!)).toBeCloseTo(1.5, 1);
    });

    it('should query and set channel coupling', () => {
      expect(scope.handleCommand(':CHAN1:COUP?')).toBe('DC');

      scope.handleCommand(':CHAN1:COUP AC');
      expect(scope.handleCommand(':CHAN1:COUP?')).toBe('AC');
    });

    it('should query and set probe attenuation', () => {
      expect(scope.handleCommand(':CHAN1:PROB?')).toBe('1');

      scope.handleCommand(':CHAN1:PROB 10');
      expect(scope.handleCommand(':CHAN1:PROB?')).toBe('10');
    });

    it('should query and set bandwidth limit', () => {
      expect(scope.handleCommand(':CHAN1:BWL?')).toBe('OFF');

      scope.handleCommand(':CHAN1:BWL ON');
      expect(scope.handleCommand(':CHAN1:BWL?')).toBe('ON');
    });

    it('should handle commands without leading colon', () => {
      expect(scope.handleCommand('CHAN1:DISP?')).toBe('1');
      scope.handleCommand('CHAN2:SCAL 3');
      expect(parseFloat(scope.handleCommand('CHAN2:SCAL?')!)).toBeCloseTo(3, 1);
    });

    it('should return 0 for invalid channel queries', () => {
      expect(scope.handleCommand(':CHAN9:DISP?')).toBe('0');
    });
  });

  describe('Timebase Commands', () => {
    it('should query and set timebase scale', () => {
      // Default is 1µs/div
      expect(parseFloat(scope.handleCommand(':TIM:SCAL?')!)).toBeCloseTo(1e-6, 9);

      scope.handleCommand(':TIM:SCAL 0.001');
      expect(parseFloat(scope.handleCommand(':TIM:SCAL?')!)).toBeCloseTo(1e-3, 6);
    });

    it('should query and set timebase offset', () => {
      expect(parseFloat(scope.handleCommand(':TIM:OFFS?')!)).toBe(0);

      scope.handleCommand(':TIM:OFFS 0.0001');
      expect(parseFloat(scope.handleCommand(':TIM:OFFS?')!)).toBeCloseTo(1e-4, 7);
    });

    it('should query and set timebase mode', () => {
      expect(scope.handleCommand(':TIM:MODE?')).toBe('MAIN');

      scope.handleCommand(':TIM:MODE ZOOM');
      expect(scope.handleCommand(':TIM:MODE?')).toBe('ZOOM');
    });

    it('should handle commands without leading colon', () => {
      scope.handleCommand('TIM:SCAL 0.01');
      expect(parseFloat(scope.handleCommand('TIM:SCAL?')!)).toBeCloseTo(0.01, 4);
    });
  });

  describe('Trigger Commands', () => {
    it('should query trigger mode', () => {
      expect(scope.handleCommand(':TRIG:MODE?')).toBe('EDGE');
    });

    it('should query trigger coupling', () => {
      expect(scope.handleCommand(':TRIG:COUP?')).toBe('DC');
    });

    it('should query and set trigger source', () => {
      expect(scope.handleCommand(':TRIG:EDG:SOUR?')).toBe('CHAN1');

      scope.handleCommand(':TRIG:EDG:SOUR CHAN2');
      expect(scope.handleCommand(':TRIG:EDG:SOUR?')).toBe('CHAN2');
    });

    it('should query and set trigger level', () => {
      expect(parseFloat(scope.handleCommand(':TRIG:EDG:LEV?')!)).toBeCloseTo(2.5, 1);

      scope.handleCommand(':TRIG:EDG:LEV 3.3');
      expect(parseFloat(scope.handleCommand(':TRIG:EDG:LEV?')!)).toBeCloseTo(3.3, 1);
    });

    it('should query and set trigger slope', () => {
      expect(scope.handleCommand(':TRIG:EDG:SLOP?')).toBe('POS');

      scope.handleCommand(':TRIG:EDG:SLOP NEG');
      expect(scope.handleCommand(':TRIG:EDG:SLOP?')).toBe('NEG');
    });

    it('should query and set trigger sweep', () => {
      expect(scope.handleCommand(':TRIG:SWE?')).toBe('AUTO');

      scope.handleCommand(':TRIG:SWE NORM');
      expect(scope.handleCommand(':TRIG:SWE?')).toBe('NORM');
    });

    it('should query trigger status', () => {
      const status = scope.handleCommand(':TRIG:STAT?');
      expect(['TD', 'WAIT', 'RUN', 'AUTO', 'STOP']).toContain(status);
    });
  });

  describe('Run Control Commands', () => {
    it('should handle RUN command', () => {
      scope.handleCommand(':STOP');
      expect(scope.handleCommand(':TRIG:STAT?')).toBe('STOP');

      scope.handleCommand(':RUN');
      expect(scope.handleCommand(':TRIG:STAT?')).toBe('AUTO');
    });

    it('should handle STOP command', () => {
      scope.handleCommand(':STOP');
      expect(scope.handleCommand(':TRIG:STAT?')).toBe('STOP');
    });

    it('should handle SING (single) command', () => {
      scope.handleCommand(':SING');
      expect(scope.handleCommand(':TRIG:STAT?')).toBe('WAIT');
    });

    it('should handle TFOR (force trigger) command', () => {
      scope.handleCommand(':TFOR');
      expect(scope.handleCommand(':TRIG:STAT?')).toBe('TD');
    });

    it('should handle commands without leading colon', () => {
      scope.handleCommand('RUN');
      expect(scope.handleCommand('TRIG:STAT?')).toBe('AUTO');
    });
  });

  describe('Acquisition Commands', () => {
    it('should query sample rate', () => {
      const response = scope.handleCommand(':ACQ:SRAT?');
      expect(parseFloat(response!)).toBe(1e9);  // 1 GSa/s
    });

    it('should query memory depth', () => {
      const response = scope.handleCommand(':ACQ:MDEP?');
      expect(parseInt(response!, 10)).toBe(12000);
    });
  });

  describe('Measurement Commands', () => {
    beforeEach(() => {
      setupActiveCircuit();
    });

    it('should measure VPP on PWM channel', () => {
      const response = scope.handleCommand(':MEAS:VPP? CHAN1');
      const vpp = parseFloat(response!);
      // PWM signal should have ~5V peak-to-peak
      expect(vpp).toBeGreaterThan(4);
      expect(vpp).toBeLessThan(6);
    });

    it('should measure VMAX on output voltage channel', () => {
      const response = scope.handleCommand(':MEAS:VMAX? CHAN3');
      const vmax = parseFloat(response!);
      // Output voltage should be around 24V
      expect(vmax).toBeGreaterThan(20);
      expect(vmax).toBeLessThan(30);
    });

    it('should measure frequency', () => {
      const response = scope.handleCommand(':MEAS:FREQ? CHAN1');
      const freq = parseFloat(response!);
      // Switching frequency should be 200kHz
      expect(freq).toBeCloseTo(200000, -3);
    });

    it('should measure period', () => {
      const response = scope.handleCommand(':MEAS:PER? CHAN1');
      const period = parseFloat(response!);
      // Period should be 5µs for 200kHz
      expect(period).toBeCloseTo(5e-6, 9);
    });

    it('should measure duty cycle', () => {
      const response = scope.handleCommand(':MEAS:PDUT? CHAN1');
      const duty = parseFloat(response!);
      // Duty cycle should be around 50% for 12V->24V boost
      expect(duty).toBeGreaterThan(40);
      expect(duty).toBeLessThan(60);
    });

    it('should return 9.9E37 for invalid measurement', () => {
      const response = scope.handleCommand(':MEAS:INVALID? CHAN1');
      expect(response).toBe('9.9E37');
    });

    it('should use current waveform source if channel not specified', () => {
      scope.handleCommand(':WAV:SOUR CHAN3');
      const response = scope.handleCommand(':MEAS:VPP?');
      // Should measure CH3 (output voltage) ripple
      expect(parseFloat(response!)).toBeLessThan(5);  // Ripple, not full swing
    });
  });

  describe('Waveform Setup Commands', () => {
    it('should set waveform source', () => {
      const result = scope.handleCommand(':WAV:SOUR CHAN2');
      expect(result).toBeNull();  // Write command returns null
    });

    it('should set waveform mode', () => {
      const result = scope.handleCommand(':WAV:MODE RAW');
      expect(result).toBeNull();
    });

    it('should set waveform format', () => {
      const result = scope.handleCommand(':WAV:FORM BYTE');
      expect(result).toBeNull();
    });

    it('should set and clamp waveform start', () => {
      scope.handleCommand(':WAV:STAR 100');
      // Can't query directly, but we can verify via preamble points
      scope.handleCommand(':WAV:STOP 200');
      const pre = scope.handleCommand(':WAV:PRE?');
      const points = parseInt(pre!.split(',')[2], 10);
      expect(points).toBe(101);  // 200 - 100 + 1
    });

    it('should clamp start to minimum of 1', () => {
      scope.handleCommand(':WAV:STAR 0');
      scope.handleCommand(':WAV:STOP 100');
      const pre = scope.handleCommand(':WAV:PRE?');
      const points = parseInt(pre!.split(',')[2], 10);
      expect(points).toBe(100);  // 100 - 1 + 1
    });

    it('should clamp stop to be >= start', () => {
      scope.handleCommand(':WAV:STAR 500');
      scope.handleCommand(':WAV:STOP 100');  // Less than start
      const pre = scope.handleCommand(':WAV:PRE?');
      const points = parseInt(pre!.split(',')[2], 10);
      expect(points).toBe(1);  // stop clamped to start
    });
  });

  describe('Waveform Preamble', () => {
    it('should return preamble with correct format', () => {
      const pre = scope.handleCommand(':WAV:PRE?');
      expect(pre).not.toBeNull();

      const parts = pre!.split(',');
      expect(parts.length).toBe(8);

      // Format: format, type, points, count, xincrement, xorigin, xref, yincrement
      expect(parseInt(parts[0], 10)).toBe(0);  // BYTE format
      expect(parseInt(parts[1], 10)).toBe(0);  // NORMAL type
      expect(parseInt(parts[2], 10)).toBeGreaterThan(0);  // points
      expect(parseInt(parts[3], 10)).toBe(1);  // count
    });

    it('should have consistent yIncrement with voltage-to-byte conversion', () => {
      scope.handleCommand(':CHAN1:SCAL 2');  // 2V/div
      const pre = scope.handleCommand(':WAV:PRE?');
      const yIncrement = parseFloat(pre!.split(',')[7]);

      // yIncrement should be scale/32 for 8 divisions over 256 levels
      expect(yIncrement).toBeCloseTo(2 / 32, 4);
    });

    it('should update points based on start/stop', () => {
      scope.handleCommand(':WAV:STAR 1');
      scope.handleCommand(':WAV:STOP 1000');
      const pre = scope.handleCommand(':WAV:PRE?');
      const points = parseInt(pre!.split(',')[2], 10);
      expect(points).toBe(1000);
    });
  });

  describe('Waveform Y Reference', () => {
    it('should return Y reference of 127 (center of 8-bit range)', () => {
      const yref = scope.handleCommand(':WAV:YREF?');
      expect(yref).toBe('127');
    });

    it('should calculate Y origin based on offset', () => {
      scope.handleCommand(':CHAN1:SCAL 2');
      scope.handleCommand(':CHAN1:OFFS 0');
      scope.handleCommand(':WAV:SOUR CHAN1');

      const yor = parseInt(scope.handleCommand(':WAV:YOR?')!, 10);
      expect(yor).toBe(0);  // No offset = 0

      scope.handleCommand(':CHAN1:OFFS 4');  // 4V offset
      const yor2 = parseInt(scope.handleCommand(':WAV:YOR?')!, 10);
      // offset / yIncrement = 4 / (2/32) = 64
      expect(yor2).toBe(64);
    });
  });

  describe('Binary Waveform Data', () => {
    beforeEach(() => {
      setupActiveCircuit();
    });

    it('should return TMC block format for waveform data', () => {
      scope.handleCommand(':WAV:SOUR CHAN1');
      scope.handleCommand(':WAV:STAR 1');
      scope.handleCommand(':WAV:STOP 100');

      const data = scope.handleBinaryCommand(':WAV:DATA?');
      expect(data).not.toBeNull();

      // Check TMC block header format: #<digit><length><data>
      const header = data!.toString('ascii', 0, 5);
      expect(header[0]).toBe('#');
      expect(parseInt(header[1], 10)).toBeGreaterThan(0);
    });

    it('should return correct number of data bytes', () => {
      scope.handleCommand(':WAV:SOUR CHAN1');
      scope.handleCommand(':WAV:STAR 1');
      scope.handleCommand(':WAV:STOP 100');

      const data = scope.handleBinaryCommand(':WAV:DATA?');
      expect(data).not.toBeNull();

      // Parse TMC block header to get length
      const numDigits = parseInt(data!.toString('ascii', 1, 2), 10);
      const dataLen = parseInt(data!.toString('ascii', 2, 2 + numDigits), 10);

      expect(dataLen).toBe(100);
      expect(data!.length).toBe(2 + numDigits + dataLen);
    });

    it('should return byte values within 0-255 range', () => {
      scope.handleCommand(':WAV:SOUR CHAN1');
      scope.handleCommand(':WAV:STAR 1');
      scope.handleCommand(':WAV:STOP 100');

      const data = scope.handleBinaryCommand(':WAV:DATA?');
      const numDigits = parseInt(data!.toString('ascii', 1, 2), 10);
      const headerLen = 2 + numDigits;

      for (let i = headerLen; i < data!.length; i++) {
        expect(data![i]).toBeGreaterThanOrEqual(0);
        expect(data![i]).toBeLessThanOrEqual(255);
      }
    });

    it('should generate different waveforms for different channels', () => {
      scope.handleCommand(':WAV:STAR 1');
      scope.handleCommand(':WAV:STOP 100');

      scope.handleCommand(':WAV:SOUR CHAN1');
      const ch1Data = scope.handleBinaryCommand(':WAV:DATA?');

      scope.handleCommand(':WAV:SOUR CHAN3');
      const ch3Data = scope.handleBinaryCommand(':WAV:DATA?');

      // Data should be different (CH1 is PWM, CH3 is output voltage)
      expect(ch1Data).not.toEqual(ch3Data);
    });

    it('should return null for non-waveform binary commands', () => {
      const data = scope.handleBinaryCommand(':UNKNOWN:CMD?');
      expect(data).toBeNull();
    });
  });

  describe('Auto Setup', () => {
    it('should not crash with inactive boost converter', () => {
      // Don't set up circuit - boost converter is inactive
      expect(() => scope.handleCommand(':AUT')).not.toThrow();
    });

    it('should adjust scales with active boost converter', () => {
      setupActiveCircuit();
      scope.handleCommand(':AUT');

      // CH1 should be 2V/div for PWM
      expect(parseFloat(scope.handleCommand(':CHAN1:SCAL?')!)).toBe(2);

      // CH2/CH3 should be adjusted for output voltage
      expect(parseFloat(scope.handleCommand(':CHAN2:SCAL?')!)).toBeGreaterThan(0);
    });

    it('should handle zero output voltage gracefully', () => {
      // PSU on but no load - very low output
      psu.handleCommand('VOLT 0');
      psu.handleCommand('OUTP ON');

      expect(() => scope.handleCommand(':AUT')).not.toThrow();
    });
  });

  describe('Waveform Physics', () => {
    beforeEach(() => {
      setupActiveCircuit();
      scope.handleCommand(':WAV:STAR 1');
      scope.handleCommand(':WAV:STOP 1000');
    });

    it('should generate PWM signal with correct amplitude on CH1', () => {
      scope.handleCommand(':WAV:SOUR CHAN1');
      const vpp = parseFloat(scope.handleCommand(':MEAS:VPP? CHAN1')!);
      // PWM should be 0-5V
      expect(vpp).toBeGreaterThan(4.5);
      expect(vpp).toBeLessThan(5.5);
    });

    it('should generate switching node voltage on CH2', () => {
      const vmax = parseFloat(scope.handleCommand(':MEAS:VMAX? CHAN2')!);
      const vmin = parseFloat(scope.handleCommand(':MEAS:VMIN? CHAN2')!);

      // Switching node: 0V (on) to ~Vout+0.7V (off)
      expect(vmin).toBeCloseTo(0, 0);
      expect(vmax).toBeGreaterThan(20);  // Should reach Vout + diode drop
    });

    it('should generate output voltage with ripple on CH3', () => {
      const vmax = parseFloat(scope.handleCommand(':MEAS:VMAX? CHAN3')!);
      const vmin = parseFloat(scope.handleCommand(':MEAS:VMIN? CHAN3')!);
      const vpp = vmax - vmin;

      // Output should be ~24V with small ripple
      expect((vmax + vmin) / 2).toBeCloseTo(24, 0);
      expect(vpp).toBeLessThan(2);  // Ripple should be small
    });

    it('should generate inductor current triangle wave on CH4', () => {
      // CH4 shows current as voltage (0.1V/A sense gain)
      const vpp = parseFloat(scope.handleCommand(':MEAS:VPP? CHAN4')!);

      // Should have some ripple representing inductor current variation
      expect(vpp).toBeGreaterThan(0);
    });

    it('should return zero waveforms when boost converter inactive', () => {
      // Create a new connection without active circuit
      const inactiveConn = createVirtualConnection(boostConfig);
      const inactiveScope = createOscilloscopeSimulator(inactiveConn);

      inactiveScope.handleCommand(':WAV:SOUR CHAN1');
      const vmax = parseFloat(inactiveScope.handleCommand(':MEAS:VMAX? CHAN1')!);

      // With no active circuit, waveform should be near zero (just noise)
      expect(Math.abs(vmax)).toBeLessThan(0.1);
    });
  });

  describe('Unknown Commands', () => {
    it('should return empty string for unknown commands', () => {
      const response = scope.handleCommand(':UNKNOWN:CMD?');
      expect(response).toBe('');
    });

    it('should return null for write commands', () => {
      expect(scope.handleCommand(':CHAN1:SCAL 5')).toBeNull();
      expect(scope.handleCommand(':TIM:SCAL 0.001')).toBeNull();
      expect(scope.handleCommand(':RUN')).toBeNull();
    });
  });

  describe('Screenshot', () => {
    it('should return minimal response for display data', () => {
      const data = scope.handleBinaryCommand(':DISP:DATA?');
      expect(data).not.toBeNull();
      // Just verify it returns something (minimal TMC block)
      expect(data!.length).toBeGreaterThan(0);
    });
  });
});
