/**
 * Simulated Transport
 * Implements Transport interface for simulated devices
 *
 * Routes SCPI commands to a simulator and returns responses.
 * Adds configurable latency to mimic real device timing.
 */

import type { Transport } from '../types.js';
import type { Result } from '../../../shared/types.js';
import { Ok } from '../../../shared/types.js';

export interface SimulatedTransportConfig {
  /** Base latency in ms (default: 20) */
  latencyMs?: number;
  /** Random jitter range in ms (default: 10) */
  jitterMs?: number;
  /** Name for logging */
  name?: string;
}

export type CommandHandler = (cmd: string) => string | null;

export function createSimulatedTransport(
  handler: CommandHandler,
  config: SimulatedTransportConfig = {}
): Transport {
  const { latencyMs = 20, jitterMs = 10, name = 'simulated' } = config;

  let opened = false;

  // Mutex to prevent concurrent commands (like real transports)
  let commandLock: Promise<void> = Promise.resolve();

  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const previousLock = commandLock;
    let releaseLock: () => void;
    commandLock = new Promise<void>(resolve => {
      releaseLock = resolve;
    });
    return previousLock.then(fn).finally(() => releaseLock());
  }

  async function delay(): Promise<void> {
    const jitter = Math.random() * jitterMs;
    const totalDelay = latencyMs + jitter;
    await new Promise(r => setTimeout(r, totalDelay));
  }

  return {
    async open(): Promise<Result<void, Error>> {
      opened = true;
      return Ok();
    },

    async close(): Promise<Result<void, Error>> {
      opened = false;
      return Ok();
    },

    async query(cmd: string): Promise<Result<string, Error>> {
      return withLock(async () => {
        await delay();
        const response = handler(cmd);
        return Ok(response ?? '');
      });
    },

    async write(cmd: string): Promise<Result<void, Error>> {
      return withLock(async () => {
        await delay();
        handler(cmd);
        return Ok();
      });
    },

    isOpen(): boolean {
      return opened;
    },
  };
}
