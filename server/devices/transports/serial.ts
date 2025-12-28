/**
 * Serial Transport
 * Implements serial port communication for SCPI devices
 */

import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import type { Transport } from '../types.js';

export interface SerialConfig {
  path: string;
  baudRate: number;
  commandDelay?: number;  // ms delay between commands (default: 50)
}

export function createSerialTransport(config: SerialConfig): Transport {
  const { path, baudRate, commandDelay = 50 } = config;

  let port: SerialPort | null = null;
  let parser: ReadlineParser | null = null;
  let opened = false;
  let disconnected = false;
  let disconnectError: Error | null = null;

  // Mutex to prevent concurrent command/response interleaving
  let commandLock: Promise<void> = Promise.resolve();

  const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

  // Acquire lock for exclusive command access
  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const previousLock = commandLock;
    let releaseLock: () => void;
    commandLock = new Promise<void>(resolve => {
      releaseLock = resolve;
    });
    return previousLock.then(fn).finally(() => releaseLock());
  }

  return {
    async open(): Promise<void> {
      if (opened) return;

      port = new SerialPort({
        path,
        baudRate,
        autoOpen: false,
      });

      // Listen for port disconnection events
      port.on('close', () => {
        disconnected = true;
        disconnectError = new Error('SERIAL_PORT_DISCONNECTED: Port closed');
        opened = false;
      });

      port.on('error', (err) => {
        disconnected = true;
        disconnectError = new Error(`SERIAL_PORT_ERROR: ${err.message}`);
      });

      parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

      await new Promise<void>((resolve, reject) => {
        port!.open((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      opened = true;
      disconnected = false;
      disconnectError = null;
    },

    async close(): Promise<void> {
      if (!port) return;

      // Remove all listeners from parser and port before closing
      if (parser) {
        parser.removeAllListeners();
      }
      port.removeAllListeners();

      if (opened && !disconnected) {
        await new Promise<void>((resolve) => {
          port!.close(() => resolve());
        });
      }

      port = null;
      parser = null;
      opened = false;
      disconnected = false;
      disconnectError = null;
    },

    async query(cmd: string): Promise<string> {
      return withLock(async () => {
        if (disconnected) {
          throw disconnectError || new Error('SERIAL_PORT_DISCONNECTED');
        }
        if (!port || !parser) {
          throw new Error('Port not opened');
        }

        const result = await new Promise<string>((resolve, reject) => {
          let settled = false;

          const cleanup = () => {
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              parser?.removeListener('data', onData);
            }
          };

          const onData = (data: string) => {
            cleanup();
            resolve(data.trim());
          };

          const timeout = setTimeout(() => {
            cleanup();
            reject(new Error(`Timeout waiting for response to: ${cmd}`));
          }, 2000);

          parser!.once('data', onData);

          port!.write(cmd + '\n', (err) => {
            if (err) {
              cleanup();
              reject(err);
            }
          });
        });

        // Add delay after query for device to settle (required for Matrix PSU)
        await delay(commandDelay);

        return result;
      });
    },

    async write(cmd: string): Promise<void> {
      return withLock(async () => {
        if (disconnected) {
          throw disconnectError || new Error('SERIAL_PORT_DISCONNECTED');
        }
        if (!port) {
          throw new Error('Port not opened');
        }

        await new Promise<void>((resolve, reject) => {
          port!.write(cmd + '\n', (err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        // Add delay after write for device to process
        await delay(commandDelay);
      });
    },

    isOpen(): boolean {
      return opened && !disconnected;
    },
  };
}

// Helper to list available serial ports
export async function listSerialPorts(): Promise<Array<{ path: string; manufacturer?: string }>> {
  const ports = await SerialPort.list();
  return ports.map(p => ({
    path: p.path,
    manufacturer: p.manufacturer,
  }));
}

// Helper to find a serial port matching a pattern
export async function findSerialPort(pattern: RegExp): Promise<string | null> {
  const ports = await SerialPort.list();
  const match = ports.find(p => pattern.test(p.path));
  return match?.path || null;
}
