/**
 * Database - SQLite database initialization and schema management
 *
 * Provides a wrapper around better-sqlite3 with:
 * - Automatic schema creation
 * - Version-tracked migrations
 * - Cross-platform data directory resolution
 *
 * Storage location (in order of precedence):
 * 1. Provided directory parameter
 * 2. LAB_CONTROLLER_DATA_DIR environment variable
 * 3. XDG_DATA_HOME/lab-controller (Linux/Pi)
 * 4. APPDATA/lab-controller (Windows)
 * 5. ~/Library/Application Support/lab-controller (macOS)
 * 6. ./data (fallback)
 */

import BetterSqlite3 from 'better-sqlite3';
import { mkdirSync } from 'fs';
import path from 'path';
import os from 'os';

const CURRENT_SCHEMA_VERSION = 1;
const DATABASE_FILENAME = 'data.db';

export interface Database {
  /** Get the underlying better-sqlite3 instance (for advanced operations) */
  readonly sqlite: BetterSqlite3.Database;

  /** List all table names in the database */
  listTables(): string[];

  /** Get column names for a table */
  getTableColumns(tableName: string): string[];

  /** Get the current schema version */
  getSchemaVersion(): number;

  /** Get a value from the meta table */
  getMeta(key: string): string | undefined;

  /** Set a value in the meta table */
  setMeta(key: string, value: string): void;

  /** Delete a value from the meta table */
  deleteMeta(key: string): void;

  /** Close the database connection */
  close(): void;
}

/**
 * Determine the default data directory based on platform and environment
 */
function getDefaultDataDirectory(): string {
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
 * Create the database schema (version 1)
 */
function createSchemaV1(db: BetterSqlite3.Database): void {
  // Meta table for storing key-value pairs (including schema version)
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Sequences table - stores AWG waveform definitions
  db.exec(`
    CREATE TABLE IF NOT EXISTS sequences (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Trigger scripts table - stores reactive automation scripts
  db.exec(`
    CREATE TABLE IF NOT EXISTS trigger_scripts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Device aliases table - stores custom names for devices by IDN
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_aliases (
      idn TEXT PRIMARY KEY,
      alias TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Create indexes for common queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sequences_name ON sequences(name);
    CREATE INDEX IF NOT EXISTS idx_trigger_scripts_name ON trigger_scripts(name);
  `);
}

/**
 * Run migrations to bring database to current schema version
 */
function runMigrations(db: BetterSqlite3.Database, currentVersion: number): void {
  // Currently only version 1 exists - migrations will be added here
  // as new versions are introduced

  if (currentVersion < 1) {
    createSchemaV1(db);
  }

  // Future migrations would be added here:
  // if (currentVersion < 2) {
  //   migrateToV2(db);
  // }
}

/**
 * Create a database connection and ensure schema is up to date
 *
 * @param dataDir - Optional directory for the database file. If not provided,
 *                  uses the default location based on platform.
 * @returns Database interface
 */
export function createDatabase(dataDir?: string): Database {
  const directory = dataDir || getDefaultDataDirectory();
  const dbPath = path.join(directory, DATABASE_FILENAME);

  // Ensure directory exists
  mkdirSync(directory, { recursive: true });

  // Open database with WAL mode for better concurrent access
  const sqlite = new BetterSqlite3(dbPath);
  sqlite.pragma('journal_mode = WAL');

  // Check current schema version
  let currentVersion = 0;
  try {
    // First check if meta table exists
    const tableCheck = sqlite.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='meta'
    `).get();

    if (tableCheck) {
      const row = sqlite.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version') as { value: string } | undefined;
      if (row) {
        currentVersion = parseInt(row.value, 10);
      }
    }
  } catch {
    // Table doesn't exist yet, version is 0
  }

  // Run migrations if needed
  if (currentVersion < CURRENT_SCHEMA_VERSION) {
    runMigrations(sqlite, currentVersion);

    // Update schema version
    sqlite.prepare(`
      INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)
    `).run(String(CURRENT_SCHEMA_VERSION));

    console.log(`[Database] Migrated from version ${currentVersion} to ${CURRENT_SCHEMA_VERSION}`);
  }

  // Prepared statements for meta operations
  const getMeta = sqlite.prepare('SELECT value FROM meta WHERE key = ?');
  const setMeta = sqlite.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  const deleteMeta = sqlite.prepare('DELETE FROM meta WHERE key = ?');

  return {
    sqlite,

    listTables(): string[] {
      const rows = sqlite.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all() as { name: string }[];
      return rows.map(r => r.name);
    },

    getTableColumns(tableName: string): string[] {
      const rows = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[];
      return rows.map(r => r.name);
    },

    getSchemaVersion(): number {
      const row = getMeta.get('schema_version') as { value: string } | undefined;
      return row ? parseInt(row.value, 10) : 0;
    },

    getMeta(key: string): string | undefined {
      const row = getMeta.get(key) as { value: string } | undefined;
      return row?.value;
    },

    setMeta(key: string, value: string): void {
      setMeta.run(key, value);
    },

    deleteMeta(key: string): void {
      deleteMeta.run(key);
    },

    close(): void {
      sqlite.close();
    },
  };
}

export { getDefaultDataDirectory };
