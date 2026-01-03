/**
 * DeviceAliasStore tests
 *
 * Tests for the SQLite-backed device alias storage implementation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { createDatabase, type Database } from '../database.js';
import { createDeviceAliasStore, type DeviceAliasStore, type DeviceAlias } from '../DeviceAliasStore.js';

describe('DeviceAliasStore', () => {
  let testDir: string;
  let db: Database;
  let store: DeviceAliasStore;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testDir = path.join(os.tmpdir(), `lab-controller-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(testDir, { recursive: true });
    db = createDatabase(testDir);
    store = createDeviceAliasStore(db);
  });

  afterEach(async () => {
    if (db) {
      db.close();
    }
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('list', () => {
    it('should return empty array for fresh database', () => {
      const result = store.list();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it('should return all saved aliases', () => {
      store.set('Rigol,DL3021,DL3A123456,1.0', 'Bench Load');
      store.set('Matrix,WPS300S,ABC123,1.0', 'Main PSU');

      const result = store.list();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value.find(a => a.idn.includes('DL3021'))?.alias).toBe('Bench Load');
        expect(result.value.find(a => a.idn.includes('WPS300S'))?.alias).toBe('Main PSU');
      }
    });
  });

  describe('get', () => {
    it('should return undefined for non-existent alias', () => {
      const result = store.get('nonexistent-idn');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeUndefined();
      }
    });

    it('should return saved alias for IDN', () => {
      const idn = 'Rigol,DL3021,DL3A123456,1.0';
      store.set(idn, 'Bench Load');

      const result = store.get(idn);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('Bench Load');
      }
    });
  });

  describe('set', () => {
    it('should create new alias', () => {
      const idn = 'Rigol,DL3021,DL3A123456,1.0';
      const result = store.set(idn, 'Bench Load');

      expect(result.ok).toBe(true);

      const getResult = store.get(idn);
      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.value).toBe('Bench Load');
      }
    });

    it('should update existing alias', () => {
      const idn = 'Rigol,DL3021,DL3A123456,1.0';
      store.set(idn, 'Old Name');
      store.set(idn, 'New Name');

      const result = store.get(idn);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('New Name');
      }
    });

    it('should return updated_at timestamp', () => {
      const idn = 'Rigol,DL3021,DL3A123456,1.0';
      const before = Date.now();
      store.set(idn, 'Test');
      const after = Date.now();

      const result = store.list();
      expect(result.ok).toBe(true);
      if (result.ok) {
        const alias = result.value[0];
        expect(alias.updatedAt).toBeGreaterThanOrEqual(before);
        expect(alias.updatedAt).toBeLessThanOrEqual(after);
      }
    });
  });

  describe('clear', () => {
    it('should remove alias', () => {
      const idn = 'Rigol,DL3021,DL3A123456,1.0';
      store.set(idn, 'Bench Load');
      store.clear(idn);

      const result = store.get(idn);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeUndefined();
      }
    });

    it('should not fail for non-existent alias', () => {
      const result = store.clear('nonexistent-idn');
      expect(result.ok).toBe(true);
    });
  });

  describe('getAll', () => {
    it('should return all aliases as a map', () => {
      store.set('idn-1', 'Alias 1');
      store.set('idn-2', 'Alias 2');

      const result = store.getAll();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.get('idn-1')).toBe('Alias 1');
        expect(result.value.get('idn-2')).toBe('Alias 2');
        expect(result.value.size).toBe(2);
      }
    });
  });

  describe('replaceAll', () => {
    it('should replace all aliases with new data', () => {
      // Set up initial data
      store.set('idn-1', 'Alias 1');
      store.set('idn-2', 'Alias 2');

      // Replace with new data
      const newAliases: DeviceAlias[] = [
        { idn: 'idn-3', alias: 'Alias 3', createdAt: Date.now(), updatedAt: Date.now() },
        { idn: 'idn-4', alias: 'Alias 4', createdAt: Date.now(), updatedAt: Date.now() },
      ];

      const result = store.replaceAll(newAliases);
      expect(result.ok).toBe(true);

      // Verify old aliases are gone
      const oldResult = store.get('idn-1');
      expect(oldResult.ok).toBe(true);
      if (oldResult.ok) {
        expect(oldResult.value).toBeUndefined();
      }

      // Verify new aliases exist
      const listResult = store.list();
      expect(listResult.ok).toBe(true);
      if (listResult.ok) {
        expect(listResult.value).toHaveLength(2);
        expect(listResult.value.find(a => a.idn === 'idn-3')?.alias).toBe('Alias 3');
      }
    });

    it('should clear all when given empty array', () => {
      store.set('idn-1', 'Alias 1');

      const result = store.replaceAll([]);
      expect(result.ok).toBe(true);

      const listResult = store.list();
      expect(listResult.ok).toBe(true);
      if (listResult.ok) {
        expect(listResult.value).toHaveLength(0);
      }
    });
  });

  describe('data integrity', () => {
    it('should persist across database reopens', () => {
      const idn = 'Rigol,DL3021,DL3A123456,1.0';
      store.set(idn, 'Persistent Alias');

      // Close and reopen database
      db.close();
      db = createDatabase(testDir);
      store = createDeviceAliasStore(db);

      const result = store.get(idn);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('Persistent Alias');
      }
    });

    it('should handle special characters in IDN strings', () => {
      const idn = 'Manufacturer,Model-V2.1,SN/123:456,Version "1.0"';
      store.set(idn, 'Special Device');

      const result = store.get(idn);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('Special Device');
      }
    });

    it('should handle unicode in alias', () => {
      const idn = 'Test,Device,123,1.0';
      store.set(idn, 'Bench PSU 🔌');

      const result = store.get(idn);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('Bench PSU 🔌');
      }
    });
  });
});
