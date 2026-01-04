import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import type { ServerMessage, DashboardLayoutData } from '../../../../shared/types';

// Mock state for WebSocket
const mockState = {
  send: vi.fn(),
  getState: vi.fn(() => 'disconnected'),
  messageHandlers: [] as ((msg: ServerMessage) => void)[],
  stateHandlers: [] as ((state: string) => void)[],
};

vi.mock('../../websocket', () => ({
  getWebSocketManager: () => ({
    send: (...args: unknown[]) => mockState.send(...args),
    getState: () => mockState.getState(),
    onMessage: (handler: (msg: ServerMessage) => void) => {
      mockState.messageHandlers.push(handler);
      return () => {
        mockState.messageHandlers = mockState.messageHandlers.filter(h => h !== handler);
      };
    },
    onStateChange: (handler: (state: string) => void) => {
      mockState.stateHandlers.push(handler);
      return () => {
        mockState.stateHandlers = mockState.stateHandlers.filter(h => h !== handler);
      };
    },
  }),
}));

// Import after mock is set up
import {
  useLayoutStore,
  initializeLayoutStore,
  selectLayouts,
  selectIsLayoutLoading,
  selectIsLayoutLoaded,
  GRID_COLS,
  GRID_BREAKPOINTS,
  ROW_HEIGHT,
} from '../layoutStore';

// Helper to simulate WebSocket messages
function simulateMessage(msg: ServerMessage) {
  mockState.messageHandlers.forEach(h => h(msg));
}

// Helper to simulate connection state changes
function simulateStateChange(state: string) {
  mockState.stateHandlers.forEach(h => h(state));
}

// Sample layout data for testing
const sampleLayoutData: DashboardLayoutData = {
  layouts: {
    lg: [
      { i: 'device-1', x: 0, y: 0, w: 6, h: 8, minW: 4, minH: 6 },
      { i: 'sequencer', x: 6, y: 0, w: 6, h: 8, minW: 4, minH: 6 },
    ],
    md: [
      { i: 'device-1', x: 0, y: 0, w: 10, h: 8 },
      { i: 'sequencer', x: 0, y: 8, w: 10, h: 8 },
    ],
    sm: [
      { i: 'device-1', x: 0, y: 0, w: 6, h: 8 },
      { i: 'sequencer', x: 0, y: 8, w: 6, h: 8 },
    ],
    xs: [
      { i: 'device-1', x: 0, y: 0, w: 4, h: 8 },
      { i: 'sequencer', x: 0, y: 8, w: 4, h: 8 },
    ],
  },
};

