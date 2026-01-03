/**
 * DashboardLayoutStore - SQLite persistence for dashboard layouts
 *
 * Stores the user's dashboard panel layout configuration using the meta table.
 * This is simpler than a dedicated table since there's only one layout per instance.
 */

import type { Database } from './database.js';
import type { DashboardLayoutData } from '../../shared/types.js';
import { Ok, Err, type Result } from '../../shared/types.js';

const LAYOUT_KEY = 'dashboard_layout';

export interface DashboardLayoutStore {
  /** Get the current dashboard layout */
  get(): Result<DashboardLayoutData | null, Error>;

  /** Save the dashboard layout */
  save(layout: DashboardLayoutData): Result<void, Error>;

  /** Clear the dashboard layout (reset to default) */
  clear(): Result<void, Error>;
}

export function createDashboardLayoutStore(database: Database): DashboardLayoutStore {
  return {
    get(): Result<DashboardLayoutData | null, Error> {
      try {
        const value = database.getMeta(LAYOUT_KEY);
        if (!value) {
          return Ok(null);
        }
        const layout = JSON.parse(value) as DashboardLayoutData;
        return Ok(layout);
      } catch (err) {
        return Err(err instanceof Error ? err : new Error(String(err)));
      }
    },

    save(layout: DashboardLayoutData): Result<void, Error> {
      try {
        const value = JSON.stringify(layout);
        database.setMeta(LAYOUT_KEY, value);
        return Ok();
      } catch (err) {
        return Err(err instanceof Error ? err : new Error(String(err)));
      }
    },

    clear(): Result<void, Error> {
      try {
        database.deleteMeta(LAYOUT_KEY);
        return Ok();
      } catch (err) {
        return Err(err instanceof Error ? err : new Error(String(err)));
      }
    },
  };
}
