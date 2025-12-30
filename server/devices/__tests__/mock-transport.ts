import type { Transport } from '../types.js';
import type { Result } from '../../../shared/types.js';
import { Ok, Err } from '../../../shared/types.js';

export interface MockTransportOptions {
  responses?: Record<string, string>;
  binaryResponses?: Record<string, Buffer>;
  defaultResponse?: string;
}

export interface MockTransport extends Transport {
  sentCommands: string[];
  responses: Record<string, string>;
  binaryResponses: Record<string, Buffer>;
  reset(): void;
}

export function createMockTransport(options: MockTransportOptions = {}): MockTransport {
  const responses: Record<string, string> = { ...options.responses };
  const binaryResponses: Record<string, Buffer> = { ...options.binaryResponses };
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
    binaryResponses,

    async open(): Promise<Result<void, Error>> {
      opened = true;
      return Ok();
    },

    async close(): Promise<Result<void, Error>> {
      opened = false;
      return Ok();
    },

    async query(cmd: string): Promise<Result<string, Error>> {
      if (!opened) return Err(new Error('Transport not opened'));
      sentCommands.push(cmd);

      // Check for exact match first
      if (cmd in responses) {
        return Ok(responses[cmd]);
      }

      // Check for pattern match (command without newline)
      const trimmed = cmd.trim();
      if (trimmed in responses) {
        return Ok(responses[trimmed]);
      }

      return Ok(defaultResponse);
    },

    async queryBinary(cmd: string): Promise<Result<Buffer, Error>> {
      if (!opened) return Err(new Error('Transport not opened'));
      sentCommands.push(cmd);

      // Check for exact match first
      if (cmd in binaryResponses) {
        return Ok(binaryResponses[cmd]);
      }

      // Check for pattern match (command without newline)
      const trimmed = cmd.trim();
      if (trimmed in binaryResponses) {
        return Ok(binaryResponses[trimmed]);
      }

      return Ok(Buffer.alloc(0));
    },

    async write(cmd: string): Promise<Result<void, Error>> {
      if (!opened) return Err(new Error('Transport not opened'));
      sentCommands.push(cmd);
      handleWrite(cmd);
      return Ok();
    },

    isOpen(): boolean {
      return opened;
    },

    reset(): void {
      sentCommands.length = 0;
    },
  };
}
