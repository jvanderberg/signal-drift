/**
 * SQLite TriggerScriptStore tests
 *
 * Tests for the SQLite-backed trigger script storage implementation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { TriggerScript, Trigger } from '../../../shared/types.js';
import { createDatabase, type Database } from '../database.js';
import { createTriggerScriptStoreSqlite, type TriggerScriptStore } from '../TriggerScriptStoreSqlite.js';

// Test fixture: minimal valid trigger
function createTestTrigger(overrides: Partial<Trigger> = {}): Trigger {
  return {
    id: `trigger-${Math.random().toString(36).slice(2)}`,
    condition: {
      type: 'time',
      seconds: 10,
    },
    action: {
      type: 'setOutput',
      deviceId: 'test-device',
      enabled: true,
    },
    repeatMode: 'once',
    debounceMs: 0,
    ...overrides,
  };
}

// Test fixture: minimal valid trigger script
function createTestScript(overrides: Partial<TriggerScript> = {}): TriggerScript {
  const now = Date.now();
  return {
    id: `script-${Math.random().toString(36).slice(2)}`,
    name: 'Test Script',
    triggers: [createTestTrigger()],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('TriggerScriptStoreSqlite', () => {
  let testDir: string;
  let db: Database;
  let store: TriggerScriptStore;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testDir = path.join(os.tmpdir(), `lab-controller-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(testDir, { recursive: true });
    db = createDatabase(testDir);
    store = createTriggerScriptStoreSqlite(db);
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

  describe('load', () => {
    it('should return empty array for fresh database', async () => {
      const result = await store.load();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it('should return saved scripts', async () => {
      const script1 = createTestScript({ id: 'script-1', name: 'Script 1' });
      const script2 = createTestScript({ id: 'script-2', name: 'Script 2' });

      await store.save([script1, script2]);
      const result = await store.load();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value.find(s => s.id === 'script-1')?.name).toBe('Script 1');
        expect(result.value.find(s => s.id === 'script-2')?.name).toBe('Script 2');
      }
    });

    it('should preserve all script fields', async () => {
      const trigger1: Trigger = {
        id: 'trigger-1',
        condition: {
          type: 'value',
          deviceId: 'psu-1',
          parameter: 'voltage',
          operator: '>',
          value: 10,
        },
        action: {
          type: 'setValue',
          deviceId: 'load-1',
          parameter: 'current',
          value: 2.0,
        },
        repeatMode: 'repeat',
        debounceMs: 500,
      };

      const trigger2: Trigger = {
        id: 'trigger-2',
        condition: {
          type: 'time',
          seconds: 30,
        },
        action: {
          type: 'startSequence',
          sequenceId: 'seq-1',
          deviceId: 'psu-1',
          parameter: 'voltage',
          repeatMode: 'once',
        },
        repeatMode: 'once',
        debounceMs: 0,
      };

      const script = createTestScript({
        id: 'script-full',
        name: 'Full Script',
        triggers: [trigger1, trigger2],
      });

      await store.save([script]);
      const result = await store.load();

      expect(result.ok).toBe(true);
      if (result.ok) {
        const loaded = result.value[0];
        expect(loaded.id).toBe('script-full');
        expect(loaded.name).toBe('Full Script');
        expect(loaded.triggers).toHaveLength(2);

        // Check first trigger
        const t1 = loaded.triggers.find(t => t.id === 'trigger-1');
        expect(t1).toBeDefined();
        expect(t1?.condition.type).toBe('value');
        if (t1?.condition.type === 'value') {
          expect(t1.condition.operator).toBe('>');
          expect(t1.condition.value).toBe(10);
        }
        expect(t1?.repeatMode).toBe('repeat');
        expect(t1?.debounceMs).toBe(500);

        // Check second trigger
        const t2 = loaded.triggers.find(t => t.id === 'trigger-2');
        expect(t2).toBeDefined();
        expect(t2?.condition.type).toBe('time');
        expect(t2?.action.type).toBe('startSequence');
      }
    });
  });

  describe('save', () => {
    it('should save scripts to database', async () => {
      const script = createTestScript();
      const result = await store.save([script]);

      expect(result.ok).toBe(true);
    });

    it('should overwrite existing scripts with same id', async () => {
      const script = createTestScript({ id: 'script-1', name: 'Original' });
      await store.save([script]);

      const updated = { ...script, name: 'Updated', updatedAt: Date.now() };
      await store.save([updated]);

      const result = await store.load();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].name).toBe('Updated');
      }
    });

    it('should remove scripts not in save array', async () => {
      const script1 = createTestScript({ id: 'script-1' });
      const script2 = createTestScript({ id: 'script-2' });
      await store.save([script1, script2]);

      // Save only script1
      await store.save([script1]);

      const result = await store.load();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].id).toBe('script-1');
      }
    });

    it('should enforce library size limit', async () => {
      const scripts: TriggerScript[] = [];
      for (let i = 0; i < 101; i++) {
        scripts.push(createTestScript({ id: `script-${i}` }));
      }

      const result = await store.save(scripts);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('exceeds maximum');
      }
    });
  });

  describe('getStoragePath', () => {
    it('should return the database file path', () => {
      const storagePath = store.getStoragePath();
      expect(storagePath).toContain('data.db');
    });
  });

  describe('trigger condition types', () => {
    it('should handle value conditions with all operators', async () => {
      const operators = ['>', '<', '>=', '<=', '==', '!='] as const;

      for (const op of operators) {
        const trigger: Trigger = {
          id: `trigger-${op}`,
          condition: {
            type: 'value',
            deviceId: 'device-1',
            parameter: 'voltage',
            operator: op,
            value: 5.0,
          },
          action: { type: 'setOutput', deviceId: 'device-1', enabled: false },
          repeatMode: 'once',
          debounceMs: 0,
        };

        const script = createTestScript({ id: `script-${op}`, triggers: [trigger] });
        await store.save([script]);

        const result = await store.load();
        expect(result.ok).toBe(true);
        if (result.ok) {
          const loaded = result.value.find(s => s.id === `script-${op}`);
          expect(loaded?.triggers[0].condition.type).toBe('value');
          if (loaded?.triggers[0].condition.type === 'value') {
            expect(loaded.triggers[0].condition.operator).toBe(op);
          }
        }
      }
    });
  });

  describe('trigger action types', () => {
    it('should handle all action types', async () => {
      const actions = [
        { type: 'setValue' as const, deviceId: 'd1', parameter: 'voltage', value: 5 },
        { type: 'setOutput' as const, deviceId: 'd1', enabled: true },
        { type: 'setMode' as const, deviceId: 'd1', mode: 'CC' },
        { type: 'startSequence' as const, sequenceId: 's1', deviceId: 'd1', parameter: 'voltage', repeatMode: 'once' as const },
        { type: 'stopSequence' as const },
        { type: 'pauseSequence' as const },
      ];

      const triggers: Trigger[] = actions.map((action, i) => ({
        id: `trigger-${i}`,
        condition: { type: 'time' as const, seconds: i * 10 },
        action,
        repeatMode: 'once' as const,
        debounceMs: 0,
      }));

      const script = createTestScript({ id: 'script-actions', triggers });
      await store.save([script]);

      const result = await store.load();
      expect(result.ok).toBe(true);
      if (result.ok) {
        const loaded = result.value[0];
        expect(loaded.triggers).toHaveLength(actions.length);
        actions.forEach((action, i) => {
          expect(loaded.triggers[i].action.type).toBe(action.type);
        });
      }
    });
  });

  describe('data integrity', () => {
    it('should persist across database reopens', async () => {
      const script = createTestScript({ id: 'persist-test', name: 'Persistent' });
      await store.save([script]);

      // Close and reopen database
      db.close();
      db = createDatabase(testDir);
      store = createTriggerScriptStoreSqlite(db);

      const result = await store.load();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].name).toBe('Persistent');
      }
    });
  });
});
