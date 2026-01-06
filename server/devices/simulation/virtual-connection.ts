/**
 * Virtual Connection
 * Links PSU, Boost Converter, and Load electrically for simulation
 *
 * Topology:
 *   PSU (3-12V) → Boost Converter → 24V Output → Load
 *
 * The boost converter steps up the PSU voltage to 24V (configurable).
 * An oscilloscope can observe:
 *   - CH1: PWM gate drive signal
 *   - CH2: Switching node voltage
 *   - CH3: Output voltage with ripple
 *   - CH4: Input current waveform
 *
 * Physics Simulation Notes:
 * - PSU operates as a voltage source with current limiting
 * - Boost converter uses duty cycle D = 1 - (Vin / Vout)
 * - When load demands more current than PSU limit, PSU enters CC mode
 * - Voltage droop is modeled as gradual (not step function) based on current/limit ratio
 * - Load CV mode uses proportional control to regulate terminal voltage
 * - Measurement jitter simulates real ADC noise and environmental factors
 *
 * Limitations:
 * - Simplified boost converter model (ideal efficiency)
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

  /**
   * Boost converter target output voltage.
   * Default: 24V
   */
  boostTargetVoltage?: number;

  /**
   * Boost converter switching frequency in Hz.
   * Typical: 100kHz - 500kHz
   * Default: 200000 (200kHz)
   */
  boostSwitchingFrequency?: number;

  /**
   * Boost converter efficiency (0-1).
   * Real converters typically 85-95%.
   * Default: 0.90 (90%)
   */
  boostEfficiency?: number;

  /**
   * Output capacitance in microfarads.
   * Affects output voltage ripple.
   * Default: 100µF
   */
  boostOutputCapacitance?: number;

  /**
   * Inductance in microhenries.
   * Affects current ripple and switching behavior.
   * Default: 22µH
   */
  boostInductance?: number;
}

/**
 * Boost converter state for oscilloscope waveform generation
 */
export interface BoostConverterState {
  /** Input voltage from PSU */
  inputVoltage: number;
  /** Output voltage (target is usually 24V) */
  outputVoltage: number;
  /** Duty cycle (0-1), calculated as 1 - Vin/Vout */
  dutyCycle: number;
  /** Input current (higher than output due to boost action) */
  inputCurrent: number;
  /** Output current (load current) */
  outputCurrent: number;
  /** Switching frequency in Hz */
  switchingFrequency: number;
  /** Whether the converter is active (PSU output enabled and voltage > 0) */
  active: boolean;
  /** Output voltage ripple peak-to-peak in volts */
  outputRipple: number;
  /** Inductor current ripple peak-to-peak in amps */
  inductorRipple: number;
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
  getLoadVoltage(): number;  // Voltage at load terminals (boost converter output)
  getLoadCurrent(): number;
  getLoadPower(): number;
  getLoadResistance(): number;

