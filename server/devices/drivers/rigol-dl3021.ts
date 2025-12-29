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
} from '../types.js';

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

    async probe(): Promise<boolean> {
      try {
        const response = await transport.query('*IDN?');
        if (response.includes('RIGOL') && response.includes('DL30')) {
          // Parse serial from IDN response
          // Format: RIGOL TECHNOLOGIES,DL3021,DL3A123456789,00.01.02.03.04
          const parts = response.split(',');
          if (parts.length >= 3) {
            info.serial = parts[2].trim();
            info.id = `rigol-dl3021-${info.serial}`;
          }
          return true;
        }
        return false;
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

    async getStatus(): Promise<DeviceStatus> {
      // Query mode - device may return CC/CV/CR/CP or CURRent/VOLTage/RESistance/POWer
      const modeResp = await transport.query(':SOUR:FUNC?');
      const modeUpper = modeResp.toUpperCase().trim();
      let mode = 'CC';
      if (modeUpper.includes('CV') || modeUpper.includes('VOLT')) mode = 'CV';
      else if (modeUpper.includes('CR') || modeUpper.includes('RES')) mode = 'CR';
      else if (modeUpper.includes('CP') || modeUpper.includes('POW')) mode = 'CP';
      else mode = 'CC';  // Default, also matches CC or CURRent

      // Query output state
      const inputResp = await transport.query(':SOUR:INP:STAT?');
      const outputEnabled = inputResp.includes('ON') || inputResp === '1';

      // Query all setpoints (so client has them when switching modes)
      const setpoints: Record<string, number> = {};
      const currResp = await transport.query(':SOUR:CURR:LEV?');
      setpoints.current = parseFloat(currResp);
      const voltResp = await transport.query(':SOUR:VOLT:LEV?');
      setpoints.voltage = parseFloat(voltResp);
      const resResp = await transport.query(':SOUR:RES:LEV?');
      setpoints.resistance = parseFloat(resResp);
      const powResp = await transport.query(':SOUR:POW:LEV?');
      setpoints.power = parseFloat(powResp);

      // Query measurements
      const measurements: Record<string, number> = {};
      const voltage = await transport.query(':MEAS:VOLT?');
      const current = await transport.query(':MEAS:CURR?');
      const power = await transport.query(':MEAS:POW?');
      const resistance = await transport.query(':MEAS:RES?');

      measurements.voltage = parseFloat(voltage);
      measurements.current = parseFloat(current);
      measurements.power = parseFloat(power);
      measurements.resistance = parseFloat(resistance);

      return {
        mode,
        outputEnabled,
        setpoints,
        measurements,
      };
    },

    async setMode(mode: string): Promise<void> {
      const scpiMode = MODE_MAP[mode];
      if (!scpiMode) {
        throw new Error(`Invalid mode: ${mode}. Valid modes: ${Object.keys(MODE_MAP).join(', ')}`);
      }
      await transport.write(`:SOUR:FUNC ${scpiMode}`);
    },

    async setValue(name: string, value: number): Promise<void> {
      const command = VALUE_COMMANDS[name];
      if (!command) {
        throw new Error(`Invalid value name: ${name}. Valid names: ${Object.keys(VALUE_COMMANDS).join(', ')}`);
      }
      await transport.write(`${command} ${value}`);

      // Check SCPI error queue
      const errResp = await transport.query(':SYST:ERR?');
      if (!errResp.startsWith('0,') && !errResp.startsWith('+0,')) {
        throw new Error(`Device error: ${errResp}`);
      }
    },

    async getValue(name: string): Promise<number> {
      const query = VALUE_QUERIES[name];
      if (!query) {
        throw new Error(`Invalid value name: ${name}. Valid names: ${Object.keys(VALUE_QUERIES).join(', ')}`);
      }
      const response = await transport.query(query);
      return parseFloat(response);
    },

    async setOutput(enabled: boolean): Promise<void> {
      await transport.write(`:SOUR:INP:STAT ${enabled ? 'ON' : 'OFF'}`);
    },

    async uploadList(mode: string, steps: ListStep[], repeat = 0): Promise<void> {
      const scpiMode = MODE_MAP[mode];
      if (!scpiMode) {
        throw new Error(`Invalid mode for list: ${mode}`);
      }

      // Set list mode type
      await transport.write(`:SOUR:LIST:MODE ${scpiMode}`);

      // Set current range (4A range for currents up to 4A, 40 for up to 40A)
      await transport.write(':SOUR:LIST:RANG 4');

      // Set step count
      await transport.write(`:SOUR:LIST:STEP ${steps.length}`);

      // Set cycle count (0 = infinite)
      await transport.write(`:SOUR:LIST:COUN ${repeat}`);

      // Upload each step (0-indexed! Display shows 1-N but SCPI uses 0-based)
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        await transport.write(`:SOUR:LIST:LEV ${i},${step.value}`);
        await transport.write(`:SOUR:LIST:WID ${i},${step.duration}`);
        if (step.slew !== undefined) {
          await transport.write(`:SOUR:LIST:SLEW ${i},${step.slew}`);
        }
      }
    },

    async startList(): Promise<void> {
      // Switch to list mode, set trigger source, enable and trigger
      await transport.write(':SOUR:FUNC:MODE LIST');
      await transport.write(':TRIG:SOUR BUS');
      await transport.write(':SOUR:INP ON');
      await transport.write(':TRIG');
    },

    async stopList(): Promise<void> {
      // Stop by switching back to fixed mode
      await transport.write(':SOUR:FUNC:MODE FIX');
    },
  };
}
