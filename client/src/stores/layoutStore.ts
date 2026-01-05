/**
 * Zustand store for dashboard layout management
 *
 * Handles the draggable, resizable dashboard panel layouts with
 * persistence via WebSocket to the server database.
 *
 * Features:
 * - Responsive layouts for different screen sizes
 * - Debounced persistence to reduce save frequency
 * - Default layouts when no saved layout exists
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Layout, LayoutItem } from 'react-grid-layout/legacy';
import type { DashboardBreakpoint, DashboardLayoutData, DashboardLayoutItem } from '../../../shared/types';
import { getWebSocketManager } from '../websocket';

// Grid configuration
export const GRID_COLS: Record<DashboardBreakpoint, number> = {
  lg: 12,
  md: 10,
  sm: 6,
  xs: 4,
};

export const GRID_BREAKPOINTS: Record<DashboardBreakpoint, number> = {
  lg: 1200,
  md: 996,
  sm: 768,
  xs: 480,
};

// Default row height in pixels
export const ROW_HEIGHT = 30;

// Default panel dimensions (in grid units)
const DEFAULT_PANEL_WIDTH = 6;
const DEFAULT_PANEL_HEIGHT = 11;
const DEFAULT_PANEL_MIN_WIDTH = 4;
const DEFAULT_PANEL_MIN_HEIGHT = 5;

// Debounce delay for saving layouts (ms)
// Balances responsiveness with avoiding excessive server writes during rapid adjustments
const SAVE_DEBOUNCE_MS = 1000;

// Stabilization period after load (ms) - ignore automatic layout changes during this time
// This prevents react-grid-layout's initial onLayoutChange from overwriting saved positions.
// 500ms is enough for the grid to finish its initial render cycle.
const LAYOUT_STABILIZATION_MS = 500;

// ============ Store State ============
interface LayoutStoreState {
  // Current layouts for each breakpoint
  layouts: Record<DashboardBreakpoint, DashboardLayoutItem[]>;

  // Loading state
  isLoading: boolean;
  isLoaded: boolean;
  isStabilizing: boolean; // True during stabilization period after load

  // Actions
  setLayouts: (layouts: Record<DashboardBreakpoint, DashboardLayoutItem[]>) => void;
  /** Update layout for a breakpoint. isAutoLayoutChange=true means this came from
   *  react-grid-layout's onLayoutChange (automatic), not from explicit user interaction */
  updateLayout: (breakpoint: DashboardBreakpoint, layout: Layout, isAutoLayoutChange?: boolean) => void;
  updateSingleItem: (breakpoint: DashboardBreakpoint, item: LayoutItem) => void;
  saveLayoutDebounced: () => void;
  addPanel: (key: string) => void;
  removePanel: (key: string) => void;
  hasPanel: (key: string) => boolean;
  resetLayout: () => void;
  clearLayoutFromServer: () => void;

  // Internal
  _saveDebounceTimer: ReturnType<typeof setTimeout> | null;
  _stabilizationTimer: ReturnType<typeof setTimeout> | null;
  _loadFromServer: () => void;
  _saveToServer: () => void;
  _handleMessage: (message: unknown) => void;
}

// Convert react-grid-layout LayoutItem to our DashboardLayoutItem
function layoutItemToDashboardItem(item: LayoutItem): DashboardLayoutItem {
  return {
    i: item.i,
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
    minW: item.minW,
    minH: item.minH,
    maxW: item.maxW,
    maxH: item.maxH,
  };
}

// Shallow equality check for layout item (faster than JSON.stringify)
function layoutItemsEqual(a: DashboardLayoutItem, b: DashboardLayoutItem): boolean {
  return a.i === b.i && a.x === b.x && a.y === b.y &&
    a.w === b.w && a.h === b.h &&
    a.minW === b.minW && a.minH === b.minH &&
    a.maxW === b.maxW && a.maxH === b.maxH;
}

// Check if two layout arrays are equal
function layoutArraysEqual(a: DashboardLayoutItem[], b: DashboardLayoutItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!layoutItemsEqual(a[i], b[i])) return false;
  }
  return true;
}

// Create an empty layout structure
function createEmptyLayouts(): Record<DashboardBreakpoint, DashboardLayoutItem[]> {
  return {
    lg: [],
    md: [],
    sm: [],
    xs: [],
  };
}

