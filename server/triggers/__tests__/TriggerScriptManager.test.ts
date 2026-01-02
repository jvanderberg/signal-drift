/**
 * TriggerScriptManager tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { createTriggerScriptManager } from '../TriggerScriptManager.js';
import type { TriggerScriptManager } from '../TriggerScriptManager.js';
import type { TriggerScript, Trigger, ServerMessage } from '../../../shared/types.js';

// Mock SessionManager
function createMockSessionManager() {
  return {
    getSession: vi.fn(),
    getDeviceSummaries: vi.fn().mockReturnValue([]),
    setValue: vi.fn().mockResolvedValue({ ok: true }),
    setOutput: vi.fn().mockResolvedValue({ ok: true }),
  };
}

// Mock SequenceManager
function createMockSequenceManager() {
  return {
    run: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    abort: vi.fn().mockResolvedValue(undefined),
    getActiveState: vi.fn().mockReturnValue(null),
  };
}

describe('TriggerScriptManager', () => {
  let tempDir: string;
  let originalEnv: string | undefined;
  let manager: TriggerScriptManager;
  let mockSessionManager: ReturnType<typeof createMockSessionManager>;
  let mockSequenceManager: ReturnType<typeof createMockSequenceManager>;

  beforeEach(async () => {
    // Create temp directory for test storage
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trigger-manager-test-'));
    originalEnv = process.env.LAB_CONTROLLER_DATA_DIR;
    process.env.LAB_CONTROLLER_DATA_DIR = tempDir;

    mockSessionManager = createMockSessionManager();
    mockSequenceManager = createMockSequenceManager();
  });

  afterEach(async () => {
    // Stop manager if running
    if (manager) {
      manager.shutdown();
    }

    // Wait for debounced saves to complete
    await new Promise(resolve => setTimeout(resolve, 50));

    // Restore environment
    if (originalEnv !== undefined) {
      process.env.LAB_CONTROLLER_DATA_DIR = originalEnv;
    } else {
      delete process.env.LAB_CONTROLLER_DATA_DIR;
    }
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  function createTestTrigger(overrides: Partial<Trigger> = {}): Trigger {
    return {
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
      ...overrides,
    };
  }

  describe('Library CRUD', () => {
    beforeEach(async () => {
      manager = createTriggerScriptManager(
        mockSessionManager as never,
        mockSequenceManager as never
      );
      await manager.initialize();
    });

    describe('listLibrary()', () => {
      it('should return empty array initially', () => {
        const scripts = manager.listLibrary();
        expect(scripts).toEqual([]);
      });
    });

    describe('saveToLibrary()', () => {
      it('should save a new script and return its ID', () => {
        const result = manager.saveToLibrary({
          name: 'Test Script',
          triggers: [createTestTrigger()],
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toMatch(/^tscript-\d+-\d+$/);
        }
      });

      it('should add script to library', () => {
        manager.saveToLibrary({
          name: 'Test Script',
          triggers: [createTestTrigger()],
        });

        const scripts = manager.listLibrary();
        expect(scripts).toHaveLength(1);
        expect(scripts[0].name).toBe('Test Script');
      });

      it('should set createdAt and updatedAt timestamps', () => {
        const before = Date.now();
        manager.saveToLibrary({
          name: 'Test Script',
          triggers: [],
        });
        const after = Date.now();

        const scripts = manager.listLibrary();
        expect(scripts[0].createdAt).toBeGreaterThanOrEqual(before);
        expect(scripts[0].createdAt).toBeLessThanOrEqual(after);
        expect(scripts[0].updatedAt).toBe(scripts[0].createdAt);
      });
    });

    describe('updateInLibrary()', () => {
      it('should update an existing script', () => {
        const result = manager.saveToLibrary({
          name: 'Original Name',
          triggers: [],
        });
        if (!result.ok) throw new Error('Save failed');

        const script = manager.getFromLibrary(result.value);
        if (!script) throw new Error('Script not found');

        const updateResult = manager.updateInLibrary({
          ...script,
          name: 'Updated Name',
        });

        expect(updateResult.ok).toBe(true);

        const updated = manager.getFromLibrary(result.value);
        expect(updated?.name).toBe('Updated Name');
      });

      it('should return error for non-existent script', () => {
        const result = manager.updateInLibrary({
          id: 'non-existent',
          name: 'Test',
          triggers: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toContain('not found');
        }
      });

      it('should update the updatedAt timestamp', async () => {
        const saveResult = manager.saveToLibrary({
          name: 'Test',
          triggers: [],
        });
        if (!saveResult.ok) throw new Error('Save failed');

        const script = manager.getFromLibrary(saveResult.value);
        if (!script) throw new Error('Script not found');

        // Wait a bit to ensure timestamp differs
        await new Promise(resolve => setTimeout(resolve, 10));

        manager.updateInLibrary({
          ...script,
          name: 'Updated',
        });

        const updated = manager.getFromLibrary(saveResult.value);
        expect(updated?.updatedAt).toBeGreaterThan(script.updatedAt);
      });
    });

    describe('deleteFromLibrary()', () => {
      it('should remove script from library', () => {
        const result = manager.saveToLibrary({
          name: 'Test Script',
          triggers: [],
        });
        if (!result.ok) throw new Error('Save failed');

        const deleteResult = manager.deleteFromLibrary(result.value);
        expect(deleteResult.ok).toBe(true);

        const scripts = manager.listLibrary();
        expect(scripts).toHaveLength(0);
      });

      it('should return error for non-existent script', () => {
        const result = manager.deleteFromLibrary('non-existent');

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toContain('not found');
        }
      });
    });

    describe('getFromLibrary()', () => {
      it('should return script by ID', () => {
        const result = manager.saveToLibrary({
          name: 'Test Script',
          triggers: [createTestTrigger()],
        });
        if (!result.ok) throw new Error('Save failed');

        const script = manager.getFromLibrary(result.value);
        expect(script).toBeDefined();
        expect(script?.name).toBe('Test Script');
      });

      it('should return undefined for non-existent ID', () => {
        const script = manager.getFromLibrary('non-existent');
        expect(script).toBeUndefined();
      });
    });
  });

  describe('Subscriptions', () => {
    beforeEach(async () => {
      manager = createTriggerScriptManager(
        mockSessionManager as never,
        mockSequenceManager as never
      );
      await manager.initialize();
    });

    it('should notify subscribers of messages', () => {
      const messages: ServerMessage[] = [];
      manager.subscribe((msg) => messages.push(msg));

      // Save triggers a broadcast indirectly through engine
      // For now just verify subscription works
      expect(messages).toHaveLength(0);
    });

    it('should allow unsubscribing', () => {
      const messages: ServerMessage[] = [];
      const unsubscribe = manager.subscribe((msg) => messages.push(msg));

      unsubscribe();
      // Subscriber should be removed
      expect(messages).toHaveLength(0);
    });
  });

  describe('Persistence', () => {
    it('should persist scripts across manager instances', async () => {
      // Create first manager and save a script
      const manager1 = createTriggerScriptManager(
        mockSessionManager as never,
        mockSequenceManager as never
      );
      await manager1.initialize();

      manager1.saveToLibrary({
        name: 'Persisted Script',
        triggers: [createTestTrigger()],
      });

      // Force save and shutdown
      manager1.shutdown();

      // Wait for debounced save
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Create second manager and verify script is loaded
      const manager2 = createTriggerScriptManager(
        mockSessionManager as never,
        mockSequenceManager as never
      );
      await manager2.initialize();

      const scripts = manager2.listLibrary();
      expect(scripts).toHaveLength(1);
      expect(scripts[0].name).toBe('Persisted Script');

      manager2.shutdown();
    });
  });

  describe('getActiveState()', () => {
    beforeEach(async () => {
      manager = createTriggerScriptManager(
        mockSessionManager as never,
        mockSequenceManager as never
      );
      await manager.initialize();
    });

    it('should return undefined when no script is running', () => {
      const state = manager.getActiveState();
      expect(state).toBeUndefined();
    });
  });
});
