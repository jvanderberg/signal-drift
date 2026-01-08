/**
 * Serial Transport
 * Implements serial port communication for SCPI devices
 */

import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import type { Transport } from '../types.js';
import type { Result } from '../../../shared/types.js';
import { Ok, Err } from '../../../shared/types.js';

export interface SerialConfig {
  path: string;
  baudRate: number;
  commandDelay?: number;  // ms delay between commands (default: 50)
  timeout?: number;       // query timeout in ms (default: 2000)
}

// Extended Transport interface with clear capability
export interface SerialTransport extends Transport {
  clear(): Promise<Result<void, Error>>;
}

export function createSerialTransport(config: SerialConfig): SerialTransport {
  const { path, baudRate, commandDelay = 50, timeout = 2000 } = config;

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
    async open(): Promise<Result<void, Error>> {
      if (opened) return Ok();

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

      try {
        await new Promise<void>((resolve, reject) => {
          port!.open((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      } catch (e) {
        return Err(e instanceof Error ? e : new Error(String(e)));
      }

      opened = true;
      disconnected = false;
      disconnectError = null;
      return Ok();
    },

    async close(): Promise<Result<void, Error>> {
      if (!port) return Ok();

      // Close with timeout to prevent hanging on shutdown
      // Wait up to 3 seconds for any in-flight operations, then force close
      const CLOSE_TIMEOUT = 3000;

      const closeOperation = withLock(async () => {
        // Remove all listeners from parser and port before closing
        if (parser) {
          parser.removeAllListeners();
        }
        if (port) {
          port.removeAllListeners();
        }

        if (opened && !disconnected && port) {
          await new Promise<void>((resolve) => {
            port!.close(() => resolve());
          });
        }

        port = null;
        parser = null;
        opened = false;
        disconnected = false;
        disconnectError = null;
      });

      const timeoutPromise = new Promise<void>((resolve) => {
        setTimeout(() => {
          console.warn(`[Serial] Close timeout after ${CLOSE_TIMEOUT}ms, forcing close`);
          // Force cleanup even if lock wasn't acquired
          if (parser) parser.removeAllListeners();
          if (port) {
            port.removeAllListeners();
            try {
              port.close();
            } catch {
              // Ignore close errors during forced cleanup
            }
          }
          port = null;
          parser = null;
          opened = false;
          disconnected = false;
          disconnectError = null;
          resolve();
        }, CLOSE_TIMEOUT);
      });

      await Promise.race([closeOperation, timeoutPromise]);
      return Ok();
    },

    async query(cmd: string): Promise<Result<string, Error>> {
      return withLock(async () => {
        if (disconnected) {
          return Err(disconnectError || new Error('SERIAL_PORT_DISCONNECTED'));
        }
        if (!port || !parser) {
          return Err(new Error('Port not opened'));
        }

        let result: string;
        try {
          result = await new Promise<string>((resolve, reject) => {
            let settled = false;

            let timeoutId: ReturnType<typeof setTimeout>;

            const cleanup = () => {
              if (!settled) {
                settled = true;
                clearTimeout(timeoutId);
                parser?.removeListener('data', onData);
              }
            };

            const onData = (data: string) => {
              cleanup();
              resolve(data.trim());
            };

            timeoutId = setTimeout(() => {
              cleanup();
              reject(new Error(`Timeout waiting for response to: ${cmd}`));
            }, timeout);

            parser!.once('data', onData);

            port!.write(cmd + '\n', (err) => {
              if (err) {
                cleanup();
                reject(err);
              }
            });
          });
        } catch (e) {
          return Err(e instanceof Error ? e : new Error(String(e)));
        }

        // Add delay after query for device to settle (required for Matrix PSU)
        await delay(commandDelay);

        return Ok(result);
      });
    },

    async write(cmd: string): Promise<Result<void, Error>> {
      return withLock(async () => {
        if (disconnected) {
          return Err(disconnectError || new Error('SERIAL_PORT_DISCONNECTED'));
        }
        if (!port) {
          return Err(new Error('Port not opened'));
        }

        try {
          await new Promise<void>((resolve, reject) => {
            port!.write(cmd + '\n', (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        } catch (e) {
          return Err(e instanceof Error ? e : new Error(String(e)));
        }

        // Add delay after write for device to process
        await delay(commandDelay);
        return Ok();
      });
    },

    isOpen(): boolean {
      return opened && !disconnected;
    },

    /**
     * Clear any pending data in the serial buffer
     * This helps recover from stuck states where the device has pending output
     * that's confusing the command/response flow
     */
    async clear(): Promise<Result<void, Error>> {
      return withLock(async () => {
        if (!port || !opened) {
          return Ok(); // Nothing to clear if not open
        }

        try {
          // Flush any pending outgoing data
          await new Promise<void>((resolve, reject) => {
            port!.flush((err) => {
              if (err) reject(err);
              else resolve();
            });
          });

          // Drain any pending incoming data by consuming it with a short timeout
          // Uses a dedicated listener that cleans up properly
          if (parser) {
            await new Promise<void>((resolve) => {
              let resolved = false;
              let timeoutId: ReturnType<typeof setTimeout>;

              const cleanup = () => {
                if (!resolved) {
                  resolved = true;
                  clearTimeout(timeoutId);
                  parser?.removeListener('data', onData);
                  resolve();
                }
              };

              const onData = () => {
                // Got some data, wait a bit more for any additional buffered data
                clearTimeout(timeoutId);
                timeoutId = setTimeout(cleanup, 50);
              };

              // Listen for data (not once - we want to drain ALL buffered data)
              parser!.on('data', onData);

              // Max drain time - resolve even if data keeps coming
              timeoutId = setTimeout(cleanup, 100);
            });
          }

          // Add a small delay for the device to settle
          await delay(commandDelay);

          return Ok();
        } catch (e) {
          // Clear errors are non-fatal - just log and continue
          console.warn(`[Serial] Clear failed: ${e}`);
          return Ok();
        }
      });
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
