/**
 * Database module tests
 *
 * Tests for SQLite database initialization, schema creation, and migrations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { createDatabase, type Database } from '../database.js';

describe('Database', () => {
  let testDir: string;
  let db: Database;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testDir = path.join(os.tmpdir(), `lab-controller-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Close database and clean up
    if (db) {
      db.close();
    }
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('createDatabase', () => {
    it('should create database file in specified directory', async () => {
      db = createDatabase(testDir);

      const dbPath = path.join(testDir, 'data.db');
      const stat = await fs.stat(dbPath);
      expect(stat.isFile()).toBe(true);
    });

    it('should create all required tables', () => {
      db = createDatabase(testDir);

      // Query sqlite_master to check tables exist
      const tables = db.listTables();
      expect(tables).toContain('sequences');
      expect(tables).toContain('trigger_scripts');
      expect(tables).toContain('device_aliases');
      expect(tables).toContain('meta');
    });

    it('should set schema version in meta table', () => {
      db = createDatabase(testDir);

      const version = db.getSchemaVersion();
      expect(version).toBe(1);
    });

    it('should be idempotent - opening existing database does not recreate tables', () => {
      // Create database and insert test data
      db = createDatabase(testDir);
      db.setMeta('test_key', 'test_value');
      db.close();

      // Reopen database
      db = createDatabase(testDir);
      const value = db.getMeta('test_key');
      expect(value).toBe('test_value');
    });

    it('should create directory if it does not exist', () => {
      const nestedDir = path.join(testDir, 'nested', 'path');
      db = createDatabase(nestedDir);

      expect(db.listTables()).toContain('meta');
    });
  });

  describe('meta table operations', () => {
    beforeEach(() => {
      db = createDatabase(testDir);
    });

    it('should set and get meta values', () => {
      db.setMeta('key1', 'value1');
      db.setMeta('key2', 'value2');

      expect(db.getMeta('key1')).toBe('value1');
      expect(db.getMeta('key2')).toBe('value2');
    });

    it('should return undefined for non-existent keys', () => {
      expect(db.getMeta('nonexistent')).toBeUndefined();
    });

    it('should overwrite existing values', () => {
      db.setMeta('key', 'original');
      db.setMeta('key', 'updated');

      expect(db.getMeta('key')).toBe('updated');
    });

    it('should delete meta values', () => {
      db.setMeta('key', 'value');
      db.deleteMeta('key');

      expect(db.getMeta('key')).toBeUndefined();
    });
  });

  describe('sequences table', () => {
    beforeEach(() => {
      db = createDatabase(testDir);
    });

    it('should have correct schema', () => {
      const columns = db.getTableColumns('sequences');
      expect(columns).toContain('id');
      expect(columns).toContain('name');
      expect(columns).toContain('data');
      expect(columns).toContain('created_at');
      expect(columns).toContain('updated_at');
    });
  });

  describe('trigger_scripts table', () => {
    beforeEach(() => {
      db = createDatabase(testDir);
    });

    it('should have correct schema', () => {
      const columns = db.getTableColumns('trigger_scripts');
      expect(columns).toContain('id');
      expect(columns).toContain('name');
      expect(columns).toContain('data');
      expect(columns).toContain('created_at');
      expect(columns).toContain('updated_at');
    });
  });

  describe('device_aliases table', () => {
    beforeEach(() => {
      db = createDatabase(testDir);
    });

    it('should have correct schema', () => {
      const columns = db.getTableColumns('device_aliases');
      expect(columns).toContain('idn');
      expect(columns).toContain('alias');
      expect(columns).toContain('created_at');
      expect(columns).toContain('updated_at');
    });
  });

  describe('migrations', () => {
    it('should handle upgrade from version 0 (fresh database)', () => {
      db = createDatabase(testDir);
      expect(db.getSchemaVersion()).toBe(1);
    });

    it('should not downgrade schema version', () => {
      // Create database at version 1
      db = createDatabase(testDir);
      expect(db.getSchemaVersion()).toBe(1);
      db.close();

      // Simulate future version by manually setting higher version
      db = createDatabase(testDir);
      db.setMeta('schema_version', '999');
      db.close();

      // Reopen - should keep the higher version (no downgrade)
      db = createDatabase(testDir);
      expect(db.getSchemaVersion()).toBe(999);
    });
  });

  describe('close', () => {
    it('should close database connection', () => {
      db = createDatabase(testDir);
      db.close();

      // Attempting to run a query after close should throw
      expect(() => {
        db.sqlite.prepare('SELECT 1').get();
      }).toThrow();
    });

    it('should be safe to call close multiple times', () => {
      db = createDatabase(testDir);
      db.close();
      // Second close should not throw (idempotent)
      expect(() => db.close()).not.toThrow();
    });
  });

  describe('sequences table CRUD operations', () => {
    beforeEach(() => {
      db = createDatabase(testDir);
    });

    it('should insert a sequence', () => {
      const id = 'seq-1';
      const name = 'Test Sequence';
      const data = JSON.stringify({ steps: [1, 2, 3] });
      const now = Date.now();

      db.sqlite.prepare(`
        INSERT INTO sequences (id, name, data, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, name, data, now, now);

      const row = db.sqlite.prepare('SELECT * FROM sequences WHERE id = ?').get(id) as {
        id: string;
        name: string;
        data: string;
        created_at: number;
        updated_at: number;
      };

      expect(row).toBeDefined();
      expect(row.id).toBe(id);
      expect(row.name).toBe(name);
      expect(row.data).toBe(data);
      expect(row.created_at).toBe(now);
    });

    it('should update a sequence', () => {
      const id = 'seq-1';
      const now = Date.now();

      db.sqlite.prepare(`
        INSERT INTO sequences (id, name, data, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, 'Original Name', '{}', now, now);

      const later = now + 1000;
      db.sqlite.prepare(`
        UPDATE sequences SET name = ?, updated_at = ? WHERE id = ?
      `).run('Updated Name', later, id);

      const row = db.sqlite.prepare('SELECT name, updated_at FROM sequences WHERE id = ?').get(id) as {
        name: string;
        updated_at: number;
      };

      expect(row.name).toBe('Updated Name');
      expect(row.updated_at).toBe(later);
    });

    it('should delete a sequence', () => {
      const id = 'seq-1';
      const now = Date.now();

      db.sqlite.prepare(`
        INSERT INTO sequences (id, name, data, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, 'Test', '{}', now, now);

      const deleteResult = db.sqlite.prepare('DELETE FROM sequences WHERE id = ?').run(id);
      expect(deleteResult.changes).toBe(1);

      const row = db.sqlite.prepare('SELECT * FROM sequences WHERE id = ?').get(id);
      expect(row).toBeUndefined();
    });

    it('should list all sequences', () => {
      const now = Date.now();

      db.sqlite.prepare(`
        INSERT INTO sequences (id, name, data, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('seq-1', 'First', '{}', now, now);

      db.sqlite.prepare(`
        INSERT INTO sequences (id, name, data, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('seq-2', 'Second', '{}', now, now);

      const rows = db.sqlite.prepare('SELECT * FROM sequences ORDER BY name').all() as { id: string }[];
      expect(rows).toHaveLength(2);
      expect(rows[0].id).toBe('seq-1');
      expect(rows[1].id).toBe('seq-2');
    });

    it('should enforce primary key uniqueness', () => {
      const now = Date.now();

      db.sqlite.prepare(`
        INSERT INTO sequences (id, name, data, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('seq-1', 'First', '{}', now, now);

      expect(() => {
        db.sqlite.prepare(`
          INSERT INTO sequences (id, name, data, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run('seq-1', 'Duplicate', '{}', now, now);
      }).toThrow();
    });
  });

  describe('trigger_scripts table CRUD operations', () => {
    beforeEach(() => {
      db = createDatabase(testDir);
    });

    it('should insert a trigger script', () => {
      const id = 'script-1';
      const name = 'Test Script';
      const data = JSON.stringify({ triggers: [] });
      const now = Date.now();

      db.sqlite.prepare(`
        INSERT INTO trigger_scripts (id, name, data, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, name, data, now, now);

      const row = db.sqlite.prepare('SELECT * FROM trigger_scripts WHERE id = ?').get(id) as {
        id: string;
        name: string;
        data: string;
      };

      expect(row).toBeDefined();
      expect(row.id).toBe(id);
      expect(row.name).toBe(name);
      expect(JSON.parse(row.data)).toEqual({ triggers: [] });
    });

    it('should update a trigger script', () => {
      const id = 'script-1';
      const now = Date.now();

      db.sqlite.prepare(`
        INSERT INTO trigger_scripts (id, name, data, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, 'Original', '{}', now, now);

      db.sqlite.prepare(`
        UPDATE trigger_scripts SET data = ? WHERE id = ?
      `).run('{"triggers": [1]}', id);

      const row = db.sqlite.prepare('SELECT data FROM trigger_scripts WHERE id = ?').get(id) as { data: string };
      expect(JSON.parse(row.data)).toEqual({ triggers: [1] });
    });

    it('should delete a trigger script', () => {
      const now = Date.now();
      db.sqlite.prepare(`
        INSERT INTO trigger_scripts (id, name, data, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('script-1', 'Test', '{}', now, now);

      db.sqlite.prepare('DELETE FROM trigger_scripts WHERE id = ?').run('script-1');

      const row = db.sqlite.prepare('SELECT * FROM trigger_scripts WHERE id = ?').get('script-1');
      expect(row).toBeUndefined();
    });
  });

  describe('device_aliases table CRUD operations', () => {
    beforeEach(() => {
      db = createDatabase(testDir);
    });

    it('should insert a device alias', () => {
      const idn = 'RIGOL TECHNOLOGIES,DL3021,DL3A123456789,00.01.03';
      const alias = 'Main Load';
      const now = Date.now();

      db.sqlite.prepare(`
        INSERT INTO device_aliases (idn, alias, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(idn, alias, now, now);

      const row = db.sqlite.prepare('SELECT * FROM device_aliases WHERE idn = ?').get(idn) as {
        idn: string;
        alias: string;
      };

      expect(row).toBeDefined();
      expect(row.alias).toBe(alias);
    });

    it('should update a device alias', () => {
      const idn = 'RIGOL,DL3021,12345,1.0';
      const now = Date.now();

      db.sqlite.prepare(`
        INSERT INTO device_aliases (idn, alias, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(idn, 'Old Name', now, now);

      db.sqlite.prepare(`
        UPDATE device_aliases SET alias = ?, updated_at = ? WHERE idn = ?
      `).run('New Name', now + 1000, idn);

      const row = db.sqlite.prepare('SELECT alias FROM device_aliases WHERE idn = ?').get(idn) as { alias: string };
      expect(row.alias).toBe('New Name');
    });

    it('should delete a device alias', () => {
      const idn = 'TEST,DEVICE,123,1.0';
      const now = Date.now();

      db.sqlite.prepare(`
        INSERT INTO device_aliases (idn, alias, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(idn, 'Test', now, now);

      db.sqlite.prepare('DELETE FROM device_aliases WHERE idn = ?').run(idn);

      const row = db.sqlite.prepare('SELECT * FROM device_aliases WHERE idn = ?').get(idn);
      expect(row).toBeUndefined();
    });

    it('should use idn as primary key (upsert pattern)', () => {
      const idn = 'DEVICE,MODEL,SERIAL,VERSION';
      const now = Date.now();

      // Insert
      db.sqlite.prepare(`
        INSERT OR REPLACE INTO device_aliases (idn, alias, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(idn, 'First', now, now);

      // Upsert with same IDN
      db.sqlite.prepare(`
        INSERT OR REPLACE INTO device_aliases (idn, alias, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(idn, 'Second', now, now + 1000);

      // Should only have one row
      const rows = db.sqlite.prepare('SELECT * FROM device_aliases WHERE idn = ?').all(idn) as { alias: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0].alias).toBe('Second');
    });
  });

  describe('concurrent operations', () => {
    it('should handle multiple sequential writes', () => {
      db = createDatabase(testDir);
      const now = Date.now();

      // Insert multiple sequences in sequence
      for (let i = 0; i < 10; i++) {
        db.sqlite.prepare(`
          INSERT INTO sequences (id, name, data, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(`seq-${i}`, `Sequence ${i}`, '{}', now, now);
      }

      const count = db.sqlite.prepare('SELECT COUNT(*) as count FROM sequences').get() as { count: number };
      expect(count.count).toBe(10);
    });

    it('should support transaction rollback', () => {
      db = createDatabase(testDir);
      const now = Date.now();

      // Start a transaction and rollback
      db.sqlite.exec('BEGIN');
      db.sqlite.prepare(`
        INSERT INTO sequences (id, name, data, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('seq-rollback', 'Will Rollback', '{}', now, now);
      db.sqlite.exec('ROLLBACK');

      const row = db.sqlite.prepare('SELECT * FROM sequences WHERE id = ?').get('seq-rollback');
      expect(row).toBeUndefined();
    });

    it('should support transaction commit', () => {
      db = createDatabase(testDir);
      const now = Date.now();

      db.sqlite.exec('BEGIN');
      db.sqlite.prepare(`
        INSERT INTO sequences (id, name, data, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('seq-commit', 'Will Commit', '{}', now, now);
      db.sqlite.exec('COMMIT');

      const row = db.sqlite.prepare('SELECT * FROM sequences WHERE id = ?').get('seq-commit') as { id: string };
      expect(row).toBeDefined();
      expect(row.id).toBe('seq-commit');
    });
  });

  describe('index usage', () => {
    beforeEach(() => {
      db = createDatabase(testDir);
    });

    it('should have index on sequences.name', () => {
      const indexes = db.sqlite.prepare(`
        SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='sequences'
      `).all() as { name: string }[];

      const indexNames = indexes.map(i => i.name);
      expect(indexNames).toContain('idx_sequences_name');
    });

    it('should have index on trigger_scripts.name', () => {
      const indexes = db.sqlite.prepare(`
        SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='trigger_scripts'
      `).all() as { name: string }[];

      const indexNames = indexes.map(i => i.name);
      expect(indexNames).toContain('idx_trigger_scripts_name');
    });
  });
});
