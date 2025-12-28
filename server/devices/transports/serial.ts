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

  const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

  return {
    async open(): Promise<void> {
      if (opened) return;

      port = new SerialPort({
        path,
        baudRate,
        autoOpen: false,
      });

      parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

      await new Promise<void>((resolve, reject) => {
        port!.open((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      opened = true;
    },

    async close(): Promise<void> {
      if (!opened || !port) return;

      await new Promise<void>((resolve) => {
        port!.close(() => resolve());
      });

      port = null;
      parser = null;
      opened = false;
    },

    async query(cmd: string): Promise<string> {
      if (!port || !parser) {
        throw new Error('Port not opened');
      }

      const result = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Timeout waiting for response to: ${cmd}`));
        }, 2000);

        parser!.once('data', (data: string) => {
          clearTimeout(timeout);
          resolve(data.trim());
        });

        port!.write(cmd + '\n', (err) => {
          if (err) {
            clearTimeout(timeout);
            reject(err);
          }
        });
      });

      // Add delay after query for device to settle (required for Matrix PSU)
      await delay(commandDelay);

      return result;
    },

    async write(cmd: string): Promise<void> {
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
    },

    isOpen(): boolean {
      return opened;
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
