// Re-export shared types (includes HistoryData, DeviceSessionState, etc.)
export * from '../../shared/types';

// Re-export waveform utilities (generation, validation, helpers)
export {
  isArbitrary,
  generateWaveformSteps,
  resolveWaveformSteps,
  applyModifiers,
  calculateDuration,
  parseArbitraryStepsCSV,
  stepsToCSV,
  validateWaveformParams,
  validateArbitraryWaveform,
  validateSequenceDefinition,
  WAVEFORM_LIMITS,
} from '../../shared/waveform';

// Client-only types

export interface SafetyLimits {
  maxPower: number;
  maxCurrent: number;
  maxVoltage: number;
}

export interface Preset {
  name: string;
  voltage: number;
  current: number;
}
