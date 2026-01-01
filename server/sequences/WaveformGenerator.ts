/**
 * WaveformGenerator - Server-side wrapper around shared waveform utilities
 *
 * Re-exports shared waveform generation functions and provides the
 * factory interface expected by existing server code.
 */

import type { WaveformParams, SequenceStep, ArbitraryWaveform } from '../../shared/types.js';
import {
  generateSine,
  generateTriangle,
  generateRamp,
  generateSquare,
  generateSteps,
  generateWaveformSteps,
  isArbitrary,
} from '../../shared/waveform.js';

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
  return {
    generateSine,
    generateTriangle,
    generateRamp,
    generateSquare,
    generateSteps,
    generate: generateWaveformSteps,
    isArbitrary,
  };
}

// Re-export for direct use
export {
  generateSine,
  generateTriangle,
  generateRamp,
  generateSquare,
  generateSteps,
  generateWaveformSteps,
  isArbitrary,
};
