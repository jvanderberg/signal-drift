import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { createSequenceStore } from '../SequenceStore.js';
import type { SequenceDefinition } from '../../../shared/types.js';
import { WAVEFORM_LIMITS } from '../../../shared/waveform.js';

describe('SequenceStore', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    // Save original env
    originalEnv = { ...process.env };

    // Create temp directory for tests
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sequence-store-test-'));

    // Use temp directory for storage
    process.env.LAB_CONTROLLER_DATA_DIR = tempDir;
  });

  afterEach(async () => {
    // Restore original env
    process.env = originalEnv;

    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  function createTestSequence(overrides: Partial<SequenceDefinition> = {}): SequenceDefinition {
    return {
      id: 'seq-1',
      name: 'Test Sequence',
      unit: 'V',
      waveform: {
        type: 'sine',
        min: 0,
        max: 10,
        pointsPerCycle: 20,
        intervalMs: 100,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    };
  }

  describe('getStoragePath', () => {
    it('should return path in configured data directory', () => {
      const store = createSequenceStore();
      const storagePath = store.getStoragePath();

      expect(storagePath).toContain(tempDir);
      expect(storagePath).toContain('sequences.json');
    });

    it('should use LAB_CONTROLLER_DATA_DIR when set', () => {
      process.env.LAB_CONTROLLER_DATA_DIR = '/custom/path';
      const store = createSequenceStore();

      expect(store.getStoragePath()).toBe('/custom/path/sequences.json');
    });

    it('should use XDG_DATA_HOME when set and LAB_CONTROLLER_DATA_DIR not set', () => {
      delete process.env.LAB_CONTROLLER_DATA_DIR;
      process.env.XDG_DATA_HOME = '/xdg/data';
      const store = createSequenceStore();

      expect(store.getStoragePath()).toBe('/xdg/data/lab-controller/sequences.json');
    });
  });

  describe('load', () => {
    it('should return empty array when file does not exist', async () => {
      const store = createSequenceStore();
      const result = await store.load();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it('should load saved sequences', async () => {
      const store = createSequenceStore();
      const sequences = [createTestSequence({ id: 'seq-1' }), createTestSequence({ id: 'seq-2' })];

      // Save first
      await store.save(sequences);

      // Load
      const result = await store.load();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0].id).toBe('seq-1');
        expect(result.value[1].id).toBe('seq-2');
      }
    });

    it('should return Err for invalid JSON', async () => {
      const store = createSequenceStore();

      // Write invalid JSON directly
      await fs.writeFile(store.getStoragePath(), 'not valid json', 'utf-8');

      const result = await store.load();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Invalid JSON');
      }
    });

    it('should return Err for invalid storage format', async () => {
      const store = createSequenceStore();

      // Write valid JSON but wrong structure
      await fs.writeFile(store.getStoragePath(), JSON.stringify({ foo: 'bar' }), 'utf-8');

      const result = await store.load();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Invalid sequence storage format');
      }
    });

    it('should return Err for unsupported version', async () => {
      const store = createSequenceStore();

      // Write with future version
      await fs.writeFile(
        store.getStoragePath(),
        JSON.stringify({
          version: 999,
          sequences: [],
          lastModified: Date.now(),
        }),
        'utf-8'
      );

      const result = await store.load();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Unsupported storage version');
      }
    });

    it('should validate sequence structure', async () => {
      const store = createSequenceStore();

      // Write with invalid sequence (missing required field)
      await fs.writeFile(
        store.getStoragePath(),
        JSON.stringify({
          version: 1,
          sequences: [{ id: 'seq-1' }], // Missing name, unit, waveform, etc.
          lastModified: Date.now(),
        }),
        'utf-8'
      );

      const result = await store.load();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Invalid sequence storage format');
      }
    });

    it('should truncate library exceeding max size on load', async () => {
      const store = createSequenceStore();

      // Create oversized library directly in file
      const oversizedSequences = Array(WAVEFORM_LIMITS.MAX_LIBRARY_SIZE + 100)
        .fill(null)
        .map((_, i) => createTestSequence({ id: `seq-${i}` }));

      await fs.writeFile(
        store.getStoragePath(),
        JSON.stringify({
          version: 1,
          sequences: oversizedSequences,
          lastModified: Date.now(),
        }),
        'utf-8'
      );

      const result = await store.load();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(WAVEFORM_LIMITS.MAX_LIBRARY_SIZE);
      }
    });
  });

  describe('save', () => {
    it('should save sequences to file', async () => {
      const store = createSequenceStore();
      const sequences = [createTestSequence()];

      const result = await store.save(sequences);

      expect(result.ok).toBe(true);

      // Verify file exists and contains correct data
      const content = await fs.readFile(store.getStoragePath(), 'utf-8');
      const data = JSON.parse(content);

      expect(data.version).toBe(1);
      expect(data.sequences).toHaveLength(1);
      expect(data.sequences[0].id).toBe('seq-1');
    });

    it('should create directory if it does not exist', async () => {
      const nestedDir = path.join(tempDir, 'nested', 'deep', 'dir');
      process.env.LAB_CONTROLLER_DATA_DIR = nestedDir;

      const store = createSequenceStore();
      const result = await store.save([createTestSequence()]);

      expect(result.ok).toBe(true);

      // Verify file exists in nested directory
      const exists = await fs
        .access(store.getStoragePath())
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it('should reject library exceeding max size', async () => {
      const store = createSequenceStore();

      const oversizedSequences = Array(WAVEFORM_LIMITS.MAX_LIBRARY_SIZE + 1)
        .fill(null)
        .map((_, i) => createTestSequence({ id: `seq-${i}` }));

      const result = await store.save(oversizedSequences);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('exceeds maximum');
      }
    });

    it('should preserve all sequence fields', async () => {
      const store = createSequenceStore();
      const sequence = createTestSequence({
        id: 'seq-full',
        name: 'Full Test',
        unit: 'A',
        waveform: { steps: [{ value: 1, dwellMs: 100 }] },
        scale: 2,
        offset: 5,
        maxClamp: 10,
        preValue: 0,
        postValue: 0,
        maxSlewRate: 1,
      });

      await store.save([sequence]);
      const result = await store.load();

      expect(result.ok).toBe(true);
      if (result.ok) {
        const loaded = result.value[0];
        expect(loaded.id).toBe('seq-full');
        expect(loaded.name).toBe('Full Test');
        expect(loaded.unit).toBe('A');
        expect(loaded.scale).toBe(2);
        expect(loaded.offset).toBe(5);
        expect(loaded.maxClamp).toBe(10);
        expect(loaded.preValue).toBe(0);
        expect(loaded.postValue).toBe(0);
        expect(loaded.maxSlewRate).toBe(1);
        expect((loaded.waveform as { steps: unknown[] }).steps).toHaveLength(1);
      }
    });
  });

  describe('atomic writes', () => {
    it('should not leave temp files on successful save', async () => {
      const store = createSequenceStore();
      await store.save([createTestSequence()]);

      const files = await fs.readdir(tempDir);
      const tempFiles = files.filter((f) => f.includes('.tmp.'));

      expect(tempFiles).toHaveLength(0);
    });

    it('should overwrite existing file', async () => {
      const store = createSequenceStore();

      // Save initial
      await store.save([createTestSequence({ id: 'seq-1', name: 'First' })]);

      // Save updated
      await store.save([createTestSequence({ id: 'seq-2', name: 'Second' })]);

      const result = await store.load();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].id).toBe('seq-2');
        expect(result.value[0].name).toBe('Second');
      }
    });
  });

  describe('round-trip', () => {
    it('should preserve data through save/load cycle', async () => {
      const store = createSequenceStore();
      const original = [
        createTestSequence({ id: 'seq-1', name: 'First' }),
        createTestSequence({ id: 'seq-2', name: 'Second' }),
        createTestSequence({
          id: 'seq-3',
          name: 'Arbitrary',
          waveform: {
            steps: [
              { value: 0, dwellMs: 100 },
              { value: 5.5, dwellMs: 200 },
            ],
          },
        }),
      ];

      await store.save(original);
      const result = await store.load();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(original);
      }
    });
  });
});
