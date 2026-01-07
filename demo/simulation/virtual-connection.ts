/**
 * Virtual Connection (Browser-compatible version)
 * Links PSU and Load electrically for simulation with boost converter
 */

export interface VirtualConnectionConfig {
  measurementStabilityPPM?: number;
  measurementNoiseFloorMv?: number;
  psuOutputImpedance?: number;
  loadCvGain?: number;
  // Boost converter parameters
  boostTargetVoltage?: number;
  boostSwitchingFrequency?: number;
  boostEfficiency?: number;
}

export interface BoostConverterState {
  inputVoltage: number;
  outputVoltage: number;
  dutyCycle: number;
  inputCurrent: number;
  outputCurrent: number;
  switchingFrequency: number;
  active: boolean;
  outputRipple: number;
  inductorRipple: number;
}

export interface VirtualConnection {
  setPsuVoltage(voltage: number): void;
  setPsuCurrentLimit(limit: number): void;
  setPsuOutputEnabled(enabled: boolean): void;
  getPsuVoltage(): number;
  getPsuCurrent(): number;
  getPsuMode(): 'CV' | 'CC';

  setLoadMode(mode: 'CC' | 'CV' | 'CR' | 'CP'): void;
  setLoadSetpoint(value: number): void;
  setLoadInputEnabled(enabled: boolean): void;
  getLoadVoltage(): number;
  getLoadCurrent(): number;
  getLoadPower(): number;
  getLoadResistance(): number;

  getBoostConverterState(): BoostConverterState;
  getConfig(): Required<VirtualConnectionConfig>;
}

interface VirtualConnectionState {
  psuVoltage: number;
  psuCurrentLimit: number;
  psuOutputEnabled: boolean;
  loadMode: 'CC' | 'CV' | 'CR' | 'CP';
  loadSetpoint: number;
  loadInputEnabled: boolean;
}

const DEFAULT_CONFIG: Required<VirtualConnectionConfig> = {
  measurementStabilityPPM: 100,
  measurementNoiseFloorMv: 1.0,
  psuOutputImpedance: 0.005,
  loadCvGain: 10,
  boostTargetVoltage: 24,
  boostSwitchingFrequency: 200000,
  boostEfficiency: 0.90,
};

