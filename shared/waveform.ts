/**
 * Shared waveform utilities for client and server
 *
 * Contains:
 * - Waveform generation (sine, triangle, ramp, square, random walk)
 * - Validation functions
 * - Type guards and helper functions
 */

import type {
  WaveformParams,
  RandomWalkParams,
  ArbitraryWaveform,
  SequenceStep,
  SequenceDefinition,
  Result,
} from './types.js';
import { Ok, Err } from './types.js';

// ============ Validation ============

/** Validation constraints for waveform parameters */
export const WAVEFORM_LIMITS = {
  /** Minimum interval between steps (ms) - prevents overwhelming hardware */
  MIN_INTERVAL_MS: 10,
  /** Maximum interval between steps (ms) - 1 hour */
  MAX_INTERVAL_MS: 3600000,
  /** Minimum points per cycle */
  MIN_POINTS: 2,
  /** Maximum points per cycle - prevents memory issues */
  MAX_POINTS: 10000,
  /** Maximum library size */
  MAX_LIBRARY_SIZE: 1000,
  /** Maximum steps in arbitrary waveform */
  MAX_ARBITRARY_STEPS: 10000,
} as const;

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validate waveform parameters
 */
export function validateWaveformParams(params: WaveformParams): Result<void, ValidationError> {
  // Check min/max relationship
  if (params.min >= params.max) {
    return Err({ field: 'min/max', message: 'Min must be less than max' });
  }

  // Check for NaN or Infinity
  if (!Number.isFinite(params.min)) {
    return Err({ field: 'min', message: 'Min must be a finite number' });
  }
  if (!Number.isFinite(params.max)) {
    return Err({ field: 'max', message: 'Max must be a finite number' });
  }

  // Check pointsPerCycle
  if (!Number.isInteger(params.pointsPerCycle)) {
    return Err({ field: 'pointsPerCycle', message: 'Points per cycle must be an integer' });
  }
  if (params.pointsPerCycle < WAVEFORM_LIMITS.MIN_POINTS) {
    return Err({ field: 'pointsPerCycle', message: `Points per cycle must be at least ${WAVEFORM_LIMITS.MIN_POINTS}` });
  }
  if (params.pointsPerCycle > WAVEFORM_LIMITS.MAX_POINTS) {
    return Err({ field: 'pointsPerCycle', message: `Points per cycle must be at most ${WAVEFORM_LIMITS.MAX_POINTS}` });
  }

  // Check intervalMs
  if (!Number.isFinite(params.intervalMs)) {
    return Err({ field: 'intervalMs', message: 'Interval must be a finite number' });
  }
  if (params.intervalMs < WAVEFORM_LIMITS.MIN_INTERVAL_MS) {
    return Err({ field: 'intervalMs', message: `Interval must be at least ${WAVEFORM_LIMITS.MIN_INTERVAL_MS}ms` });
  }
  if (params.intervalMs > WAVEFORM_LIMITS.MAX_INTERVAL_MS) {
    return Err({ field: 'intervalMs', message: `Interval must be at most ${WAVEFORM_LIMITS.MAX_INTERVAL_MS}ms` });
  }

  // Validate waveform type
  const validTypes = ['sine', 'triangle', 'ramp', 'square'];
  if (!validTypes.includes(params.type)) {
    return Err({ field: 'type', message: `Invalid waveform type: ${params.type}` });
  }

  return Ok();
}

/**
 * Validate arbitrary waveform steps
 */
