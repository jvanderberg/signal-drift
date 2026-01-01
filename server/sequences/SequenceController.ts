/**
 * SequenceController - Timer-based execution engine for sequences
 *
 * - Wraps a DeviceSession and calls setValue() at scheduled times
 * - Precomputes absolute target times to prevent drift
 * - Supports start/pause/resume/abort
 * - Broadcasts progress and state changes via callbacks
 */

import type { DeviceSession } from '../sessions/DeviceSession.js';
import type {
  SequenceDefinition,
  SequenceRunConfig,
  SequenceState,
  SequenceStep,
  SequenceExecutionState,
  ServerMessage,
} from '../../shared/types.js';
import { createWaveformGenerator } from './WaveformGenerator.js';

export interface SequenceControllerConfig {
  minIntervalMs?: number;  // Minimum time between setValue calls (default: 50)
}

type SubscriberCallback = (message: ServerMessage) => void;

export interface SequenceController {
  getState(): SequenceState;

  start(): Promise<void>;
  pause(): void;
  resume(): void;
  abort(): Promise<void>;

  subscribe(callback: SubscriberCallback): () => void;

  destroy(): void;
}

const DEFAULT_CONFIG: Required<SequenceControllerConfig> = {
  minIntervalMs: 50,
};

export function createSequenceController(
  definition: SequenceDefinition,
  runConfig: SequenceRunConfig,
  session: DeviceSession,
  config: SequenceControllerConfig = {}
): SequenceController {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const waveformGenerator = createWaveformGenerator();

  // Generate steps from definition
  const steps = resolveSteps(definition, waveformGenerator);

  // Apply modifiers to steps
  const processedSteps = applyModifiers(steps, definition);

  // State
  let executionState: SequenceExecutionState = 'idle';
  let currentStepIndex = 0;
  let currentCycle = 0;
  let startedAt: number | null = null;
  let pausedAt: number | null = null;
  let pauseElapsedMs = 0;  // Accumulated pause time
  let stepTimer: ReturnType<typeof setTimeout> | null = null;
  let errorMessage: string | undefined;
  let commandedValue = 0;
  let skippedSteps = 0;  // Count of steps skipped to maintain schedule

  // Precomputed schedule (absolute target times)
  let schedule: number[] = [];
  let cycleEndTime = 0;  // When current cycle should end (for multi-cycle timing)

  // Subscribers
  const subscribers = new Set<SubscriberCallback>();

  function broadcast(message: ServerMessage): void {
    for (const callback of subscribers) {
      try {
        callback(message);
      } catch (err) {
        console.error('Sequence subscriber callback error:', err);
      }
    }
  }

  function getTotalCycles(): number | null {
    if (runConfig.repeatMode === 'once') return 1;
    if (runConfig.repeatMode === 'count') return runConfig.repeatCount ?? 1;
    return null; // continuous
  }

  function getElapsedMs(): number {
    if (!startedAt) return 0;
    if (pausedAt) return pausedAt - startedAt - pauseElapsedMs;
    return Date.now() - startedAt - pauseElapsedMs;
  }

  function getState(): SequenceState {
    return {
      sequenceId: definition.id,
      runConfig,
      executionState,
      currentStepIndex,
      totalSteps: processedSteps.length,
      currentCycle,
      totalCycles: getTotalCycles(),
      startedAt,
      elapsedMs: getElapsedMs(),
      commandedValue,
      error: errorMessage,
    };
  }

  function broadcastProgress(): void {
    broadcast({
      type: 'sequenceProgress',
      state: getState(),
    });
  }

  function buildSchedule(firstStepTime: number): void {
    schedule = [];
    let cumulative = firstStepTime;
    for (const step of processedSteps) {
      schedule.push(cumulative);
      cumulative += Math.max(step.dwellMs, cfg.minIntervalMs);
    }
    cycleEndTime = cumulative;  // Track when this cycle should end
  }

  async function executeStep(): Promise<void> {
    if (executionState !== 'running') return;

    const step = processedSteps[currentStepIndex];
    if (!step) {
      handleError('Invalid step index');
      return;
    }

    commandedValue = step.value;

    // Send value to device (immediate mode for sequences)
    const result = await session.setValue(runConfig.parameter, step.value, true);

    if (!result.ok) {
      handleError(`Failed to set value: ${result.error.message}`);
      return;
    }

    // Broadcast progress
    broadcastProgress();

    // Advance to next step
    currentStepIndex++;

    // Check for cycle completion
    if (currentStepIndex >= processedSteps.length) {
      currentStepIndex = 0;
      currentCycle++;

      const totalCycles = getTotalCycles();
      if (totalCycles !== null && currentCycle >= totalCycles) {
        // Sequence complete
        await handleComplete();
        return;
      }

      // Start next cycle from when this cycle should have ended (not from now)
      // This prevents drift across cycles
      buildSchedule(cycleEndTime);
    }

    // Schedule next step using absolute timing
    scheduleNextStep();
  }

  function scheduleNextStep(): void {
    if (executionState !== 'running') return;

    const now = Date.now();

    // Skip past any steps whose time has already passed (frame dropping)
    // This maintains overall schedule timing at the cost of skipped values
    let stepsSkipped = 0;
    while (currentStepIndex < processedSteps.length - 1 &&
           schedule[currentStepIndex + 1] <= now) {
      currentStepIndex++;
      stepsSkipped++;
    }
    if (stepsSkipped > 0) {
      skippedSteps += stepsSkipped;
      console.warn(`[Sequence] Skipped ${stepsSkipped} step(s) to maintain schedule (${skippedSteps} total)`);
    }

    const targetTime = schedule[currentStepIndex];
    const delay = Math.max(0, targetTime - now);

    stepTimer = setTimeout(() => {
      executeStep();
    }, delay);
  }

  async function handleComplete(): Promise<void> {
    executionState = 'completed';

    // Set post value if configured
    if (definition.postValue !== undefined) {
      let postValue = definition.postValue;
      if (definition.scale !== undefined) postValue *= definition.scale;
      if (definition.offset !== undefined) postValue += definition.offset;
      if (definition.maxClamp !== undefined) postValue = Math.min(postValue, definition.maxClamp);

      await session.setValue(runConfig.parameter, postValue, true);
      commandedValue = postValue;
    }

    broadcast({
      type: 'sequenceCompleted',
      sequenceId: definition.id,
    });
  }

  function handleError(message: string): void {
    executionState = 'error';
    errorMessage = message;

    if (stepTimer) {
      clearTimeout(stepTimer);
      stepTimer = null;
    }

    broadcast({
      type: 'sequenceError',
      sequenceId: definition.id,
      error: message,
    });
  }

  async function start(): Promise<void> {
    if (executionState === 'running') {
      throw new Error('Sequence already running');
    }

    // Reset state
    currentStepIndex = 0;
    currentCycle = 0;
    startedAt = Date.now();
    pausedAt = null;
    pauseElapsedMs = 0;
    errorMessage = undefined;
    skippedSteps = 0;
    executionState = 'running';

    // Set pre value if configured
    if (definition.preValue !== undefined) {
      let preValue = definition.preValue;
      if (definition.scale !== undefined) preValue *= definition.scale;
      if (definition.offset !== undefined) preValue += definition.offset;
      if (definition.maxClamp !== undefined) preValue = Math.min(preValue, definition.maxClamp);

      const result = await session.setValue(runConfig.parameter, preValue, true);
      if (!result.ok) {
        handleError(`Failed to set pre-value: ${result.error.message}`);
        return;
      }
      commandedValue = preValue;
    }

    // Build initial schedule
    buildSchedule(Date.now());

    broadcast({
      type: 'sequenceStarted',
      state: getState(),
    });

    // Start execution
    await executeStep();
  }

  function pause(): void {
    if (executionState !== 'running') {
      throw new Error('Sequence not running');
    }

    executionState = 'paused';
    pausedAt = Date.now();

    if (stepTimer) {
      clearTimeout(stepTimer);
      stepTimer = null;
    }

    broadcastProgress();
  }

  function resume(): void {
    if (executionState !== 'paused') {
      throw new Error('Sequence not paused');
    }

    // Calculate how long we were paused
    const pauseDuration = pausedAt ? Date.now() - pausedAt : 0;
    pauseElapsedMs += pauseDuration;
    pausedAt = null;
    executionState = 'running';

    // Shift schedule forward by pause duration to maintain relative timing
    for (let i = currentStepIndex; i < schedule.length; i++) {
      schedule[i] += pauseDuration;
    }
    cycleEndTime += pauseDuration;

    broadcastProgress();

    // Resume execution - schedule current step with minimal delay
    stepTimer = setTimeout(() => {
      executeStep();
    }, cfg.minIntervalMs);
  }

  async function abort(): Promise<void> {
    if (executionState === 'idle' || executionState === 'completed') {
      return; // Already stopped
    }

    const wasRunning = executionState === 'running' || executionState === 'paused';
    executionState = 'idle';

    if (stepTimer) {
      clearTimeout(stepTimer);
      stepTimer = null;
    }

    // Set post value if configured and was running
    if (wasRunning && definition.postValue !== undefined) {
      let postValue = definition.postValue;
      if (definition.scale !== undefined) postValue *= definition.scale;
      if (definition.offset !== undefined) postValue += definition.offset;
      if (definition.maxClamp !== undefined) postValue = Math.min(postValue, definition.maxClamp);

      await session.setValue(runConfig.parameter, postValue, true);
      commandedValue = postValue;
    }

    broadcast({
      type: 'sequenceAborted',
      sequenceId: definition.id,
    });
  }

  function subscribe(callback: SubscriberCallback): () => void {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
  }

  function destroy(): void {
    if (stepTimer) {
      clearTimeout(stepTimer);
      stepTimer = null;
    }
    subscribers.clear();
  }

  return {
    getState,
    start,
    pause,
    resume,
    abort,
    subscribe,
    destroy,
  };
}

// Helper: Resolve waveform to steps
function resolveSteps(
  definition: SequenceDefinition,
  generator: ReturnType<typeof createWaveformGenerator>
): SequenceStep[] {
  if (generator.isArbitrary(definition.waveform)) {
    return definition.waveform.steps;
  }
  return generator.generate(definition.waveform);
}

// Helper: Apply modifiers (scale, offset, clamp) to steps
function applyModifiers(steps: SequenceStep[], definition: SequenceDefinition): SequenceStep[] {
  const { scale, offset, maxClamp } = definition;

  if (scale === undefined && offset === undefined && maxClamp === undefined) {
    return steps;
  }

  return steps.map(step => {
    let value = step.value;
    if (scale !== undefined) value *= scale;
    if (offset !== undefined) value += offset;
    if (maxClamp !== undefined) value = Math.min(value, maxClamp);
    return { ...step, value };
  });
}
