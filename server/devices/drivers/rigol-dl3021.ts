/**
 * Rigol DL3021 Electronic Load Driver
 * Implements the DeviceDriver interface for the DL3021
 */

import type {
  DeviceDriver,
  DeviceInfo,
  DeviceCapabilities,
  DeviceStatus,
  ListStep,
  Transport,
  ProbeError,
} from '../types.js';
import type { Result } from '../../../shared/types.js';
import { Ok, Err } from '../../../shared/types.js';
import { ScpiParser } from '../scpi-parser.js';

const MODE_MAP: Record<string, string> = {
  CC: 'CURR',
  CV: 'VOLT',
  CR: 'RES',
  CP: 'POW',
};

const VALUE_COMMANDS: Record<string, string> = {
  current: ':SOUR:CURR:LEV',
  voltage: ':SOUR:VOLT:LEV',
  resistance: ':SOUR:RES:LEV',
  power: ':SOUR:POW:LEV',
};

const VALUE_QUERIES: Record<string, string> = {
  current: ':SOUR:CURR:LEV?',
  voltage: ':SOUR:VOLT:LEV?',
  resistance: ':SOUR:RES:LEV?',
  power: ':SOUR:POW:LEV?',
};

export function createRigolDL3021(transport: Transport): DeviceDriver {
  const info: DeviceInfo = {
    id: '',
    type: 'electronic-load',
    manufacturer: 'Rigol',
    model: 'DL3021',
  };

  const capabilities: DeviceCapabilities = {
    deviceClass: 'load',
    features: {
      listMode: true,
    },
    modes: ['CC', 'CV', 'CR', 'CP'],
    modesSettable: true,
    outputs: [
      { name: 'current', unit: 'A', decimals: 3, min: 0, max: 40, modes: ['CC'] },
      { name: 'voltage', unit: 'V', decimals: 3, min: 0, max: 150, modes: ['CV'] },
      { name: 'resistance', unit: 'Ω', decimals: 3, min: 0.05, max: 15000, modes: ['CR'] },
      { name: 'power', unit: 'W', decimals: 3, min: 0, max: 200, modes: ['CP'] },
    ],
    measurements: [
      { name: 'voltage', unit: 'V', decimals: 3 },
      { name: 'current', unit: 'A', decimals: 3 },
      { name: 'power', unit: 'W', decimals: 3 },
      { name: 'resistance', unit: 'Ω', decimals: 3 },
    ],
    listMode: {
      maxSteps: 512,
      supportedModes: ['CC', 'CV', 'CR', 'CP'],
    },
  };

  return {
    info,
    capabilities,

    async probe(): Promise<Result<DeviceInfo, ProbeError>> {
      const result = await transport.query('*IDN?');
      if (!result.ok) {
        return Err({ reason: 'timeout', message: result.error.message });
      }

      const response = result.value;
      if (response.includes('RIGOL') && response.includes('DL30')) {
        // Parse serial from IDN response
        // Format: RIGOL TECHNOLOGIES,DL3021,DL3A123456789,00.01.02.03.04
        const parts = response.split(',');
        if (parts.length >= 3) {
          info.serial = parts[2].trim();
          info.id = `rigol-dl3021-${info.serial}`;
        }
        return Ok(info);
      }

      return Err({ reason: 'wrong_device', message: `IDN response does not match DL3021: ${response}` });
    },

    async connect(): Promise<Result<void, Error>> {
      return transport.open();
    },

    async disconnect(): Promise<Result<void, Error>> {
      return transport.close();
    },

    async getStatus(): Promise<Result<DeviceStatus, Error>> {
      // Query mode - device may return CC/CV/CR/CP or CURRent/VOLTage/RESistance/POWer
      const modeResult = await transport.query(':SOUR:FUNC?');
      if (!modeResult.ok) return modeResult;

      const modeUpper = modeResult.value.toUpperCase().trim();
      let mode = 'CC';
      if (modeUpper.includes('CV') || modeUpper.includes('VOLT')) mode = 'CV';
      else if (modeUpper.includes('CR') || modeUpper.includes('RES')) mode = 'CR';
      else if (modeUpper.includes('CP') || modeUpper.includes('POW')) mode = 'CP';
      else mode = 'CC';  // Default, also matches CC or CURRent

      // Query output state
      const inputResult = await transport.query(':SOUR:INP:STAT?');
      if (!inputResult.ok) return inputResult;
      const outputEnabled = inputResult.value.includes('ON') || inputResult.value === '1';

      // Query all setpoints (so client has them when switching modes)
      const setpoints: Record<string, number> = {};

      const currResult = await transport.query(':SOUR:CURR:LEV?');
      if (!currResult.ok) return currResult;
      setpoints.current = ScpiParser.parseNumberOr(currResult.value, 0);

      const voltResult = await transport.query(':SOUR:VOLT:LEV?');
      if (!voltResult.ok) return voltResult;
      setpoints.voltage = ScpiParser.parseNumberOr(voltResult.value, 0);

      const resResult = await transport.query(':SOUR:RES:LEV?');
      if (!resResult.ok) return resResult;
      setpoints.resistance = ScpiParser.parseNumberOr(resResult.value, 0);

      const powResult = await transport.query(':SOUR:POW:LEV?');
      if (!powResult.ok) return powResult;
      setpoints.power = ScpiParser.parseNumberOr(powResult.value, 0);

      // Query measurements
      const measurements: Record<string, number> = {};

      const voltMeasResult = await transport.query(':MEAS:VOLT?');
      if (!voltMeasResult.ok) return voltMeasResult;
      measurements.voltage = ScpiParser.parseNumberOr(voltMeasResult.value, 0);

      const currMeasResult = await transport.query(':MEAS:CURR?');
      if (!currMeasResult.ok) return currMeasResult;
      measurements.current = ScpiParser.parseNumberOr(currMeasResult.value, 0);

      const powMeasResult = await transport.query(':MEAS:POW?');
      if (!powMeasResult.ok) return powMeasResult;
      measurements.power = ScpiParser.parseNumberOr(powMeasResult.value, 0);

      const resMeasResult = await transport.query(':MEAS:RES?');
      if (!resMeasResult.ok) return resMeasResult;
      measurements.resistance = ScpiParser.parseNumberOr(resMeasResult.value, 0);

      return Ok({
        mode,
        outputEnabled,
        setpoints,
        measurements,
      });
    },

    async setMode(mode: string): Promise<Result<void, Error>> {
      const scpiMode = MODE_MAP[mode];
      if (!scpiMode) {
        return Err(new Error(`Invalid mode: ${mode}. Valid modes: ${Object.keys(MODE_MAP).join(', ')}`));
      }
      return transport.write(`:SOUR:FUNC ${scpiMode}`);
    },

    async setValue(name: string, value: number): Promise<Result<void, Error>> {
      const command = VALUE_COMMANDS[name];
      if (!command) {
        return Err(new Error(`Invalid value name: ${name}. Valid names: ${Object.keys(VALUE_COMMANDS).join(', ')}`));
      }

      const writeResult = await transport.write(`${command} ${value}`);
      if (!writeResult.ok) return writeResult;

      // Check SCPI error queue
      const errResult = await transport.query(':SYST:ERR?');
      if (!errResult.ok) return errResult;

      const errResp = errResult.value;
      if (!errResp.startsWith('0,') && !errResp.startsWith('+0,')) {
        return Err(new Error(`Device error: ${errResp}`));
      }

      return Ok();
    },

    async getValue(name: string): Promise<Result<number, Error>> {
      const query = VALUE_QUERIES[name];
      if (!query) {
        return Err(new Error(`Invalid value name: ${name}. Valid names: ${Object.keys(VALUE_QUERIES).join(', ')}`));
      }

      const result = await transport.query(query);
      if (!result.ok) return result;

      const parseResult = ScpiParser.parseNumber(result.value);
      if (!parseResult.ok) {
        return Err(new Error(`Failed to parse response: ${result.value}`));
      }

      return Ok(parseResult.value);
    },

    async setOutput(enabled: boolean): Promise<Result<void, Error>> {
      return transport.write(`:SOUR:INP:STAT ${enabled ? 'ON' : 'OFF'}`);
    },

    async uploadList(mode: string, steps: ListStep[], repeat = 0): Promise<Result<void, Error>> {
      const scpiMode = MODE_MAP[mode];
      if (!scpiMode) {
        return Err(new Error(`Invalid mode for list: ${mode}`));
      }

      // Set list mode type
      let result = await transport.write(`:SOUR:LIST:MODE ${scpiMode}`);
      if (!result.ok) return result;

      // Set current range (4A range for currents up to 4A, 40 for up to 40A)
      result = await transport.write(':SOUR:LIST:RANG 4');
      if (!result.ok) return result;

      // Set step count
      result = await transport.write(`:SOUR:LIST:STEP ${steps.length}`);
      if (!result.ok) return result;

      // Set cycle count (0 = infinite)
      result = await transport.write(`:SOUR:LIST:COUN ${repeat}`);
      if (!result.ok) return result;

      // Upload each step (0-indexed! Display shows 1-N but SCPI uses 0-based)
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        result = await transport.write(`:SOUR:LIST:LEV ${i},${step.value}`);
        if (!result.ok) return result;

        result = await transport.write(`:SOUR:LIST:WID ${i},${step.duration}`);
        if (!result.ok) return result;

        if (step.slew !== undefined) {
          result = await transport.write(`:SOUR:LIST:SLEW ${i},${step.slew}`);
          if (!result.ok) return result;
        }
      }

      return Ok();
    },

    async startList(): Promise<Result<void, Error>> {
      // Switch to list mode, set trigger source, enable and trigger
      let result = await transport.write(':SOUR:FUNC:MODE LIST');
      if (!result.ok) return result;

      result = await transport.write(':TRIG:SOUR BUS');
      if (!result.ok) return result;

      result = await transport.write(':SOUR:INP ON');
      if (!result.ok) return result;

      result = await transport.write(':TRIG');
      if (!result.ok) return result;

      return Ok();
    },

    async stopList(): Promise<Result<void, Error>> {
      // Stop by switching back to fixed mode
      return transport.write(':SOUR:FUNC:MODE FIX');
    },
  };
}
