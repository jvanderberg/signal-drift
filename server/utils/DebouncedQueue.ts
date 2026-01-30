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
  /** Mark a key as confirmed (no longer pending). Call when external state matches. */
  confirm: (key: string) => void;
  clear: () => void;
  /** Wait for all in-flight executions to complete */
  flush: () => Promise<void>;
} {
  const { debounceMs } = options;

  const queue = new Map<string, QueueEntry<T>>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const inflight = new Map<string, Promise<void>>();
  // Tracks keys where executor completed but external confirmation hasn't arrived yet
  const awaitingConfirm = new Map<string, T>();

  function enqueue(key: string, value: T): void {
    queue.set(key, { value, enqueuedAt: Date.now() });

    // If inflight, just update the queue — .finally() will pick it up
    if (inflight.has(key)) return;

    // Restart the timer on every enqueue — 250ms of silence before firing
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);
    scheduleTimer(key);
  }

  function scheduleTimer(key: string): void {
    const timer = setTimeout(() => {
      timers.delete(key);
      drain(key);
    }, debounceMs);

    timers.set(key, timer);
  }

  function drain(key: string): void {
    const entry = queue.get(key);
    if (!entry) return;

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
        // Keep as awaiting confirmation until externally confirmed
        awaitingConfirm.set(key, value);

        // If a new value arrived during execution, start a new debounce
        if (queue.has(key) && !timers.has(key)) {
          scheduleTimer(key);
        }
      });

    inflight.set(key, promise);
  }

  function hasPending(key: string): boolean {
    return queue.has(key) || inflight.has(key) || awaitingConfirm.has(key);
  }

  function getPendingValue(key: string): T | undefined {
    return queue.get(key)?.value ?? awaitingConfirm.get(key);
  }

  function confirm(key: string): void {
    awaitingConfirm.delete(key);
  }

  function clear(): void {
    for (const timer of timers.values()) {
      clearTimeout(timer);
    }
    timers.clear();
    queue.clear();
    awaitingConfirm.clear();
    // Note: inflight executions continue to completion
  }

  async function flush(): Promise<void> {
    const promises = [...inflight.values()];
    if (promises.length > 0) {
      await Promise.all(promises);
    }
  }

  return { enqueue, hasPending, getPendingValue, confirm, clear, flush };
}
