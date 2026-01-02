/**
 * TriggerScriptStore - Persistent JSON file storage for trigger script library
 *
 * Works on both Raspberry Pi and Electron by using a configurable data directory.
 * Stores trigger scripts in a JSON file with atomic write operations.
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
import type { TriggerScript, Result } from '../../shared/types.js';
import { Ok, Err } from '../../shared/types.js';

export interface TriggerScriptStore {
  /** Load all trigger scripts from storage */
  load(): Promise<Result<TriggerScript[], Error>>;

  /** Save all trigger scripts to storage (atomic write) */
  save(scripts: TriggerScript[]): Promise<Result<void, Error>>;

  /** Get the storage file path (for debugging) */
  getStoragePath(): string;
}

interface StorageData {
  version: number;
  scripts: TriggerScript[];
  lastModified: number;
}

const STORAGE_VERSION = 1;
const STORAGE_FILENAME = 'trigger-scripts.json';
const MAX_LIBRARY_SIZE = 100;

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
 * Validate loaded scripts (basic structure check)
 */
function validateStorageData(data: unknown): data is StorageData {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;

  if (typeof obj.version !== 'number') return false;
  if (!Array.isArray(obj.scripts)) return false;

  // Check each script has required fields
  for (const script of obj.scripts) {
    if (typeof script !== 'object' || script === null) return false;
    const s = script as Record<string, unknown>;
    if (typeof s.id !== 'string') return false;
    if (typeof s.name !== 'string') return false;
    if (!Array.isArray(s.triggers)) return false;
    if (typeof s.createdAt !== 'number') return false;
    if (typeof s.updatedAt !== 'number') return false;
  }

  return true;
}

export function createTriggerScriptStore(): TriggerScriptStore {
  const dataDir = getDataDirectory();
  const storagePath = path.join(dataDir, STORAGE_FILENAME);

  async function load(): Promise<Result<TriggerScript[], Error>> {
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
          console.log(`[TriggerScriptStore] No existing storage at ${storagePath}, starting fresh`);
          return Ok([]);
        }
        throw err;
      }

      // Parse JSON
      let data: unknown;
      try {
        data = JSON.parse(content);
      } catch {
        return Err(new Error('Invalid JSON in trigger script storage file'));
      }

      // Validate structure
      if (!validateStorageData(data)) {
        return Err(new Error('Invalid trigger script storage format'));
      }

      // Check version and migrate if needed (for future compatibility)
      if (data.version > STORAGE_VERSION) {
        return Err(new Error(`Unsupported storage version: ${data.version}`));
      }

      // Enforce library size limit
      if (data.scripts.length > MAX_LIBRARY_SIZE) {
        console.warn(`[TriggerScriptStore] Library exceeds max size, truncating to ${MAX_LIBRARY_SIZE}`);
        data.scripts = data.scripts.slice(0, MAX_LIBRARY_SIZE);
      }

      console.log(`[TriggerScriptStore] Loaded ${data.scripts.length} trigger scripts from ${storagePath}`);
      return Ok(data.scripts);
    } catch (err) {
      return Err(err instanceof Error ? err : new Error(String(err)));
    }
  }

  async function save(scripts: TriggerScript[]): Promise<Result<void, Error>> {
    try {
      // Ensure directory exists
      await ensureDir(dataDir);

      // Enforce library size limit
      if (scripts.length > MAX_LIBRARY_SIZE) {
        return Err(new Error(`Library size exceeds maximum of ${MAX_LIBRARY_SIZE}`));
      }

      const data: StorageData = {
        version: STORAGE_VERSION,
        scripts,
        lastModified: Date.now(),
      };

      // Atomic write
      await atomicWrite(storagePath, JSON.stringify(data, null, 2));
      console.log(`[TriggerScriptStore] Saved ${scripts.length} trigger scripts to ${storagePath}`);
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
