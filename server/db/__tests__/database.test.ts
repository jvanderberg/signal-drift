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

      // Attempting operations after close should not throw
      // (we just check close doesn't throw)
      expect(true).toBe(true);
    });
  });
});
