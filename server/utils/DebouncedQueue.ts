/**
 * DebouncedQueue - Coalesces rapid updates per key into single executions.
 *
 * Each key has an independent queue. When a value is enqueued:
 * - It replaces any previously queued value for that key
 * - The debounce timer restarts (trailing-edge: fires after silence)
 *
 * Only one execution per key runs at a time. If a new value arrives during
 * execution, it will be picked up after the current execution completes.
 *
 * After execution succeeds, the key enters "awaiting confirmation" state.
 * hasPending() remains true until confirm(key) is called externally
 * (e.g., when a poll confirms the device applied the value).
 */

export interface DebouncedQueueOptions {
  debounceMs: number;
  /** Timeout for awaiting confirmation. Key auto-confirms after this. Default: 5000ms */
  confirmTimeoutMs?: number;
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
  const { debounceMs, confirmTimeoutMs = 5000 } = options;

  const queue = new Map<string, QueueEntry<T>>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const inflight = new Map<string, Promise<void>>();
  // Value currently being executed (so getPendingValue works during inflight)
  const inflightValues = new Map<string, T>();
  // Keys where executor succeeded but external confirmation hasn't arrived yet
  const awaitingConfirm = new Map<string, T>();
  const confirmTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function enqueue(key: string, value: T): void {
    queue.set(key, { value, enqueuedAt: Date.now() });

    // If inflight, just update the queue — .finally() will pick it up
    if (inflight.has(key)) return;

    // Restart the timer on every enqueue — debounceMs of silence before firing
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
    inflightValues.set(key, value);

    let succeeded = false;
    const promise = executor(key, value)
      .then(() => {
        succeeded = true;
      })
      .catch((err) => {
        console.error(`[DebouncedQueue] Executor failed for key=${key}:`, err);
      })
      .finally(() => {
        inflight.delete(key);
        inflightValues.delete(key);

        if (succeeded) {
          // Keep as awaiting confirmation until externally confirmed
          awaitingConfirm.set(key, value);

          // Auto-confirm after timeout to prevent permanent suppression
          const ct = setTimeout(() => {
            confirmTimers.delete(key);
            awaitingConfirm.delete(key);
          }, confirmTimeoutMs);
          confirmTimers.set(key, ct);
        }

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
    return queue.get(key)?.value ?? inflightValues.get(key) ?? awaitingConfirm.get(key);
  }

  function confirm(key: string): void {
    awaitingConfirm.delete(key);
    const ct = confirmTimers.get(key);
    if (ct) {
      clearTimeout(ct);
      confirmTimers.delete(key);
    }
  }

  function clear(): void {
    for (const timer of timers.values()) {
      clearTimeout(timer);
    }
    for (const ct of confirmTimers.values()) {
      clearTimeout(ct);
    }
    timers.clear();
    queue.clear();
    inflightValues.clear();
    awaitingConfirm.clear();
    confirmTimers.clear();
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