describe('layoutStore', () => {
  beforeAll(() => {
    // Initialize the store which sets up WebSocket listeners
    initializeLayoutStore();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Reset store state
    useLayoutStore.setState({
      layouts: {
        lg: [],
        md: [],
        sm: [],
        xs: [],
      },
      isLoading: false,
      isLoaded: false,
      _saveDebounceTimer: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    const timer = useLayoutStore.getState()._saveDebounceTimer;
    if (timer) {
      clearTimeout(timer);
    }
  });

  describe('Grid configuration constants', () => {
    it('should have correct column counts for each breakpoint', () => {
      expect(GRID_COLS.lg).toBe(12);
      expect(GRID_COLS.md).toBe(10);
      expect(GRID_COLS.sm).toBe(6);
      expect(GRID_COLS.xs).toBe(4);
    });

    it('should have correct breakpoint widths', () => {
      expect(GRID_BREAKPOINTS.lg).toBe(1200);
      expect(GRID_BREAKPOINTS.md).toBe(996);
      expect(GRID_BREAKPOINTS.sm).toBe(768);
      expect(GRID_BREAKPOINTS.xs).toBe(480);
    });

    it('should have correct row height', () => {
      expect(ROW_HEIGHT).toBe(30);
    });
  });

  describe('Initial state', () => {
    it('should have empty layouts initially', () => {
      const state = useLayoutStore.getState();
      expect(state.layouts.lg).toEqual([]);
      expect(state.layouts.md).toEqual([]);
      expect(state.layouts.sm).toEqual([]);
      expect(state.layouts.xs).toEqual([]);
    });

    it('should not be loaded initially', () => {
      const state = useLayoutStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.isLoaded).toBe(false);
    });
  });

  describe('setLayouts', () => {
    it('should update layouts and mark as loaded', () => {
      act(() => {
        useLayoutStore.getState().setLayouts(sampleLayoutData.layouts);
      });

      const state = useLayoutStore.getState();
      expect(state.layouts.lg).toHaveLength(2);
      expect(state.layouts.lg[0].i).toBe('device-1');
      expect(state.isLoaded).toBe(true);
    });
  });

  describe('updateLayout', () => {
    it('should update layout for specific breakpoint', () => {
      const newLayout = [
        { i: 'panel-1', x: 0, y: 0, w: 6, h: 8 },
      ];

      act(() => {
        useLayoutStore.getState().updateLayout('lg', newLayout);
      });

      const state = useLayoutStore.getState();
      expect(state.layouts.lg).toHaveLength(1);
      expect(state.layouts.lg[0].i).toBe('panel-1');
    });

    it('should not save to server before layout is loaded', () => {
      const newLayout = [{ i: 'panel-1', x: 0, y: 0, w: 6, h: 8 }];

      // isLoaded is false by default
      act(() => {
        useLayoutStore.getState().updateLayout('lg', newLayout);
      });

      // Advance time by debounce period
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      // Should not have saved because isLoaded is false
      expect(mockState.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'dashboardLayoutSave' }));
    });

    it('should debounce save to server', () => {
      const newLayout = [{ i: 'panel-1', x: 0, y: 0, w: 6, h: 8 }];

      // Set isLoaded to true so updateLayout will save
      act(() => {
        useLayoutStore.setState({ isLoaded: true });
        useLayoutStore.getState().updateLayout('lg', newLayout);
      });

      // Should not save immediately
      expect(mockState.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'dashboardLayoutSave' }));

      // Advance time by debounce period
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      // Now it should save
      expect(mockState.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'dashboardLayoutSave' }));
    });

    it('should reset debounce timer on multiple updates', () => {
      const layout1 = [{ i: 'panel-1', x: 0, y: 0, w: 6, h: 8 }];
      const layout2 = [{ i: 'panel-1', x: 1, y: 0, w: 6, h: 8 }];

      // Set isLoaded to true so updateLayout will save
      act(() => {
        useLayoutStore.setState({ isLoaded: true });
        useLayoutStore.getState().updateLayout('lg', layout1);
      });

      // Advance partial time
      act(() => {
        vi.advanceTimersByTime(500);
      });

      // Update again
      act(() => {
        useLayoutStore.getState().updateLayout('lg', layout2);
      });

      // Advance remaining time from first update
      act(() => {
        vi.advanceTimersByTime(500);
      });

      // Should not have saved yet (timer was reset)
      expect(mockState.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'dashboardLayoutSave' }));

      // Advance remaining time
      act(() => {
        vi.advanceTimersByTime(500);
      });

      // Now should save with the latest layout
      expect(mockState.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'dashboardLayoutSave' }));
    });
  });

  describe('addPanel', () => {
    it('should add new panel to all breakpoints', () => {
      act(() => {
        useLayoutStore.getState().addPanel('new-panel');
      });

      const state = useLayoutStore.getState();
      expect(state.layouts.lg.find(p => p.i === 'new-panel')).toBeDefined();
      expect(state.layouts.md.find(p => p.i === 'new-panel')).toBeDefined();
      expect(state.layouts.sm.find(p => p.i === 'new-panel')).toBeDefined();
      expect(state.layouts.xs.find(p => p.i === 'new-panel')).toBeDefined();
    });

    it('should not add duplicate panel', () => {
      act(() => {
        useLayoutStore.getState().addPanel('panel-1');
        useLayoutStore.getState().addPanel('panel-1');
      });

      const state = useLayoutStore.getState();
      const panels = state.layouts.lg.filter(p => p.i === 'panel-1');
      expect(panels).toHaveLength(1);
    });

    it('should save immediately after adding panel', () => {
      act(() => {
        useLayoutStore.getState().addPanel('new-panel');
      });

      expect(mockState.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'dashboardLayoutSave' }));
    });

    it('should use full width on mobile breakpoints', () => {
      act(() => {
        useLayoutStore.getState().addPanel('new-panel');
      });

      const state = useLayoutStore.getState();
      expect(state.layouts.xs.find(p => p.i === 'new-panel')?.w).toBe(GRID_COLS.xs);
      expect(state.layouts.sm.find(p => p.i === 'new-panel')?.w).toBe(GRID_COLS.sm);
    });
  });

  describe('removePanel', () => {
    beforeEach(() => {
      // Set up initial state with panels
      useLayoutStore.setState({
        layouts: sampleLayoutData.layouts,
        isLoaded: true,
        isLoading: false,
        _saveDebounceTimer: null,
      });
    });

    it('should remove panel from all breakpoints', () => {
      act(() => {
        useLayoutStore.getState().removePanel('device-1');
      });

      const state = useLayoutStore.getState();
      expect(state.layouts.lg.find(p => p.i === 'device-1')).toBeUndefined();
      expect(state.layouts.md.find(p => p.i === 'device-1')).toBeUndefined();
      expect(state.layouts.sm.find(p => p.i === 'device-1')).toBeUndefined();
      expect(state.layouts.xs.find(p => p.i === 'device-1')).toBeUndefined();
    });

    it('should keep other panels when removing', () => {
      act(() => {
        useLayoutStore.getState().removePanel('device-1');
      });

      const state = useLayoutStore.getState();
      expect(state.layouts.lg.find(p => p.i === 'sequencer')).toBeDefined();
    });

    it('should save immediately after removing panel', () => {
      act(() => {
        useLayoutStore.getState().removePanel('device-1');
      });

      expect(mockState.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'dashboardLayoutSave' }));
    });
  });

  describe('hasPanel', () => {
    beforeEach(() => {
      useLayoutStore.setState({
        layouts: sampleLayoutData.layouts,
        isLoaded: true,
        isLoading: false,
        _saveDebounceTimer: null,
      });
    });

    it('should return true for existing panel', () => {
      expect(useLayoutStore.getState().hasPanel('device-1')).toBe(true);
    });

    it('should return false for non-existing panel', () => {
      expect(useLayoutStore.getState().hasPanel('non-existent')).toBe(false);
    });
  });

  describe('resetLayout', () => {
    beforeEach(() => {
      useLayoutStore.setState({
        layouts: sampleLayoutData.layouts,
        isLoaded: true,
        isLoading: false,
        _saveDebounceTimer: null,
      });
    });

    it('should clear all layouts', () => {
      act(() => {
        useLayoutStore.getState().resetLayout();
      });

      const state = useLayoutStore.getState();
      expect(state.layouts.lg).toEqual([]);
      expect(state.layouts.md).toEqual([]);
      expect(state.layouts.sm).toEqual([]);
      expect(state.layouts.xs).toEqual([]);
    });

    it('should save immediately after reset', () => {
      act(() => {
        useLayoutStore.getState().resetLayout();
      });

      expect(mockState.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'dashboardLayoutSave' }));
    });
  });

  describe('WebSocket message handling', () => {
    describe('dashboardLayout message', () => {
      it('should load layout from server message', () => {
        act(() => {
          simulateMessage({
            type: 'dashboardLayout',
            layout: sampleLayoutData,
          } as ServerMessage);
        });

        const state = useLayoutStore.getState();
        expect(state.layouts.lg).toHaveLength(2);
        expect(state.isLoaded).toBe(true);
        expect(state.isLoading).toBe(false);
      });

      it('should handle null layout (no saved layout)', () => {
        act(() => {
          simulateMessage({
            type: 'dashboardLayout',
            layout: null,
          } as ServerMessage);
        });

        const state = useLayoutStore.getState();
        expect(state.layouts.lg).toEqual([]);
        expect(state.isLoaded).toBe(true);
        expect(state.isLoading).toBe(false);
      });
    });

    describe('connection state handling', () => {
      it('should request layout when connected and not loaded', () => {
        mockState.getState.mockReturnValue('connected');
        useLayoutStore.setState({ isLoaded: false });

        act(() => {
          simulateStateChange('connected');
        });

        expect(mockState.send).toHaveBeenCalledWith({ type: 'dashboardLayoutGet' });
      });
    });
  });

  describe('Selectors', () => {
    beforeEach(() => {
      useLayoutStore.setState({
        layouts: sampleLayoutData.layouts,
        isLoading: true,
        isLoaded: true,
        _saveDebounceTimer: null,
      });
    });

    it('selectLayouts should return layouts', () => {
      const layouts = selectLayouts(useLayoutStore.getState());
      expect(layouts.lg).toHaveLength(2);
    });

    it('selectIsLayoutLoading should return loading state', () => {
      expect(selectIsLayoutLoading(useLayoutStore.getState())).toBe(true);
    });

    it('selectIsLayoutLoaded should return loaded state', () => {
      expect(selectIsLayoutLoaded(useLayoutStore.getState())).toBe(true);
    });
  });

  describe('Multiple panels', () => {
    it('should position panels correctly when adding multiple', () => {
      act(() => {
        useLayoutStore.getState().addPanel('panel-1');
        useLayoutStore.getState().addPanel('panel-2');
        useLayoutStore.getState().addPanel('panel-3');
      });

      const state = useLayoutStore.getState();
      expect(state.layouts.lg).toHaveLength(3);

      // All panels should exist
      expect(state.layouts.lg.find(p => p.i === 'panel-1')).toBeDefined();
      expect(state.layouts.lg.find(p => p.i === 'panel-2')).toBeDefined();
      expect(state.layouts.lg.find(p => p.i === 'panel-3')).toBeDefined();
    });
  });
});
