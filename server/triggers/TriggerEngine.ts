/**
 * TriggerEngine - Evaluates trigger conditions and executes actions
 *
 * - Monitors device values via SessionManager subscriptions
 * - Evaluates value-based and time-based conditions
 * - Executes actions (setValue, setOutput, sequence control)
 * - Respects repeatMode and debounce settings
 */

import type { SessionManager } from '../sessions/SessionManager.js';
import type { SequenceManager } from '../sequences/SequenceManager.js';
import type {
  TriggerScript,
  Trigger,
  TriggerCondition,
  TriggerAction,
  TriggerScriptState,
  TriggerScriptExecutionState,
  TriggerState,
  TriggerOperator,
  ServerMessage,
  Result,
} from '../../shared/types.js';
import { Ok, Err } from '../../shared/types.js';

type SubscriberCallback = (message: ServerMessage) => void;

export interface TriggerEngine {
  getState(): TriggerScriptState;

  start(): Promise<Result<void, Error>>;
  stop(): Promise<void>;
  pause(): Result<void, Error>;
  resume(): Result<void, Error>;

  subscribe(callback: SubscriberCallback): () => void;

  destroy(): void;
}

interface TriggerRuntimeState {
  trigger: Trigger;
  firedCount: number;
  lastFiredAt: number | null;
  conditionMet: boolean;
  previousConditionMet: boolean;  // For edge detection
}

const EVAL_INTERVAL_MS = 100;  // Evaluate conditions every 100ms