  // Boost converter
  getBoostConverterState(): BoostConverterState;

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
  boostTargetVoltage: 24,           // 24V output
  boostSwitchingFrequency: 200000,  // 200kHz
  boostEfficiency: 0.90,            // 90% efficiency
  boostOutputCapacitance: 100,      // 100µF
  boostInductance: 22,              // 22µH
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
   * Calculate the boost converter and circuit state.
   *
   * Topology: PSU → Boost Converter → Load
   *
   * The boost converter steps up PSU voltage (3-12V) to target (24V).
   * Load is connected to the boost output, not directly to PSU.
   */
  function calculateBoostCircuit(): {
    psuVoltage: number;      // Voltage at PSU output (into boost)
    psuCurrent: number;      // Current drawn from PSU
    boostOutputVoltage: number;  // Voltage at boost output (to load)
    loadCurrent: number;     // Current drawn by load
    dutyCycle: number;       // Boost duty cycle
    outputRipple: number;    // Output voltage ripple Vpp
    inductorRipple: number;  // Inductor current ripple App
  } {
    const targetVout = resolvedConfig.boostTargetVoltage;
    const efficiency = resolvedConfig.boostEfficiency;
    const switchFreq = resolvedConfig.boostSwitchingFrequency;
    const inductance = resolvedConfig.boostInductance * 1e-6; // µH to H
    const capacitance = resolvedConfig.boostOutputCapacitance * 1e-6; // µF to F

    // If PSU output is disabled, everything is off
    if (!state.psuOutputEnabled) {
      return {
        psuVoltage: 0,
        psuCurrent: 0,
        boostOutputVoltage: 0,
        loadCurrent: 0,
        dutyCycle: 0,
        outputRipple: 0,
        inductorRipple: 0,
      };
    }

    const psuVoltage = state.psuVoltage;

    // Boost converter needs minimum input voltage to operate
    if (psuVoltage < 1.0) {
      return {
        psuVoltage: psuVoltage,
        psuCurrent: 0,
        boostOutputVoltage: 0,
        loadCurrent: 0,
        dutyCycle: 0,
        outputRipple: 0,
        inductorRipple: 0,
      };
    }

    // Calculate ideal duty cycle: D = 1 - Vin/Vout
    // Clamp to valid range
    let dutyCycle = 1 - (psuVoltage / targetVout);
    dutyCycle = Math.max(0, Math.min(0.9, dutyCycle)); // Max 90% duty cycle for stability

    // Actual boost output voltage (may be limited by duty cycle constraint)
    let boostOutputVoltage = psuVoltage / (1 - dutyCycle);

    // If load input is disabled, boost runs at no-load (light regulation)
    if (!state.loadInputEnabled) {
      return {
        psuVoltage,
        psuCurrent: 0.01, // Small quiescent current
        boostOutputVoltage,
        loadCurrent: 0,
        dutyCycle,
        outputRipple: 0,
        inductorRipple: 0,
      };
    }

    // Calculate load current demand at boost output voltage
    let loadDemandedCurrent: number;

    switch (state.loadMode) {
      case 'CC':
        loadDemandedCurrent = state.loadSetpoint;
        break;

      case 'CV': {
        // CV mode: load regulates to setpoint voltage
        const voltageDelta = boostOutputVoltage - state.loadSetpoint;
        if (voltageDelta > 0 && state.loadSetpoint > 0) {
          loadDemandedCurrent = resolvedConfig.loadCvGain * voltageDelta;
        } else {
          loadDemandedCurrent = 0;
        }
        break;
      }

      case 'CR':
        if (state.loadSetpoint > 0) {
          loadDemandedCurrent = boostOutputVoltage / state.loadSetpoint;
        } else {
          loadDemandedCurrent = 0;
        }
        break;

      case 'CP':
        if (boostOutputVoltage > 0 && state.loadSetpoint > 0) {
          loadDemandedCurrent = state.loadSetpoint / boostOutputVoltage;
        } else {
          loadDemandedCurrent = 0;
        }
        break;

      default:
        loadDemandedCurrent = 0;
    }

    // Calculate required input current from PSU
    // Pin = Pout / efficiency, and Pin = Vin * Iin, Pout = Vout * Iout
    // So Iin = (Vout * Iout) / (Vin * efficiency)
    const psuDemandedCurrent = (boostOutputVoltage * loadDemandedCurrent) / (psuVoltage * efficiency);

    // Apply PSU current limit
    const psuActualCurrent = Math.min(Math.max(0, psuDemandedCurrent), state.psuCurrentLimit);

    // If PSU is current-limited, reduce the boost output power/voltage
    let loadActualCurrent = loadDemandedCurrent;
    let actualBoostVoltage = boostOutputVoltage;

    if (psuDemandedCurrent > state.psuCurrentLimit && psuDemandedCurrent > 0) {
      // PSU is limiting - scale down the output power
      const powerRatio = (state.psuCurrentLimit * psuVoltage * efficiency) / (boostOutputVoltage * loadDemandedCurrent);
      loadActualCurrent = loadDemandedCurrent * powerRatio;

      // Boost output voltage droops when overloaded
      const droopFactor = Math.max(0.5, powerRatio);
      actualBoostVoltage = boostOutputVoltage * droopFactor;
    }

    // Calculate ripple characteristics for oscilloscope display
    // Inductor current ripple: ΔIL = (Vin * D) / (L * f)
    const inductorRipple = (psuVoltage * dutyCycle) / (inductance * switchFreq);

    // Output voltage ripple: ΔVout ≈ (Iout * D) / (C * f)
    const outputRipple = (loadActualCurrent * dutyCycle) / (capacitance * switchFreq);

    return {
      psuVoltage: Math.max(0, psuVoltage - psuActualCurrent * resolvedConfig.psuOutputImpedance),
      psuCurrent: Math.max(0, psuActualCurrent),
      boostOutputVoltage: Math.max(0, actualBoostVoltage),
      loadCurrent: Math.max(0, loadActualCurrent),
      dutyCycle,
      outputRipple: Math.min(outputRipple, actualBoostVoltage * 0.1), // Cap ripple at 10% of voltage
      inductorRipple: Math.min(inductorRipple, psuActualCurrent * 2), // Reasonable limit
    };
  }

  /**
   * Legacy calculateCircuit for backward compatibility.
   * Returns PSU-side measurements.
   */
  function calculateCircuit(): { voltage: number; current: number } {
    const boost = calculateBoostCircuit();
    return {
      voltage: boost.psuVoltage,
      current: boost.psuCurrent,
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
      const boost = calculateBoostCircuit();
      return addJitter(boost.boostOutputVoltage);
    },

    getLoadCurrent(): number {
      const boost = calculateBoostCircuit();
      return addJitter(boost.loadCurrent);
    },

    getLoadPower(): number {
      const boost = calculateBoostCircuit();
      // Jitter applied to the product, not individual values
      return addJitter(boost.boostOutputVoltage * boost.loadCurrent);
    },

    getLoadResistance(): number {
      const boost = calculateBoostCircuit();
      if (boost.loadCurrent < 0.0001) return 0; // No meaningful resistance when no current
      return addJitter(boost.boostOutputVoltage / boost.loadCurrent);
    },

    getBoostConverterState(): BoostConverterState {
      const boost = calculateBoostCircuit();
      return {
        inputVoltage: boost.psuVoltage,
        outputVoltage: boost.boostOutputVoltage,
        dutyCycle: boost.dutyCycle,
        inputCurrent: boost.psuCurrent,
        outputCurrent: boost.loadCurrent,
        switchingFrequency: resolvedConfig.boostSwitchingFrequency,
        active: state.psuOutputEnabled && state.psuVoltage >= 1.0,
        outputRipple: boost.outputRipple,
        inductorRipple: boost.inductorRipple,
      };
    },

    getConfig(): Required<VirtualConnectionConfig> {
      return { ...resolvedConfig };
    },
  };
}
