import { describe, it, expect } from 'vitest';
import { createWaveformGenerator } from '../WaveformGenerator.js';
import type { WaveformParams } from '../../../shared/types.js';

describe('WaveformGenerator', () => {
  const generator = createWaveformGenerator();

  describe('generateSine', () => {
    it('should generate N loopable points', () => {
      const params: WaveformParams = {
        type: 'sine',
        min: 0,
        max: 10,
        pointsPerCycle: 20,
        intervalMs: 100,
      };

      const steps = generator.generateSine(params);
      expect(steps.length).toBe(20);
    });

    it('should end at center value for seamless looping', () => {
      const params: WaveformParams = {
        type: 'sine',
        min: 0,
        max: 10,
        pointsPerCycle: 20,
        intervalMs: 100,
      };

      const steps = generator.generateSine(params);
      // Last point is at angle 2π = 0, so sin(2π) = 0, value = center = 5
      expect(steps[steps.length - 1].value).toBeCloseTo(5, 5);
    });

    it('should have correct dwell time for each step', () => {
      const params: WaveformParams = {
        type: 'sine',
        min: 0,
        max: 10,
        pointsPerCycle: 10,
        intervalMs: 50,
      };

      const steps = generator.generateSine(params);
      expect(steps.every(s => s.dwellMs === 50)).toBe(true);
    });

    it('should oscillate between min and max', () => {
      const params: WaveformParams = {
        type: 'sine',
        min: 0,
        max: 10,
        pointsPerCycle: 100,
        intervalMs: 10,
      };

      const steps = generator.generateSine(params);
      const values = steps.map(s => s.value);
      const minValue = Math.min(...values);
      const maxValue = Math.max(...values);

      // Sine should reach close to min and max
      expect(minValue).toBeCloseTo(0, 1);
      expect(maxValue).toBeCloseTo(10, 1);
    });

    it('should start just after center (first step after sin(0))', () => {
      const params: WaveformParams = {
        type: 'sine',
        min: 0,
        max: 10,
        pointsPerCycle: 20,
        intervalMs: 100,
      };

      const steps = generator.generateSine(params);
      // First point is at angle 2π/20 = π/10, slightly above center
      // sin(π/10) ≈ 0.309, so value ≈ 5 + 5*0.309 ≈ 6.545
      expect(steps[0].value).toBeGreaterThan(5);
      expect(steps[0].value).toBeLessThan(7);
    });
  });

  describe('generateTriangle', () => {
    it('should generate N loopable points', () => {
      const params: WaveformParams = {
        type: 'triangle',
        min: 0,
        max: 10,
        pointsPerCycle: 20,
        intervalMs: 100,
      };

      const steps = generator.generateTriangle(params);
      expect(steps.length).toBe(20);
    });

    it('should end at min for seamless looping', () => {
      const params: WaveformParams = {
        type: 'triangle',
        min: 0,
        max: 10,
        pointsPerCycle: 20,
        intervalMs: 100,
      };

      const steps = generator.generateTriangle(params);
      // Last point at t=1.0 is min (falling edge completed)
      expect(steps[steps.length - 1].value).toBeCloseTo(0, 5);
    });

    it('should start just after min (first step going up)', () => {
      const params: WaveformParams = {
        type: 'triangle',
        min: 2,
        max: 8,
        pointsPerCycle: 20,
        intervalMs: 100,
      };

      const steps = generator.generateTriangle(params);
      // First point at t=1/20=0.05, rising phase: 2 + 6 * 0.05 * 2 = 2.6
      expect(steps[0].value).toBeGreaterThan(2);
      expect(steps[0].value).toBeLessThan(3);
    });

    it('should reach max at midpoint', () => {
      const params: WaveformParams = {
        type: 'triangle',
        min: 0,
        max: 10,
        pointsPerCycle: 20,
        intervalMs: 100,
      };

      const steps = generator.generateTriangle(params);
      // At t=0.5 (index 9 for 20 points starting at t=1/20), value should be max
      // Index 9 corresponds to t = 10/20 = 0.5
      const midIndex = Math.floor(20 / 2) - 1; // index 9
      expect(steps[midIndex].value).toBeCloseTo(10, 1);
    });
  });

  describe('generateRamp', () => {
    it('should generate correct number of points', () => {
      const params: WaveformParams = {
        type: 'ramp',
        min: 0,
        max: 10,
        pointsPerCycle: 10,
        intervalMs: 100,
      };

      const steps = generator.generateRamp(params);
      expect(steps.length).toBe(10);
    });

    it('should start at min and end at max', () => {
      const params: WaveformParams = {
        type: 'ramp',
        min: 0,
        max: 10,
        pointsPerCycle: 10,
        intervalMs: 100,
      };

      const steps = generator.generateRamp(params);
      expect(steps[0].value).toBe(0);
      expect(steps[9].value).toBe(10);
    });

    it('should increase linearly', () => {
      const params: WaveformParams = {
        type: 'ramp',
        min: 0,
        max: 9,
        pointsPerCycle: 10,
        intervalMs: 100,
      };

      const steps = generator.generateRamp(params);
      // Each step should increase by 1
      for (let i = 0; i < steps.length; i++) {
        expect(steps[i].value).toBeCloseTo(i, 5);
      }
    });
  });

  describe('generateSquare', () => {
    it('should generate correct number of points', () => {
      const params: WaveformParams = {
        type: 'square',
        min: 0,
        max: 10,
        pointsPerCycle: 10,
        intervalMs: 100,
      };

      const steps = generator.generateSquare(params);
      expect(steps.length).toBe(10);
    });

    it('should have only min and max values', () => {
      const params: WaveformParams = {
        type: 'square',
        min: 0,
        max: 10,
        pointsPerCycle: 10,
        intervalMs: 100,
      };

      const steps = generator.generateSquare(params);
      const uniqueValues = [...new Set(steps.map(s => s.value))];
      expect(uniqueValues.sort()).toEqual([0, 10]);
    });

    it('should start high and end low', () => {
      const params: WaveformParams = {
        type: 'square',
        min: 0,
        max: 10,
        pointsPerCycle: 10,
        intervalMs: 100,
      };

      const steps = generator.generateSquare(params);
      expect(steps[0].value).toBe(10); // High first
      expect(steps[9].value).toBe(0);  // Low last
    });

    it('should be roughly 50% duty cycle', () => {
      const params: WaveformParams = {
        type: 'square',
        min: 0,
        max: 10,
        pointsPerCycle: 10,
        intervalMs: 100,
      };

      const steps = generator.generateSquare(params);
      const highCount = steps.filter(s => s.value === 10).length;
      const lowCount = steps.filter(s => s.value === 0).length;
      expect(highCount).toBe(5);
      expect(lowCount).toBe(5);
    });
  });

  describe('generateSteps', () => {
    it('should generate correct number of points', () => {
      const params: WaveformParams = {
        type: 'steps',
        min: 0,
        max: 10,
        pointsPerCycle: 5,
        intervalMs: 100,
      };

      const steps = generator.generateSteps(params);
      expect(steps.length).toBe(5);
    });

    it('should produce discrete evenly-spaced values', () => {
      const params: WaveformParams = {
        type: 'steps',
        min: 0,
        max: 8,
        pointsPerCycle: 5,
        intervalMs: 100,
      };

      const steps = generator.generateSteps(params);
      expect(steps[0].value).toBe(0);
      expect(steps[1].value).toBe(2);
      expect(steps[2].value).toBe(4);
      expect(steps[3].value).toBe(6);
      expect(steps[4].value).toBe(8);
    });
  });

  describe('generate', () => {
    it('should dispatch to correct generator based on type', () => {
      const sineParams: WaveformParams = { type: 'sine', min: 0, max: 10, pointsPerCycle: 10, intervalMs: 100 };
      const triangleParams: WaveformParams = { type: 'triangle', min: 0, max: 10, pointsPerCycle: 10, intervalMs: 100 };
      const rampParams: WaveformParams = { type: 'ramp', min: 0, max: 10, pointsPerCycle: 10, intervalMs: 100 };
      const squareParams: WaveformParams = { type: 'square', min: 0, max: 10, pointsPerCycle: 10, intervalMs: 100 };
      const stepsParams: WaveformParams = { type: 'steps', min: 0, max: 10, pointsPerCycle: 10, intervalMs: 100 };

      expect(generator.generate(sineParams)).toEqual(generator.generateSine(sineParams));
      expect(generator.generate(triangleParams)).toEqual(generator.generateTriangle(triangleParams));
      expect(generator.generate(rampParams)).toEqual(generator.generateRamp(rampParams));
      expect(generator.generate(squareParams)).toEqual(generator.generateSquare(squareParams));
      expect(generator.generate(stepsParams)).toEqual(generator.generateSteps(stepsParams));
    });
  });

  describe('isArbitrary', () => {
    it('should return true for arbitrary waveforms', () => {
      const arbitrary = { steps: [{ value: 1, dwellMs: 100 }] };
      expect(generator.isArbitrary(arbitrary)).toBe(true);
    });

    it('should return false for standard waveforms', () => {
      const standard: WaveformParams = { type: 'sine', min: 0, max: 10, pointsPerCycle: 10, intervalMs: 100 };
      expect(generator.isArbitrary(standard)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle single point', () => {
      const params: WaveformParams = {
        type: 'ramp',
        min: 5,
        max: 10,
        pointsPerCycle: 1,
        intervalMs: 100,
      };

      const steps = generator.generate(params);
      expect(steps.length).toBe(1);
      expect(steps[0].value).toBe(5); // Should be min when only 1 point
    });

    it('should handle zero range (min == max)', () => {
      const params: WaveformParams = {
        type: 'sine',
        min: 5,
        max: 5,
        pointsPerCycle: 10,
        intervalMs: 100,
      };

      const steps = generator.generate(params);
      expect(steps.every(s => s.value === 5)).toBe(true);
    });

    it('should handle negative values', () => {
      const params: WaveformParams = {
        type: 'ramp',
        min: -10,
        max: 10,
        pointsPerCycle: 5,
        intervalMs: 100,
      };

      const steps = generator.generate(params);
      expect(steps[0].value).toBe(-10);
      expect(steps[4].value).toBe(10);
    });
  });
});