export function createTriggerEngine(
  script: TriggerScript,
  sessionManager: SessionManager,
  sequenceManager: SequenceManager
): TriggerEngine {
  // State
  let executionState: TriggerScriptExecutionState = 'idle';
  let startedAt: number | null = null;
  let pausedAt: number | null = null;
  let pauseElapsedMs = 0;
  let errorMessage: string | undefined;

  // Runtime state for each trigger
  const triggerStates: TriggerRuntimeState[] = script.triggers.map(trigger => ({
    trigger,
    firedCount: 0,
    lastFiredAt: null,
    conditionMet: false,
    previousConditionMet: false,
  }));

  // Timers
  let evalTimer: ReturnType<typeof setInterval> | null = null;
  let progressTimer: ReturnType<typeof setInterval> | null = null;
  const timeoutTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  const PROGRESS_INTERVAL_MS = 500;  // Broadcast progress every 500ms

  // Subscribers
  const subscribers = new Set<SubscriberCallback>();

  function broadcast(message: ServerMessage): void {
    for (const callback of subscribers) {
      try {
        callback(message);
      } catch (err) {
        console.error('TriggerEngine subscriber error:', err);
      }
    }
  }

  function getElapsedMs(): number {
    if (!startedAt) return 0;
    if (pausedAt) return pausedAt - startedAt - pauseElapsedMs;
    return Date.now() - startedAt - pauseElapsedMs;
  }

  function getState(): TriggerScriptState {
    return {
      scriptId: script.id,
      executionState,
      startedAt,
      elapsedMs: getElapsedMs(),
      triggerStates: triggerStates.map(ts => ({
        triggerId: ts.trigger.id,
        firedCount: ts.firedCount,
        lastFiredAt: ts.lastFiredAt,
        conditionMet: ts.conditionMet,
      })),
      error: errorMessage,
    };
  }

  function broadcastProgress(): void {
    broadcast({
      type: 'triggerScriptProgress',
      state: getState(),
    });
  }

  /**
   * Evaluate a comparison operator
   */
  function evaluateOperator(actual: number, operator: TriggerOperator, expected: number): boolean {
    switch (operator) {
      case '>': return actual > expected;
      case '<': return actual < expected;
      case '>=': return actual >= expected;
      case '<=': return actual <= expected;
      case '==': return actual === expected;
      case '!=': return actual !== expected;
    }
  }

  /**
   * Evaluate a single condition
   */
  function evaluateCondition(condition: TriggerCondition): boolean {
    if (condition.type === 'time') {
      const elapsedSeconds = getElapsedMs() / 1000;
      return elapsedSeconds >= condition.seconds;
    }

    // Value-based condition
    const session = sessionManager.getSession(condition.deviceId);
    if (!session) {
      console.warn(`[TriggerEngine] Device not found: ${condition.deviceId}`);
      return false;
    }

    const state = session.getState();
    const value = state.measurements[condition.parameter];
    if (value === undefined) {
      console.warn(`[TriggerEngine] Measurement not found: ${condition.parameter}`);
      return false;
    }

    return evaluateOperator(value, condition.operator, condition.value);
  }

  /**
   * Broadcast an action failure
   */
  function broadcastActionFailure(triggerId: string, actionType: string, error: string): void {
    broadcast({
      type: 'triggerActionFailed',
      scriptId: script.id,
      triggerId,
      actionType,
      error,
    });
  }

  /**
   * Execute a trigger action
   */
  async function executeAction(triggerId: string, action: TriggerAction): Promise<void> {
    switch (action.type) {
      case 'setValue': {
        const result = await sessionManager.setValue(
          action.deviceId,
          action.parameter,
          action.value,
          true  // immediate
        );
        if (!result.ok) {
          const errorMsg = `Failed to set value: ${result.error.message}`;
          console.error(`[TriggerEngine] ${errorMsg}`);
          broadcastActionFailure(triggerId, action.type, errorMsg);
        }
        break;
      }

      case 'setOutput': {
        const result = await sessionManager.setOutput(
          action.deviceId,
          action.enabled
        );
        if (!result.ok) {
          const errorMsg = `Failed to set output: ${result.error.message}`;
          console.error(`[TriggerEngine] ${errorMsg}`);
          broadcastActionFailure(triggerId, action.type, errorMsg);
        }
        break;
      }

      case 'setMode': {
        const result = await sessionManager.setMode(
          action.deviceId,
          action.mode
        );
        if (!result.ok) {
          const errorMsg = `Failed to set mode: ${result.error.message}`;
          console.error(`[TriggerEngine] ${errorMsg}`);
          broadcastActionFailure(triggerId, action.type, errorMsg);
        }
        break;
      }

      case 'startSequence': {
        const result = await sequenceManager.run({
          sequenceId: action.sequenceId,
          deviceId: action.deviceId,
          parameter: action.parameter,
          repeatMode: action.repeatMode,
          repeatCount: action.repeatCount,
        });
        if (!result.ok) {
          const errorMsg = `Failed to start sequence: ${result.error.message}`;
          console.error(`[TriggerEngine] ${errorMsg}`);
          broadcastActionFailure(triggerId, action.type, errorMsg);
        }
        break;
      }

      case 'stopSequence': {
        await sequenceManager.abort();
        break;
      }

      case 'pauseSequence': {
        // Note: SequenceManager doesn't have a public pause method currently
        // This would need to be added for full support
        console.warn('[TriggerEngine] pauseSequence action not fully implemented');
        broadcastActionFailure(triggerId, action.type, 'pauseSequence not implemented');
        break;
      }
    }
  }

  /**
   * Check if a trigger should fire (considering debounce)
   */
  function shouldFire(ts: TriggerRuntimeState): boolean {
    // Check debounce
    if (ts.trigger.debounceMs > 0 && ts.lastFiredAt !== null) {
      const timeSinceLastFire = Date.now() - ts.lastFiredAt;
      if (timeSinceLastFire < ts.trigger.debounceMs) {
        return false;
      }
    }

    // For 'once' mode, only fire if we haven't fired before
    if (ts.trigger.repeatMode === 'once' && ts.firedCount > 0) {
      return false;
    }

    return true;
  }

  /**
   * Fire a trigger
   */
  async function fireTrigger(ts: TriggerRuntimeState): Promise<void> {
    ts.firedCount++;
    ts.lastFiredAt = Date.now();

    console.log(`[TriggerEngine] Trigger fired: ${ts.trigger.id} (count: ${ts.firedCount})`);

    // Broadcast trigger fired event
    broadcast({
      type: 'triggerFired',
      scriptId: script.id,
      triggerId: ts.trigger.id,
      triggerState: {
        triggerId: ts.trigger.id,
        firedCount: ts.firedCount,
        lastFiredAt: ts.lastFiredAt,
        conditionMet: ts.conditionMet,
      },
    });

    // Execute the action
    await executeAction(ts.trigger.id, ts.trigger.action);
  }

  /**
   * Evaluate all triggers
   */
  async function evaluate(): Promise<void> {
    if (executionState !== 'running') return;

    for (const ts of triggerStates) {
      ts.previousConditionMet = ts.conditionMet;
      ts.conditionMet = evaluateCondition(ts.trigger.condition);

      // Fire on rising edge (condition just became true)
      if (ts.conditionMet && !ts.previousConditionMet && shouldFire(ts)) {
        await fireTrigger(ts);
      }
    }
  }

  /**
   * Set up time-based triggers (scheduled at specific times)
   */
  function setupTimeTriggers(): void {
    for (const ts of triggerStates) {
      if (ts.trigger.condition.type === 'time') {
        const delayMs = ts.trigger.condition.seconds * 1000;
        const timer = setTimeout(async () => {
          if (executionState === 'running' && shouldFire(ts)) {
            ts.conditionMet = true;
            await fireTrigger(ts);
          }
        }, delayMs);
        timeoutTimers.set(ts.trigger.id, timer);
      }
    }
  }

  /**
   * Clear all time-based trigger timers
   */
  function clearTimeTriggers(): void {
    for (const timer of timeoutTimers.values()) {
      clearTimeout(timer);
    }
    timeoutTimers.clear();
  }

  async function start(): Promise<Result<void, Error>> {
    if (executionState === 'running') {
      return Err(new Error('Trigger script already running'));
    }

    // Reset state
    startedAt = Date.now();
    pausedAt = null;
    pauseElapsedMs = 0;
    errorMessage = undefined;
    executionState = 'running';

    // Reset trigger states
    for (const ts of triggerStates) {
      ts.firedCount = 0;
      ts.lastFiredAt = null;
      ts.conditionMet = false;
      ts.previousConditionMet = false;
    }

    // Set up time-based triggers
    setupTimeTriggers();

    // Start evaluation loop for value-based triggers
    evalTimer = setInterval(() => {
      evaluate();
    }, EVAL_INTERVAL_MS);

    // Start progress broadcast loop
    progressTimer = setInterval(() => {
      broadcastProgress();
    }, PROGRESS_INTERVAL_MS);

    broadcast({
      type: 'triggerScriptStarted',
      state: getState(),
    });

    return Ok();
  }

  async function stop(): Promise<void> {
    if (executionState === 'idle') return;

    executionState = 'idle';

    // Clear timers
    if (evalTimer) {
      clearInterval(evalTimer);
      evalTimer = null;
    }
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
    clearTimeTriggers();

    broadcast({
      type: 'triggerScriptStopped',
      scriptId: script.id,
    });
  }

  function pause(): Result<void, Error> {
    if (executionState !== 'running') {
      return Err(new Error('Trigger script not running'));
    }

    executionState = 'paused';
    pausedAt = Date.now();

    // Clear evaluation timer
    if (evalTimer) {
      clearInterval(evalTimer);
      evalTimer = null;
    }
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }

    // Clear time triggers (will need to be rescheduled on resume)
    clearTimeTriggers();

    broadcast({
      type: 'triggerScriptPaused',
      scriptId: script.id,
    });

    return Ok();
  }

  function resume(): Result<void, Error> {
    if (executionState !== 'paused') {
      return Err(new Error('Trigger script not paused'));
    }

    const pauseDuration = pausedAt ? Date.now() - pausedAt : 0;
    pauseElapsedMs += pauseDuration;
    pausedAt = null;
    executionState = 'running';

    // Reschedule time triggers accounting for pause
    for (const ts of triggerStates) {
      if (ts.trigger.condition.type === 'time' && ts.firedCount === 0) {
        const targetMs = ts.trigger.condition.seconds * 1000;
        const elapsedMs = getElapsedMs();
        const remainingMs = targetMs - elapsedMs;

        if (remainingMs > 0) {
          const timer = setTimeout(async () => {
            if (executionState === 'running' && shouldFire(ts)) {
              ts.conditionMet = true;
              await fireTrigger(ts);
            }
          }, remainingMs);
          timeoutTimers.set(ts.trigger.id, timer);
        }
      }
    }

    // Restart evaluation loop
    evalTimer = setInterval(() => {
      evaluate();
    }, EVAL_INTERVAL_MS);

    // Restart progress broadcast loop
    progressTimer = setInterval(() => {
      broadcastProgress();
    }, PROGRESS_INTERVAL_MS);

    broadcast({
      type: 'triggerScriptResumed',
      scriptId: script.id,
    });

    return Ok();
  }

  function subscribe(callback: SubscriberCallback): () => void {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
  }

  function destroy(): void {
    if (evalTimer) {
      clearInterval(evalTimer);
      evalTimer = null;
    }
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
    clearTimeTriggers();
    subscribers.clear();
  }

  return {
    getState,
    start,
    stop,
    pause,
    resume,
    subscribe,
    destroy,
  };
}
