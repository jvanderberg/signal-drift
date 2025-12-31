/**
 * Virtual Connection
 * Links PSU and Load electrically for simulation
 *
 * PSU output voltage → Load input voltage
 * Load current draw → PSU current measurement
 *
 * Physics Simulation Notes:
 * - PSU operates as a voltage source with current limiting
 * - When load demands more current than PSU limit, PSU enters CC mode
 * - Voltage droop is modeled as gradual (not step function) based on current/limit ratio
 * - Load CV mode uses proportional control to regulate terminal voltage
 * - Measurement jitter simulates real ADC noise and environmental factors
 *
 * Limitations:
 * - No wire resistance or inductance modeling
 * - No thermal effects on readings
 * - CV mode uses simplified proportional control (real loads use PID)
 * - No transient response simulation (settling time, overshoot)
 */

export interface VirtualConnectionConfig {
  /**
   * Measurement stability in PPM (parts per million).
   * Adds proportional noise to readings that scales with measurement value.
   * Real instruments typically have 50-500 PPM stability.
   * Default: 100 PPM (0.01% variation)
   */
  measurementStabilityPPM?: number;

  /**
   * Absolute measurement noise floor in millivolts.
   * This is the minimum noise present regardless of measurement value.
   * Real bench equipment typically has 0.5-2mV noise floor.
   * Default: 1.0 mV
   */
  measurementNoiseFloorMv?: number;

  /**
   * PSU output impedance in ohms. Affects voltage droop under load.
   * Typical regulated bench supplies: 1-10 mΩ
   * Default: 0.005 ohms (5mΩ)
   */
  psuOutputImpedance?: number;

  /**
   * CV mode gain for load. Higher = more aggressive regulation.
   * Affects how quickly the load responds to voltage differences.
   * Default: 10 A/V
   */
  loadCvGain?: number;
}

export interface VirtualConnection {
  // PSU side
  setPsuVoltage(voltage: number): void;
  setPsuCurrentLimit(limit: number): void;
  setPsuOutputEnabled(enabled: boolean): void;
  getPsuVoltage(): number;   // Voltage PSU is outputting (setpoint, or drooped under load)
  getPsuCurrent(): number;
  getPsuMode(): 'CV' | 'CC';

  // Load side
  setLoadMode(mode: 'CC' | 'CV' | 'CR' | 'CP'): void;
  setLoadSetpoint(value: number): void;
  setLoadInputEnabled(enabled: boolean): void;
  getLoadVoltage(): number;  // Voltage at load terminals (from PSU)
  getLoadCurrent(): number;
  getLoadPower(): number;
  getLoadResistance(): number;

