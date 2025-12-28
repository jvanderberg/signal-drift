/**
 * Matrix WPS300S Power Supply Driver
 * Implements the DeviceDriver interface for the WPS300S
 *
 * Note: This PSU uses simple SCPI-like commands over USB-Serial (CH340).
 * Mode is auto-detected (CV/CC) based on load conditions - cannot be queried.
 * Default baud rate: 115200 (configurable on PSU, but 115200 recommended for polling)
 * Requires 30-50ms delay between commands.
 */

import type {
  DeviceDriver,
  DeviceInfo,
  DeviceCapabilities,
  DeviceStatus,
  Transport,
} from '../types.js';

const VALUE_COMMANDS: Record<string, string> = {
  voltage: 'VOLT',
  current: 'CURR',
};

export function createMatrixWPS300S(transport: Transport): DeviceDriver {
  const info: DeviceInfo = {
    id: 'matrix-wps300s',
    type: 'power-supply',
    manufacturer: 'Matrix',
    model: 'WPS300S',
  };

  const capabilities: DeviceCapabilities = {
    modes: ['CV', 'CC'],
    modesSettable: false,  // Mode is auto-detected based on load, cannot be set or queried
    outputs: [
      { name: 'voltage', unit: 'V', decimals: 3, min: 0, max: 80 },
      { name: 'current', unit: 'A', decimals: 3, min: 0, max: 10 },
    ],
    measurements: [
      { name: 'voltage', unit: 'V', decimals: 3 },
      { name: 'current', unit: 'A', decimals: 4 },
      { name: 'power', unit: 'W', decimals: 3 },
    ],
    // No listMode - this PSU doesn't support it
  };

  return {
    info,
    capabilities,

    async probe(): Promise<boolean> {
      try {
        // Matrix PSU doesn't support *IDN?, but responds to VOLT?
        const response = await transport.query('VOLT?');
        // If we get a numeric response, it's likely a Matrix PSU
        const value = parseFloat(response);
        return !isNaN(value);
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
      // Query setpoints
      const voltageSetpointStr = await transport.query('VOLT?');
      const currentLimitStr = await transport.query('CURR?');

      // Query output state (returns "0" or "1", not "ON"/"OFF")
      const outputStr = await transport.query('OUTP?');

      // Query actual measurements (separate from setpoints)
      const voltageActualStr = await transport.query('MEAS:VOLT?');
      const currentActualStr = await transport.query('MEAS:CURR?');

      const voltageSetpoint = parseFloat(voltageSetpointStr);
      const currentLimit = parseFloat(currentLimitStr);
      const voltageActual = parseFloat(voltageActualStr);
      const currentActual = parseFloat(currentActualStr);

      // Output state: "1" = on, "0" = off
      const outputEnabled = outputStr.trim() === '1';

      // Mode cannot be queried on this PSU - it auto-switches between CV/CC
      // We can infer it: if actual current equals limit, probably CC mode
      // But this is unreliable, so we just report 'CV' as default
      const mode = 'CV';

      return {
        mode,
        outputEnabled,
        setpoints: {
          voltage: voltageSetpoint,
          current: currentLimit,
        },
        measurements: {
          voltage: voltageActual,
          current: currentActual,
          power: voltageActual * currentActual,
        },
      };
    },

    async setMode(_mode: string): Promise<void> {
      // No-op: Mode is auto-detected based on load conditions
      // The PSU switches between CV and CC automatically
    },

    async setValue(name: string, value: number): Promise<void> {
      const command = VALUE_COMMANDS[name];
      if (!command) {
        throw new Error(`Invalid value name: ${name}. Valid names: ${Object.keys(VALUE_COMMANDS).join(', ')}`);
      }
      await transport.write(`${command} ${value}`);
    },

    async setOutput(enabled: boolean): Promise<void> {
      await transport.write(`OUTP ${enabled ? 'ON' : 'OFF'}`);
    },

    // No list mode methods - this device doesn't support them
  };
}
