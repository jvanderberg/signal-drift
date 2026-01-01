/**
 * SequenceStore - Persistent JSON file storage for sequence library
 *
 * Works on both Raspberry Pi and Electron by using a configurable data directory.
 * Stores sequences in a JSON file with atomic write operations.
 *
 * Storage location (in order of precedence):
 * 1. LAB_CONTROLLER_DATA_DIR environment variable
 * 2. XDG_DATA_HOME/lab-controller (Linux/Pi)
 * 3. APPDATA/lab-controller (Windows)
 * 4. ~/Library/Application Support/lab-controller (macOS)
 * 5. ./data (fallback)
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { SequenceDefinition, Result } from '../../shared/types.js';
import { Ok, Err } from '../../shared/types.js';
import { WAVEFORM_LIMITS } from '../../shared/waveform.js';

export interface SequenceStore {
  /** Load all sequences from storage */
  load(): Promise<Result<SequenceDefinition[], Error>>;

  /** Save all sequences to storage (atomic write) */
  save(sequences: SequenceDefinition[]): Promise<Result<void, Error>>;

  /** Get the storage file path (for debugging) */
  getStoragePath(): string;
}

interface StorageData {
  version: number;
  sequences: SequenceDefinition[];
  lastModified: number;
}

const STORAGE_VERSION = 1;
const STORAGE_FILENAME = 'sequences.json';

/**
 * Determine the data directory based on platform and environment
 */
function getDataDirectory(): string {
  // 1. Environment variable override
  if (process.env.LAB_CONTROLLER_DATA_DIR) {
    return process.env.LAB_CONTROLLER_DATA_DIR;
  }

  // 2. XDG_DATA_HOME (Linux/Pi)
  if (process.env.XDG_DATA_HOME) {
    return path.join(process.env.XDG_DATA_HOME, 'lab-controller');
  }

  // 3. Platform-specific defaults
  const platform = os.platform();
  const homedir = os.homedir();

  switch (platform) {
    case 'win32':
      // Windows: %APPDATA%\lab-controller
      return path.join(process.env.APPDATA || path.join(homedir, 'AppData', 'Roaming'), 'lab-controller');

    case 'darwin':
      // macOS: ~/Library/Application Support/lab-controller
      return path.join(homedir, 'Library', 'Application Support', 'lab-controller');

    case 'linux':
    default:
      // Linux/Pi: ~/.local/share/lab-controller (XDG default)
      return path.join(homedir, '.local', 'share', 'lab-controller');
  }
}

/**
 * Ensure directory exists, creating it if necessary
 */
async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (err) {
    // Ignore if already exists
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw err;
    }
  }
}

/**
 * Atomic write: write to temp file then rename
 */
async function atomicWrite(filePath: string, data: string): Promise<void> {
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  await fs.writeFile(tempPath, data, 'utf-8');
  await fs.rename(tempPath, filePath);
}

/**
 * Validate loaded sequences (basic structure check)
 */
function validateSequences(data: unknown): data is StorageData {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;

  if (typeof obj.version !== 'number') return false;
  if (!Array.isArray(obj.sequences)) return false;

  // Check each sequence has required fields
  for (const seq of obj.sequences) {
    if (typeof seq !== 'object' || seq === null) return false;
    const s = seq as Record<string, unknown>;
    if (typeof s.id !== 'string') return false;
    if (typeof s.name !== 'string') return false;
    if (typeof s.unit !== 'string') return false;
    if (typeof s.waveform !== 'object') return false;
    if (typeof s.createdAt !== 'number') return false;
    if (typeof s.updatedAt !== 'number') return false;
  }

  return true;
}

export function createSequenceStore(): SequenceStore {
  const dataDir = getDataDirectory();
  const storagePath = path.join(dataDir, STORAGE_FILENAME);

  async function load(): Promise<Result<SequenceDefinition[], Error>> {
    try {
      // Ensure directory exists
      await ensureDir(dataDir);

      // Try to read file
      let content: string;
      try {
        content = await fs.readFile(storagePath, 'utf-8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          // File doesn't exist yet - return empty array
          console.log(`[SequenceStore] No existing storage at ${storagePath}, starting fresh`);
          return Ok([]);
        }
        throw err;
      }

      // Parse JSON
      let data: unknown;
      try {
        data = JSON.parse(content);
      } catch {
        return Err(new Error('Invalid JSON in sequence storage file'));
      }

      // Validate structure
      if (!validateSequences(data)) {
        return Err(new Error('Invalid sequence storage format'));
      }

      // Check version and migrate if needed (for future compatibility)
      if (data.version > STORAGE_VERSION) {
        return Err(new Error(`Unsupported storage version: ${data.version}`));
      }

      // Enforce library size limit
      if (data.sequences.length > WAVEFORM_LIMITS.MAX_LIBRARY_SIZE) {
        console.warn(`[SequenceStore] Library exceeds max size, truncating to ${WAVEFORM_LIMITS.MAX_LIBRARY_SIZE}`);
        data.sequences = data.sequences.slice(0, WAVEFORM_LIMITS.MAX_LIBRARY_SIZE);
      }

      console.log(`[SequenceStore] Loaded ${data.sequences.length} sequences from ${storagePath}`);
      return Ok(data.sequences);
    } catch (err) {
      return Err(err instanceof Error ? err : new Error(String(err)));
    }
  }

  async function save(sequences: SequenceDefinition[]): Promise<Result<void, Error>> {
    try {
      // Ensure directory exists
      await ensureDir(dataDir);

      // Enforce library size limit
      if (sequences.length > WAVEFORM_LIMITS.MAX_LIBRARY_SIZE) {
        return Err(new Error(`Library size exceeds maximum of ${WAVEFORM_LIMITS.MAX_LIBRARY_SIZE}`));
      }

      const data: StorageData = {
        version: STORAGE_VERSION,
        sequences,
        lastModified: Date.now(),
      };

      // Atomic write
      await atomicWrite(storagePath, JSON.stringify(data, null, 2));
      console.log(`[SequenceStore] Saved ${sequences.length} sequences to ${storagePath}`);
      return Ok();
    } catch (err) {
      return Err(err instanceof Error ? err : new Error(String(err)));
    }
  }

  function getStoragePath(): string {
    return storagePath;
  }

  return {
    load,
    save,
    getStoragePath,
  };
}
