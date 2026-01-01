/**
 * WaveformGenerator - Server-side wrapper around shared waveform utilities
 *
 * Re-exports shared waveform generation functions and provides the
 * factory interface expected by existing server code.
 */

import type { WaveformParams, RandomWalkParams, SequenceStep, ArbitraryWaveform } from '../../shared/types.js';
import {
  generateSine,
  generateTriangle,
  generateRamp,
  generateSquare,
  generateWaveformSteps,
  generateRandomWalk,
  isArbitrary,
  isRandomWalk,
} from '../../shared/waveform.js';

export interface WaveformGenerator {
  generateSine(params: WaveformParams): SequenceStep[];
  generateTriangle(params: WaveformParams): SequenceStep[];
  generateRamp(params: WaveformParams): SequenceStep[];
  generateSquare(params: WaveformParams): SequenceStep[];
  generateRandomWalk(params: RandomWalkParams, lastValue?: number): SequenceStep[];
  generate(params: WaveformParams): SequenceStep[];
  isArbitrary(waveform: WaveformParams | RandomWalkParams | ArbitraryWaveform): waveform is ArbitraryWaveform;
  isRandomWalk(waveform: WaveformParams | RandomWalkParams | ArbitraryWaveform): waveform is RandomWalkParams;
}

export function createWaveformGenerator(): WaveformGenerator {
  return {
    generateSine,
    generateTriangle,
    generateRamp,
    generateSquare,
    generateRandomWalk,
    generate: generateWaveformSteps,
    isArbitrary,
    isRandomWalk,
  };
}

// Re-export for direct use
export {
  generateSine,
  generateTriangle,
  generateRamp,
  generateSquare,
  generateWaveformSteps,
  generateRandomWalk,
  isArbitrary,
  isRandomWalk,
};
