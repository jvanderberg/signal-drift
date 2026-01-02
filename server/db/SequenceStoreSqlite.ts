/**
 * SequenceStoreSqlite - SQLite-backed storage for sequence library
 *
 * Replaces the JSON file-based storage with SQLite for better
 * concurrent access and atomic operations.
 *
 * Data is stored as JSON blobs with an embedded version for JIT migration.
 */

import type { SequenceDefinition, Result } from '../../shared/types.js';
import { Ok, Err } from '../../shared/types.js';
import { WAVEFORM_LIMITS } from '../../shared/waveform.js';
import type { Database } from './database.js';

export interface SequenceStore {
  /** Load all sequences from storage */
  load(): Promise<Result<SequenceDefinition[], Error>>;

  /** Save all sequences to storage (full replace) */
  save(sequences: SequenceDefinition[]): Promise<Result<void, Error>>;

  /** Get the storage file path (for debugging) */
  getStoragePath(): string;
}

/** Data format version for JIT migration */
const DATA_VERSION = 1;

interface StoredData {
  dataVersion: number;
  sequence: SequenceDefinition;
}

/**
 * Migrate data from older versions to current format
 */
function migrateData(stored: StoredData): SequenceDefinition {
  // Currently only version 1 exists - add migrations here as needed
  // if (stored.dataVersion < 2) {
  //   // Migrate v1 -> v2
  // }
  return stored.sequence;
}

/**
 * Create a SQLite-backed sequence store
 *
 * @param db - Database instance (must be initialized with schema)
 * @returns SequenceStore interface
 */
export function createSequenceStoreSqlite(db: Database): SequenceStore {
  const sqlite = db.sqlite;

  // Prepared statements for efficient operations
  const selectAll = sqlite.prepare('SELECT id, name, data, created_at, updated_at FROM sequences');
  const insert = sqlite.prepare(`
    INSERT OR REPLACE INTO sequences (id, name, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const deleteById = sqlite.prepare('DELETE FROM sequences WHERE id = ?');
  const deleteAll = sqlite.prepare('DELETE FROM sequences');
  const selectIds = sqlite.prepare('SELECT id FROM sequences');

  async function load(): Promise<Result<SequenceDefinition[], Error>> {
    try {
      const rows = selectAll.all() as Array<{
        id: string;
        name: string;
        data: string;
        created_at: number;
        updated_at: number;
      }>;

      const sequences: SequenceDefinition[] = [];

      for (const row of rows) {
        try {
          const stored: StoredData = JSON.parse(row.data);

          // Apply JIT migration if needed
          const sequence = migrateData(stored);

          sequences.push(sequence);
        } catch (parseErr) {
          console.error(`[SequenceStoreSqlite] Failed to parse sequence ${row.id}:`, parseErr);
          // Skip invalid entries rather than failing entirely
        }
      }

      console.log(`[SequenceStoreSqlite] Loaded ${sequences.length} sequences`);
      return Ok(sequences);
    } catch (err) {
      return Err(err instanceof Error ? err : new Error(String(err)));
    }
  }

  async function save(sequences: SequenceDefinition[]): Promise<Result<void, Error>> {
    try {
      // Enforce library size limit
      if (sequences.length > WAVEFORM_LIMITS.MAX_LIBRARY_SIZE) {
        return Err(new Error(`Library size exceeds maximum of ${WAVEFORM_LIMITS.MAX_LIBRARY_SIZE}`));
      }

      // Use a transaction for atomicity
      const transaction = sqlite.transaction(() => {
        // Get existing IDs
        const existingRows = selectIds.all() as Array<{ id: string }>;
        const existingIds = new Set(existingRows.map(r => r.id));

        // Track IDs we're saving
        const savingIds = new Set(sequences.map(s => s.id));

        // Delete sequences that are no longer in the list
        for (const existingId of existingIds) {
          if (!savingIds.has(existingId)) {
            deleteById.run(existingId);
          }
        }

        // Insert or update all sequences
        for (const sequence of sequences) {
          const stored: StoredData = {
            dataVersion: DATA_VERSION,
            sequence,
          };

          insert.run(
            sequence.id,
            sequence.name,
            JSON.stringify(stored),
            sequence.createdAt,
            sequence.updatedAt
          );
        }
      });

      transaction();

      console.log(`[SequenceStoreSqlite] Saved ${sequences.length} sequences`);
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