export function validateArbitraryWaveform(waveform: ArbitraryWaveform): Result<void, ValidationError> {
  if (!Array.isArray(waveform.steps)) {
    return Err({ field: 'steps', message: 'Steps must be an array' });
  }

  if (waveform.steps.length === 0) {
    return Err({ field: 'steps', message: 'At least one step is required' });
  }

  if (waveform.steps.length > WAVEFORM_LIMITS.MAX_ARBITRARY_STEPS) {
    return Err({ field: 'steps', message: `Maximum ${WAVEFORM_LIMITS.MAX_ARBITRARY_STEPS} steps allowed` });
  }

  for (let i = 0; i < waveform.steps.length; i++) {
    const step = waveform.steps[i];

    if (!Number.isFinite(step.value)) {
      return Err({ field: `steps[${i}].value`, message: 'Step value must be a finite number' });
    }

    if (!Number.isFinite(step.dwellMs)) {
      return Err({ field: `steps[${i}].dwellMs`, message: 'Step dwell time must be a finite number' });
    }

    if (step.dwellMs < WAVEFORM_LIMITS.MIN_INTERVAL_MS) {
      return Err({ field: `steps[${i}].dwellMs`, message: `Step dwell time must be at least ${WAVEFORM_LIMITS.MIN_INTERVAL_MS}ms` });
    }

    if (step.dwellMs > WAVEFORM_LIMITS.MAX_INTERVAL_MS) {
      return Err({ field: `steps[${i}].dwellMs`, message: `Step dwell time must be at most ${WAVEFORM_LIMITS.MAX_INTERVAL_MS}ms` });
    }
  }

  return Ok();
}

/**
 * Validate a complete sequence definition (excluding id/timestamps)
 */
export function validateSequenceDefinition(
  def: Omit<SequenceDefinition, 'id' | 'createdAt' | 'updatedAt'>
): Result<void, ValidationError> {
  // Validate name
  if (typeof def.name !== 'string' || def.name.trim().length === 0) {
    return Err({ field: 'name', message: 'Name is required' });
  }
  if (def.name.length > 100) {
    return Err({ field: 'name', message: 'Name must be 100 characters or less' });
  }

  // Validate unit
  const validUnits = ['V', 'A', 'W', 'Ω'];
  if (!validUnits.includes(def.unit)) {
    return Err({ field: 'unit', message: `Invalid unit: ${def.unit}` });
  }

  // Validate waveform
  if (isArbitrary(def.waveform)) {
    const result = validateArbitraryWaveform(def.waveform);
    if (!result.ok) return result;
  } else if (isRandomWalk(def.waveform)) {
    const result = validateRandomWalkParams(def.waveform);
    if (!result.ok) return result;
  } else {
    const result = validateWaveformParams(def.waveform);
    if (!result.ok) return result;
  }

  // Validate optional modifiers
  if (def.scale !== undefined && !Number.isFinite(def.scale)) {
    return Err({ field: 'scale', message: 'Scale must be a finite number' });
  }
  if (def.offset !== undefined && !Number.isFinite(def.offset)) {
    return Err({ field: 'offset', message: 'Offset must be a finite number' });
  }
  if (def.minClamp !== undefined && !Number.isFinite(def.minClamp)) {
    return Err({ field: 'minClamp', message: 'Min clamp must be a finite number' });
  }
  if (def.maxClamp !== undefined && !Number.isFinite(def.maxClamp)) {
    return Err({ field: 'maxClamp', message: 'Max clamp must be a finite number' });
  }
  if (def.preValue !== undefined && !Number.isFinite(def.preValue)) {
    return Err({ field: 'preValue', message: 'Pre-value must be a finite number' });
  }
  if (def.postValue !== undefined && !Number.isFinite(def.postValue)) {
    return Err({ field: 'postValue', message: 'Post-value must be a finite number' });
  }
  if (def.maxSlewRate !== undefined) {
    if (!Number.isFinite(def.maxSlewRate) || def.maxSlewRate <= 0) {
      return Err({ field: 'maxSlewRate', message: 'Max slew rate must be a positive number' });
    }
  }

  return Ok();
}

/**
 * Validate random walk parameters
 */
