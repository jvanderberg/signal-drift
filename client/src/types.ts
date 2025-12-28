// Re-export shared types
export * from '../../shared/types';

// Client-only types

export interface HistoryData {
  timestamps: number[];
  voltage: number[];
  current: number[];
  power: number[];
  resistance?: number[];
}

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
