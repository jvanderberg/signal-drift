/**
 * DeviceAliasStore - SQLite-backed storage for device aliases
 *
 * Maps device IDN strings to user-friendly alias names.
 * The IDN (Identification) is the response from *IDN? SCPI command,
 * which uniquely identifies each device.
 */

import type { Result, DeviceAlias } from '../../shared/types.js';
import { Ok, Err } from '../../shared/types.js';
import type { Database } from './database.js';

// Re-export for convenience
export type { DeviceAlias };

export interface DeviceAliasStore {
  /** List all device aliases */
  list(): Result<DeviceAlias[], Error>;

  /** Get alias for a specific device IDN */
  get(idn: string): Result<string | undefined, Error>;

  /** Set alias for a device IDN (creates or updates) */
  set(idn: string, alias: string): Result<void, Error>;

  /** Clear (remove) alias for a device IDN */
  clear(idn: string): Result<void, Error>;

  /** Get all aliases as a map (IDN -> alias) */
  getAll(): Result<Map<string, string>, Error>;

  /** Replace all aliases with new data (used for import) */
  replaceAll(aliases: DeviceAlias[]): Result<void, Error>;
}

/**
 * Create a SQLite-backed device alias store
 *
 * @param db - Database instance (must be initialized with schema)
 * @returns DeviceAliasStore interface
 */
export function createDeviceAliasStore(db: Database): DeviceAliasStore {
  const sqlite = db.sqlite;

  // Prepared statements for efficient operations
  const selectAll = sqlite.prepare('SELECT idn, alias, created_at, updated_at FROM device_aliases');
  const selectOne = sqlite.prepare('SELECT alias FROM device_aliases WHERE idn = ?');
  const upsert = sqlite.prepare(`
    INSERT INTO device_aliases (idn, alias, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(idn) DO UPDATE SET
      alias = excluded.alias,
      updated_at = excluded.updated_at
  `);
  const deleteOne = sqlite.prepare('DELETE FROM device_aliases WHERE idn = ?');
  const deleteAll = sqlite.prepare('DELETE FROM device_aliases');
  const insertBulk = sqlite.prepare(`
    INSERT INTO device_aliases (idn, alias, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `);

  function list(): Result<DeviceAlias[], Error> {
    try {
      const rows = selectAll.all() as Array<{
        idn: string;
        alias: string;
        created_at: number;
        updated_at: number;
      }>;

      const aliases: DeviceAlias[] = rows.map(row => ({
        idn: row.idn,
        alias: row.alias,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));

      return Ok(aliases);
    } catch (err) {
      return Err(err instanceof Error ? err : new Error(String(err)));
    }
  }

  function get(idn: string): Result<string | undefined, Error> {
    try {
      const row = selectOne.get(idn) as { alias: string } | undefined;
      return Ok(row?.alias);
    } catch (err) {
      return Err(err instanceof Error ? err : new Error(String(err)));
    }
  }

  function set(idn: string, alias: string): Result<void, Error> {
    try {
      const now = Date.now();
      upsert.run(idn, alias, now, now);
      return Ok();
    } catch (err) {
      return Err(err instanceof Error ? err : new Error(String(err)));
    }
  }

  function clear(idn: string): Result<void, Error> {
    try {
      deleteOne.run(idn);
      return Ok();
    } catch (err) {
      return Err(err instanceof Error ? err : new Error(String(err)));
    }
  }

  function getAll(): Result<Map<string, string>, Error> {
    try {
      const rows = selectAll.all() as Array<{
        idn: string;
        alias: string;
        created_at: number;
        updated_at: number;
      }>;

      const map = new Map<string, string>();
      for (const row of rows) {
        map.set(row.idn, row.alias);
      }

      return Ok(map);
    } catch (err) {
      return Err(err instanceof Error ? err : new Error(String(err)));
    }
  }

  function replaceAll(aliases: DeviceAlias[]): Result<void, Error> {
    try {
      const transaction = sqlite.transaction(() => {
        // Delete all existing aliases
        deleteAll.run();

        // Insert new aliases
        for (const alias of aliases) {
          insertBulk.run(
            alias.idn,
            alias.alias,
            alias.createdAt,
            alias.updatedAt
          );
        }
      });

      transaction();
      return Ok();
    } catch (err) {
      return Err(err instanceof Error ? err : new Error(String(err)));
    }
  }

  return {
    list,
    get,
    set,
    clear,
    getAll,
    replaceAll,
  };
}