export function validateRandomWalkParams(params: RandomWalkParams): Result<void, ValidationError> {
  // Check min/max relationship
  if (params.min >= params.max) {
    return Err({ field: 'min/max', message: 'Min must be less than max' });
  }

  // Check for NaN or Infinity
  if (!Number.isFinite(params.min)) {
    return Err({ field: 'min', message: 'Min must be a finite number' });
  }
  if (!Number.isFinite(params.max)) {
    return Err({ field: 'max', message: 'Max must be a finite number' });
  }

  // Check startValue is within bounds
  if (!Number.isFinite(params.startValue)) {
    return Err({ field: 'startValue', message: 'Start value must be a finite number' });
  }
  if (params.startValue < params.min || params.startValue > params.max) {
    return Err({ field: 'startValue', message: 'Start value must be within min/max bounds' });
  }

  // Check maxStepSize
  if (!Number.isFinite(params.maxStepSize) || params.maxStepSize <= 0) {
    return Err({ field: 'maxStepSize', message: 'Max step size must be a positive number' });
  }

  // Check pointsPerCycle
  if (!Number.isInteger(params.pointsPerCycle)) {
    return Err({ field: 'pointsPerCycle', message: 'Points per cycle must be an integer' });
  }
  if (params.pointsPerCycle < WAVEFORM_LIMITS.MIN_POINTS) {
    return Err({ field: 'pointsPerCycle', message: `Points per cycle must be at least ${WAVEFORM_LIMITS.MIN_POINTS}` });
  }
  if (params.pointsPerCycle > WAVEFORM_LIMITS.MAX_POINTS) {
    return Err({ field: 'pointsPerCycle', message: `Points per cycle must be at most ${WAVEFORM_LIMITS.MAX_POINTS}` });
  }

  // Check intervalMs
  if (!Number.isFinite(params.intervalMs)) {
    return Err({ field: 'intervalMs', message: 'Interval must be a finite number' });
  }
  if (params.intervalMs < WAVEFORM_LIMITS.MIN_INTERVAL_MS) {
    return Err({ field: 'intervalMs', message: `Interval must be at least ${WAVEFORM_LIMITS.MIN_INTERVAL_MS}ms` });
  }
  if (params.intervalMs > WAVEFORM_LIMITS.MAX_INTERVAL_MS) {
    return Err({ field: 'intervalMs', message: `Interval must be at most ${WAVEFORM_LIMITS.MAX_INTERVAL_MS}ms` });
  }

  return Ok();
}

// ============ Type Guards ============

/**
 * Type guard: check if waveform is arbitrary (has steps array)
 */
export function isArbitrary(waveform: WaveformParams | RandomWalkParams | ArbitraryWaveform): waveform is ArbitraryWaveform {
  return 'steps' in waveform;
}

/**
 * Type guard: check if waveform is random walk
 */
export function isRandomWalk(waveform: WaveformParams | RandomWalkParams | ArbitraryWaveform): waveform is RandomWalkParams {
  return 'type' in waveform && waveform.type === 'random';
}

// ============ Waveform Generation ============

/**
 * Generate sine waveform steps
 * N loopable points, ending at center for clean looping
 */
export function generateSine(params: WaveformParams): SequenceStep[] {
  const { min, max, pointsPerCycle, intervalMs } = params;
  const amplitude = (max - min) / 2;
  const center = min + amplitude;
  const steps: SequenceStep[] = [];

  // First point is one step after center, last point is center
  for (let i = 1; i <= pointsPerCycle; i++) {
    const angle = (2 * Math.PI * i) / pointsPerCycle;
    const value = center + amplitude * Math.sin(angle);
    steps.push({ value, dwellMs: intervalMs });
  }

  return steps;
}

/**
 * Generate triangle waveform steps
 * N loopable points, ending at min
 */
export function generateTriangle(params: WaveformParams): SequenceStep[] {
  const { min, max, pointsPerCycle, intervalMs } = params;
  const steps: SequenceStep[] = [];

  for (let i = 1; i <= pointsPerCycle; i++) {
    const t = i / pointsPerCycle;
    let value: number;
    if (t <= 0.5) {
      value = min + (max - min) * (t * 2); // Rising
    } else {
      value = max - (max - min) * ((t - 0.5) * 2); // Falling
    }
    steps.push({ value, dwellMs: intervalMs });
  }

  return steps;
}

/**
 * Generate ramp waveform steps (linear sweep from min to max)
 */
export function generateRamp(params: WaveformParams): SequenceStep[] {
  const { min, max, pointsPerCycle, intervalMs } = params;
  const steps: SequenceStep[] = [];

  for (let i = 0; i < pointsPerCycle; i++) {
    const t = pointsPerCycle > 1 ? i / (pointsPerCycle - 1) : 0;
    const value = min + (max - min) * t;
    steps.push({ value, dwellMs: intervalMs });
  }

  return steps;
}

/**
 * Generate square waveform steps (50% duty cycle)
 */
