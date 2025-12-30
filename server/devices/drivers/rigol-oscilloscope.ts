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
  ProbeError,
} from '../types.js';
import type { Result } from '../../../shared/types.js';
import { Ok, Err } from '../../../shared/types.js';
import { ScpiParser } from '../scpi-parser.js';

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
      'FREQ', 'PER', 'PDUT', 'NDUT', 'PWID', 'NWID',
      'RISE', 'FALL', 'OVER', 'PRES',
    ],
    hasAWG: false,
  };

  return {
    info,
    capabilities,

    async probe(): Promise<Result<OscilloscopeInfo, ProbeError>> {
      const result = await transport.query('*IDN?');
      if (!result.ok) {
        return Err({ reason: 'timeout', message: result.error.message });
      }

      const response = result.value;
      if (!response.includes('RIGOL')) {
        return Err({ reason: 'wrong_device', message: 'Not a Rigol device' });
      }

      // Parse IDN response: RIGOL TECHNOLOGIES,MODEL,SERIAL,VERSION
      const parts = response.split(',');
      if (parts.length < 3) {
        return Err({ reason: 'parse_error', message: 'Invalid IDN format' });
      }

      const model = parts[1].trim();
      const serial = parts[2].trim();

      // Check if it's an oscilloscope (DS or MSO prefix)
      if (!model.startsWith('DS') && !model.startsWith('MSO')) {
        return Err({ reason: 'wrong_device', message: `Model ${model} is not an oscilloscope` });
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

      return Ok(info);
    },

    async connect(): Promise<Result<void, Error>> {
      return transport.open();
    },

    async disconnect(): Promise<Result<void, Error>> {
      return transport.close();
    },

    async getStatus(): Promise<Result<OscilloscopeStatus, Error>> {
      // Query trigger status
      const trigStatResult = await transport.query(':TRIG:STAT?');
      if (!trigStatResult.ok) return trigStatResult;
      const trigStat = trigStatResult.value.trim().toUpperCase();
      const triggerStatus = TRIGGER_STATUS_MAP[trigStat] || 'stopped';
      const running = triggerStatus !== 'stopped';

      // Query sample rate and memory depth
      const sampleRateResult = await transport.query(':ACQ:SRAT?');
      if (!sampleRateResult.ok) return sampleRateResult;
      const sampleRate = ScpiParser.parseNumberOr(sampleRateResult.value, 0);

      const memDepthResult = await transport.query(':ACQ:MDEP?');
      if (!memDepthResult.ok) return memDepthResult;
      const memoryDepth = ScpiParser.parseNumberOr(memDepthResult.value, 0);

      // Query channel configurations
      const channels: Record<string, ChannelConfig> = {};
      for (let i = 1; i <= capabilities.channels; i++) {
        const ch = `CHAN${i}`;

        const dispResult = await transport.query(`:${ch}:DISP?`);
        if (!dispResult.ok) return dispResult;
        const enabled = ScpiParser.parseBool(dispResult.value);

        const scalResult = await transport.query(`:${ch}:SCAL?`);
        if (!scalResult.ok) return scalResult;
        const scale = ScpiParser.parseNumberOr(scalResult.value, 1);

        const offsResult = await transport.query(`:${ch}:OFFS?`);
        if (!offsResult.ok) return offsResult;
        const offset = ScpiParser.parseNumberOr(offsResult.value, 0);

        const coupResult = await transport.query(`:${ch}:COUP?`);
        if (!coupResult.ok) return coupResult;
        const coupling = coupResult.value.trim().toUpperCase() as 'AC' | 'DC' | 'GND';

        const probResult = await transport.query(`:${ch}:PROB?`);
        if (!probResult.ok) return probResult;
        const probe = ScpiParser.parseNumberOr(probResult.value, 1);

        const bwlResult = await transport.query(`:${ch}:BWL?`);
        if (!bwlResult.ok) return bwlResult;
        const bwLimit = ScpiParser.parseBool(bwlResult.value);

        channels[ch] = { enabled, scale, offset, coupling, probe, bwLimit };
      }

      // Query timebase
      const timScalResult = await transport.query(':TIM:SCAL?');
      if (!timScalResult.ok) return timScalResult;
      const timScale = ScpiParser.parseNumberOr(timScalResult.value, 0.001);

      const timOffsResult = await transport.query(':TIM:OFFS?');
      if (!timOffsResult.ok) return timOffsResult;
      const timOffs = ScpiParser.parseNumberOr(timOffsResult.value, 0);

      const timModeResult = await transport.query(':TIM:MODE?');
      if (!timModeResult.ok) return timModeResult;
      const timModeResp = timModeResult.value.trim().toUpperCase();
      const timebaseMode = timModeResp === 'ROLL' ? 'roll' : timModeResp === 'ZOOM' ? 'zoom' : 'main';

      // Query trigger settings
      const trigModeResult = await transport.query(':TRIG:MODE?');
      if (!trigModeResult.ok) return trigModeResult;
      const trigModeResp = trigModeResult.value.trim().toUpperCase();

      const trigCoupResult = await transport.query(':TRIG:COUP?');
      if (!trigCoupResult.ok) return trigCoupResult;
      const trigCoupResp = trigCoupResult.value.trim().toUpperCase();

      const trigSrcResult = await transport.query(':TRIG:EDG:SOUR?');
      if (!trigSrcResult.ok) return trigSrcResult;
      const trigSrc = trigSrcResult.value.trim();

      const trigLevResult = await transport.query(':TRIG:EDG:LEV?');
      if (!trigLevResult.ok) return trigLevResult;
      const trigLev = ScpiParser.parseNumberOr(trigLevResult.value, 0);

      const trigSlopResult = await transport.query(':TRIG:EDG:SLOP?');
      if (!trigSlopResult.ok) return trigSlopResult;
      const trigSlopResp = trigSlopResult.value.trim().toUpperCase();

      const trigSweepResult = await transport.query(':TRIG:SWE?');
      if (!trigSweepResult.ok) return trigSweepResult;
      const trigSweepResp = trigSweepResult.value.trim().toUpperCase();

      // Map trigger mode
      const trigMode = trigModeResp.toLowerCase() as 'edge' | 'pulse' | 'slope' | 'video';

      // Map trigger coupling
      const trigCoupling = trigCoupResp as 'AC' | 'DC' | 'LFReject' | 'HFReject';

      // Map trigger edge
      const trigEdge = EDGE_REVERSE_MAP[trigSlopResp] || 'rising';

      // Map trigger sweep
      const trigSweep = (trigSweepResp === 'NORM' ? 'normal' : trigSweepResp === 'SING' ? 'single' : 'auto') as 'auto' | 'normal' | 'single';

      return Ok({
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
      });
    },

    async run(): Promise<Result<void, Error>> {
      return transport.write(':RUN');
    },

    async stop(): Promise<Result<void, Error>> {
      return transport.write(':STOP');
    },

    async single(): Promise<Result<void, Error>> {
      return transport.write(':SING');
    },

    async autoSetup(): Promise<Result<void, Error>> {
      return transport.write(':AUT');
    },

    async forceTrigger(): Promise<Result<void, Error>> {
      return transport.write(':TFOR');
    },

    async setChannelEnabled(channel: string, enabled: boolean): Promise<Result<void, Error>> {
      return transport.write(`:${channel}:DISP ${enabled ? 'ON' : 'OFF'}`);
    },

    async setChannelScale(channel: string, scale: number): Promise<Result<void, Error>> {
      return transport.write(`:${channel}:SCAL ${scale}`);
    },

    async setChannelOffset(channel: string, offset: number): Promise<Result<void, Error>> {
      return transport.write(`:${channel}:OFFS ${offset}`);
    },

    async setChannelCoupling(channel: string, coupling: string): Promise<Result<void, Error>> {
      return transport.write(`:${channel}:COUP ${coupling}`);
    },

    async setChannelProbe(channel: string, ratio: number): Promise<Result<void, Error>> {
      return transport.write(`:${channel}:PROB ${ratio}`);
    },

    async setChannelBwLimit(channel: string, enabled: boolean): Promise<Result<void, Error>> {
      return transport.write(`:${channel}:BWL ${enabled ? 'ON' : 'OFF'}`);
    },

    async setTimebaseScale(scale: number): Promise<Result<void, Error>> {
      return transport.write(`:TIM:SCAL ${scale}`);
    },

    async setTimebaseOffset(offset: number): Promise<Result<void, Error>> {
      return transport.write(`:TIM:OFFS ${offset}`);
    },

    async setTriggerSource(source: string): Promise<Result<void, Error>> {
      return transport.write(`:TRIG:EDG:SOUR ${source}`);
    },

    async setTriggerLevel(level: number): Promise<Result<void, Error>> {
      return transport.write(`:TRIG:EDG:LEV ${level}`);
    },

    async setTriggerEdge(edge: string): Promise<Result<void, Error>> {
      const scpiEdge = EDGE_MAP[edge] || 'POS';
      return transport.write(`:TRIG:EDG:SLOP ${scpiEdge}`);
    },

    async setTriggerSweep(sweep: string): Promise<Result<void, Error>> {
      const scpiSweep = SWEEP_MAP[sweep] || 'AUTO';
      return transport.write(`:TRIG:SWE ${scpiSweep}`);
    },

    async getMeasurement(channel: string, type: string): Promise<Result<number | null, Error>> {
      const result = await transport.query(`:MEAS:${type}? ${channel}`);
      if (!result.ok) return result;

      const trimmed = result.value.trim();

      // Check for invalid measurement:
      // - **** means no signal/invalid
      // - 9.9E37 or similar huge values indicate overflow/invalid on Rigol scopes
      // - Empty response
      // - Non-numeric response
      if (trimmed.includes('****') || trimmed === '' || isNaN(parseFloat(trimmed))) {
        return Ok(null);
      }

      const value = parseFloat(trimmed);

      // 9.9E37 is Rigol's way of indicating an invalid/overflow measurement
      if (Math.abs(value) > 9e36) {
        return Ok(null);
      }

      return Ok(value);
    },

    async getMeasurements(channel: string, types: string[]): Promise<Result<Record<string, number | null>, Error>> {
      const results: Record<string, number | null> = {};

      for (const type of types) {
        const measResult = await this.getMeasurement(channel, type);
        if (!measResult.ok) return measResult;
        results[type] = measResult.value;
      }

      return Ok(results);
    },

    async getWaveform(channel: string, start?: number, count?: number): Promise<Result<WaveformData, Error>> {
      // Set waveform source
      let writeResult = await transport.write(`:WAV:SOUR ${channel}`);
      if (!writeResult.ok) return writeResult;

      // Set mode to NORM (screen data)
      writeResult = await transport.write(':WAV:MODE NORM');
      if (!writeResult.ok) return writeResult;

      // Set format to BYTE (binary, more efficient)
      writeResult = await transport.write(':WAV:FORM BYTE');
      if (!writeResult.ok) return writeResult;

      // Set start/stop if provided
      if (start !== undefined && count !== undefined) {
        writeResult = await transport.write(`:WAV:STAR ${start}`);
        if (!writeResult.ok) return writeResult;
        writeResult = await transport.write(`:WAV:STOP ${start + count - 1}`);
        if (!writeResult.ok) return writeResult;
      }

      // Get preamble for scaling
      // DS1000Z series returns 8 values: format,type,points,count,xinc,xorig,xref,yinc
      const preambleResult = await transport.query(':WAV:PRE?');
      if (!preambleResult.ok) return preambleResult;
      const preambleParts = preambleResult.value.split(',').map((s) => parseFloat(s.trim()));
      const [, , , , xIncrement, xOrigin, , yIncrement] = preambleParts;

      // Query yOrigin and yReference separately (not in preamble for DS1000Z)
      const yOrResult = await transport.query(':WAV:YOR?');
      if (!yOrResult.ok) return yOrResult;
      const yOrigin = ScpiParser.parseNumberOr(yOrResult.value, 0);

      const yRefResult = await transport.query(':WAV:YREF?');
      if (!yRefResult.ok) return yRefResult;
      const yReference = ScpiParser.parseNumberOr(yRefResult.value, 0);

      // Get waveform data (BYTE format)
      if (!transport.queryBinary) {
        return Err(new Error('Transport does not support binary queries'));
      }

      const rawDataResult = await transport.queryBinary(':WAV:DATA?');
      if (!rawDataResult.ok) return rawDataResult;

      // Parse TMC block format - returns exactly dataLength bytes
      const blockResult = ScpiParser.parseDefiniteLengthBlock(rawDataResult.value);
      if (!blockResult.ok) {
        return Err(new Error(blockResult.error));
      }
      const waveformBytes = blockResult.value;

      // Convert bytes to voltage values
      // Formula per Rigol DS1000Z Programming Guide:
      // voltage = (rawValue - yOrigin - yReference) * yIncrement
      const points: number[] = [];
      for (let i = 0; i < waveformBytes.length; i++) {
        const rawValue = waveformBytes[i];
        const voltage = (rawValue - yOrigin - yReference) * yIncrement;
        points.push(voltage);
      }

      return Ok({
        channel,
        points,
        xIncrement,
        xOrigin,
        yIncrement,
        yOrigin,
        yReference,
      });
    },

    async getScreenshot(): Promise<Result<Buffer, Error>> {
      if (!transport.queryBinary) {
        return Err(new Error('Transport does not support binary queries'));
      }

      const rawDataResult = await transport.queryBinary(':DISP:DATA? ON,OFF,PNG');
      if (!rawDataResult.ok) return rawDataResult;

      // The screenshot data may or may not be in TMC block format depending on model
      // Try to parse as TMC, otherwise return raw
      const blockResult = ScpiParser.parseDefiniteLengthBlock(rawDataResult.value);
      if (blockResult.ok) {
        return Ok(blockResult.value);
      }

      // Not TMC format, return raw (minus any header bytes if present)
      return Ok(rawDataResult.value);
    },
  };
}
