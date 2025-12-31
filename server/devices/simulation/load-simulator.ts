/**
 * Load Simulator
 * Simulates Rigol DL3021 Electronic Load SCPI commands
 *
 * Command set:
 * - *IDN?                    - Identification
 * - :SOUR:FUNC? / :SOUR:FUNC <mode>  - Operating mode (CC/CV/CR/CP)
 * - :SOUR:INP:STAT? / :SOUR:INP:STAT ON|OFF  - Input enable
 * - :SOUR:CURR:LEV? / :SOUR:CURR:LEV <value> - CC setpoint
 * - :SOUR:VOLT:LEV? / :SOUR:VOLT:LEV <value> - CV setpoint
 * - :SOUR:RES:LEV? / :SOUR:RES:LEV <value>   - CR setpoint
 * - :SOUR:POW:LEV? / :SOUR:POW:LEV <value>   - CP setpoint
 * - :MEAS:VOLT? / :MEAS:CURR? / :MEAS:POW? / :MEAS:RES? - Measurements
 * - :SYST:ERR?               - Error queue
 * - List mode commands
 */

import type { VirtualConnection } from './virtual-connection.js';

type LoadMode = 'CC' | 'CV' | 'CR' | 'CP';

export interface LoadSimulator {
  handleCommand(cmd: string): string | null;
}

