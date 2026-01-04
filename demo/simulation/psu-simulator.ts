/**
 * PSU Simulator (Browser-compatible version)
 * Simulates Matrix WPS300S Power Supply SCPI commands
 */

import type { VirtualConnection } from './virtual-connection';

export interface PsuSimulator {
  handleCommand(cmd: string): string | null;
}

export function createPsuSimulator(connection: VirtualConnection): PsuSimulator {
  let voltageSetpoint = 0;
  let currentLimit = 10;
  let outputEnabled = false;

  function handleCommand(cmd: string): string | null {
    const trimmed = cmd.trim().toUpperCase();

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

    if (trimmed === 'OUTP?') {
      return outputEnabled ? '1' : '0';
    }
    if (trimmed.startsWith('OUTP ')) {
      const state = trimmed.slice(5).trim();
      outputEnabled = state === 'ON' || state === '1';
      connection.setPsuOutputEnabled(outputEnabled);
      return null;
    }

    if (trimmed === 'MEAS:VOLT?') {
      if (!outputEnabled) return '0.000';
      const voltage = connection.getPsuVoltage();
      return voltage.toFixed(3);
    }

    if (trimmed === 'MEAS:CURR?') {
      if (!outputEnabled) return '0.0000';
      const current = connection.getPsuCurrent();
      return current.toFixed(4);
    }

    console.warn(`[PSU Simulator] Unknown command: ${cmd}`);
    return '';
  }

  return {
    handleCommand,
  };
}
