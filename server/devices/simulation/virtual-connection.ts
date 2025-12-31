/**
 * Virtual Connection
 * Links PSU and Load electrically for simulation
 *
 * PSU output voltage → Load input voltage
 * Load current draw → PSU current measurement
 */

export interface VirtualConnection {
  // PSU side
  setPsuVoltage(voltage: number): void;
  setPsuCurrentLimit(limit: number): void;
  setPsuOutputEnabled(enabled: boolean): void;
  getPsuCurrent(): number;
  getPsuMode(): 'CV' | 'CC';

  // Load side
  setLoadMode(mode: 'CC' | 'CV' | 'CR' | 'CP'): void;
  setLoadSetpoint(value: number): void;
  setLoadInputEnabled(enabled: boolean): void;
  getLoadVoltage(): number;
  getLoadCurrent(): number;
  getLoadPower(): number;
  getLoadResistance(): number;
}

export interface VirtualConnectionState {
  // PSU state
  psuVoltage: number;
  psuCurrentLimit: number;
  psuOutputEnabled: boolean;

  // Load state
  loadMode: 'CC' | 'CV' | 'CR' | 'CP';
  loadSetpoint: number;
  loadInputEnabled: boolean;
}

export function createVirtualConnection(): VirtualConnection {
  const state: VirtualConnectionState = {
    psuVoltage: 0,
    psuCurrentLimit: 10,
    psuOutputEnabled: false,
    loadMode: 'CC',
    loadSetpoint: 0,
    loadInputEnabled: false,
  };

  // Calculate the actual circuit state based on both device settings
  function calculateCircuit(): { voltage: number; current: number } {
    // If either side is disabled, no current flows
    if (!state.psuOutputEnabled || !state.loadInputEnabled) {
      return { voltage: state.psuOutputEnabled ? state.psuVoltage : 0, current: 0 };
    }

    const psuVoltage = state.psuVoltage;
    const psuCurrentLimit = state.psuCurrentLimit;

    let demandedCurrent: number;

    switch (state.loadMode) {
      case 'CC':
        // Constant current mode - load tries to draw setpoint current
        demandedCurrent = state.loadSetpoint;
        break;

      case 'CV':
        // Constant voltage mode - load regulates to setpoint voltage
        // Current depends on PSU voltage vs load setpoint
        // If PSU voltage > load setpoint, load sinks current to drop voltage
        // This is simplified - real behavior is more complex
        if (psuVoltage > state.loadSetpoint && state.loadSetpoint > 0) {
          // Load sinks current to maintain its voltage setpoint
          // Approximate with high current demand
          demandedCurrent = psuCurrentLimit;
        } else {
          demandedCurrent = 0;
        }
        break;

      case 'CR':
        // Constant resistance mode - I = V / R
        if (state.loadSetpoint > 0) {
          demandedCurrent = psuVoltage / state.loadSetpoint;
        } else {
          demandedCurrent = 0;
        }
        break;

      case 'CP':
        // Constant power mode - I = P / V
        if (psuVoltage > 0) {
          demandedCurrent = state.loadSetpoint / psuVoltage;
        } else {
          demandedCurrent = 0;
        }
        break;

      default:
        demandedCurrent = 0;
    }

    // PSU limits the current if demand exceeds limit
    const actualCurrent = Math.min(demandedCurrent, psuCurrentLimit);

    // Voltage at load input
    // In CC mode of PSU, voltage may droop - simulate with small droop
    let actualVoltage = psuVoltage;
    if (actualCurrent >= psuCurrentLimit * 0.98) {
      // PSU is in CC mode, slight voltage droop
      actualVoltage = psuVoltage * 0.95;
    }

    return { voltage: Math.max(0, actualVoltage), current: Math.max(0, actualCurrent) };
  }

  return {
    // PSU side
    setPsuVoltage(voltage: number): void {
      state.psuVoltage = voltage;
    },

    setPsuCurrentLimit(limit: number): void {
      state.psuCurrentLimit = limit;
    },

    setPsuOutputEnabled(enabled: boolean): void {
      state.psuOutputEnabled = enabled;
    },

    getPsuCurrent(): number {
      return calculateCircuit().current;
    },

    getPsuMode(): 'CV' | 'CC' {
      const { current } = calculateCircuit();
      // CC mode when current is at limit
      if (current >= state.psuCurrentLimit * 0.98) {
        return 'CC';
      }
      return 'CV';
    },

    // Load side
    setLoadMode(mode: 'CC' | 'CV' | 'CR' | 'CP'): void {
      state.loadMode = mode;
    },

    setLoadSetpoint(value: number): void {
      state.loadSetpoint = value;
    },

    setLoadInputEnabled(enabled: boolean): void {
      state.loadInputEnabled = enabled;
    },

    getLoadVoltage(): number {
      if (!state.loadInputEnabled) return 0;
      return calculateCircuit().voltage;
    },

    getLoadCurrent(): number {
      return calculateCircuit().current;
    },

    getLoadPower(): number {
      const { voltage, current } = calculateCircuit();
      return voltage * current;
    },

    getLoadResistance(): number {
      const { voltage, current } = calculateCircuit();
      if (current < 0.001) return 9999999; // Very high resistance when no current
      return voltage / current;
    },
  };
}
