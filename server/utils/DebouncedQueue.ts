/**
 * DebouncedQueue - Coalesces rapid updates per key into single executions.
 *
 * Each key has an independent queue. When a value is enqueued:
 * - It replaces any previously queued value for that key
 * - A drain timer is started (if not already running)
 * - When the timer fires, if the value is old enough (>= debounceMs), execute it
 * - If the value is too recent, reschedule the timer
 *
 * Only one execution per key runs at a time. If a new value arrives during
 * execution, it will be picked up after the current execution completes.
 */

export interface DebouncedQueueOptions {
  debounceMs: number;
}

interface QueueEntry<T> {
  value: T;
  enqueuedAt: number;
}

export type Executor<T> = (key: string, value: T) => Promise<void>;

export function createDebouncedQueue<T>(
  executor: Executor<T>,
  options: DebouncedQueueOptions
): {
  enqueue: (key: string, value: T) => void;
  hasPending: (key: string) => boolean;
  getPendingValue: (key: string) => T | undefined;
  clear: () => void;
  /** Wait for all in-flight executions to complete */
  flush: () => Promise<void>;
} {
  const { debounceMs } = options;

  const queue = new Map<string, QueueEntry<T>>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const inflight = new Map<string, Promise<void>>();

  function enqueue(key: string, value: T): void {
    queue.set(key, { value, enqueuedAt: Date.now() });

    // Start a timer if one isn't already running for this key
    if (!timers.has(key)) {
      scheduleTimer(key);
    }
  }

  function scheduleTimer(key: string): void {
    const entry = queue.get(key);
    if (!entry) return;

    const age = Date.now() - entry.enqueuedAt;
    const remaining = Math.max(0, debounceMs - age);

    const timer = setTimeout(() => {
      timers.delete(key);
      drain(key);
    }, remaining);

    timers.set(key, timer);
  }

  function drain(key: string): void {
    const entry = queue.get(key);
    if (!entry) return;

    const age = Date.now() - entry.enqueuedAt;
    if (age < debounceMs) {
      // Value is too recent — reschedule
      scheduleTimer(key);
      return;
    }

    // Don't start if already executing for this key
    if (inflight.has(key)) return;

    // Take the value and execute
    const { value } = entry;
    queue.delete(key);

    const promise = executor(key, value)
      .catch((err) => {
        console.error(`[DebouncedQueue] Executor failed for key=${key}:`, err);
      })
      .finally(() => {
        inflight.delete(key);

        // If a new value arrived during execution, drain again
        if (queue.has(key)) {
          const pending = queue.get(key)!;
          const pendingAge = Date.now() - pending.enqueuedAt;
          if (pendingAge >= debounceMs) {
            drain(key);
          } else if (!timers.has(key)) {
            scheduleTimer(key);
          }
        }
      });

    inflight.set(key, promise);
  }

  function hasPending(key: string): boolean {
    return queue.has(key) || inflight.has(key);
  }

  function getPendingValue(key: string): T | undefined {
    return queue.get(key)?.value;
  }

  function clear(): void {
    for (const timer of timers.values()) {
      clearTimeout(timer);
    }
    timers.clear();
    queue.clear();
    // Note: inflight executions continue to completion
  }

  async function flush(): Promise<void> {
    const promises = [...inflight.values()];
    if (promises.length > 0) {
      await Promise.all(promises);
    }
  }

  return { enqueue, hasPending, getPendingValue, clear, flush };
}