export function createVirtualConnection(
  config: VirtualConnectionConfig = {}
): VirtualConnection {
  const resolvedConfig: Required<VirtualConnectionConfig> = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  const state: VirtualConnectionState = {
    psuVoltage: 0,
    psuCurrentLimit: 10,
    psuOutputEnabled: false,
    loadMode: 'CC',
    loadSetpoint: 0,
    loadInputEnabled: false,
  };

  function addJitter(value: number): number {
    const hasNoiseFloor = resolvedConfig.measurementNoiseFloorMv > 0;
    const hasPpmNoise = resolvedConfig.measurementStabilityPPM > 0;

    if (value === 0 || (!hasNoiseFloor && !hasPpmNoise)) return value;

    const noise = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
    let totalJitter = 0;

    if (hasNoiseFloor) {
      totalJitter += noise * (resolvedConfig.measurementNoiseFloorMv / 1000);
    }

    if (hasPpmNoise) {
      const stabilityRatio = resolvedConfig.measurementStabilityPPM / 1_000_000;
      totalJitter += noise * stabilityRatio * Math.abs(value);
    }

    return value + totalJitter;
  }

  function calculateCircuit(): { voltage: number; current: number } {
    if (!state.psuOutputEnabled) {
      return { voltage: 0, current: 0 };
    }

    if (!state.loadInputEnabled) {
      return { voltage: state.psuVoltage, current: 0 };
    }

    const psuVoltage = state.psuVoltage;
    const psuCurrentLimit = state.psuCurrentLimit;
    const outputImpedance = resolvedConfig.psuOutputImpedance;

    let demandedCurrent: number;

    switch (state.loadMode) {
      case 'CC':
        demandedCurrent = state.loadSetpoint;
        break;

      case 'CV': {
        const voltageDelta = psuVoltage - state.loadSetpoint;
        if (voltageDelta > 0 && state.loadSetpoint > 0) {
          demandedCurrent = resolvedConfig.loadCvGain * voltageDelta;
        } else {
          demandedCurrent = 0;
        }
        break;
      }

      case 'CR':
        if (state.loadSetpoint > 0) {
          demandedCurrent = psuVoltage / (state.loadSetpoint + outputImpedance);
        } else {
          demandedCurrent = 0;
        }
        break;

      case 'CP':
        if (psuVoltage > 0 && state.loadSetpoint > 0) {
          let current = state.loadSetpoint / psuVoltage;
          const voltageWithDroop = psuVoltage - current * outputImpedance;
          if (voltageWithDroop > 0) {
            current = state.loadSetpoint / voltageWithDroop;
          }
          demandedCurrent = current;
        } else {
          demandedCurrent = 0;
        }
        break;

      default:
        demandedCurrent = 0;
    }

    const actualCurrent = Math.min(Math.max(0, demandedCurrent), psuCurrentLimit);
    let actualVoltage = psuVoltage - actualCurrent * outputImpedance;

    if (demandedCurrent > psuCurrentLimit) {
      const excessRatio = (demandedCurrent - psuCurrentLimit) / psuCurrentLimit;
      const ccDroop = Math.min(excessRatio * 0.1, 0.5);
      actualVoltage *= (1 - ccDroop);
    }

    return {
      voltage: Math.max(0, actualVoltage),
      current: Math.max(0, actualCurrent),
    };
  }

  return {
    setPsuVoltage(voltage: number): void {
      state.psuVoltage = Math.max(0, voltage);
    },

    setPsuCurrentLimit(limit: number): void {
      state.psuCurrentLimit = Math.max(0, limit);
    },

    setPsuOutputEnabled(enabled: boolean): void {
      state.psuOutputEnabled = enabled;
    },

    getPsuVoltage(): number {
      const { voltage } = calculateCircuit();
      return addJitter(voltage);
    },

    getPsuCurrent(): number {
      const { current } = calculateCircuit();
      return addJitter(current);
    },

    getPsuMode(): 'CV' | 'CC' {
      const { current } = calculateCircuit();
      const atLimit = current >= state.psuCurrentLimit * 0.98;

      let demandExceedsLimit = false;
      if (state.loadInputEnabled && state.psuOutputEnabled) {
        if (state.loadMode === 'CC' && state.loadSetpoint > state.psuCurrentLimit) {
          demandExceedsLimit = true;
        }
      }

      return (atLimit || demandExceedsLimit) ? 'CC' : 'CV';
    },

    setLoadMode(mode: 'CC' | 'CV' | 'CR' | 'CP'): void {
      state.loadMode = mode;
    },

    setLoadSetpoint(value: number): void {
      state.loadSetpoint = Math.max(0, value);
    },

    setLoadInputEnabled(enabled: boolean): void {
      state.loadInputEnabled = enabled;
    },

    getLoadVoltage(): number {
      const { voltage } = calculateCircuit();
      return addJitter(voltage);
    },

    getLoadCurrent(): number {
      const { current } = calculateCircuit();
      return addJitter(current);
    },

    getLoadPower(): number {
      const { voltage, current } = calculateCircuit();
      return addJitter(voltage * current);
    },

    getLoadResistance(): number {
      const { voltage, current } = calculateCircuit();
      if (current < 0.0001) return 0;
      return addJitter(voltage / current);
    },

    getBoostConverterState(): BoostConverterState {
      const psuVoltage = state.psuOutputEnabled ? state.psuVoltage : 0;
      const targetVout = resolvedConfig.boostTargetVoltage;
      const switchingFrequency = resolvedConfig.boostSwitchingFrequency;
      const efficiency = resolvedConfig.boostEfficiency;

      // Boost converter is active when PSU is on and has voltage
      const active = state.psuOutputEnabled && psuVoltage > 0;

      if (!active) {
        return {
          inputVoltage: 0,
          outputVoltage: 0,
          dutyCycle: 0,
          inputCurrent: 0,
          outputCurrent: 0,
          switchingFrequency,
          active: false,
          outputRipple: 0,
          inductorRipple: 0,
        };
      }

      // Calculate output current based on load
      const { current: loadCurrent } = calculateCircuit();
      const outputCurrent = state.loadInputEnabled ? loadCurrent : 0;

      // Input current = output current * Vout / (Vin * efficiency)
      const inputCurrent = outputCurrent > 0
        ? (outputCurrent * targetVout) / (psuVoltage * efficiency)
        : 0;

      // Calculate duty cycle: D = 1 - Vin/Vout for ideal boost converter
      // In reality, duty cycle increases with load to compensate for losses:
      // - Rds(on) losses in the switch
      // - Inductor DCR losses
      // - Diode forward voltage drop
      // Model: D_actual = D_ideal + k * I_out where k represents loss compensation
      const idealDutyCycle = 1 - (psuVoltage / targetVout);
      const lossCompensation = 0.02 * outputCurrent; // ~2% duty increase per amp of load
      const dutyCycle = Math.max(0, Math.min(0.9, idealDutyCycle + lossCompensation));

      // Simplified ripple calculations
      const inductorRipple = inputCurrent * 0.3; // 30% ripple
      const outputRipple = targetVout * 0.02; // 2% output ripple

      return {
        inputVoltage: psuVoltage,
        outputVoltage: targetVout,
        dutyCycle,
        inputCurrent,
        outputCurrent,
        switchingFrequency,
        active,
        outputRipple,
        inductorRipple,
      };
    },

    getConfig(): Required<VirtualConnectionConfig> {
      return { ...resolvedConfig };
    },
  };
}
