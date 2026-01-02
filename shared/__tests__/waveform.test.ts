import { describe, it, expect, beforeAll } from 'vitest';
import {
  validateWaveformParams,
  validateArbitraryWaveform,
  validateRandomWalkParams,
  validateSequenceDefinition,
  isArbitrary,
  isRandomWalk,
  generateWaveformSteps,
  generateRandomWalk,
  resolveWaveformSteps,
  applyModifiers,
  calculateDuration,
  parseArbitraryStepsCSV,
  stepsToCSV,
  WAVEFORM_LIMITS,
} from '../waveform.js';
import type { WaveformParams, ArbitraryWaveform, RandomWalkParams, SequenceStep } from '../types.js';

describe('Waveform Validation', () => {
  describe('validateWaveformParams', () => {
    const validParams: WaveformParams = {
      type: 'sine',
      min: 0,
      max: 10,
      pointsPerCycle: 20,
      intervalMs: 100,
    };

    it('should accept valid parameters', () => {
      const result = validateWaveformParams(validParams);
      expect(result.ok).toBe(true);
    });

    it('should reject min >= max', () => {
      const result = validateWaveformParams({ ...validParams, min: 10, max: 10 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('min/max');
      }
    });

    it('should reject min > max', () => {
      const result = validateWaveformParams({ ...validParams, min: 15, max: 10 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('min/max');
      }
    });

    it('should reject NaN min', () => {
      const result = validateWaveformParams({ ...validParams, min: NaN });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('min');
      }
    });

    it('should reject Infinity max', () => {
      const result = validateWaveformParams({ ...validParams, max: Infinity });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('max');
      }
    });

    it('should reject non-integer pointsPerCycle', () => {
      const result = validateWaveformParams({ ...validParams, pointsPerCycle: 10.5 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('pointsPerCycle');
      }
    });

    it('should reject pointsPerCycle below minimum', () => {
      const result = validateWaveformParams({ ...validParams, pointsPerCycle: 1 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('pointsPerCycle');
        expect(result.error.message).toContain(String(WAVEFORM_LIMITS.MIN_POINTS));
      }
    });

    it('should reject pointsPerCycle above maximum', () => {
      const result = validateWaveformParams({ ...validParams, pointsPerCycle: 100000 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('pointsPerCycle');
        expect(result.error.message).toContain(String(WAVEFORM_LIMITS.MAX_POINTS));
      }
    });

    it('should reject intervalMs below minimum', () => {
      const result = validateWaveformParams({ ...validParams, intervalMs: 5 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('intervalMs');
        expect(result.error.message).toContain(String(WAVEFORM_LIMITS.MIN_INTERVAL_MS));
      }
    });

    it('should reject intervalMs above maximum', () => {
      const result = validateWaveformParams({ ...validParams, intervalMs: 5000000 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('intervalMs');
      }
    });

    it('should reject NaN intervalMs', () => {
      const result = validateWaveformParams({ ...validParams, intervalMs: NaN });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('intervalMs');
      }
    });

    it('should reject invalid waveform type', () => {
      const result = validateWaveformParams({ ...validParams, type: 'invalid' as WaveformParams['type'] });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('type');
      }
    });

    it('should accept all valid waveform types', () => {
      const types: WaveformParams['type'][] = ['sine', 'triangle', 'ramp', 'square'];
      for (const type of types) {
        const result = validateWaveformParams({ ...validParams, type });
        expect(result.ok).toBe(true);
      }
    });

    it('should accept negative values', () => {
      const result = validateWaveformParams({ ...validParams, min: -10, max: -5 });
      expect(result.ok).toBe(true);
    });

    it('should accept boundary values for pointsPerCycle', () => {
      const minResult = validateWaveformParams({ ...validParams, pointsPerCycle: WAVEFORM_LIMITS.MIN_POINTS });
      expect(minResult.ok).toBe(true);

      const maxResult = validateWaveformParams({ ...validParams, pointsPerCycle: WAVEFORM_LIMITS.MAX_POINTS });
      expect(maxResult.ok).toBe(true);
    });

    it('should accept boundary values for intervalMs', () => {
      const minResult = validateWaveformParams({ ...validParams, intervalMs: WAVEFORM_LIMITS.MIN_INTERVAL_MS });
      expect(minResult.ok).toBe(true);

      const maxResult = validateWaveformParams({ ...validParams, intervalMs: WAVEFORM_LIMITS.MAX_INTERVAL_MS });
      expect(maxResult.ok).toBe(true);
    });
  });

  describe('validateArbitraryWaveform', () => {
    const validWaveform: ArbitraryWaveform = {
      steps: [
        { value: 0, dwellMs: 100 },
        { value: 5, dwellMs: 200 },
        { value: 10, dwellMs: 100 },
      ],
    };

    it('should accept valid arbitrary waveform', () => {
      const result = validateArbitraryWaveform(validWaveform);
      expect(result.ok).toBe(true);
    });

    it('should reject non-array steps', () => {
      const result = validateArbitraryWaveform({ steps: 'not an array' } as unknown as ArbitraryWaveform);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('steps');
      }
    });

    it('should reject empty steps array', () => {
      const result = validateArbitraryWaveform({ steps: [] });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('steps');
        expect(result.error.message).toContain('At least one step');
      }
    });

    it('should reject too many steps', () => {
      const tooManySteps = Array(WAVEFORM_LIMITS.MAX_ARBITRARY_STEPS + 1)
        .fill(null)
        .map(() => ({ value: 1, dwellMs: 100 }));
      const result = validateArbitraryWaveform({ steps: tooManySteps });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('steps');
      }
    });

    it('should reject NaN step value', () => {
      const result = validateArbitraryWaveform({
        steps: [{ value: NaN, dwellMs: 100 }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('steps[0].value');
      }
    });

    it('should reject Infinity step value', () => {
      const result = validateArbitraryWaveform({
        steps: [{ value: Infinity, dwellMs: 100 }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('steps[0].value');
      }
    });

    it('should reject NaN dwellMs', () => {
      const result = validateArbitraryWaveform({
        steps: [{ value: 5, dwellMs: NaN }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('steps[0].dwellMs');
      }
    });

    it('should reject dwellMs below minimum', () => {
      const result = validateArbitraryWaveform({
        steps: [{ value: 5, dwellMs: 5 }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('steps[0].dwellMs');
      }
    });

    it('should reject dwellMs above maximum', () => {
      const result = validateArbitraryWaveform({
        steps: [{ value: 5, dwellMs: WAVEFORM_LIMITS.MAX_INTERVAL_MS + 1 }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('steps[0].dwellMs');
      }
    });

    it('should report correct index for invalid step', () => {
      const result = validateArbitraryWaveform({
        steps: [
          { value: 1, dwellMs: 100 },
          { value: 2, dwellMs: 100 },
          { value: NaN, dwellMs: 100 },
        ],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('steps[2].value');
      }
    });

    it('should accept single step', () => {
      const result = validateArbitraryWaveform({
        steps: [{ value: 5, dwellMs: 100 }],
      });
      expect(result.ok).toBe(true);
    });

    it('should accept negative step values', () => {
      const result = validateArbitraryWaveform({
        steps: [{ value: -10, dwellMs: 100 }],
      });
      expect(result.ok).toBe(true);
    });
  });

  describe('validateRandomWalkParams', () => {
    const validParams: RandomWalkParams = {
      type: 'random',
      startValue: 5,
      maxStepSize: 1,
      min: 0,
      max: 10,
      pointsPerCycle: 20,
      intervalMs: 100,
    };

    it('should accept valid random walk parameters', () => {
      const result = validateRandomWalkParams(validParams);
      expect(result.ok).toBe(true);
    });

    it('should reject min >= max', () => {
      const result = validateRandomWalkParams({ ...validParams, min: 10, max: 5 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('min/max');
      }
    });

    it('should reject startValue outside bounds', () => {
      const result = validateRandomWalkParams({ ...validParams, startValue: 15 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('startValue');
      }
    });

    it('should reject negative maxStepSize', () => {
      const result = validateRandomWalkParams({ ...validParams, maxStepSize: -1 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('maxStepSize');
      }
    });

    it('should reject zero maxStepSize', () => {
      const result = validateRandomWalkParams({ ...validParams, maxStepSize: 0 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('maxStepSize');
      }
    });

    it('should reject NaN values', () => {
      const result = validateRandomWalkParams({ ...validParams, startValue: NaN });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('startValue');
      }
    });

    it('should reject pointsPerCycle below minimum', () => {
      const result = validateRandomWalkParams({ ...validParams, pointsPerCycle: 1 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('pointsPerCycle');
      }
    });

    it('should reject intervalMs below minimum', () => {
      const result = validateRandomWalkParams({ ...validParams, intervalMs: 5 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('intervalMs');
      }
    });
  });

  describe('validateSequenceDefinition', () => {
    const validDef = {
      name: 'Test Sequence',
      unit: 'V' as const,
      waveform: {
        type: 'sine' as const,
        min: 0,
        max: 10,
        pointsPerCycle: 20,
        intervalMs: 100,
      },
    };

    it('should accept valid definition', () => {
      const result = validateSequenceDefinition(validDef);
      expect(result.ok).toBe(true);
    });

    it('should reject empty name', () => {
      const result = validateSequenceDefinition({ ...validDef, name: '' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('name');
      }
    });

    it('should reject whitespace-only name', () => {
      const result = validateSequenceDefinition({ ...validDef, name: '   ' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('name');
      }
    });

    it('should reject name over 100 characters', () => {
      const result = validateSequenceDefinition({ ...validDef, name: 'a'.repeat(101) });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('name');
        expect(result.error.message).toContain('100 characters');
      }
    });

    it('should accept all valid units', () => {
      const units = ['V', 'A', 'W', 'Ω'] as const;
      for (const unit of units) {
        const result = validateSequenceDefinition({ ...validDef, unit });
        expect(result.ok).toBe(true);
      }
    });

    it('should reject invalid unit', () => {
      const result = validateSequenceDefinition({ ...validDef, unit: 'Hz' as 'V' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('unit');
      }
    });

    it('should validate waveform params', () => {
      const result = validateSequenceDefinition({
        ...validDef,
        waveform: { ...validDef.waveform, min: 10, max: 5 },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('min/max');
      }
    });

    it('should validate arbitrary waveform', () => {
      const result = validateSequenceDefinition({
        ...validDef,
        waveform: { steps: [] },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('steps');
      }
    });

    it('should accept valid arbitrary waveform', () => {
      const result = validateSequenceDefinition({
        ...validDef,
        waveform: { steps: [{ value: 5, dwellMs: 100 }] },
      });
      expect(result.ok).toBe(true);
    });

    it('should reject NaN scale', () => {
      const result = validateSequenceDefinition({ ...validDef, scale: NaN });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('scale');
      }
    });

    it('should reject Infinity offset', () => {
      const result = validateSequenceDefinition({ ...validDef, offset: Infinity });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('offset');
      }
    });

    it('should reject NaN maxClamp', () => {
      const result = validateSequenceDefinition({ ...validDef, maxClamp: NaN });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('maxClamp');
      }
    });

    it('should reject NaN preValue', () => {
      const result = validateSequenceDefinition({ ...validDef, preValue: NaN });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('preValue');
      }
    });

    it('should reject NaN postValue', () => {
      const result = validateSequenceDefinition({ ...validDef, postValue: NaN });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('postValue');
      }
    });

    it('should reject zero maxSlewRate', () => {
      const result = validateSequenceDefinition({ ...validDef, maxSlewRate: 0 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('maxSlewRate');
      }
    });

    it('should reject negative maxSlewRate', () => {
      const result = validateSequenceDefinition({ ...validDef, maxSlewRate: -1 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('maxSlewRate');
      }
    });

    it('should accept valid modifiers', () => {
      const result = validateSequenceDefinition({
        ...validDef,
        scale: 2,
        offset: -5,
        maxClamp: 100,
        preValue: 0,
        postValue: 0,
        maxSlewRate: 10,
      });
      expect(result.ok).toBe(true);
    });
  });
});

describe('Type Guards', () => {
  describe('isArbitrary', () => {
    it('should return true for arbitrary waveform', () => {
      const waveform: ArbitraryWaveform = { steps: [{ value: 1, dwellMs: 100 }] };
      expect(isArbitrary(waveform)).toBe(true);
    });

    it('should return false for standard waveform', () => {
      const waveform: WaveformParams = {
        type: 'sine',
        min: 0,
        max: 10,
        pointsPerCycle: 20,
        intervalMs: 100,
      };
      expect(isArbitrary(waveform)).toBe(false);
    });

    it('should return false for random walk', () => {
      const waveform: RandomWalkParams = {
        type: 'random',
        startValue: 5,
        maxStepSize: 1,
        min: 0,
        max: 10,
        pointsPerCycle: 20,
        intervalMs: 100,
      };
      expect(isArbitrary(waveform)).toBe(false);
    });
  });

  describe('isRandomWalk', () => {
    it('should return true for random walk', () => {
      const waveform: RandomWalkParams = {
        type: 'random',
        startValue: 5,
        maxStepSize: 1,
        min: 0,
        max: 10,
        pointsPerCycle: 20,
        intervalMs: 100,
      };
      expect(isRandomWalk(waveform)).toBe(true);
    });

    it('should return false for standard waveform', () => {
      const waveform: WaveformParams = {
        type: 'sine',
        min: 0,
        max: 10,
        pointsPerCycle: 20,
        intervalMs: 100,
      };
      expect(isRandomWalk(waveform)).toBe(false);
    });

    it('should return false for arbitrary waveform', () => {
      const waveform: ArbitraryWaveform = { steps: [{ value: 1, dwellMs: 100 }] };
      expect(isRandomWalk(waveform)).toBe(false);
    });
  });
});

describe('Random Walk Generation', () => {
  describe('generateRandomWalk', () => {
    const baseParams: RandomWalkParams = {
      type: 'random',
      startValue: 5,
      maxStepSize: 1,
      min: 0,
      max: 10,
      pointsPerCycle: 10,
      intervalMs: 100,
    };

    it('should generate correct number of points', () => {
      const steps = generateRandomWalk(baseParams);
      expect(steps).toHaveLength(10);
    });

    it('should start from startValue on first call', () => {
      const steps = generateRandomWalk(baseParams);
      // First step should be within maxStepSize of startValue
      expect(Math.abs(steps[0].value - baseParams.startValue)).toBeLessThanOrEqual(baseParams.maxStepSize);
    });

    it('should start from lastValue when provided', () => {
      const lastValue = 7;
      const steps = generateRandomWalk(baseParams, lastValue);
      // First step should be within maxStepSize of lastValue
      expect(Math.abs(steps[0].value - lastValue)).toBeLessThanOrEqual(baseParams.maxStepSize);
    });

    it('should clamp values to min/max bounds', () => {
      const params: RandomWalkParams = {
        ...baseParams,
        startValue: 9,
        maxStepSize: 5, // Large step to force clamping
        pointsPerCycle: 50,
      };
      const steps = generateRandomWalk(params);

      for (const step of steps) {
        expect(step.value).toBeGreaterThanOrEqual(params.min);
        expect(step.value).toBeLessThanOrEqual(params.max);
      }
    });

    it('should have correct dwell time for each step', () => {
      const steps = generateRandomWalk(baseParams);
      for (const step of steps) {
        expect(step.dwellMs).toBe(baseParams.intervalMs);
      }
    });

    it('should produce different values on subsequent calls (randomness)', () => {
      const steps1 = generateRandomWalk(baseParams);
      const steps2 = generateRandomWalk(baseParams);

      // With 10 random steps, extremely unlikely to be identical
      const values1 = steps1.map(s => s.value);
      const values2 = steps2.map(s => s.value);
      expect(values1).not.toEqual(values2);
    });

    it('should have each step within maxStepSize of previous step', () => {
      const steps = generateRandomWalk(baseParams);

      for (let i = 1; i < steps.length; i++) {
        const diff = Math.abs(steps[i].value - steps[i - 1].value);
        expect(diff).toBeLessThanOrEqual(baseParams.maxStepSize);
      }
    });
  });
});

describe('Waveform Resolution', () => {
  describe('resolveWaveformSteps', () => {
    it('should return steps directly for arbitrary waveform', () => {
      const steps: SequenceStep[] = [
        { value: 1, dwellMs: 100 },
        { value: 2, dwellMs: 200 },
      ];
      const result = resolveWaveformSteps({ steps });
      expect(result).toBe(steps);
    });

    it('should generate steps for standard waveform', () => {
      const params: WaveformParams = {
        type: 'ramp',
        min: 0,
        max: 10,
        pointsPerCycle: 5,
        intervalMs: 100,
      };
      const result = resolveWaveformSteps(params);
      expect(result.length).toBe(5);
      expect(result[0].value).toBe(0);
      expect(result[4].value).toBe(10);
    });
  });

  describe('generateWaveformSteps', () => {
    it('should generate correct type for each waveform', () => {
      const baseParams = { min: 0, max: 10, pointsPerCycle: 10, intervalMs: 100 };

      // Sine starts above center
      const sine = generateWaveformSteps({ ...baseParams, type: 'sine' });
      expect(sine[0].value).toBeGreaterThan(5);

      // Triangle starts just above min
      const triangle = generateWaveformSteps({ ...baseParams, type: 'triangle' });
      expect(triangle[0].value).toBeGreaterThan(0);
      expect(triangle[0].value).toBeLessThan(5);

      // Ramp starts at min
      const ramp = generateWaveformSteps({ ...baseParams, type: 'ramp' });
      expect(ramp[0].value).toBe(0);

      // Square starts at max
      const square = generateWaveformSteps({ ...baseParams, type: 'square' });
      expect(square[0].value).toBe(10);
    });
  });
});

describe('Modifiers', () => {
  describe('applyModifiers', () => {
    const baseSteps: SequenceStep[] = [
      { value: 0, dwellMs: 100 },
      { value: 5, dwellMs: 100 },
      { value: 10, dwellMs: 100 },
    ];

    it('should return original steps if no modifiers', () => {
      const result = applyModifiers(baseSteps);
      expect(result).toBe(baseSteps);
    });

    it('should apply scale', () => {
      const result = applyModifiers(baseSteps, 2);
      expect(result.map(s => s.value)).toEqual([0, 10, 20]);
    });

    it('should apply offset', () => {
      const result = applyModifiers(baseSteps, undefined, 5);
      expect(result.map(s => s.value)).toEqual([5, 10, 15]);
    });

    it('should apply maxClamp', () => {
      const result = applyModifiers(baseSteps, undefined, undefined, undefined, 7);
      expect(result.map(s => s.value)).toEqual([0, 5, 7]);
    });

    it('should apply minClamp', () => {
      const result = applyModifiers(baseSteps, undefined, undefined, 3, undefined);
      expect(result.map(s => s.value)).toEqual([3, 5, 10]);
    });

    it('should apply modifiers in order: scale, offset, clamp', () => {
      // value=10: scale(2)=20, offset(+5)=25, clamp(15)=15
      const result = applyModifiers(baseSteps, 2, 5, undefined, 15);
      expect(result[2].value).toBe(15);
    });

    it('should preserve dwellMs', () => {
      const result = applyModifiers(baseSteps, 2, 5, undefined, 15);
      expect(result.map(s => s.dwellMs)).toEqual([100, 100, 100]);
    });

    it('should handle negative scale', () => {
      const result = applyModifiers(baseSteps, -1);
      // Note: 0 * -1 = -0 in JavaScript (Object.is distinguishes them)
      expect(Object.is(result[0].value, -0)).toBe(true);
      expect(result[1].value).toBe(-5);
      expect(result[2].value).toBe(-10);
    });

    it('should handle negative offset', () => {
      const result = applyModifiers(baseSteps, undefined, -3);
      expect(result.map(s => s.value)).toEqual([-3, 2, 7]);
    });

    it('should not mutate original steps', () => {
      const original = [...baseSteps.map(s => ({ ...s }))];
      applyModifiers(baseSteps, 2, 5, undefined, 15);
      expect(baseSteps).toEqual(original);
    });
  });

  describe('calculateDuration', () => {
    it('should sum all dwell times', () => {
      const steps: SequenceStep[] = [
        { value: 0, dwellMs: 100 },
        { value: 5, dwellMs: 200 },
        { value: 10, dwellMs: 150 },
      ];
      expect(calculateDuration(steps)).toBe(450);
    });

    it('should return 0 for empty array', () => {
      expect(calculateDuration([])).toBe(0);
    });

    it('should handle single step', () => {
      expect(calculateDuration([{ value: 5, dwellMs: 100 }])).toBe(100);
    });
  });
});

describe('CSV Parsing', () => {
  describe('parseArbitraryStepsCSV', () => {
    it('should parse valid CSV', () => {
      const csv = '0,100\n5,200\n10,150';
      const result = parseArbitraryStepsCSV(csv);
      expect(result).toEqual([
        { value: 0, dwellMs: 100 },
        { value: 5, dwellMs: 200 },
        { value: 10, dwellMs: 150 },
      ]);
    });

    it('should handle whitespace', () => {
      const csv = '  0 , 100  \n  5,200\n10,  150  ';
      const result = parseArbitraryStepsCSV(csv);
      expect(result).toEqual([
        { value: 0, dwellMs: 100 },
        { value: 5, dwellMs: 200 },
        { value: 10, dwellMs: 150 },
      ]);
    });

    it('should skip empty lines', () => {
      const csv = '0,100\n\n5,200\n\n';
      const result = parseArbitraryStepsCSV(csv);
      expect(result).toEqual([
        { value: 0, dwellMs: 100 },
        { value: 5, dwellMs: 200 },
      ]);
    });

    it('should handle negative values', () => {
      const csv = '-10,100\n0,100\n10,100';
      const result = parseArbitraryStepsCSV(csv);
      expect(result?.[0].value).toBe(-10);
    });

    it('should handle decimal values', () => {
      const csv = '1.5,100.5';
      const result = parseArbitraryStepsCSV(csv);
      expect(result).toEqual([{ value: 1.5, dwellMs: 100.5 }]);
    });

    it('should return null for invalid value', () => {
      const csv = 'abc,100';
      const result = parseArbitraryStepsCSV(csv);
      expect(result).toBeNull();
    });

    it('should return null for invalid dwellMs', () => {
      const csv = '10,abc';
      const result = parseArbitraryStepsCSV(csv);
      expect(result).toBeNull();
    });

    it('should return null for zero dwellMs', () => {
      const csv = '10,0';
      const result = parseArbitraryStepsCSV(csv);
      expect(result).toBeNull();
    });

    it('should return null for negative dwellMs', () => {
      const csv = '10,-100';
      const result = parseArbitraryStepsCSV(csv);
      expect(result).toBeNull();
    });

    it('should return null for empty input', () => {
      const result = parseArbitraryStepsCSV('');
      expect(result).toBeNull();
    });

    it('should return null for whitespace-only input', () => {
      const result = parseArbitraryStepsCSV('   \n   \n   ');
      expect(result).toBeNull();
    });

    it('should skip lines with insufficient columns', () => {
      const csv = '0,100\n5\n10,150';
      const result = parseArbitraryStepsCSV(csv);
      expect(result).toEqual([
        { value: 0, dwellMs: 100 },
        { value: 10, dwellMs: 150 },
      ]);
    });

    it('should ignore extra columns', () => {
      const csv = '0,100,extra,columns';
      const result = parseArbitraryStepsCSV(csv);
      expect(result).toEqual([{ value: 0, dwellMs: 100 }]);
    });
  });

  describe('stepsToCSV', () => {
    it('should convert steps to CSV', () => {
      const steps: SequenceStep[] = [
        { value: 0, dwellMs: 100 },
        { value: 5, dwellMs: 200 },
        { value: 10, dwellMs: 150 },
      ];
      const result = stepsToCSV(steps);
      expect(result).toBe('0,100\n5,200\n10,150');
    });

    it('should handle empty array', () => {
      expect(stepsToCSV([])).toBe('');
    });

    it('should handle single step', () => {
      expect(stepsToCSV([{ value: 5, dwellMs: 100 }])).toBe('5,100');
    });

    it('should preserve decimal precision', () => {
      const steps: SequenceStep[] = [{ value: 1.23456, dwellMs: 100.5 }];
      expect(stepsToCSV(steps)).toBe('1.23456,100.5');
    });

    it('should handle negative values', () => {
      const steps: SequenceStep[] = [{ value: -10, dwellMs: 100 }];
      expect(stepsToCSV(steps)).toBe('-10,100');
    });
  });

  describe('CSV round-trip', () => {
    it('should preserve data through CSV round-trip', () => {
      const original: SequenceStep[] = [
        { value: 0, dwellMs: 100 },
        { value: 5.5, dwellMs: 200 },
        { value: -10, dwellMs: 150 },
      ];
      const csv = stepsToCSV(original);
      const parsed = parseArbitraryStepsCSV(csv);
      expect(parsed).toEqual(original);
    });
  });
});

describe('Trigger Script Validation', () => {
  describe('validateTriggerScript', () => {
    // Import in this scope to avoid breaking other tests if function doesn't exist
    let validateTriggerScript: typeof import('../waveform.js').validateTriggerScript;
    let TRIGGER_SCRIPT_LIMITS: typeof import('../waveform.js').TRIGGER_SCRIPT_LIMITS;

    beforeAll(async () => {
      const module = await import('../waveform.js');
      validateTriggerScript = module.validateTriggerScript;
      TRIGGER_SCRIPT_LIMITS = module.TRIGGER_SCRIPT_LIMITS;
    });

    const validTrigger = {
      id: 'trigger-1',
      condition: {
        type: 'time' as const,
        seconds: 5,
      },
      action: {
        type: 'setOutput' as const,
        deviceId: 'device-1',
        enabled: true,
      },
      repeatMode: 'once' as const,
      debounceMs: 0,
    };

    const validScript = {
      name: 'Test Script',
      triggers: [validTrigger],
    };

    it('should accept valid script with time-based trigger', () => {
      const result = validateTriggerScript(validScript);
      expect(result.ok).toBe(true);
    });

    it('should accept valid script with value-based trigger', () => {
      const result = validateTriggerScript({
        ...validScript,
        triggers: [{
          ...validTrigger,
          condition: {
            type: 'value' as const,
            deviceId: 'device-1',
            parameter: 'voltage',
            operator: '>' as const,
            value: 5,
          },
        }],
      });
      expect(result.ok).toBe(true);
    });

    it('should accept script with empty triggers array', () => {
      const result = validateTriggerScript({ ...validScript, triggers: [] });
      expect(result.ok).toBe(true);
    });

    // Name validation
    it('should reject empty name', () => {
      const result = validateTriggerScript({ ...validScript, name: '' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('name');
      }
    });

    it('should reject whitespace-only name', () => {
      const result = validateTriggerScript({ ...validScript, name: '   ' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('name');
      }
    });

    it('should reject name over 100 characters', () => {
      const result = validateTriggerScript({ ...validScript, name: 'a'.repeat(101) });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('name');
      }
    });

    // Triggers array limit
    it('should reject too many triggers', () => {
      const manyTriggers = Array(TRIGGER_SCRIPT_LIMITS.MAX_TRIGGERS + 1).fill(null).map((_, i) => ({
        ...validTrigger,
        id: `trigger-${i}`,
      }));
      const result = validateTriggerScript({ ...validScript, triggers: manyTriggers });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('triggers');
      }
    });

    // Time condition validation
    it('should reject negative time seconds', () => {
      const result = validateTriggerScript({
        ...validScript,
        triggers: [{
          ...validTrigger,
          condition: { type: 'time' as const, seconds: -5 },
        }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toContain('seconds');
      }
    });

    it('should reject NaN time seconds', () => {
      const result = validateTriggerScript({
        ...validScript,
        triggers: [{
          ...validTrigger,
          condition: { type: 'time' as const, seconds: NaN },
        }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toContain('seconds');
      }
    });

    // Value condition validation
    it('should reject empty deviceId in value condition', () => {
      const result = validateTriggerScript({
        ...validScript,
        triggers: [{
          ...validTrigger,
          condition: {
            type: 'value' as const,
            deviceId: '',
            parameter: 'voltage',
            operator: '>' as const,
            value: 5,
          },
        }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toContain('deviceId');
      }
    });

    it('should reject empty parameter in value condition', () => {
      const result = validateTriggerScript({
        ...validScript,
        triggers: [{
          ...validTrigger,
          condition: {
            type: 'value' as const,
            deviceId: 'device-1',
            parameter: '',
            operator: '>' as const,
            value: 5,
          },
        }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toContain('parameter');
      }
    });

    it('should reject NaN value in value condition', () => {
      const result = validateTriggerScript({
        ...validScript,
        triggers: [{
          ...validTrigger,
          condition: {
            type: 'value' as const,
            deviceId: 'device-1',
            parameter: 'voltage',
            operator: '>' as const,
            value: NaN,
          },
        }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toContain('value');
      }
    });

    // Action validation - setValue
    it('should reject empty deviceId in setValue action', () => {
      const result = validateTriggerScript({
        ...validScript,
        triggers: [{
          ...validTrigger,
          action: {
            type: 'setValue' as const,
            deviceId: '',
            parameter: 'voltage',
            value: 5,
          },
        }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toContain('deviceId');
      }
    });

    it('should reject NaN value in setValue action', () => {
      const result = validateTriggerScript({
        ...validScript,
        triggers: [{
          ...validTrigger,
          action: {
            type: 'setValue' as const,
            deviceId: 'device-1',
            parameter: 'voltage',
            value: NaN,
          },
        }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toContain('value');
      }
    });

    // Action validation - setOutput
    it('should reject empty deviceId in setOutput action', () => {
      const result = validateTriggerScript({
        ...validScript,
        triggers: [{
          ...validTrigger,
          action: {
            type: 'setOutput' as const,
            deviceId: '',
            enabled: true,
          },
        }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toContain('deviceId');
      }
    });

    // Action validation - startSequence
    it('should reject empty sequenceId in startSequence action', () => {
      const result = validateTriggerScript({
        ...validScript,
        triggers: [{
          ...validTrigger,
          action: {
            type: 'startSequence' as const,
            sequenceId: '',
            deviceId: 'device-1',
            parameter: 'voltage',
            repeatMode: 'once' as const,
          },
        }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toContain('sequenceId');
      }
    });

    // Debounce validation
    it('should reject negative debounceMs', () => {
      const result = validateTriggerScript({
        ...validScript,
        triggers: [{
          ...validTrigger,
          debounceMs: -100,
        }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toContain('debounceMs');
      }
    });

    // Valid complex script
    it('should accept valid script with multiple trigger types', () => {
      const result = validateTriggerScript({
        name: 'Complex Script',
        triggers: [
          {
            id: 'trigger-1',
            condition: { type: 'time' as const, seconds: 5 },
            action: { type: 'setOutput' as const, deviceId: 'device-1', enabled: true },
            repeatMode: 'once' as const,
            debounceMs: 0,
          },
          {
            id: 'trigger-2',
            condition: {
              type: 'value' as const,
              deviceId: 'device-1',
              parameter: 'voltage',
              operator: '>' as const,
              value: 10,
            },
            action: {
              type: 'setValue' as const,
              deviceId: 'device-2',
              parameter: 'current',
              value: 2,
            },
            repeatMode: 'repeat' as const,
            debounceMs: 500,
          },
          {
            id: 'trigger-3',
            condition: { type: 'time' as const, seconds: 10 },
            action: { type: 'stopSequence' as const },
            repeatMode: 'once' as const,
            debounceMs: 0,
          },
        ],
      });
      expect(result.ok).toBe(true);
    });
  });
});