export function createLoadSimulator(connection: VirtualConnection, serialNumber = 'DL3A000000001'): LoadSimulator {
  // Internal state
  let mode: LoadMode = 'CC';
  let inputEnabled = false;
  let currentSetpoint = 0;
  let voltageSetpoint = 0;
  let resistanceSetpoint = 1000;
  let powerSetpoint = 0;

  // List mode state (basic tracking, not full timing simulation)
  let listMode: LoadMode = 'CC';
  let listSteps: Array<{ value: number; duration: number; slew?: number }> = [];
  let listCount = 1;
  let listRunning = false;
  let funcMode: 'FIX' | 'LIST' = 'FIX';

  // Map SCPI mode names to internal mode
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

  // Get current setpoint for active mode
  function getActiveSetpoint(): number {
    switch (mode) {
      case 'CC': return currentSetpoint;
      case 'CV': return voltageSetpoint;
      case 'CR': return resistanceSetpoint;
      case 'CP': return powerSetpoint;
    }
  }

  // Update virtual connection with current mode and setpoint
  function updateConnection(): void {
    connection.setLoadMode(mode);
    connection.setLoadSetpoint(getActiveSetpoint());
    connection.setLoadInputEnabled(inputEnabled);
  }

  function handleCommand(cmd: string): string | null {
    const trimmed = cmd.trim();
    // Normalize: remove leading colons for comparison but keep case for parsing values
    const normalized = trimmed.toUpperCase().replace(/^:+/, '');

    // *IDN? - Identification
    if (normalized === '*IDN?') {
      return `RIGOL TECHNOLOGIES,DL3021,${serialNumber},00.01.00.00.00`;
    }

    // :SOUR:FUNC? - Query mode
    if (normalized === 'SOUR:FUNC?') {
      return modeToScpi(mode);
    }

    // :SOUR:FUNC <mode> - Set mode
    if (normalized.startsWith('SOUR:FUNC ')) {
      const newMode = parseMode(normalized.slice(10));
      if (newMode) {
        mode = newMode;
        updateConnection();
      }
      return null;
    }

    // :SOUR:INP:STAT? - Query input state
    if (normalized === 'SOUR:INP:STAT?') {
      return inputEnabled ? 'ON' : 'OFF';
    }

    // :SOUR:INP:STAT ON|OFF - Set input state
    if (normalized.startsWith('SOUR:INP:STAT ') || normalized.startsWith('SOUR:INP ')) {
      const parts = normalized.split(' ');
      const state = parts[parts.length - 1];
      inputEnabled = state === 'ON' || state === '1';
      updateConnection();
      return null;
    }

    // :SOUR:CURR:LEV? - Query current setpoint
    if (normalized === 'SOUR:CURR:LEV?') {
      return currentSetpoint.toFixed(4);
    }

    // :SOUR:CURR:LEV <value> - Set current setpoint
    if (normalized.startsWith('SOUR:CURR:LEV ')) {
      const value = parseFloat(normalized.slice(14));
      if (!isNaN(value) && value >= 0 && value <= 40) {
        currentSetpoint = value;
        if (mode === 'CC') updateConnection();
      }
      return null;
    }

    // :SOUR:VOLT:LEV? - Query voltage setpoint
    if (normalized === 'SOUR:VOLT:LEV?') {
      return voltageSetpoint.toFixed(3);
    }

    // :SOUR:VOLT:LEV <value> - Set voltage setpoint
    if (normalized.startsWith('SOUR:VOLT:LEV ')) {
      const value = parseFloat(normalized.slice(14));
      if (!isNaN(value) && value >= 0 && value <= 150) {
        voltageSetpoint = value;
        if (mode === 'CV') updateConnection();
      }
      return null;
    }

    // :SOUR:RES:LEV? - Query resistance setpoint
    if (normalized === 'SOUR:RES:LEV?') {
      return resistanceSetpoint.toFixed(3);
    }

    // :SOUR:RES:LEV <value> - Set resistance setpoint
    if (normalized.startsWith('SOUR:RES:LEV ')) {
      const value = parseFloat(normalized.slice(13));
      if (!isNaN(value) && value >= 0.05 && value <= 15000) {
        resistanceSetpoint = value;
        if (mode === 'CR') updateConnection();
      }
      return null;
    }

    // :SOUR:POW:LEV? - Query power setpoint
    if (normalized === 'SOUR:POW:LEV?') {
      return powerSetpoint.toFixed(3);
    }

    // :SOUR:POW:LEV <value> - Set power setpoint
    if (normalized.startsWith('SOUR:POW:LEV ')) {
      const value = parseFloat(normalized.slice(13));
      if (!isNaN(value) && value >= 0 && value <= 200) {
        powerSetpoint = value;
        if (mode === 'CP') updateConnection();
      }
      return null;
    }

    // :MEAS:VOLT? - Measure voltage
    if (normalized === 'MEAS:VOLT?') {
      const voltage = connection.getLoadVoltage();
      return voltage.toFixed(4);
    }

    // :MEAS:CURR? - Measure current
    if (normalized === 'MEAS:CURR?') {
      const current = connection.getLoadCurrent();
      return current.toFixed(4);
    }

    // :MEAS:POW? - Measure power
    if (normalized === 'MEAS:POW?') {
      const power = connection.getLoadPower();
      return power.toFixed(4);
    }

    // :MEAS:RES? - Measure resistance
    if (normalized === 'MEAS:RES?') {
      const resistance = connection.getLoadResistance();
      return resistance.toFixed(4);
    }

    // :SYST:ERR? - Error queue (always return no error)
    if (normalized === 'SYST:ERR?') {
      return '0,No error';
    }

    // List mode commands
    if (normalized.startsWith('SOUR:LIST:MODE ')) {
      const newMode = parseMode(normalized.slice(15));
      if (newMode) listMode = newMode;
      return null;
    }

    if (normalized === 'SOUR:LIST:MODE?') {
      return modeToScpi(listMode);
    }

    if (normalized.startsWith('SOUR:LIST:RANG ')) {
      // Ignore range setting in simulation
      return null;
    }

    if (normalized.startsWith('SOUR:LIST:STEP ')) {
      const count = parseInt(normalized.slice(15), 10);
      if (!isNaN(count) && count > 0 && count <= 512) {
        // Initialize steps array
        listSteps = new Array(count).fill(null).map(() => ({ value: 0, duration: 1 }));
      }
      return null;
    }

    if (normalized.startsWith('SOUR:LIST:COUN ')) {
      const count = parseInt(normalized.slice(15), 10);
      if (!isNaN(count)) listCount = count;
      return null;
    }

    if (normalized.startsWith('SOUR:LIST:LEV ')) {
      // Format: :SOUR:LIST:LEV <idx>,<value>
      const params = normalized.slice(14).split(',');
      if (params.length >= 2) {
        const idx = parseInt(params[0], 10);
        const value = parseFloat(params[1]);
        if (!isNaN(idx) && !isNaN(value) && idx >= 0 && idx < listSteps.length) {
          listSteps[idx].value = value;
        }
      }
      return null;
    }

    if (normalized.startsWith('SOUR:LIST:WID ')) {
      // Format: :SOUR:LIST:WID <idx>,<duration>
      const params = normalized.slice(14).split(',');
      if (params.length >= 2) {
        const idx = parseInt(params[0], 10);
        const duration = parseFloat(params[1]);
        if (!isNaN(idx) && !isNaN(duration) && idx >= 0 && idx < listSteps.length) {
          listSteps[idx].duration = duration;
        }
      }
      return null;
    }

    if (normalized.startsWith('SOUR:LIST:SLEW ')) {
      // Format: :SOUR:LIST:SLEW <idx>,<rate>
      const params = normalized.slice(15).split(',');
      if (params.length >= 2) {
        const idx = parseInt(params[0], 10);
        const slew = parseFloat(params[1]);
        if (!isNaN(idx) && !isNaN(slew) && idx >= 0 && idx < listSteps.length) {
          listSteps[idx].slew = slew;
        }
      }
      return null;
    }

    if (normalized === 'SOUR:FUNC:MODE LIST') {
      funcMode = 'LIST';
      listRunning = false;
      return null;
    }

    if (normalized === 'SOUR:FUNC:MODE FIX') {
      funcMode = 'FIX';
      listRunning = false;
      return null;
    }

    if (normalized.startsWith('TRIG:SOUR ')) {
      // Ignore trigger source setting
      return null;
    }

    if (normalized === 'TRIG') {
      // Start list execution (simplified - just mark as running)
      if (funcMode === 'LIST') {
        listRunning = true;
        // In a real simulation, we'd step through the list over time
        // For now, just use the first step value
        if (listSteps.length > 0) {
          mode = listMode;
          switch (listMode) {
            case 'CC': currentSetpoint = listSteps[0].value; break;
            case 'CV': voltageSetpoint = listSteps[0].value; break;
            case 'CR': resistanceSetpoint = listSteps[0].value; break;
            case 'CP': powerSetpoint = listSteps[0].value; break;
          }
          updateConnection();
        }
      }
      return null;
    }

    // Unknown command
    console.warn(`[Load Simulator] Unknown command: ${cmd}`);
    return '';
  }

  return {
    handleCommand,
  };
}
