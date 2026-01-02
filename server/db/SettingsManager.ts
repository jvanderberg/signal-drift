/**
 * SettingsManager - Export/Import all settings
 *
 * Provides functionality to export all settings (sequences, trigger scripts,
 * device aliases) to a single JSON file and import them back.
 */

import type { Result, SettingsExportData, SettingsImportResult } from '../../shared/types.js';
import { Ok, Err } from '../../shared/types.js';
import type { SequenceStore } from './SequenceStoreSqlite.js';
import type { TriggerScriptStore } from './TriggerScriptStoreSqlite.js';
import type { DeviceAliasStore } from './DeviceAliasStore.js';

// Re-export shared types for convenience
export type { SettingsExportData, SettingsImportResult };

// Alias for backward compatibility
export type ImportResult = SettingsImportResult;

/** Current export format version */
const EXPORT_VERSION = 1;

export interface SettingsManager {
  /** Export all settings to a data object */
  exportSettings(): Promise<Result<SettingsExportData, Error>>;

  /** Import settings from a data object (full replace) */
  importSettings(data: SettingsExportData): Promise<Result<SettingsImportResult, Error>>;
}

/**
 * Create a settings manager for export/import
 */
export function createSettingsManager(
  sequenceStore: SequenceStore,
  triggerScriptStore: TriggerScriptStore,
  deviceAliasStore: DeviceAliasStore
): SettingsManager {

  async function exportSettings(): Promise<Result<SettingsExportData, Error>> {
    try {
      // Load all data
      const sequencesResult = await sequenceStore.load();
      if (!sequencesResult.ok) {
        return Err(new Error(`Failed to load sequences: ${sequencesResult.error.message}`));
      }

      const triggerScriptsResult = await triggerScriptStore.load();
      if (!triggerScriptsResult.ok) {
        return Err(new Error(`Failed to load trigger scripts: ${triggerScriptsResult.error.message}`));
      }

      const deviceAliasesResult = deviceAliasStore.list();
      if (!deviceAliasesResult.ok) {
        return Err(new Error(`Failed to load device aliases: ${deviceAliasesResult.error.message}`));
      }

      const data: SettingsExportData = {
        version: EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        sequences: sequencesResult.value,
        triggerScripts: triggerScriptsResult.value,
        deviceAliases: deviceAliasesResult.value,
      };

      return Ok(data);
    } catch (err) {
      return Err(err instanceof Error ? err : new Error(String(err)));
    }
  }

  async function importSettings(data: SettingsExportData): Promise<Result<SettingsImportResult, Error>> {
    try {
      // Validate version
      if (data.version > EXPORT_VERSION) {
        return Err(new Error(`Unsupported export version: ${data.version}. Maximum supported version is ${EXPORT_VERSION}`));
      }

      // Future: Add version migration if needed
      // if (data.version < EXPORT_VERSION) {
      //   data = migrateExportData(data);
      // }

      // Import sequences (full replace)
      const sequencesResult = await sequenceStore.save(data.sequences);
      if (!sequencesResult.ok) {
        return Err(new Error(`Failed to import sequences: ${sequencesResult.error.message}`));
      }

      // Import trigger scripts (full replace)
      const triggerScriptsResult = await triggerScriptStore.save(data.triggerScripts);
      if (!triggerScriptsResult.ok) {
        return Err(new Error(`Failed to import trigger scripts: ${triggerScriptsResult.error.message}`));
      }

      // Import device aliases (full replace)
      const deviceAliasesResult = deviceAliasStore.replaceAll(data.deviceAliases);
      if (!deviceAliasesResult.ok) {
        return Err(new Error(`Failed to import device aliases: ${deviceAliasesResult.error.message}`));
      }

      return Ok({
        sequences: data.sequences.length,
        triggerScripts: data.triggerScripts.length,
        deviceAliases: data.deviceAliases.length,
      });
    } catch (err) {
      return Err(err instanceof Error ? err : new Error(String(err)));
    }
  }

  return {
    exportSettings,
    importSettings,
  };
}
