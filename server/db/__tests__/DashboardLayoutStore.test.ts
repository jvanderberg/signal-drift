/**
 * DashboardLayoutStore tests
 *
 * Tests for the SQLite-backed dashboard layout storage implementation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { createDatabase, type Database } from '../database.js';
import { createDashboardLayoutStore, type DashboardLayoutStore } from '../DashboardLayoutStore.js';
import type { DashboardLayoutData, DashboardLayoutItem } from '../../../shared/types.js';

describe('DashboardLayoutStore', () => {
  let testDir: string;
  let db: Database;
  let store: DashboardLayoutStore;

  // Sample layout data for testing
  const sampleLayout: DashboardLayoutData = {
    layouts: {
      lg: [
        { i: 'device-1', x: 0, y: 0, w: 6, h: 8, minW: 4, minH: 6 },
        { i: 'sequencer', x: 6, y: 0, w: 6, h: 8, minW: 4, minH: 6 },
      ],
      md: [
        { i: 'device-1', x: 0, y: 0, w: 10, h: 8 },
        { i: 'sequencer', x: 0, y: 8, w: 10, h: 8 },
      ],
      sm: [
        { i: 'device-1', x: 0, y: 0, w: 6, h: 8 },
        { i: 'sequencer', x: 0, y: 8, w: 6, h: 8 },
      ],
      xs: [
        { i: 'device-1', x: 0, y: 0, w: 4, h: 8 },
        { i: 'sequencer', x: 0, y: 8, w: 4, h: 8 },
      ],
    },
  };

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testDir = path.join(os.tmpdir(), `lab-controller-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(testDir, { recursive: true });
    db = createDatabase(testDir);
    store = createDashboardLayoutStore(db);
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

  describe('get', () => {
    it('should return null for fresh database', () => {
      const result = store.get();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('should return saved layout', () => {
      store.save(sampleLayout);

      const result = store.get();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        expect(result.value?.layouts.lg).toHaveLength(2);
        expect(result.value?.layouts.lg[0].i).toBe('device-1');
      }
    });
  });

  describe('save', () => {
    it('should save layout successfully', () => {
      const result = store.save(sampleLayout);

      expect(result.ok).toBe(true);

      const getResult = store.get();
      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.value).toEqual(sampleLayout);
      }
    });

    it('should update existing layout', () => {
      store.save(sampleLayout);

      const updatedLayout: DashboardLayoutData = {
        layouts: {
          lg: [{ i: 'new-panel', x: 0, y: 0, w: 12, h: 10 }],
          md: [{ i: 'new-panel', x: 0, y: 0, w: 10, h: 10 }],
          sm: [{ i: 'new-panel', x: 0, y: 0, w: 6, h: 10 }],
          xs: [{ i: 'new-panel', x: 0, y: 0, w: 4, h: 10 }],
        },
      };
      store.save(updatedLayout);

      const result = store.get();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value?.layouts.lg).toHaveLength(1);
        expect(result.value?.layouts.lg[0].i).toBe('new-panel');
      }
    });

    it('should preserve all layout properties', () => {
      const layoutWithAllProps: DashboardLayoutData = {
        layouts: {
          lg: [{
            i: 'panel-1',
            x: 2,
            y: 3,
            w: 4,
            h: 5,
            minW: 2,
            minH: 3,
            maxW: 8,
            maxH: 10,
          }],
          md: [],
          sm: [],
          xs: [],
        },
      };

      store.save(layoutWithAllProps);

      const result = store.get();
      expect(result.ok).toBe(true);
      if (result.ok) {
        const panel = result.value?.layouts.lg[0];
        expect(panel?.x).toBe(2);
        expect(panel?.y).toBe(3);
        expect(panel?.w).toBe(4);
        expect(panel?.h).toBe(5);
        expect(panel?.minW).toBe(2);
        expect(panel?.minH).toBe(3);
        expect(panel?.maxW).toBe(8);
        expect(panel?.maxH).toBe(10);
      }
    });

    it('should handle empty layouts', () => {
      const emptyLayout: DashboardLayoutData = {
        layouts: {
          lg: [],
          md: [],
          sm: [],
          xs: [],
        },
      };

      const result = store.save(emptyLayout);
      expect(result.ok).toBe(true);

      const getResult = store.get();
      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.value?.layouts.lg).toHaveLength(0);
      }
    });
  });

  describe('clear', () => {
    it('should remove layout', () => {
      store.save(sampleLayout);
      store.clear();

      const result = store.get();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('should not fail when no layout exists', () => {
      const result = store.clear();
      expect(result.ok).toBe(true);
    });
  });

  describe('data integrity', () => {
    it('should persist across database reopens', () => {
      store.save(sampleLayout);

      // Close and reopen database
      db.close();
      db = createDatabase(testDir);
      store = createDashboardLayoutStore(db);

      const result = store.get();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(sampleLayout);
      }
    });

    it('should handle panel IDs with special characters', () => {
      const layoutWithSpecialIds: DashboardLayoutData = {
        layouts: {
          lg: [
            { i: 'device-uuid-12345-abcdef', x: 0, y: 0, w: 6, h: 8 },
            { i: 'trigger-scripts', x: 6, y: 0, w: 6, h: 8 },
          ],
          md: [],
          sm: [],
          xs: [],
        },
      };

      store.save(layoutWithSpecialIds);

      const result = store.get();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value?.layouts.lg[0].i).toBe('device-uuid-12345-abcdef');
        expect(result.value?.layouts.lg[1].i).toBe('trigger-scripts');
      }
    });

    it('should handle many panels', () => {
      const manyPanels: DashboardLayoutItem[] = [];
      for (let i = 0; i < 20; i++) {
        manyPanels.push({
          i: `device-${i}`,
          x: (i % 4) * 3,
          y: Math.floor(i / 4) * 8,
          w: 3,
          h: 8,
        });
      }

      const layout: DashboardLayoutData = {
        layouts: {
          lg: manyPanels,
          md: manyPanels,
          sm: manyPanels,
          xs: manyPanels,
        },
      };

      store.save(layout);

      const result = store.get();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value?.layouts.lg).toHaveLength(20);
      }
    });
  });
});
