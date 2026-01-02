/**
 * Settings Export/Import tests
 *
 * Tests for exporting and importing all settings as a single JSON file.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { SequenceDefinition, TriggerScript } from '../../../shared/types.js';
import { createDatabase, type Database } from '../database.js';
import { createSequenceStoreSqlite } from '../SequenceStoreSqlite.js';
import { createTriggerScriptStoreSqlite } from '../TriggerScriptStoreSqlite.js';
import { createDeviceAliasStore, type DeviceAlias } from '../DeviceAliasStore.js';
import {
  createSettingsManager,
  type SettingsManager,
  type SettingsExportData,
} from '../SettingsManager.js';

// Test fixtures
function createTestSequence(overrides: Partial<SequenceDefinition> = {}): SequenceDefinition {
  const now = Date.now();
  return {
    id: `seq-${Math.random().toString(36).slice(2)}`,
    name: 'Test Sequence',
    unit: 'V',
    waveform: { type: 'sine', min: 0, max: 10, pointsPerCycle: 100, intervalMs: 100 },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createTestScript(overrides: Partial<TriggerScript> = {}): TriggerScript {
  const now = Date.now();
  return {
    id: `script-${Math.random().toString(36).slice(2)}`,
    name: 'Test Script',
    triggers: [{
      id: 'trigger-1',
      condition: { type: 'time', seconds: 10 },
      action: { type: 'setOutput', deviceId: 'device-1', enabled: true },
      repeatMode: 'once',
      debounceMs: 0,
    }],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createTestAlias(idn: string, alias: string): DeviceAlias {
  const now = Date.now();
  return { idn, alias, createdAt: now, updatedAt: now };
}

describe('SettingsManager', () => {
  let testDir: string;
  let db: Database;
  let manager: SettingsManager;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `lab-controller-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(testDir, { recursive: true });
    db = createDatabase(testDir);

    const sequenceStore = createSequenceStoreSqlite(db);
    const triggerScriptStore = createTriggerScriptStoreSqlite(db);
    const deviceAliasStore = createDeviceAliasStore(db);

    manager = createSettingsManager(sequenceStore, triggerScriptStore, deviceAliasStore);
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

  describe('exportSettings', () => {
    it('should export empty data for fresh database', async () => {
      const result = await manager.exportSettings();

      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.value;
        expect(data.version).toBe(1);
        expect(data.exportedAt).toBeDefined();
        expect(data.sequences).toEqual([]);
        expect(data.triggerScripts).toEqual([]);
        expect(data.deviceAliases).toEqual([]);
      }
    });

    it('should export all settings', async () => {
      // Add some data
      const sequenceStore = createSequenceStoreSqlite(db);
      const triggerScriptStore = createTriggerScriptStoreSqlite(db);
      const deviceAliasStore = createDeviceAliasStore(db);

      const seq = createTestSequence({ id: 'seq-1', name: 'Sequence 1' });
      const script = createTestScript({ id: 'script-1', name: 'Script 1' });

      await sequenceStore.save([seq]);
      await triggerScriptStore.save([script]);
      deviceAliasStore.set('Rigol,DL3021,123,1.0', 'Bench Load');

      // Export
      const result = await manager.exportSettings();

      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.value;
        expect(data.sequences).toHaveLength(1);
        expect(data.sequences[0].name).toBe('Sequence 1');
        expect(data.triggerScripts).toHaveLength(1);
        expect(data.triggerScripts[0].name).toBe('Script 1');
        expect(data.deviceAliases).toHaveLength(1);
        expect(data.deviceAliases[0].alias).toBe('Bench Load');
      }
    });

    it('should produce valid JSON', async () => {
      const result = await manager.exportSettings();

      expect(result.ok).toBe(true);
      if (result.ok) {
        const json = JSON.stringify(result.value);
        const parsed = JSON.parse(json);
        expect(parsed.version).toBe(1);
      }
    });
  });

  describe('importSettings', () => {
    it('should import settings from export data', async () => {
      const exportData: SettingsExportData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        sequences: [createTestSequence({ id: 'seq-import', name: 'Imported Sequence' })],
        triggerScripts: [createTestScript({ id: 'script-import', name: 'Imported Script' })],
        deviceAliases: [createTestAlias('Matrix,WPS300S,456,1.0', 'Main PSU')],
      };

      const result = await manager.importSettings(exportData);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sequences).toBe(1);
        expect(result.value.triggerScripts).toBe(1);
        expect(result.value.deviceAliases).toBe(1);
      }

      // Verify data was imported
      const verifyResult = await manager.exportSettings();
      expect(verifyResult.ok).toBe(true);
      if (verifyResult.ok) {
        expect(verifyResult.value.sequences[0].name).toBe('Imported Sequence');
        expect(verifyResult.value.triggerScripts[0].name).toBe('Imported Script');
        expect(verifyResult.value.deviceAliases[0].alias).toBe('Main PSU');
      }
    });

    it('should fully replace existing data', async () => {
      // Set up initial data
      const sequenceStore = createSequenceStoreSqlite(db);
      const triggerScriptStore = createTriggerScriptStoreSqlite(db);
      const deviceAliasStore = createDeviceAliasStore(db);

      await sequenceStore.save([createTestSequence({ id: 'old-seq', name: 'Old Sequence' })]);
      await triggerScriptStore.save([createTestScript({ id: 'old-script', name: 'Old Script' })]);
      deviceAliasStore.set('old-idn', 'Old Alias');

      // Import new data (full replace)
      const exportData: SettingsExportData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        sequences: [createTestSequence({ id: 'new-seq', name: 'New Sequence' })],
        triggerScripts: [createTestScript({ id: 'new-script', name: 'New Script' })],
        deviceAliases: [createTestAlias('new-idn', 'New Alias')],
      };

      await manager.importSettings(exportData);

      // Verify old data is gone
      const verifyResult = await manager.exportSettings();
      expect(verifyResult.ok).toBe(true);
      if (verifyResult.ok) {
        expect(verifyResult.value.sequences).toHaveLength(1);
        expect(verifyResult.value.sequences[0].id).toBe('new-seq');
        expect(verifyResult.value.triggerScripts).toHaveLength(1);
        expect(verifyResult.value.triggerScripts[0].id).toBe('new-script');
        expect(verifyResult.value.deviceAliases).toHaveLength(1);
        expect(verifyResult.value.deviceAliases[0].idn).toBe('new-idn');
      }
    });

    it('should reject invalid version', async () => {
      const exportData = {
        version: 999,
        exportedAt: new Date().toISOString(),
        sequences: [],
        triggerScripts: [],
        deviceAliases: [],
      };

      const result = await manager.importSettings(exportData);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('version');
      }
    });

    it('should handle empty import data', async () => {
      // Set up initial data
      const sequenceStore = createSequenceStoreSqlite(db);
      await sequenceStore.save([createTestSequence({ id: 'existing', name: 'Existing' })]);

      // Import empty data
      const exportData: SettingsExportData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        sequences: [],
        triggerScripts: [],
        deviceAliases: [],
      };

      const result = await manager.importSettings(exportData);
      expect(result.ok).toBe(true);

      // Verify all data is cleared
      const verifyResult = await manager.exportSettings();
      expect(verifyResult.ok).toBe(true);
      if (verifyResult.ok) {
        expect(verifyResult.value.sequences).toHaveLength(0);
        expect(verifyResult.value.triggerScripts).toHaveLength(0);
        expect(verifyResult.value.deviceAliases).toHaveLength(0);
      }
    });
  });

  describe('round-trip', () => {
    it('should preserve data through export/import cycle', async () => {
      // Create varied data
      const sequences = [
        createTestSequence({ id: 'seq-1', name: 'Sine Wave', unit: 'V' }),
        createTestSequence({
          id: 'seq-2',
          name: 'Random Walk',
          unit: 'A',
          waveform: {
            type: 'random',
            startValue: 1,
            min: 0,
            max: 5,
            maxStepSize: 0.1,
            pointsPerCycle: 50,
            intervalMs: 100,
          },
        }),
      ];

      const scripts = [
        createTestScript({
          id: 'script-1',
          name: 'Safety Interlock',
          triggers: [
            {
              id: 't1',
              condition: { type: 'value', deviceId: 'd1', parameter: 'current', operator: '>', value: 2 },
              action: { type: 'setOutput', deviceId: 'd1', enabled: false },
              repeatMode: 'once',
              debounceMs: 100,
            },
          ],
        }),
      ];

      const aliases = [
        createTestAlias('Rigol,DL3021,ABC,1.0', 'Bench Load'),
        createTestAlias('Matrix,WPS300S,XYZ,2.0', 'Main PSU'),
      ];

      // Save initial data
      const sequenceStore = createSequenceStoreSqlite(db);
      const triggerScriptStore = createTriggerScriptStoreSqlite(db);
      const deviceAliasStore = createDeviceAliasStore(db);

      await sequenceStore.save(sequences);
      await triggerScriptStore.save(scripts);
      deviceAliasStore.replaceAll(aliases);

      // Export
      const exportResult = await manager.exportSettings();
      expect(exportResult.ok).toBe(true);
      if (!exportResult.ok) return;

      const exported = exportResult.value;

      // Clear all data
      await sequenceStore.save([]);
      await triggerScriptStore.save([]);
      deviceAliasStore.replaceAll([]);

      // Import
      const importResult = await manager.importSettings(exported);
      expect(importResult.ok).toBe(true);

      // Verify data matches
      const verifyResult = await manager.exportSettings();
      expect(verifyResult.ok).toBe(true);
      if (verifyResult.ok) {
        expect(verifyResult.value.sequences).toHaveLength(2);
        expect(verifyResult.value.triggerScripts).toHaveLength(1);
        expect(verifyResult.value.deviceAliases).toHaveLength(2);

        // Check specific fields
        const seq2 = verifyResult.value.sequences.find(s => s.id === 'seq-2');
        expect(seq2?.waveform && 'type' in seq2.waveform ? seq2.waveform.type : undefined).toBe('random');

        const script1 = verifyResult.value.triggerScripts[0];
        expect(script1.triggers[0].condition.type).toBe('value');
      }
    });
  });
});
