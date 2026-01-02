/**
 * TriggerScriptStoreSqlite - SQLite-backed storage for trigger script library
 *
 * Replaces the JSON file-based storage with SQLite for better
 * concurrent access and atomic operations.
 *
 * Data is stored as JSON blobs with an embedded version for JIT migration.
 */

import type { TriggerScript, Result } from '../../shared/types.js';
import { Ok, Err } from '../../shared/types.js';
import type { Database } from './database.js';

export interface TriggerScriptStore {
  /** Load all trigger scripts from storage */
  load(): Promise<Result<TriggerScript[], Error>>;

  /** Save all trigger scripts to storage (full replace) */
  save(scripts: TriggerScript[]): Promise<Result<void, Error>>;

  /** Get the storage file path (for debugging) */
  getStoragePath(): string;
}

/** Data format version for JIT migration */
const DATA_VERSION = 1;

/** Maximum number of scripts in the library */
const MAX_LIBRARY_SIZE = 100;

interface StoredData {
  dataVersion: number;
  script: TriggerScript;
}

/**
 * Migrate data from older versions to current format
 */
function migrateData(stored: StoredData): TriggerScript {
  // Currently only version 1 exists - add migrations here as needed
  // if (stored.dataVersion < 2) {
  //   // Migrate v1 -> v2
  // }
  return stored.script;
}

/**
 * Create a SQLite-backed trigger script store
 *
 * @param db - Database instance (must be initialized with schema)
 * @returns TriggerScriptStore interface
 */
export function createTriggerScriptStoreSqlite(db: Database): TriggerScriptStore {
  const sqlite = db.sqlite;

  // Prepared statements for efficient operations
  const selectAll = sqlite.prepare('SELECT id, name, data, created_at, updated_at FROM trigger_scripts');
  const insert = sqlite.prepare(`
    INSERT OR REPLACE INTO trigger_scripts (id, name, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const deleteById = sqlite.prepare('DELETE FROM trigger_scripts WHERE id = ?');
  const selectIds = sqlite.prepare('SELECT id FROM trigger_scripts');

  async function load(): Promise<Result<TriggerScript[], Error>> {
    try {
      const rows = selectAll.all() as Array<{
        id: string;
        name: string;
        data: string;
        created_at: number;
        updated_at: number;
      }>;

      const scripts: TriggerScript[] = [];

      for (const row of rows) {
        try {
          const stored: StoredData = JSON.parse(row.data);

          // Apply JIT migration if needed
          const script = migrateData(stored);

          scripts.push(script);
        } catch (parseErr) {
          console.error(`[TriggerScriptStoreSqlite] Failed to parse script ${row.id}:`, parseErr);
          // Skip invalid entries rather than failing entirely
        }
      }

      console.log(`[TriggerScriptStoreSqlite] Loaded ${scripts.length} trigger scripts`);
      return Ok(scripts);
    } catch (err) {
      return Err(err instanceof Error ? err : new Error(String(err)));
    }
  }

  async function save(scripts: TriggerScript[]): Promise<Result<void, Error>> {
    try {
      // Enforce library size limit
      if (scripts.length > MAX_LIBRARY_SIZE) {
        return Err(new Error(`Library size exceeds maximum of ${MAX_LIBRARY_SIZE}`));
      }

      // Use a transaction for atomicity
      const transaction = sqlite.transaction(() => {
        // Get existing IDs
        const existingRows = selectIds.all() as Array<{ id: string }>;
        const existingIds = new Set(existingRows.map(r => r.id));

        // Track IDs we're saving
        const savingIds = new Set(scripts.map(s => s.id));

        // Delete scripts that are no longer in the list
        for (const existingId of existingIds) {
          if (!savingIds.has(existingId)) {
            deleteById.run(existingId);
          }
        }

        // Insert or update all scripts
        for (const script of scripts) {
          const stored: StoredData = {
            dataVersion: DATA_VERSION,
            script,
          };

          insert.run(
            script.id,
            script.name,
            JSON.stringify(stored),
            script.createdAt,
            script.updatedAt
          );
        }
      });

      transaction();

      console.log(`[TriggerScriptStoreSqlite] Saved ${scripts.length} trigger scripts`);
      return Ok();
    } catch (err) {
      return Err(err instanceof Error ? err : new Error(String(err)));
    }
  }

  function getStoragePath(): string {
    return sqlite.name;
  }

  return {
    load,
    save,
    getStoragePath,
  };
}
