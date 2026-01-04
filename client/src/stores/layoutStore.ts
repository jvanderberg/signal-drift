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
const DEFAULT_PANEL_HEIGHT = 16;
const DEFAULT_PANEL_MIN_WIDTH = 4;
const DEFAULT_PANEL_MIN_HEIGHT = 10;

// Debounce delay for saving layouts (ms)
const SAVE_DEBOUNCE_MS = 1000;

// ============ Store State ============
interface LayoutStoreState {
  // Current layouts for each breakpoint
  layouts: Record<DashboardBreakpoint, DashboardLayoutItem[]>;

  // Loading state
  isLoading: boolean;
  isLoaded: boolean;

  // Actions
  setLayouts: (layouts: Record<DashboardBreakpoint, DashboardLayoutItem[]>) => void;
  updateLayout: (breakpoint: DashboardBreakpoint, layout: Layout) => void;
  addPanel: (key: string) => void;
  removePanel: (key: string) => void;
  hasPanel: (key: string) => boolean;
  resetLayout: () => void;
  clearLayoutFromServer: () => void;

  // Internal
  _saveDebounceTimer: ReturnType<typeof setTimeout> | null;
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
    _saveDebounceTimer: null,

    setLayouts: (layouts) => {
      set({ layouts, isLoaded: true });
    },

    updateLayout: (breakpoint, layout) => {
      const items = layout.map(layoutItemToDashboardItem);
      const currentItems = get().layouts[breakpoint];

      // Check if layout actually changed (compare JSON for deep equality)
      const currentJson = JSON.stringify(currentItems);
      const newJson = JSON.stringify(items);
      if (currentJson === newJson) {
        return; // No change, skip update
      }

      set((state) => ({
        layouts: {
          ...state.layouts,
          [breakpoint]: items,
        },
      }));

      // Debounced save to server
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
      if (hasPanel(key)) return;

      const newLayouts = generateResponsiveLayouts(key, layouts);
      set({ layouts: newLayouts });

      // Save immediately when adding a panel
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

      // Save immediately when removing a panel
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
      const msg = message as { type: string; layout?: DashboardLayoutData | null };

      if (msg.type === 'dashboardLayout') {
        if (msg.layout && msg.layout.layouts) {
          set({
            layouts: msg.layout.layouts,
            isLoading: false,
            isLoaded: true,
          });
        } else {
          // No saved layout, use empty
          set({
            layouts: createEmptyLayouts(),
            isLoading: false,
            isLoaded: true,
          });
        }
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
