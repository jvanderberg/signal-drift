/**
 * DashboardLayoutContext - Provides layout information to dashboard panels
 *
 * This context allows panels to access their current grid layout (column count, row count)
 * so they can implement responsive behavior based on grid-snapped dimensions rather than
 * smooth pixel widths from ResizeObserver.
 *
 * This solves the WYSIWYG problem during resize: breakpoints are calculated from the
 * column count that the grid will snap to, not from intermediate pixel widths.
 */

import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { DashboardLayoutItem } from '../../../shared/types';

// Layout information for a single panel
interface PanelLayout {
  w: number;  // Column count (width in grid units)
  h: number;  // Row count (height in grid units)
  x: number;  // X position in grid
  y: number;  // Y position in grid
}

// Context value type
interface DashboardLayoutContextValue {
  // Map of panel key to its layout
  layouts: Map<string, PanelLayout>;
  // Current number of columns in the grid (varies by viewport breakpoint)
  cols: number;
}

const DashboardLayoutContext = createContext<DashboardLayoutContextValue | null>(null);

interface DashboardLayoutProviderProps {
  children: ReactNode;
  // Layout items for the current breakpoint
  items: DashboardLayoutItem[];
  // Current column count (from GRID_COLS for current breakpoint)
  cols: number;
}

export function DashboardLayoutProvider({ children, items, cols }: DashboardLayoutProviderProps) {
  // Build a map of panel key -> layout for O(1) lookup
  const value = useMemo<DashboardLayoutContextValue>(() => {
    const layouts = new Map<string, PanelLayout>();
    for (const item of items) {
      layouts.set(item.i, {
        w: item.w,
        h: item.h,
        x: item.x,
        y: item.y,
      });
    }
    return { layouts, cols };
  }, [items, cols]);

  return (
    <DashboardLayoutContext.Provider value={value}>
      {children}
    </DashboardLayoutContext.Provider>
  );
}

/**
 * Hook to get the current panel's layout from the dashboard grid
 *
 * @param panelKey - The unique key for this panel (e.g., "device-123")
 * @returns The panel's layout info, or null if not found
 */
export function usePanelLayout(panelKey: string): PanelLayout | null {
  const context = useContext(DashboardLayoutContext);
  if (!context) {
    // Not wrapped in DashboardLayoutProvider - return null
    return null;
  }
  return context.layouts.get(panelKey) ?? null;
}

/**
 * Hook to get the current grid column count
 *
 * @returns The number of columns in the current grid breakpoint
 */
export function useGridCols(): number {
  const context = useContext(DashboardLayoutContext);
  return context?.cols ?? 12; // Default to lg breakpoint
}

// Column count breakpoints for responsive panel layouts
// These map grid column counts to container breakpoints
export const COLUMN_BREAKPOINTS = {
  large: 4,    // >= 4 columns: show full UI with chart
  medium: 3,   // >= 3 columns: show readings + setters, no chart
  narrow: 2,   // >= 2 columns: show readings + toggle only
  // < 2 columns: very-narrow, readings wrap + toggle
} as const;

/**
 * Get container breakpoint from column count
 *
 * This replaces pixel-based breakpoints with column-based breakpoints
 * for grid-aligned responsive behavior.
 *
 * @param cols - The panel's column count (w)
 * @returns The container breakpoint name
 */
export function getBreakpointFromColumns(cols: number): 'large' | 'medium' | 'narrow' | 'very-narrow' {
  if (cols >= COLUMN_BREAKPOINTS.large) return 'large';
  if (cols >= COLUMN_BREAKPOINTS.medium) return 'medium';
  if (cols >= COLUMN_BREAKPOINTS.narrow) return 'narrow';
  return 'very-narrow';
}
