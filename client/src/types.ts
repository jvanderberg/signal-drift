// Re-export shared types (includes HistoryData, DeviceSessionState, etc.)
export * from '../../shared/types';

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