// Generate responsive layouts for a new panel
function generateResponsiveLayouts(
  key: string,
  currentLayouts: Record<DashboardBreakpoint, DashboardLayoutItem[]>
): Record<DashboardBreakpoint, DashboardLayoutItem[]> {
  const result = { ...currentLayouts };

  for (const bp of Object.keys(GRID_COLS) as DashboardBreakpoint[]) {
    const existingItems = result[bp] || [];
    const cols = GRID_COLS[bp];

    // Calculate responsive width
    let width = DEFAULT_PANEL_WIDTH;
    if (bp === 'xs') width = cols; // Full width on mobile
    else if (bp === 'sm') width = cols; // Full width on tablet
    else if (bp === 'md') width = Math.min(DEFAULT_PANEL_WIDTH, cols);

    // Find next position
    let maxY = 0;
    for (const item of existingItems) {
      const itemBottom = item.y + item.h;
      if (itemBottom > maxY) maxY = itemBottom;
    }

    const numItems = existingItems.length;
    let x = 0;
    let y = maxY;

    // For larger screens, try 2-column layout
    if (bp === 'lg' || bp === 'md') {
      if (numItems % 2 === 1 && existingItems.length > 0) {
        // Place next to previous item if there's room
        const lastItem = existingItems[existingItems.length - 1];
        if (lastItem.x + lastItem.w + width <= cols) {
          x = lastItem.x + lastItem.w;
          y = lastItem.y;
        }
      }
    }

    result[bp] = [
      ...existingItems,
      {
        i: key,
        x,
        y,
        w: width,
        h: DEFAULT_PANEL_HEIGHT,
        minW: Math.min(DEFAULT_PANEL_MIN_WIDTH, cols),
        minH: DEFAULT_PANEL_MIN_HEIGHT,
      },
    ];
  }

  return result;
}

