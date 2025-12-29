import type { Transport } from '../types.js';

export interface MockTransportOptions {
  responses?: Record<string, string>;
  defaultResponse?: string;
}

export interface MockTransport extends Transport {
  sentCommands: string[];
  responses: Record<string, string>;
  reset(): void;
}

export function createMockTransport(options: MockTransportOptions = {}): MockTransport {
  const responses: Record<string, string> = { ...options.responses };
  const defaultResponse = options.defaultResponse ?? '';
  let opened = false;
  const sentCommands: string[] = [];

  // Track written values to update query responses
  // This handles commands like "VOLT 24.5" which should update "VOLT?" response
  function handleWrite(cmd: string): void {
    const trimmed = cmd.trim();

    // Parse common SCPI-style set commands
    // Matrix PSU: "VOLT 24.5", "CURR 2.5", "OUTP ON"
    const matrixMatch = trimmed.match(/^(VOLT|CURR)\s+([\d.]+)$/);
    if (matrixMatch) {
      const [, param, value] = matrixMatch;
      responses[`${param}?`] = value;
      return;
    }

    // Rigol style: ":SOUR:CURR:LEV 2.5" -> update ":SOUR:CURR:LEV?"
    const rigolMatch = trimmed.match(/^(:SOUR:\w+:LEV)\s+([\d.]+)$/);
    if (rigolMatch) {
      const [, param, value] = rigolMatch;
      responses[`${param}?`] = value;
      return;
    }
  }

  return {
    sentCommands,
    responses,

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
      handleWrite(cmd);
    },

    isOpen(): boolean {
      return opened;
    },

    reset(): void {
      sentCommands.length = 0;
    },
  };
}
