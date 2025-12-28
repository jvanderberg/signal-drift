import type { Transport } from '../types.js';

export interface MockTransportOptions {
  responses?: Record<string, string>;
  defaultResponse?: string;
}

export interface MockTransport extends Transport {
  sentCommands: string[];
  reset(): void;
}

export function createMockTransport(options: MockTransportOptions = {}): MockTransport {
  const { responses = {}, defaultResponse = '' } = options;
  let opened = false;
  const sentCommands: string[] = [];

  return {
    sentCommands,

    async open(): Promise<void> {
      opened = true;
    },

    async close(): Promise<void> {
      opened = false;
    },

    async query(cmd: string): Promise<string> {
      if (!opened) throw new Error('Transport not opened');
      sentCommands.push(cmd);

      // Check for exact match first
      if (cmd in responses) {
        return responses[cmd];
      }

      // Check for pattern match (command without newline)
      const trimmed = cmd.trim();
      if (trimmed in responses) {
        return responses[trimmed];
      }

      return defaultResponse;
    },

    async write(cmd: string): Promise<void> {
      if (!opened) throw new Error('Transport not opened');
      sentCommands.push(cmd);
    },

    isOpen(): boolean {
      return opened;
    },

    reset(): void {
      sentCommands.length = 0;
    },
  };
}
