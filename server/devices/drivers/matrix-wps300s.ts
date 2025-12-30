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
    deviceClass: 'psu',
    features: {},  // No special features on this basic PSU
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

      // Infer mode from measurements vs setpoints
      // CC mode: current is at limit AND voltage is below setpoint
      // CV mode: voltage is at setpoint OR current is below limit (default)
      let mode = 'CV';
      if (outputEnabled && currentLimit > 0.001 && voltageSetpoint > 0.001) {
        const currentAtLimit = currentActual >= currentLimit * 0.98;
        const voltageAtSetpoint = voltageActual >= voltageSetpoint * 0.98;
        // CC mode: hitting current limit while voltage droops
        if (currentAtLimit && !voltageAtSetpoint) {
          mode = 'CC';
        }
      }

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

      // Verify the value was accepted by querying it back
      const actualStr = await transport.query(`${command}?`);
      const actual = parseFloat(actualStr);
      // Allow small tolerance for floating point differences
      if (Math.abs(actual - value) > 0.01) {
        throw new Error(`Value rejected: requested ${value}, device reports ${actual}`);
      }
    },

    async setOutput(enabled: boolean): Promise<void> {
      await transport.write(`OUTP ${enabled ? 'ON' : 'OFF'}`);
    },

    // No list mode methods - this device doesn't support them
  };
}
