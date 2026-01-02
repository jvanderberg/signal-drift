/**
 * TriggerScriptStore tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { createTriggerScriptStore } from '../TriggerScriptStore.js';
import type { TriggerScript } from '../../../shared/types.js';

describe('TriggerScriptStore', () => {
  let tempDir: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    // Create temp directory for test storage
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trigger-store-test-'));
    originalEnv = process.env.LAB_CONTROLLER_DATA_DIR;
    process.env.LAB_CONTROLLER_DATA_DIR = tempDir;
  });

  afterEach(async () => {
    // Restore environment
    if (originalEnv !== undefined) {
      process.env.LAB_CONTROLLER_DATA_DIR = originalEnv;
    } else {
      delete process.env.LAB_CONTROLLER_DATA_DIR;
    }
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function createTestScript(overrides: Partial<TriggerScript> = {}): TriggerScript {
    return {
      id: 'test-script-1',
      name: 'Test Script',
      triggers: [
        {
          id: 'trigger-1',
          condition: {
            type: 'value',
            deviceId: 'psu-1',
            parameter: 'voltage',
            operator: '>',
            value: 10,
          },
          action: {
            type: 'setOutput',
            deviceId: 'load-1',
            enabled: true,
          },
          repeatMode: 'once',
          debounceMs: 100,
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    };
  }

  describe('load()', () => {
    it('should return empty array when no storage file exists', async () => {
      const store = createTriggerScriptStore();
      const result = await store.load();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it('should load scripts from existing storage file', async () => {
      const scripts = [createTestScript()];
      const storageData = {
        version: 1,
        scripts,
        lastModified: Date.now(),
      };

      // Write storage file directly
      await fs.writeFile(
        path.join(tempDir, 'trigger-scripts.json'),
        JSON.stringify(storageData)
      );

      const store = createTriggerScriptStore();
      const result = await store.load();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].name).toBe('Test Script');
      }
    });

    it('should return error for invalid JSON', async () => {
      await fs.writeFile(
        path.join(tempDir, 'trigger-scripts.json'),
        'not valid json'
      );

      const store = createTriggerScriptStore();
      const result = await store.load();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Invalid JSON');
      }
    });

    it('should return error for invalid storage format', async () => {
      await fs.writeFile(
        path.join(tempDir, 'trigger-scripts.json'),
        JSON.stringify({ foo: 'bar' })
      );

      const store = createTriggerScriptStore();
      const result = await store.load();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Invalid');
      }
    });
  });

  describe('save()', () => {
    it('should save scripts to storage file', async () => {
      const store = createTriggerScriptStore();
      const scripts = [createTestScript()];

      const result = await store.save(scripts);

      expect(result.ok).toBe(true);

      // Verify file was written
      const content = await fs.readFile(
        path.join(tempDir, 'trigger-scripts.json'),
        'utf-8'
      );
      const data = JSON.parse(content);
      expect(data.version).toBe(1);
      expect(data.scripts).toHaveLength(1);
      expect(data.scripts[0].name).toBe('Test Script');
    });

    it('should roundtrip scripts correctly', async () => {
      const store = createTriggerScriptStore();
      const scripts = [
        createTestScript({ id: 'script-1', name: 'Script 1' }),
        createTestScript({ id: 'script-2', name: 'Script 2' }),
      ];

      await store.save(scripts);
      const result = await store.load();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0].name).toBe('Script 1');
        expect(result.value[1].name).toBe('Script 2');
      }
    });

    it('should use atomic writes (temp file + rename)', async () => {
      const store = createTriggerScriptStore();
      const scripts = [createTestScript()];

      await store.save(scripts);

      // Temp file should not exist after save
      const files = await fs.readdir(tempDir);
      const tempFiles = files.filter(f => f.includes('.tmp.'));
      expect(tempFiles).toHaveLength(0);
    });
  });

  describe('getStoragePath()', () => {
    it('should return path based on LAB_CONTROLLER_DATA_DIR', () => {
      const store = createTriggerScriptStore();
      const storagePath = store.getStoragePath();

      expect(storagePath).toBe(path.join(tempDir, 'trigger-scripts.json'));
    });
  });
});
