/**
 * Rigol DS1000Z/DS2000/MSO5000 Series Oscilloscope Driver
 * Implements the OscilloscopeDriver interface
 */

import type {
  OscilloscopeDriver,
  OscilloscopeInfo,
  Transport,
  OscilloscopeCapabilities,
  OscilloscopeStatus,
  WaveformData,
  ChannelConfig,
  TriggerStatus,
} from '../types.js';

// Map trigger edge settings
const EDGE_MAP: Record<string, string> = {
  rising: 'POS',
  falling: 'NEG',
  either: 'RFAL',
};

const EDGE_REVERSE_MAP: Record<string, 'rising' | 'falling' | 'either'> = {
  POS: 'rising',
  NEG: 'falling',
  RFAL: 'either',
};

// Map trigger sweep modes
const SWEEP_MAP: Record<string, string> = {
  auto: 'AUTO',
  normal: 'NORM',
  single: 'SING',
};

// Map trigger status from device to our type
const TRIGGER_STATUS_MAP: Record<string, TriggerStatus> = {
  TD: 'triggered',
  WAIT: 'wait',
  RUN: 'armed',
  AUTO: 'auto',
  STOP: 'stopped',
};

export function createRigolOscilloscope(transport: Transport): OscilloscopeDriver {
  const info: OscilloscopeInfo = {
    id: '',
    type: 'oscilloscope',
    manufacturer: 'Rigol',
    model: '',
  };

  const capabilities: OscilloscopeCapabilities = {
    channels: 4,           // Default, updated after probe
    bandwidth: 50,         // MHz, updated after probe
    maxSampleRate: 1e9,    // 1 GSa/s default
    maxMemoryDepth: 12e6,  // 12M default
    supportedMeasurements: [
      'VPP', 'VMAX', 'VMIN', 'VAMP', 'VTOP', 'VBAS', 'VAVG', 'VRMS',
      'OVER', 'PRES', 'MAR', 'MPAR', 'PER', 'FREQ',
      'RTIM', 'FTIM', 'PWID', 'NWID', 'PDUT', 'NDUT',
      'RISE', 'FALL', 'RDEL', 'FDEL', 'RPH', 'FPH',
    ],
    hasAWG: false,
  };

  // Helper to parse SCPI boolean responses
  function parseBool(response: string): boolean {
    const val = response.trim();
    return val === '1' || val.toUpperCase() === 'ON';
  }

  // Helper to parse SCPI numeric responses
  function parseNumber(response: string, defaultValue = 0): number {
    const trimmed = response.trim();
    // Handle "AUTO" and other non-numeric responses
    if (isNaN(parseFloat(trimmed))) {
      return defaultValue;
    }
    return parseFloat(trimmed);
  }

  // Parse TMC block format: #NXXXXXXXX...data...
  function parseTmcBlock(buffer: Buffer): Buffer {
    if (buffer.length < 2 || buffer[0] !== 0x23) {  // '#'
      throw new Error('Invalid TMC block format: missing header');
    }

    const numDigits = parseInt(String.fromCharCode(buffer[1]), 10);
    if (isNaN(numDigits) || numDigits < 1 || numDigits > 9) {
      throw new Error('Invalid TMC block format: invalid digit count');
    }

    const lengthStr = buffer.slice(2, 2 + numDigits).toString('ascii');
    const dataLength = parseInt(lengthStr, 10);
    if (isNaN(dataLength)) {
      throw new Error('Invalid TMC block format: invalid length');
    }

    const dataStart = 2 + numDigits;
    return buffer.slice(dataStart, dataStart + dataLength);
  }

  return {
    info,
    capabilities,

    async probe(): Promise<boolean> {
      try {
        const response = await transport.query('*IDN?');
        if (!response.includes('RIGOL')) {
          return false;
        }

        // Parse IDN response: RIGOL TECHNOLOGIES,MODEL,SERIAL,VERSION
        const parts = response.split(',');
        if (parts.length < 3) {
          return false;
        }

        const model = parts[1].trim();
        const serial = parts[2].trim();

        // Check if it's an oscilloscope (DS or MSO prefix)
        if (!model.startsWith('DS') && !model.startsWith('MSO')) {
          return false;
        }

        info.model = model;
        info.serial = serial;
        info.id = `rigol-${model.toLowerCase()}-${serial}`;

        // Update capabilities based on model
        if (model.includes('1054') || model.includes('1104')) {
          capabilities.channels = 4;
          capabilities.bandwidth = model.includes('1104') ? 100 : 50;
        } else if (model.includes('1102') || model.includes('1052')) {
          capabilities.channels = 2;
          capabilities.bandwidth = model.includes('1102') ? 100 : 50;
        } else if (model.startsWith('DS2')) {
          // DS2000 series
          capabilities.channels = 2;
          const bwMatch = model.match(/(\d+)A?$/);
          if (bwMatch) {
            capabilities.bandwidth = parseInt(bwMatch[1], 10);
          }
        } else if (model.startsWith('MSO5')) {
          // MSO5000 series
          capabilities.channels = 4;
          const bwMatch = model.match(/50(\d+)/);
          if (bwMatch) {
            capabilities.bandwidth = parseInt(bwMatch[1], 10);
          }
          capabilities.hasAWG = true;
        }

        return true;
      } catch {
        return false;
      }
    },

    async connect(): Promise<void> {
      await transport.open();
    },

    async disconnect(): Promise<void> {
      await transport.close();
    },

    async getStatus(): Promise<OscilloscopeStatus> {
      // Query trigger status
      const trigStatResp = await transport.query(':TRIG:STAT?');
      const trigStat = trigStatResp.trim().toUpperCase();
      const triggerStatus = TRIGGER_STATUS_MAP[trigStat] || 'stopped';
      const running = triggerStatus !== 'stopped';

      // Query sample rate and memory depth
      const sampleRateResp = await transport.query(':ACQ:SRAT?');
      const sampleRate = parseNumber(sampleRateResp);

      const memDepthResp = await transport.query(':ACQ:MDEP?');
      const memoryDepth = parseNumber(memDepthResp);

      // Query channel configurations
      const channels: Record<string, ChannelConfig> = {};
      for (let i = 1; i <= capabilities.channels; i++) {
        const ch = `CHAN${i}`;
        const enabled = parseBool(await transport.query(`:${ch}:DISP?`));
        const scale = parseNumber(await transport.query(`:${ch}:SCAL?`));
        const offset = parseNumber(await transport.query(`:${ch}:OFFS?`));
        const couplingResp = (await transport.query(`:${ch}:COUP?`)).trim().toUpperCase();
        const coupling = couplingResp as 'AC' | 'DC' | 'GND';
        const probe = parseNumber(await transport.query(`:${ch}:PROB?`));
        const bwlResp = await transport.query(`:${ch}:BWL?`);
        const bwLimit = parseBool(bwlResp);

        channels[ch] = {
          enabled,
          scale,
          offset,
          coupling,
          probe,
          bwLimit,
        };
      }

      // Query timebase
      const timScale = parseNumber(await transport.query(':TIM:SCAL?'));
      const timOffs = parseNumber(await transport.query(':TIM:OFFS?'));
      const timModeResp = (await transport.query(':TIM:MODE?')).trim().toUpperCase();
      const timebaseMode = timModeResp === 'ROLL' ? 'roll' : timModeResp === 'ZOOM' ? 'zoom' : 'main';

      // Query trigger settings
      const trigModeResp = (await transport.query(':TRIG:MODE?')).trim().toUpperCase();
      const trigCoupResp = (await transport.query(':TRIG:COUP?')).trim().toUpperCase();
      const trigSrc = (await transport.query(':TRIG:EDG:SOUR?')).trim();
      const trigLev = parseNumber(await transport.query(':TRIG:EDG:LEV?'));
      const trigSlopResp = (await transport.query(':TRIG:EDG:SLOP?')).trim().toUpperCase();
      const trigSweepResp = (await transport.query(':TRIG:SWE?')).trim().toUpperCase();

      // Map trigger mode
      const trigMode = trigModeResp.toLowerCase() as 'edge' | 'pulse' | 'slope' | 'video';

      // Map trigger coupling
      const trigCoupling = trigCoupResp as 'AC' | 'DC' | 'LFReject' | 'HFReject';

      // Map trigger edge
      const trigEdge = EDGE_REVERSE_MAP[trigSlopResp] || 'rising';

      // Map trigger sweep
      const trigSweep = (trigSweepResp === 'NORM' ? 'normal' : trigSweepResp === 'SING' ? 'single' : 'auto') as 'auto' | 'normal' | 'single';

      return {
        running,
        triggerStatus,
        sampleRate,
        memoryDepth,
        channels,
        timebase: {
          scale: timScale,
          offset: timOffs,
          mode: timebaseMode,
        },
        trigger: {
          source: trigSrc,
          mode: trigMode,
          coupling: trigCoupling,
          level: trigLev,
          edge: trigEdge,
          sweep: trigSweep,
        },
        measurements: [],  // Measurements are queried on-demand
      };
    },

    async run(): Promise<void> {
      await transport.write(':RUN');
    },

    async stop(): Promise<void> {
      await transport.write(':STOP');
    },

    async single(): Promise<void> {
      await transport.write(':SING');
    },

    async autoSetup(): Promise<void> {
      await transport.write(':AUT');
    },

    async forceTrigger(): Promise<void> {
      await transport.write(':TFOR');
    },

    async setChannelEnabled(channel: string, enabled: boolean): Promise<void> {
      await transport.write(`:${channel}:DISP ${enabled ? 'ON' : 'OFF'}`);
    },

    async setChannelScale(channel: string, scale: number): Promise<void> {
      await transport.write(`:${channel}:SCAL ${scale}`);
    },

    async setChannelOffset(channel: string, offset: number): Promise<void> {
      await transport.write(`:${channel}:OFFS ${offset}`);
    },

    async setChannelCoupling(channel: string, coupling: string): Promise<void> {
      await transport.write(`:${channel}:COUP ${coupling}`);
    },

    async setChannelProbe(channel: string, ratio: number): Promise<void> {
      await transport.write(`:${channel}:PROB ${ratio}`);
    },

    async setChannelBwLimit(channel: string, enabled: boolean): Promise<void> {
      await transport.write(`:${channel}:BWL ${enabled ? 'ON' : 'OFF'}`);
    },

    async setTimebaseScale(scale: number): Promise<void> {
      await transport.write(`:TIM:SCAL ${scale}`);
    },

    async setTimebaseOffset(offset: number): Promise<void> {
      await transport.write(`:TIM:OFFS ${offset}`);
    },

    async setTriggerSource(source: string): Promise<void> {
      await transport.write(`:TRIG:EDG:SOUR ${source}`);
    },

    async setTriggerLevel(level: number): Promise<void> {
      await transport.write(`:TRIG:EDG:LEV ${level}`);
    },

    async setTriggerEdge(edge: string): Promise<void> {
      const scpiEdge = EDGE_MAP[edge] || 'POS';
      await transport.write(`:TRIG:EDG:SLOP ${scpiEdge}`);
    },

    async setTriggerSweep(sweep: string): Promise<void> {
      const scpiSweep = SWEEP_MAP[sweep] || 'AUTO';
      await transport.write(`:TRIG:SWE ${scpiSweep}`);
    },

    async getMeasurement(channel: string, type: string): Promise<number | null> {
      const response = await transport.query(`:MEAS:${type}? ${channel}`);
      const trimmed = response.trim();

      // Check for invalid measurement:
      // - **** means no signal/invalid
      // - 9.9E37 or similar huge values indicate overflow/invalid on Rigol scopes
      // - Empty response
      // - Non-numeric response
      if (trimmed.includes('****') || trimmed === '' || isNaN(parseFloat(trimmed))) {
        return null;
      }

      const value = parseFloat(trimmed);

      // 9.9E37 is Rigol's way of indicating an invalid/overflow measurement
      if (Math.abs(value) > 9e36) {
        return null;
      }

      return value;
    },

    async getMeasurements(channel: string, types: string[]): Promise<Record<string, number | null>> {
      const results: Record<string, number | null> = {};

      for (const type of types) {
        results[type] = await this.getMeasurement(channel, type);
      }

      return results;
    },

    async getWaveform(channel: string, start?: number, count?: number): Promise<WaveformData> {
      // Set waveform source
      await transport.write(`:WAV:SOUR ${channel}`);

      // Set mode to NORM (screen data)
      await transport.write(':WAV:MODE NORM');

      // Set format to BYTE (binary, more efficient)
      await transport.write(':WAV:FORM BYTE');

      // Set start/stop if provided
      if (start !== undefined && count !== undefined) {
        await transport.write(`:WAV:STAR ${start}`);
        await transport.write(`:WAV:STOP ${start + count - 1}`);
      }

      // Get preamble for scaling
      // DS1000Z series returns 8 values: format,type,points,count,xinc,xorig,xref,yinc
      const preambleResp = await transport.query(':WAV:PRE?');
      const preambleParts = preambleResp.split(',').map((s) => parseFloat(s.trim()));
      const [, , , , xIncrement, xOrigin, , yIncrement] = preambleParts;

      // Query yOrigin and yReference separately (not in preamble for DS1000Z)
      const yOrigin = parseNumber(await transport.query(':WAV:YOR?'));
      const yReference = parseNumber(await transport.query(':WAV:YREF?'));

      // Get waveform data (BYTE format)
      if (!transport.queryBinary) {
        throw new Error('Transport does not support binary queries');
      }
      const rawData = await transport.queryBinary(':WAV:DATA?');

      // Parse TMC block format - returns exactly dataLength bytes
      const waveformBytes = parseTmcBlock(rawData);


      // Convert bytes to voltage values
      // Formula per Rigol DS1000Z Programming Guide:
      // voltage = (rawValue - yOrigin - yReference) * yIncrement
      const points: number[] = [];
      for (let i = 0; i < waveformBytes.length; i++) {
        const rawValue = waveformBytes[i];
        const voltage = (rawValue - yOrigin - yReference) * yIncrement;
        points.push(voltage);
      }

      return {
        channel,
        points,
        xIncrement,
        xOrigin,
        yIncrement,
        yOrigin,
        yReference,
      };
    },

    async getScreenshot(): Promise<Buffer> {
      if (!transport.queryBinary) {
        throw new Error('Transport does not support binary queries');
      }

      const rawData = await transport.queryBinary(':DISP:DATA? ON,OFF,PNG');

      // The screenshot data may or may not be in TMC block format depending on model
      // Try to parse as TMC, otherwise return raw
      try {
        return parseTmcBlock(rawData);
      } catch {
        // Not TMC format, return raw (minus any header bytes if present)
        return rawData;
      }
    },
  };
}
