import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDebouncedQueue } from '../DebouncedQueue';

describe('DebouncedQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should execute after debounce period', async () => {
    const executor = vi.fn().mockResolvedValue(undefined);
    const q = createDebouncedQueue(executor, { debounceMs: 250 });

    q.enqueue('voltage', 12.0);

    // Not called yet
    expect(executor).not.toHaveBeenCalled();

    // Advance past debounce
    await vi.advanceTimersByTimeAsync(250);

    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor).toHaveBeenCalledWith('voltage', 12.0);
  });

  it('should coalesce rapid updates into one execution', async () => {
    const executor = vi.fn().mockResolvedValue(undefined);
    const q = createDebouncedQueue(executor, { debounceMs: 250 });

    q.enqueue('voltage', 12.0);
    await vi.advanceTimersByTimeAsync(50);
    q.enqueue('voltage', 12.1);
    await vi.advanceTimersByTimeAsync(50);
    q.enqueue('voltage', 12.2);
    await vi.advanceTimersByTimeAsync(50);
    q.enqueue('voltage', 12.3);

    // Timer from first enqueue fires at 250ms, but value is only 100ms old
    // so it reschedules. Advance to 500ms total to be sure.
    await vi.advanceTimersByTimeAsync(300);

    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor).toHaveBeenCalledWith('voltage', 12.3);
  });

  it('should handle independent keys separately', async () => {
    const executor = vi.fn().mockResolvedValue(undefined);
    const q = createDebouncedQueue(executor, { debounceMs: 250 });

    q.enqueue('voltage', 12.0);
    q.enqueue('current', 5.0);

    await vi.advanceTimersByTimeAsync(250);

    expect(executor).toHaveBeenCalledTimes(2);
    expect(executor).toHaveBeenCalledWith('voltage', 12.0);
    expect(executor).toHaveBeenCalledWith('current', 5.0);
  });

  it('should not execute twice for the same value', async () => {
    const executor = vi.fn().mockResolvedValue(undefined);
    const q = createDebouncedQueue(executor, { debounceMs: 250 });

    q.enqueue('voltage', 12.0);
    await vi.advanceTimersByTimeAsync(250);

    expect(executor).toHaveBeenCalledTimes(1);

    // No more calls after further time
    await vi.advanceTimersByTimeAsync(500);
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('should pick up new value arriving during execution', async () => {
    let resolveExecution: () => void;
    const executor = vi.fn().mockImplementation(() => {
      return new Promise<void>((resolve) => {
        resolveExecution = resolve;
      });
    });

    const q = createDebouncedQueue(executor, { debounceMs: 250 });

    // First value
    q.enqueue('voltage', 12.0);
    await vi.advanceTimersByTimeAsync(250);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor).toHaveBeenCalledWith('voltage', 12.0);

    // New value arrives during execution
    q.enqueue('voltage', 12.5);
    await vi.advanceTimersByTimeAsync(250);

    // Still only 1 call — executor is blocked
    expect(executor).toHaveBeenCalledTimes(1);

    // Complete first execution
    resolveExecution!();
    await vi.advanceTimersByTimeAsync(0);

    // Now the queued value should execute
    // It was enqueued 250ms ago so it should drain immediately
    expect(executor).toHaveBeenCalledTimes(2);
    expect(executor).toHaveBeenCalledWith('voltage', 12.5);
  });

  it('should not start concurrent executions for the same key', async () => {
    let activeCount = 0;
    let maxActive = 0;
    const executor = vi.fn().mockImplementation(async () => {
      activeCount++;
      maxActive = Math.max(maxActive, activeCount);
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      activeCount--;
    });

    const q = createDebouncedQueue(executor, { debounceMs: 50 });

    // Enqueue rapidly
    q.enqueue('voltage', 1);
    await vi.advanceTimersByTimeAsync(50);
    // First execution starts

    q.enqueue('voltage', 2);
    await vi.advanceTimersByTimeAsync(50);
    // Timer fires but inflight guard prevents concurrent execution

    q.enqueue('voltage', 3);
    await vi.advanceTimersByTimeAsync(50);

    // Let first execution complete
    await vi.advanceTimersByTimeAsync(100);
    // Second execution starts with value 3

    // Let second complete
    await vi.advanceTimersByTimeAsync(100);

    expect(maxActive).toBe(1);
  });

  it('should coalesce values arriving during execution into one call', async () => {
    let resolveExecution: () => void;
    const executor = vi.fn().mockImplementation(() => {
      return new Promise<void>((resolve) => {
        resolveExecution = resolve;
      });
    });

    const q = createDebouncedQueue(executor, { debounceMs: 100 });

    q.enqueue('voltage', 1);
    await vi.advanceTimersByTimeAsync(100);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor).toHaveBeenCalledWith('voltage', 1);

    // Multiple values arrive during execution
    q.enqueue('voltage', 2);
    await vi.advanceTimersByTimeAsync(30);
    q.enqueue('voltage', 3);
    await vi.advanceTimersByTimeAsync(30);
    q.enqueue('voltage', 4);
    await vi.advanceTimersByTimeAsync(100);

    // Still just 1 call
    expect(executor).toHaveBeenCalledTimes(1);

    // Complete first execution
    resolveExecution!();
    await vi.advanceTimersByTimeAsync(0);

    // Should execute only once more with the latest value (4)
    expect(executor).toHaveBeenCalledTimes(2);
    expect(executor).toHaveBeenLastCalledWith('voltage', 4);
  });

  it('should report hasPending during debounce wait', async () => {
    const executor = vi.fn().mockResolvedValue(undefined);
    const q = createDebouncedQueue(executor, { debounceMs: 250 });

    expect(q.hasPending('voltage')).toBe(false);

    q.enqueue('voltage', 12.0);
    expect(q.hasPending('voltage')).toBe(true);
    expect(q.hasPending('current')).toBe(false);

    await vi.advanceTimersByTimeAsync(250);
    expect(q.hasPending('voltage')).toBe(false);
  });

  it('should report hasPending during execution', async () => {
    let resolveExecution: () => void;
    const executor = vi.fn().mockImplementation(() => {
      return new Promise<void>((resolve) => {
        resolveExecution = resolve;
      });
    });

    const q = createDebouncedQueue(executor, { debounceMs: 100 });

    q.enqueue('voltage', 12.0);
    await vi.advanceTimersByTimeAsync(100);

    // Execution in flight
    expect(q.hasPending('voltage')).toBe(true);

    resolveExecution!();
    await vi.advanceTimersByTimeAsync(0);

    expect(q.hasPending('voltage')).toBe(false);
  });

  it('should return pending value via getPendingValue', async () => {
    const executor = vi.fn().mockResolvedValue(undefined);
    const q = createDebouncedQueue(executor, { debounceMs: 250 });

    expect(q.getPendingValue('voltage')).toBeUndefined();

    q.enqueue('voltage', 12.0);
    expect(q.getPendingValue('voltage')).toBe(12.0);

    q.enqueue('voltage', 12.5);
    expect(q.getPendingValue('voltage')).toBe(12.5);
  });

  it('should clear all pending timers and queued values', async () => {
    const executor = vi.fn().mockResolvedValue(undefined);
    const q = createDebouncedQueue(executor, { debounceMs: 250 });

    q.enqueue('voltage', 12.0);
    q.enqueue('current', 5.0);

    q.clear();

    await vi.advanceTimersByTimeAsync(500);
    expect(executor).not.toHaveBeenCalled();
    expect(q.hasPending('voltage')).toBe(false);
    expect(q.hasPending('current')).toBe(false);
  });

  it('should flush and wait for in-flight executions', async () => {
    let resolveExecution: () => void;
    const executor = vi.fn().mockImplementation(() => {
      return new Promise<void>((resolve) => {
        resolveExecution = resolve;
      });
    });

    const q = createDebouncedQueue(executor, { debounceMs: 100 });

    q.enqueue('voltage', 12.0);
    await vi.advanceTimersByTimeAsync(100);
    expect(executor).toHaveBeenCalledTimes(1);

    // flush should wait for the in-flight execution
    const flushed = vi.fn();
    q.flush().then(flushed);
    await vi.advanceTimersByTimeAsync(0);
    expect(flushed).not.toHaveBeenCalled();

    resolveExecution!();
    await vi.advanceTimersByTimeAsync(0);
    expect(flushed).toHaveBeenCalled();
  });

  it('should handle executor errors without breaking the queue', async () => {
    let callCount = 0;
    const executor = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error('hardware error');
    });

    const q = createDebouncedQueue(executor, { debounceMs: 100 });

    // First call fails
    q.enqueue('voltage', 12.0);
    await vi.advanceTimersByTimeAsync(100);
    expect(executor).toHaveBeenCalledTimes(1);

    // Queue should still work after error
    q.enqueue('voltage', 13.0);
    await vi.advanceTimersByTimeAsync(100);
    expect(executor).toHaveBeenCalledTimes(2);
    expect(executor).toHaveBeenLastCalledWith('voltage', 13.0);
  });

  it('should handle sustained rapid clicking (value every 50ms for 2 seconds)', async () => {
    const executor = vi.fn().mockImplementation(async () => {
      // Simulate hardware call taking 200ms
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
    });

    const q = createDebouncedQueue(executor, { debounceMs: 250 });

    // Simulate 40 clicks over 2 seconds (one every 50ms)
    for (let i = 0; i < 40; i++) {
      q.enqueue('voltage', 10 + i * 0.1);
      await vi.advanceTimersByTimeAsync(50);
    }

    // Let everything drain
    await vi.advanceTimersByTimeAsync(2000);

    // Should have far fewer executions than 40 clicks
    // The exact count depends on timing, but it should be small
    expect(executor.mock.calls.length).toBeLessThan(10);

    // Last execution should have the final value
    const lastCall = executor.mock.calls[executor.mock.calls.length - 1];
    expect(lastCall[1]).toBeCloseTo(10 + 39 * 0.1, 5);
  });

  it('should never go backwards in value for a key', async () => {
    const executedValues: number[] = [];
    const executor = vi.fn().mockImplementation(async (_key: string, value: number) => {
      executedValues.push(value);
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    });

    const q = createDebouncedQueue(executor, { debounceMs: 250 });

    // Monotonically increasing values
    for (let i = 0; i < 20; i++) {
      q.enqueue('voltage', 10 + i);
      await vi.advanceTimersByTimeAsync(80);
    }

    await vi.advanceTimersByTimeAsync(2000);

    // Each executed value should be >= the previous one
    for (let i = 1; i < executedValues.length; i++) {
      expect(executedValues[i]).toBeGreaterThanOrEqual(executedValues[i - 1]);
    }

    // Last executed value should be the final one
    if (executedValues.length > 0) {
      expect(executedValues[executedValues.length - 1]).toBe(29);
    }
  });
});
