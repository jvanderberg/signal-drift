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
  ProbeError,
} from '../types.js';
import type { Result } from '../../../shared/types.js';
import { Ok, Err } from '../../../shared/types.js';
import { ScpiParser } from '../scpi-parser.js';

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

    async probe(): Promise<Result<DeviceInfo, ProbeError>> {
      // Matrix PSU doesn't support *IDN?, but responds to VOLT?
      const result = await transport.query('VOLT?');
      if (!result.ok) {
        return Err({ reason: 'timeout', message: result.error.message });
      }

      // If we get a numeric response, it's likely a Matrix PSU
      const parseResult = ScpiParser.parseNumber(result.value);
      if (!parseResult.ok) {
        return Err({ reason: 'wrong_device', message: 'Response is not numeric' });
      }

      return Ok(info);
    },

    async connect(): Promise<Result<void, Error>> {
      return transport.open();
    },

    async disconnect(): Promise<Result<void, Error>> {
      return transport.close();
    },

    async getStatus(): Promise<Result<DeviceStatus, Error>> {
      // Query setpoints
      const voltageSetpointResult = await transport.query('VOLT?');
      if (!voltageSetpointResult.ok) return voltageSetpointResult;

      const currentLimitResult = await transport.query('CURR?');
      if (!currentLimitResult.ok) return currentLimitResult;

      // Query output state (returns "0" or "1", not "ON"/"OFF")
      const outputResult = await transport.query('OUTP?');
      if (!outputResult.ok) return outputResult;

      // Query actual measurements (separate from setpoints)
      const voltageActualResult = await transport.query('MEAS:VOLT?');
      if (!voltageActualResult.ok) return voltageActualResult;

      const currentActualResult = await transport.query('MEAS:CURR?');
      if (!currentActualResult.ok) return currentActualResult;

      const voltageSetpoint = ScpiParser.parseNumberOr(voltageSetpointResult.value, 0);
      const currentLimit = ScpiParser.parseNumberOr(currentLimitResult.value, 0);
      const voltageActual = ScpiParser.parseNumberOr(voltageActualResult.value, 0);
      const currentActual = ScpiParser.parseNumberOr(currentActualResult.value, 0);

      // Output state: "1" = on, "0" = off
      const outputEnabled = outputResult.value.trim() === '1';

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

      return Ok({
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
      });
    },

    async setMode(_mode: string): Promise<Result<void, Error>> {
      // No-op: Mode is auto-detected based on load conditions
      // The PSU switches between CV and CC automatically
      return Ok();
    },

    async setValue(name: string, value: number): Promise<Result<void, Error>> {
      const command = VALUE_COMMANDS[name];
      if (!command) {
        return Err(new Error(`Invalid value name: ${name}. Valid names: ${Object.keys(VALUE_COMMANDS).join(', ')}`));
      }

      const writeResult = await transport.write(`${command} ${value}`);
      if (!writeResult.ok) return writeResult;

      // Verify the value was accepted by querying it back
      const queryResult = await transport.query(`${command}?`);
      if (!queryResult.ok) return queryResult;

      const actual = ScpiParser.parseNumberOr(queryResult.value, NaN);
      // Allow small tolerance for floating point differences
      if (Math.abs(actual - value) > 0.01) {
        return Err(new Error(`Value rejected: requested ${value}, device reports ${actual}`));
      }

      return Ok();
    },

    async setOutput(enabled: boolean): Promise<Result<void, Error>> {
      return transport.write(`OUTP ${enabled ? 'ON' : 'OFF'}`);
    },

    // No list mode methods - this device doesn't support them
  };
}
