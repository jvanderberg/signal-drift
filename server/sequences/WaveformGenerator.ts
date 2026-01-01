/**
 * WaveformGenerator - Generates step arrays from waveform parameters
 *
 * Pure functions that convert waveform definitions (sine, triangle, etc.)
 * into arrays of SequenceStep with value and dwell time.
 */

import type { WaveformParams, SequenceStep, ArbitraryWaveform } from '../../shared/types.js';

export interface WaveformGenerator {
  generateSine(params: WaveformParams): SequenceStep[];
  generateTriangle(params: WaveformParams): SequenceStep[];
  generateRamp(params: WaveformParams): SequenceStep[];
  generateSquare(params: WaveformParams): SequenceStep[];
  generateSteps(params: WaveformParams): SequenceStep[];
  generate(params: WaveformParams): SequenceStep[];
  isArbitrary(waveform: WaveformParams | ArbitraryWaveform): waveform is ArbitraryWaveform;
}

export function createWaveformGenerator(): WaveformGenerator {
  function generateSine(params: WaveformParams): SequenceStep[] {
    const { min, max, pointsPerCycle, intervalMs } = params;
    const amplitude = (max - min) / 2;
    const center = min + amplitude;
    const steps: SequenceStep[] = [];

    // Generate N points, ending at center for clean looping
    // First point is one step after center, last point is center
    // angles: 2π/N, 2π*2/N, ..., 2π (=0, center)
    for (let i = 1; i <= pointsPerCycle; i++) {
      const angle = (2 * Math.PI * i) / pointsPerCycle;
      const value = center + amplitude * Math.sin(angle);
      steps.push({ value, dwellMs: intervalMs });
    }

    return steps;
  }

  function generateTriangle(params: WaveformParams): SequenceStep[] {
    const { min, max, pointsPerCycle, intervalMs } = params;
    const steps: SequenceStep[] = [];

    // Generate N loopable points, ending at min
    // First point is one step after min (going up), last point is min
    for (let i = 1; i <= pointsPerCycle; i++) {
      const t = i / pointsPerCycle; // 1/N to N/N (which wraps to 0 = min)
      // Triangle: 0->0.5 rises min->max, 0.5->1 falls max->min
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

  function generateRamp(params: WaveformParams): SequenceStep[] {
    const { min, max, pointsPerCycle, intervalMs } = params;
    const steps: SequenceStep[] = [];

    for (let i = 0; i < pointsPerCycle; i++) {
      const t = pointsPerCycle > 1 ? i / (pointsPerCycle - 1) : 0;
      const value = min + (max - min) * t;
      steps.push({ value, dwellMs: intervalMs });
    }

    return steps;
  }

  function generateSquare(params: WaveformParams): SequenceStep[] {
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

  function generateSteps(params: WaveformParams): SequenceStep[] {
    const { min, max, pointsPerCycle, intervalMs } = params;
    const steps: SequenceStep[] = [];

    // Discrete steps from min to max
    for (let i = 0; i < pointsPerCycle; i++) {
      const t = pointsPerCycle > 1 ? i / (pointsPerCycle - 1) : 0;
      const value = min + (max - min) * t;
      steps.push({ value, dwellMs: intervalMs });
    }

    return steps;
  }

  function generate(params: WaveformParams): SequenceStep[] {
    switch (params.type) {
      case 'sine':
        return generateSine(params);
      case 'triangle':
        return generateTriangle(params);
      case 'ramp':
        return generateRamp(params);
      case 'square':
        return generateSquare(params);
      case 'steps':
        return generateSteps(params);
      default: {
        const exhaustiveCheck: never = params.type;
        throw new Error(`Unknown waveform type: ${exhaustiveCheck}`);
      }
    }
  }

  function isArbitrary(waveform: WaveformParams | ArbitraryWaveform): waveform is ArbitraryWaveform {
    return 'steps' in waveform;
  }

  return {
    generateSine,
    generateTriangle,
    generateRamp,
    generateSquare,
    generateSteps,
    generate,
    isArbitrary,
  };
}
