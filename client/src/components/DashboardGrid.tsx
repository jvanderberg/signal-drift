/**
 * DashboardGrid - Responsive, draggable, resizable dashboard layout
 *
 * Uses react-grid-layout to provide a flexible dashboard where panels
 * can be dragged and resized. Layout is persisted to the database.
 */

import { useMemo, useCallback, useRef, useState, ReactNode, isValidElement } from 'react';
import { Responsive, WidthProvider, type Layout, type LayoutItem } from 'react-grid-layout/legacy';
import {
  useLayoutStore,
  selectLayouts,
  GRID_COLS,
  GRID_BREAKPOINTS,
  ROW_HEIGHT,
} from '../stores';
import type { DashboardBreakpoint } from '../../../shared/types';
import { DashboardLayoutProvider } from '../contexts/DashboardLayoutContext';

// Base styles from library, custom overrides in index.css
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
    <div className="flex-1 min-h-0 w-full overflow-hidden flex flex-col">
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
  const currentBreakpointRef = useRef<DashboardBreakpoint>('lg');
  const [currentBreakpoint, setCurrentBreakpoint] = useState<DashboardBreakpoint>('lg');

  // Track live resize state for WYSIWYG preview
  // This holds the grid-snapped dimensions during resize drag
  const [liveResizeItem, setLiveResizeItem] = useState<LayoutItem | null>(null);

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

  // Track breakpoint changes - update both ref (for callbacks) and state (for re-render)
  const handleBreakpointChange = useCallback((breakpoint: string) => {
    const bp = breakpoint as DashboardBreakpoint;
    currentBreakpointRef.current = bp;
    setCurrentBreakpoint(bp);
  }, []);

  // Handle resize in progress - update live state for WYSIWYG preview
  // The newItem contains grid-snapped w/h values even during drag
  const handleResize = useCallback(
    (_layout: Layout, _oldItem: LayoutItem | null, newItem: LayoutItem | null) => {
      setLiveResizeItem(newItem);
    },
    []
  );

  // Handle user interaction completion (drag or resize)
  // Updates only the specific item that changed and triggers debounced save
  const handleInteractionStop = useCallback(
    (_layout: Layout, _oldItem: LayoutItem | null, newItem: LayoutItem | null) => {
      // Clear live resize state
      setLiveResizeItem(null);

      if (newItem) {
        updateSingleItem(currentBreakpointRef.current, newItem);
        saveLayoutDebounced();
      }
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
        <div key={child.key} className="dashboard-panel h-full">
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

  // Get current layout items and column count for context provider
  // Merge in live resize state for WYSIWYG preview during drag
  const currentLayoutItems = useMemo(() => {
    const baseItems = layouts[currentBreakpoint];
    if (!liveResizeItem) return baseItems;

    // Replace the item being resized with its live dimensions
    return baseItems.map(item =>
      item.i === liveResizeItem.i
        ? { ...item, w: liveResizeItem.w, h: liveResizeItem.h }
        : item
    );
  }, [layouts, currentBreakpoint, liveResizeItem]);

  const currentCols = GRID_COLS[currentBreakpoint];

  return (
    <div className="dashboard-grid">
      <DashboardLayoutProvider items={currentLayoutItems} cols={currentCols}>
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
          onResize={handleResize}
          onDragStop={handleInteractionStop}
          onResizeStop={handleInteractionStop}
          draggableHandle=".panel-drag-handle"
          resizeHandles={['se', 'sw', 'ne', 'nw', 'e', 'w', 's', 'n']}
          useCSSTransforms={true}
          compactType={null}
          preventCollision={true}
        >
          {wrappedChildren}
        </ResponsiveGridLayout>
      </DashboardLayoutProvider>
    </div>
  );
}

// Export panel key generators
export function getDevicePanelKey(deviceId: string): string {
  return `device-${deviceId}`;
}

export function getOscilloscopePanelKey(deviceId: string): string {
  return `oscilloscope-${deviceId}`;
}

export function getSequencerPanelKey(): string {
  return 'sequencer';
}

export function getTriggerScriptsPanelKey(): string {
  return 'trigger-scripts';
}
