/**
 * SQLite SequenceStore tests
 *
 * Tests for the SQLite-backed sequence storage implementation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { SequenceDefinition } from '../../../shared/types.js';
import { createDatabase, type Database } from '../database.js';
import { createSequenceStoreSqlite, type SequenceStore } from '../SequenceStoreSqlite.js';

// Test fixture: minimal valid sequence
function createTestSequence(overrides: Partial<SequenceDefinition> = {}): SequenceDefinition {
  const now = Date.now();
  return {
    id: `seq-${Math.random().toString(36).slice(2)}`,
    name: 'Test Sequence',
    unit: 'V',
    waveform: {
      type: 'sine',
      min: 0,
      max: 10,
      pointsPerCycle: 100,
      intervalMs: 100,
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('SequenceStoreSqlite', () => {
  let testDir: string;
  let db: Database;
  let store: SequenceStore;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testDir = path.join(os.tmpdir(), `lab-controller-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(testDir, { recursive: true });
    db = createDatabase(testDir);
    store = createSequenceStoreSqlite(db);
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

    it('should return saved sequences', async () => {
      const seq1 = createTestSequence({ id: 'seq-1', name: 'Sequence 1' });
      const seq2 = createTestSequence({ id: 'seq-2', name: 'Sequence 2' });

      await store.save([seq1, seq2]);
      const result = await store.load();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value.find(s => s.id === 'seq-1')?.name).toBe('Sequence 1');
        expect(result.value.find(s => s.id === 'seq-2')?.name).toBe('Sequence 2');
      }
    });

    it('should preserve all sequence fields', async () => {
      const seq = createTestSequence({
        id: 'seq-full',
        name: 'Full Sequence',
        unit: 'A',
        preValue: 1.0,
        postValue: 0.5,
        scale: 2.0,
        offset: 0.1,
        minClamp: 0,
        maxClamp: 5,
        maxSlewRate: 100,
      });

      await store.save([seq]);
      const result = await store.load();

      expect(result.ok).toBe(true);
      if (result.ok) {
        const loaded = result.value[0];
        expect(loaded.id).toBe('seq-full');
        expect(loaded.name).toBe('Full Sequence');
        expect(loaded.unit).toBe('A');
        expect(loaded.preValue).toBe(1.0);
        expect(loaded.postValue).toBe(0.5);
        expect(loaded.scale).toBe(2.0);
        expect(loaded.offset).toBe(0.1);
        expect(loaded.minClamp).toBe(0);
        expect(loaded.maxClamp).toBe(5);
        expect(loaded.maxSlewRate).toBe(100);
        expect(loaded.createdAt).toBe(seq.createdAt);
        expect(loaded.updatedAt).toBe(seq.updatedAt);
      }
    });
  });

  describe('save', () => {
    it('should save sequences to database', async () => {
      const seq = createTestSequence();
      const result = await store.save([seq]);

      expect(result.ok).toBe(true);
    });

    it('should overwrite existing sequences with same id', async () => {
      const seq = createTestSequence({ id: 'seq-1', name: 'Original' });
      await store.save([seq]);

      const updated = { ...seq, name: 'Updated', updatedAt: Date.now() };
      await store.save([updated]);

      const result = await store.load();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].name).toBe('Updated');
      }
    });

    it('should remove sequences not in save array', async () => {
      const seq1 = createTestSequence({ id: 'seq-1' });
      const seq2 = createTestSequence({ id: 'seq-2' });
      await store.save([seq1, seq2]);

      // Save only seq1
      await store.save([seq1]);

      const result = await store.load();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].id).toBe('seq-1');
      }
    });

    it('should enforce library size limit', async () => {
      const sequences: SequenceDefinition[] = [];
      for (let i = 0; i < 1001; i++) {
        sequences.push(createTestSequence({ id: `seq-${i}` }));
      }

      const result = await store.save(sequences);

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

  describe('different waveform types', () => {
    it('should handle sine waveform', async () => {
      const seq = createTestSequence({
        waveform: { type: 'sine', min: 0, max: 10, pointsPerCycle: 50, intervalMs: 100 },
      });

      await store.save([seq]);
      const result = await store.load();

      expect(result.ok).toBe(true);
      if (result.ok) {
        const wf = result.value[0].waveform;
        expect('type' in wf && wf.type).toBe('sine');
        if ('type' in wf && wf.type === 'sine') {
          expect(wf.min).toBe(0);
          expect(wf.max).toBe(10);
          expect(wf.pointsPerCycle).toBe(50);
          expect(wf.intervalMs).toBe(100);
        }
      }
    });

    it('should handle random walk waveform', async () => {
      const seq = createTestSequence({
        waveform: {
          type: 'random',
          startValue: 5,
          min: 0,
          max: 10,
          maxStepSize: 0.5,
          pointsPerCycle: 100,
          intervalMs: 50,
        },
      });

      await store.save([seq]);
      const result = await store.load();

      expect(result.ok).toBe(true);
      if (result.ok) {
        const wf = result.value[0].waveform;
        expect('type' in wf && wf.type).toBe('random');
      }
    });

    it('should handle arbitrary waveform', async () => {
      const seq = createTestSequence({
        waveform: {
          steps: [
            { value: 0, dwellMs: 100 },
            { value: 5, dwellMs: 200 },
            { value: 10, dwellMs: 100 },
          ],
        },
      });

      await store.save([seq]);
      const result = await store.load();

      expect(result.ok).toBe(true);
      if (result.ok) {
        const wf = result.value[0].waveform;
        expect('steps' in wf).toBe(true);
        if ('steps' in wf) {
          expect(wf.steps).toHaveLength(3);
        }
      }
    });
  });

  describe('data integrity', () => {
    it('should handle concurrent save/load operations', async () => {
      const sequences = Array.from({ length: 10 }, (_, i) =>
        createTestSequence({ id: `seq-${i}`, name: `Sequence ${i}` })
      );

      // Save all at once
      await store.save(sequences);

      // Multiple concurrent loads
      const results = await Promise.all([
        store.load(),
        store.load(),
        store.load(),
      ]);

      for (const result of results) {
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toHaveLength(10);
        }
      }
    });

    it('should persist across database reopens', async () => {
      const seq = createTestSequence({ id: 'persist-test', name: 'Persistent' });
      await store.save([seq]);

      // Close and reopen database
      db.close();
      db = createDatabase(testDir);
      store = createSequenceStoreSqlite(db);

      const result = await store.load();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].name).toBe('Persistent');
      }
    });
  });
});
