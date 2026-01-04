/**
 * DashboardGrid - Responsive, draggable, resizable dashboard layout
 *
 * Uses react-grid-layout to provide a flexible dashboard where panels
 * can be dragged and resized. Layout is persisted to the database.
 */

import { useMemo, useCallback, useRef, ReactNode } from 'react';
import { Responsive, WidthProvider, type Layout, type LayoutItem } from 'react-grid-layout/legacy';
import {
  useLayoutStore,
  selectLayouts,
  GRID_COLS,
  GRID_BREAKPOINTS,
  ROW_HEIGHT,
} from '../stores';
import type { DashboardBreakpoint } from '../../../shared/types';

// Import react-grid-layout styles
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const ResponsiveGridLayout = WidthProvider(Responsive);

interface DashboardGridProps {
  children: ReactNode;
}

// Panel wrapper component with consistent styling
interface PanelWrapperProps {
  children: ReactNode;
}

function PanelWrapper({ children }: PanelWrapperProps) {
  return (
    <div className="h-full w-full overflow-hidden">
      {children}
    </div>
  );
}

export function DashboardGrid({ children }: DashboardGridProps) {
  const layouts = useLayoutStore(selectLayouts);
  const updateLayout = useLayoutStore((state) => state.updateLayout);
  const updateSingleItem = useLayoutStore((state) => state.updateSingleItem);
  const saveLayoutDebounced = useLayoutStore((state) => state.saveLayoutDebounced);
  const currentBreakpoint = useRef<DashboardBreakpoint>('lg');

  // Convert our layout format to react-grid-layout format
  const gridLayouts = useMemo(() => {
    const result: Record<string, Layout> = {};
    for (const bp of Object.keys(layouts) as DashboardBreakpoint[]) {
      result[bp] = layouts[bp].map((item) => ({
        i: item.i,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        minW: item.minW,
        minH: item.minH,
        maxW: item.maxW,
        maxH: item.maxH,
      }));
    }
    return result;
  }, [layouts]);

  // Handle layout changes (drag/resize)
  const handleLayoutChange = useCallback(
    (_layout: Layout, allLayouts: Partial<Record<string, Layout>>) => {
      // Update all breakpoints from allLayouts to avoid race condition
      // with onBreakpointChange
      for (const bp of Object.keys(allLayouts) as DashboardBreakpoint[]) {
        const bpLayout = allLayouts[bp];
        if (bpLayout) {
          updateLayout(bp, bpLayout);
        }
      }
    },
    [updateLayout]
  );

  // Track breakpoint changes
  const handleBreakpointChange = useCallback((breakpoint: string) => {
    currentBreakpoint.current = breakpoint as DashboardBreakpoint;
  }, []);

  // Save layout after user interaction (drag or resize)
  // Only update the specific item that was changed, not the entire layout
  const handleDragStop = useCallback(
    (_layout: Layout, _oldItem: LayoutItem, newItem: LayoutItem) => {
      // Update only the dragged item's position
      updateSingleItem(currentBreakpoint.current, newItem);
      saveLayoutDebounced();
    },
    [updateSingleItem, saveLayoutDebounced]
  );

  const handleResizeStop = useCallback(
    (_layout: Layout, _oldItem: LayoutItem, newItem: LayoutItem) => {
      // Update only the resized item's size
      updateSingleItem(currentBreakpoint.current, newItem);
      saveLayoutDebounced();
    },
    [updateSingleItem, saveLayoutDebounced]
  );

  // Wrap children with panel wrappers and ensure they have keys
  const wrappedChildren = useMemo(() => {
    // Flatten children (handles nested arrays from .map() calls)
    const childArray = Array.isArray(children) ? children.flat(Infinity) : [children];
    return childArray
      .filter((child) => child != null && child !== false)
      .map((child) => {
        // Each child should have a React key for identification
        const key = (child as React.ReactElement).key;
        if (!key) {
          console.warn('DashboardGrid child missing key', child);
          return null;
        }
        return (
          <div key={key} className="dashboard-panel">
            <PanelWrapper>{child}</PanelWrapper>
          </div>
        );
      })
      .filter(Boolean);
  }, [children]);

  return (
    <div className="dashboard-grid">
      <ResponsiveGridLayout
        className="layout"
        layouts={gridLayouts}
        breakpoints={GRID_BREAKPOINTS}
        cols={GRID_COLS}
        rowHeight={ROW_HEIGHT}
        margin={[16, 16]}
        containerPadding={[0, 0]}
        onLayoutChange={handleLayoutChange}
        onBreakpointChange={handleBreakpointChange}
        onDragStop={handleDragStop}
        onResizeStop={handleResizeStop}
        draggableHandle=".panel-drag-handle"
        resizeHandles={['se', 'sw', 'ne', 'nw', 'e', 'w', 's', 'n']}
        useCSSTransforms={true}
        compactType="vertical"
        preventCollision={false}
      >
        {wrappedChildren}
      </ResponsiveGridLayout>
    </div>
  );
}

// Export panel key generators
export function getDevicePanelKey(deviceId: string): string {
  return `device-${deviceId}`;
}

export function getSequencerPanelKey(): string {
  return 'sequencer';
}

export function getTriggerScriptsPanelKey(): string {
  return 'trigger-scripts';
}