export function generateSquare(params: WaveformParams): SequenceStep[] {
  const { min, max, pointsPerCycle, intervalMs } = params;
  const halfPoints = Math.floor(pointsPerCycle / 2);
  const steps: SequenceStep[] = [];

  // High phase
  for (let i = 0; i < halfPoints; i++) {
    steps.push({ value: max, dwellMs: intervalMs });
  }

  // Low phase
  for (let i = 0; i < pointsPerCycle - halfPoints; i++) {
    steps.push({ value: min, dwellMs: intervalMs });
  }

  return steps;
}

/**
 * Generate random walk steps
 * Each step changes by a random amount within [-maxStepSize, +maxStepSize]
 * Values are clamped to min/max bounds
 *
 * @param params - Random walk parameters
 * @param lastValue - Optional starting value (for cycle continuation). If not provided, uses params.startValue
 */
export function generateRandomWalk(params: RandomWalkParams, lastValue?: number): SequenceStep[] {
  const { min, max, maxStepSize, pointsPerCycle, intervalMs, startValue } = params;
  const steps: SequenceStep[] = [];

  // Use lastValue if provided (for cycle continuation), otherwise use startValue
  let currentValue = lastValue !== undefined ? lastValue : startValue;

  for (let i = 0; i < pointsPerCycle; i++) {
    // Generate random step in [-maxStepSize, +maxStepSize]
    const step = (Math.random() * 2 - 1) * maxStepSize;
    currentValue = currentValue + step;

    // Clamp to bounds
    currentValue = Math.max(min, Math.min(max, currentValue));

    steps.push({ value: currentValue, dwellMs: intervalMs });
  }

  return steps;
}

/**
 * Generate steps from any waveform parameters
 */
export function generateWaveformSteps(params: WaveformParams): SequenceStep[] {
  switch (params.type) {
    case 'sine':
      return generateSine(params);
    case 'triangle':
      return generateTriangle(params);
    case 'ramp':
      return generateRamp(params);
    case 'square':
      return generateSquare(params);
    default: {
      const exhaustiveCheck: never = params.type;
      throw new Error(`Unknown waveform type: ${exhaustiveCheck}`);
    }
  }
}

/**
 * Resolve waveform definition to steps (handles both standard and arbitrary)
 */
export function resolveWaveformSteps(waveform: WaveformParams | ArbitraryWaveform): SequenceStep[] {
  if (isArbitrary(waveform)) {
    return waveform.steps;
  }
  return generateWaveformSteps(waveform);
}

/**
 * Apply modifiers (scale, offset, clamp) to steps
 */
export function applyModifiers(
  steps: SequenceStep[],
  scale?: number,
  offset?: number,
  minClamp?: number,
  maxClamp?: number
): SequenceStep[] {
  if (scale === undefined && offset === undefined && minClamp === undefined && maxClamp === undefined) {
    return steps;
  }

  return steps.map((step) => {
    let value = step.value;
    if (scale !== undefined) value *= scale;
    if (offset !== undefined) value += offset;
    if (minClamp !== undefined) value = Math.max(value, minClamp);
    if (maxClamp !== undefined) value = Math.min(value, maxClamp);
    return { ...step, value };
  });
}

/**
 * Calculate total duration of steps in milliseconds
 */
export function calculateDuration(steps: SequenceStep[]): number {
  return steps.reduce((sum, step) => sum + step.dwellMs, 0);
}

// ============ CSV Parsing ============

/**
 * Parse CSV format arbitrary steps (value,dwellMs per line)
 * Returns null if parsing fails
 */
export function parseArbitraryStepsCSV(csv: string): SequenceStep[] | null {
  const lines = csv.trim().split('\n');
  const steps: SequenceStep[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue; // Skip empty lines

    const parts = trimmed.split(',').map((s) => s.trim());
    if (parts.length < 2) continue;

    const value = parseFloat(parts[0]);
    const dwellMs = parseFloat(parts[1]);

    if (isNaN(value) || isNaN(dwellMs) || dwellMs <= 0) {
      return null;
    }

    steps.push({ value, dwellMs });
  }

  return steps.length > 0 ? steps : null;
}

/**
 * Convert steps to CSV format
 */
export function stepsToCSV(steps: SequenceStep[]): string {
  return steps.map((s) => `${s.value},${s.dwellMs}`).join('\n');
}
