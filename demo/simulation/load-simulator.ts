/**
 * Load Simulator (Browser-compatible version)
 * Simulates Rigol DL3021 Electronic Load SCPI commands
 */

import type { VirtualConnection } from './virtual-connection';

type LoadMode = 'CC' | 'CV' | 'CR' | 'CP';

export interface LoadSimulator {
  handleCommand(cmd: string): string | null;
}

export function createLoadSimulator(connection: VirtualConnection, serialNumber = 'DL3A000000001'): LoadSimulator {
  let mode: LoadMode = 'CC';
  let inputEnabled = false;
  let currentSetpoint = 0;
  let voltageSetpoint = 0;
  let resistanceSetpoint = 1000;
  let powerSetpoint = 0;

  function parseMode(modeStr: string): LoadMode | null {
    const upper = modeStr.toUpperCase().trim();
    if (upper === 'CURR' || upper === 'CC' || upper === 'CURRENT') return 'CC';
    if (upper === 'VOLT' || upper === 'CV' || upper === 'VOLTAGE') return 'CV';
    if (upper === 'RES' || upper === 'CR' || upper === 'RESISTANCE') return 'CR';
    if (upper === 'POW' || upper === 'CP' || upper === 'POWER') return 'CP';
    return null;
  }

  function modeToScpi(m: LoadMode): string {
    switch (m) {
      case 'CC': return 'CURR';
      case 'CV': return 'VOLT';
      case 'CR': return 'RES';
      case 'CP': return 'POW';
    }
  }

  function getActiveSetpoint(): number {
    switch (mode) {
      case 'CC': return currentSetpoint;
      case 'CV': return voltageSetpoint;
      case 'CR': return resistanceSetpoint;
      case 'CP': return powerSetpoint;
    }
  }

  function updateConnection(): void {
    connection.setLoadMode(mode);
    connection.setLoadSetpoint(getActiveSetpoint());
    connection.setLoadInputEnabled(inputEnabled);
  }

  function handleCommand(cmd: string): string | null {
    const trimmed = cmd.trim();
    const normalized = trimmed.toUpperCase().replace(/^:+/, '');

    if (normalized === '*IDN?') {
      return `RIGOL TECHNOLOGIES,DL3021,${serialNumber},00.01.00.00.00`;
    }

    if (normalized === 'SOUR:FUNC?') {
      return modeToScpi(mode);
    }

    if (normalized.startsWith('SOUR:FUNC ')) {
      const newMode = parseMode(normalized.slice(10));
      if (newMode) {
        mode = newMode;
        updateConnection();
      }
      return null;
    }

    if (normalized === 'SOUR:INP:STAT?') {
      return inputEnabled ? 'ON' : 'OFF';
    }

    if (normalized.startsWith('SOUR:INP:STAT ') || normalized.startsWith('SOUR:INP ')) {
      const parts = normalized.split(' ');
      const state = parts[parts.length - 1];
      inputEnabled = state === 'ON' || state === '1';
      updateConnection();
      return null;
    }

    if (normalized === 'SOUR:CURR:LEV?') {
      return currentSetpoint.toFixed(4);
    }

    if (normalized.startsWith('SOUR:CURR:LEV ')) {
      const value = parseFloat(normalized.slice(14));
      if (!isNaN(value) && value >= 0 && value <= 40) {
        currentSetpoint = value;
        if (mode === 'CC') updateConnection();
      }
      return null;
    }

    if (normalized === 'SOUR:VOLT:LEV?') {
      return voltageSetpoint.toFixed(3);
    }

    if (normalized.startsWith('SOUR:VOLT:LEV ')) {
      const value = parseFloat(normalized.slice(14));
      if (!isNaN(value) && value >= 0 && value <= 150) {
        voltageSetpoint = value;
        if (mode === 'CV') updateConnection();
      }
      return null;
    }

    if (normalized === 'SOUR:RES:LEV?') {
      return resistanceSetpoint.toFixed(3);
    }

    if (normalized.startsWith('SOUR:RES:LEV ')) {
      const value = parseFloat(normalized.slice(13));
      if (!isNaN(value) && value >= 0.05 && value <= 15000) {
        resistanceSetpoint = value;
        if (mode === 'CR') updateConnection();
      }
      return null;
    }

    if (normalized === 'SOUR:POW:LEV?') {
      return powerSetpoint.toFixed(3);
    }

    if (normalized.startsWith('SOUR:POW:LEV ')) {
      const value = parseFloat(normalized.slice(13));
      if (!isNaN(value) && value >= 0 && value <= 200) {
        powerSetpoint = value;
        if (mode === 'CP') updateConnection();
      }
      return null;
    }

    if (normalized === 'MEAS:VOLT?') {
      const voltage = connection.getLoadVoltage();
      return voltage.toFixed(4);
    }

    if (normalized === 'MEAS:CURR?') {
      const current = connection.getLoadCurrent();
      return current.toFixed(4);
    }

    if (normalized === 'MEAS:POW?') {
      const power = connection.getLoadPower();
      return power.toFixed(4);
    }

    if (normalized === 'MEAS:RES?') {
      const resistance = connection.getLoadResistance();
      return resistance.toFixed(4);
    }

    if (normalized === 'SYST:ERR?') {
      return '0,No error';
    }

    console.warn(`[Load Simulator] Unknown command: ${cmd}`);
    return '';
  }

  return {
    handleCommand,
  };
}