  // Configuration
  getConfig(): Required<VirtualConnectionConfig>;
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

const DEFAULT_CONFIG: Required<VirtualConnectionConfig> = {
  measurementStabilityPPM: 100,
  measurementNoiseFloorMv: 1.0,
  psuOutputImpedance: 0.005, // 5mΩ - typical for regulated bench PSU
  loadCvGain: 10,
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

  /**
   * Add measurement jitter to simulate real instrument noise.
   * Uses Gaussian-ish distribution (sum of uniform randoms approximates normal).
   *
   * Real instruments have two noise components:
   * 1. Absolute noise floor (ADC quantization, thermal noise) - constant regardless of value
   * 2. Proportional noise (PPM stability) - scales with measurement value
   */
  function addJitter(value: number): number {
    // No jitter for zero values or if both noise sources are disabled
    const hasNoiseFloor = resolvedConfig.measurementNoiseFloorMv > 0;
    const hasPpmNoise = resolvedConfig.measurementStabilityPPM > 0;

    if (value === 0 || (!hasNoiseFloor && !hasPpmNoise)) return value;

    // Generate pseudo-Gaussian noise using sum of 3 uniform randoms
    // This gives a bell-curve-ish distribution centered at 0, range roughly [-1, 1]
    const noise = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

    // Calculate total jitter from both components
    let totalJitter = 0;

    // Absolute noise floor (in volts, converted from mV)
    if (hasNoiseFloor) {
      totalJitter += noise * (resolvedConfig.measurementNoiseFloorMv / 1000);
    }

    // Proportional noise (PPM of reading)
    if (hasPpmNoise) {
      const stabilityRatio = resolvedConfig.measurementStabilityPPM / 1_000_000;
      totalJitter += noise * stabilityRatio * Math.abs(value);
    }

    return value + totalJitter;
  }

  /**
   * Calculate the actual circuit state based on both device settings.
   * Returns ideal values (without jitter) for consistent physics calculations.
   */
  function calculateCircuit(): { voltage: number; current: number } {
    // If PSU output is disabled, no voltage or current
    if (!state.psuOutputEnabled) {
      return { voltage: 0, current: 0 };
    }

    // If load input is disabled, PSU outputs voltage but no current flows
    if (!state.loadInputEnabled) {
      return { voltage: state.psuVoltage, current: 0 };
    }

    const psuVoltage = state.psuVoltage;
    const psuCurrentLimit = state.psuCurrentLimit;
    const outputImpedance = resolvedConfig.psuOutputImpedance;

    let demandedCurrent: number;

    switch (state.loadMode) {
      case 'CC':
        // Constant current mode - load tries to draw setpoint current
        demandedCurrent = state.loadSetpoint;
        break;

      case 'CV': {
        // Constant voltage mode - load regulates to setpoint voltage
        // Uses proportional control: current = gain * (Vpsu - Vsetpoint)
        // When Vpsu > Vsetpoint, load sinks current to drop voltage across output impedance
        const voltageDelta = psuVoltage - state.loadSetpoint;
        if (voltageDelta > 0 && state.loadSetpoint > 0) {
          // Load sinks current proportional to voltage difference
          demandedCurrent = resolvedConfig.loadCvGain * voltageDelta;
        } else {
          // PSU voltage at or below setpoint - minimal current needed
          demandedCurrent = 0;
        }
        break;
      }

      case 'CR':
        // Constant resistance mode - I = V / R
        // Use open-circuit voltage for initial estimate, then iterate
        if (state.loadSetpoint > 0) {
          // V = Vpsu - I*Rout, and I = V/R
          // Solving: I = Vpsu / (R + Rout)
          demandedCurrent = psuVoltage / (state.loadSetpoint + outputImpedance);
        } else {
          demandedCurrent = 0;
        }
        break;

      case 'CP':
        // Constant power mode - P = V * I, so I = P / V
        // Use iterative approach: start with open-circuit voltage estimate
        if (psuVoltage > 0 && state.loadSetpoint > 0) {
          // Initial estimate using PSU voltage
          let current = state.loadSetpoint / psuVoltage;
          // Refine once: account for voltage droop
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

    // PSU limits the current if demand exceeds limit
    const actualCurrent = Math.min(Math.max(0, demandedCurrent), psuCurrentLimit);

    // Calculate voltage droop due to output impedance and current
    // V_out = V_setpoint - I * R_output
    // This gives gradual droop instead of step function
    let actualVoltage = psuVoltage - actualCurrent * outputImpedance;

    // When in CC mode (current limited), voltage droops more significantly
    // Model additional droop when approaching current limit
    if (demandedCurrent > psuCurrentLimit) {
      // Load wants more current than PSU can provide
      // Additional voltage collapse proportional to excess demand
      const excessRatio = (demandedCurrent - psuCurrentLimit) / psuCurrentLimit;
      // Soft limiting: voltage drops as demand exceeds capacity
      const ccDroop = Math.min(excessRatio * 0.1, 0.5); // Max 50% additional droop
      actualVoltage *= (1 - ccDroop);
    }

    return {
      voltage: Math.max(0, actualVoltage),
      current: Math.max(0, actualCurrent),
    };
  }

  return {
    // PSU side
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
      // Determine mode from ideal values (no jitter) to avoid flickering
      const { current } = calculateCircuit();
      // CC mode when current is within 2% of limit and load is demanding more
      const atLimit = current >= state.psuCurrentLimit * 0.98;

      // Also check if load is demanding more than PSU can provide
      let demandExceedsLimit = false;
      if (state.loadInputEnabled && state.psuOutputEnabled) {
        // Rough check based on mode
        if (state.loadMode === 'CC' && state.loadSetpoint > state.psuCurrentLimit) {
          demandExceedsLimit = true;
        }
      }

      return (atLimit || demandExceedsLimit) ? 'CC' : 'CV';
    },

    // Load side
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
      // Jitter applied to the product, not individual values
      return addJitter(voltage * current);
    },

    getLoadResistance(): number {
      const { voltage, current } = calculateCircuit();
      if (current < 0.0001) return 0; // No meaningful resistance when no current
      return addJitter(voltage / current);
    },

    getConfig(): Required<VirtualConnectionConfig> {
      return { ...resolvedConfig };
    },
  };
}