// Create store
export const useLayoutStore = create<LayoutStoreState>()(
  subscribeWithSelector((set, get) => ({
    layouts: createEmptyLayouts(),
    isLoading: false,
    isLoaded: false,
    isStabilizing: false,
    _saveDebounceTimer: null,
    _stabilizationTimer: null,

    setLayouts: (layouts) => {
      set({ layouts, isLoaded: true });
    },

    updateLayout: (breakpoint, layout, isAutoLayoutChange = true) => {
      // During stabilization, ignore automatic layout changes from react-grid-layout
      // to prevent overwriting saved positions with computed ones
      if (get().isStabilizing && isAutoLayoutChange) {
        return;
      }

      const incomingItems = layout.map(layoutItemToDashboardItem);
      const existingItems = get().layouts[breakpoint];

      // Build lookup structures
      const incomingItemKeys = new Set(incomingItems.map(item => item.i));
      const existingItemsByKey = new Map(existingItems.map(item => [item.i, item]));

      // Keep items that aren't in incoming layout (panels not currently rendered)
      const unrenderedPanels = existingItems.filter(item => !incomingItemKeys.has(item.i));

      // For each incoming item: use existing data for auto changes, new data for user changes
      const updatedItems = incomingItems.map(incomingItem => {
        const existingItem = existingItemsByKey.get(incomingItem.i);
        if (existingItem && isAutoLayoutChange) {
          // Auto change: keep saved position/size to prevent react-grid-layout
          // from overwriting our stored layout
          return existingItem;
        }
        return incomingItem;
      });

      const mergedItems = [...updatedItems, ...unrenderedPanels];

      // Skip update if nothing changed
      if (layoutArraysEqual(existingItems, mergedItems)) {
        return;
      }

      set((state) => ({
        layouts: {
          ...state.layouts,
          [breakpoint]: mergedItems,
        },
      }));
    },

    updateSingleItem: (breakpoint, item) => {
      const currentItems = get().layouts[breakpoint];
      const newItem = layoutItemToDashboardItem(item);

      // Immutably replace the item at its index
      const updatedItems = currentItems.map(existing =>
        existing.i === item.i ? newItem : existing
      );

      // Verify item was found and changed
      if (layoutArraysEqual(currentItems, updatedItems)) {
        return; // Item not found or unchanged
      }

      set((state) => ({
        layouts: {
          ...state.layouts,
          [breakpoint]: updatedItems,
        },
      }));
    },

    saveLayoutDebounced: () => {
      // Only save if layout has been loaded and stabilized
      if (!get().isLoaded || get().isStabilizing) {
        return;
      }

      // Clear existing timer and set new one
      const timer = get()._saveDebounceTimer;
      if (timer) {
        clearTimeout(timer);
      }
      const newTimer = setTimeout(() => {
        get()._saveToServer();
      }, SAVE_DEBOUNCE_MS);
      set({ _saveDebounceTimer: newTimer });
    },

    addPanel: (key) => {
      const { layouts, hasPanel } = get();
      if (hasPanel(key)) {
        return; // Panel already exists
      }

      const newLayouts = generateResponsiveLayouts(key, layouts);
      set({ layouts: newLayouts });
      get()._saveToServer();
    },

    removePanel: (key) => {
      set((state) => {
        const newLayouts = { ...state.layouts };
        for (const bp of Object.keys(newLayouts) as DashboardBreakpoint[]) {
          newLayouts[bp] = newLayouts[bp].filter((item) => item.i !== key);
        }
        return { layouts: newLayouts };
      });
      get()._saveToServer();
    },

    hasPanel: (key) => {
      const { layouts } = get();
      // Check all breakpoints since layouts might be inconsistent
      for (const bp of Object.keys(layouts) as DashboardBreakpoint[]) {
        if (layouts[bp].some((item) => item.i === key)) {
          return true;
        }
      }
      return false;
    },

    resetLayout: () => {
      set({ layouts: createEmptyLayouts() });
      get()._saveToServer();
    },

    clearLayoutFromServer: () => {
      set({ layouts: createEmptyLayouts(), isLoading: true });
      const wsManager = getWebSocketManager();
      wsManager.send({ type: 'dashboardLayoutClear' });
    },

    _loadFromServer: () => {
      set({ isLoading: true });
      const wsManager = getWebSocketManager();
      wsManager.send({ type: 'dashboardLayoutGet' });
    },

    _saveToServer: () => {
      const { layouts } = get();
      const wsManager = getWebSocketManager();
      const layoutData: DashboardLayoutData = { layouts };
      wsManager.send({ type: 'dashboardLayoutSave', layout: layoutData });
    },

    _handleMessage: (message: unknown) => {
      // Runtime validation of message structure
      if (!message || typeof message !== 'object' || !('type' in message)) {
        console.error('[LayoutStore] Invalid message format:', message);
        return;
      }
      const msg = message as { type: string; layout?: DashboardLayoutData | null };

      if (msg.type === 'dashboardLayout') {
        // Clear any existing stabilization timer
        const existingTimer = get()._stabilizationTimer;
        if (existingTimer) {
          clearTimeout(existingTimer);
        }

        // Apply layout from server or use empty if none saved
        const layouts = msg.layout?.layouts ?? createEmptyLayouts();
        set({
          layouts,
          isLoading: false,
          isLoaded: true,
          isStabilizing: true,
        });

        // End stabilization after delay - layout changes will be accepted after this
        const stabilizationTimer = setTimeout(() => {
          set({ isStabilizing: false, _stabilizationTimer: null });
        }, LAYOUT_STABILIZATION_MS);
        set({ _stabilizationTimer: stabilizationTimer });
      }
      // dashboardLayoutSaved - no action needed
    },
  }))
);

// Initialize WebSocket listener
let wsListenerInitialized = false;

export function initializeLayoutStore(): void {
  if (wsListenerInitialized) return;
  wsListenerInitialized = true;

  const wsManager = getWebSocketManager();
  const store = useLayoutStore.getState();

  // Listen for WebSocket messages
  wsManager.onMessage((message) => {
    if (message.type === 'dashboardLayout' || message.type === 'dashboardLayoutSaved') {
      store._handleMessage(message);
    }
  });

  // Load layout when connected
  wsManager.onStateChange((state) => {
    if (state === 'connected' && !useLayoutStore.getState().isLoaded) {
      store._loadFromServer();
    }
  });

  // If already connected, load now
  if (wsManager.getState() === 'connected') {
    store._loadFromServer();
  }
}

// ============ Selectors ============
export const selectLayouts = (state: LayoutStoreState) => state.layouts;
export const selectIsLayoutLoading = (state: LayoutStoreState) => state.isLoading;
export const selectIsLayoutLoaded = (state: LayoutStoreState) => state.isLoaded;
