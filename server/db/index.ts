/**
 * Database module - SQLite persistence layer
 *
 * Provides persistent storage for:
 * - Sequences (AWG waveforms)
 * - Trigger scripts
 * - Device aliases
 * - Dashboard layouts
 */

export { createDatabase, getDefaultDataDirectory, type Database } from './database.js';
export { createSequenceStoreSqlite, type SequenceStore } from './SequenceStoreSqlite.js';
export { createTriggerScriptStoreSqlite, type TriggerScriptStore } from './TriggerScriptStoreSqlite.js';
export { createDeviceAliasStore, type DeviceAliasStore, type DeviceAlias } from './DeviceAliasStore.js';
export { createSettingsManager, type SettingsManager, type SettingsExportData, type ImportResult } from './SettingsManager.js';
export { createDashboardLayoutStore, type DashboardLayoutStore } from './DashboardLayoutStore.js';
