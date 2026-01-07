/**
 * PSU Simulator
 * Simulates Matrix WPS300S Power Supply SCPI commands
 *
 * Command set:
 * - VOLT? / VOLT <value>     - Voltage setpoint
 * - CURR? / CURR <value>     - Current limit
 * - OUTP? / OUTP ON|OFF      - Output enable
 * - MEAS:VOLT?               - Actual voltage
 * - MEAS:CURR?               - Actual current
 */

import type { VirtualConnection } from './virtual-connection.js';

export interface PsuSimulator {
  handleCommand(cmd: string): string | null;
}

export function createPsuSimulator(connection: VirtualConnection): PsuSimulator {
  // Internal state (setpoints)
  let voltageSetpoint = 0;
  let currentLimit = 10;
  let outputEnabled = false;

  // Parse a command and return response (or null for write commands)
  function handleCommand(cmd: string): string | null {
    const trimmed = cmd.trim().toUpperCase();

    // Voltage setpoint
    if (trimmed === 'VOLT?') {
      return voltageSetpoint.toFixed(3);
    }
    if (trimmed.startsWith('VOLT ')) {
      const value = parseFloat(trimmed.slice(5));
      if (!isNaN(value) && value >= 0 && value <= 80) {
        voltageSetpoint = value;
        connection.setPsuVoltage(value);
      }
      return null;
    }

    // Current limit
    if (trimmed === 'CURR?') {
      return currentLimit.toFixed(3);
    }
    if (trimmed.startsWith('CURR ')) {
      const value = parseFloat(trimmed.slice(5));
      if (!isNaN(value) && value >= 0 && value <= 10) {
        currentLimit = value;
        connection.setPsuCurrentLimit(value);
      }
      return null;
    }

    // Output enable
    if (trimmed === 'OUTP?') {
      return outputEnabled ? '1' : '0';
    }
    if (trimmed.startsWith('OUTP ')) {
      const state = trimmed.slice(5).trim();
      outputEnabled = state === 'ON' || state === '1';
      connection.setPsuOutputEnabled(outputEnabled);
      return null;
    }

    // Measurements
    if (trimmed === 'MEAS:VOLT?') {
      if (!outputEnabled) return '0.000';
      // Return actual voltage PSU is outputting
      const voltage = connection.getPsuVoltage();
      return voltage.toFixed(3);
    }

    if (trimmed === 'MEAS:CURR?') {
      if (!outputEnabled) return '0.0000';
      // Return actual current drawn by load
      const current = connection.getPsuCurrent();
      return current.toFixed(4);
    }

    // Unknown command - return empty (real device might error)
    console.warn(`[PSU Simulator] Unknown command: ${cmd}`);
    return '';
  }

  return {
    handleCommand,
  };
}
