/**
 * DashboardGrid - Responsive, draggable, resizable dashboard layout
 *
 * Uses react-grid-layout to provide a flexible dashboard where panels
 * can be dragged and resized. Layout is persisted to the database.
 */

import { useMemo, useCallback, useRef, ReactNode, isValidElement } from 'react';
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
  const isLoading = useLayoutStore((state) => state.isLoading);
  const isStabilizing = useLayoutStore((state) => state.isStabilizing);
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

  // Handle user interaction completion (drag or resize)
  // Updates only the specific item that changed and triggers debounced save
  const handleInteractionStop = useCallback(
    (_layout: Layout, _oldItem: LayoutItem, newItem: LayoutItem) => {
      updateSingleItem(currentBreakpoint.current, newItem);
      saveLayoutDebounced();
    },
    [updateSingleItem, saveLayoutDebounced]
  );

  // Wrap children with panel wrappers and ensure they have keys
  const wrappedChildren = useMemo(() => {
    // Flatten children (handles nested arrays from .map() calls, max 2 levels deep)
    const childArray = Array.isArray(children) ? children.flat(2) : [children];
    return childArray
      .filter((child): child is React.ReactElement =>
        isValidElement(child) && child.key != null
      )
      .map((child) => (
        <div key={child.key} className="dashboard-panel">
          <PanelWrapper>{child}</PanelWrapper>
        </div>
      ));
  }, [children]);

  // Don't render grid until layout is loaded and stabilized.
  // react-grid-layout caches its internal layout state on mount. If we mount before
  // the saved layout is loaded, it will use computed defaults. Waiting ensures the
  // grid mounts fresh with correct saved sizes, avoiding a flash of wrong sizes.
  if (isLoading || isStabilizing) {
    return (
      <div className="dashboard-grid">
        <div className="flex items-center justify-center h-32 text-[var(--color-text-secondary)]">
          Loading layout...
        </div>
      </div>
    );
  }

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
        onDragStop={handleInteractionStop}
        onResizeStop={handleInteractionStop}
        draggableHandle=".panel-drag-handle"
        resizeHandles={['se', 'sw', 'ne', 'nw', 'e', 'w', 's', 'n']}
        useCSSTransforms={true}
        compactType={null}
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
