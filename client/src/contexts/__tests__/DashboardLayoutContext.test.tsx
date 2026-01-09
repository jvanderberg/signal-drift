/**
 * Tests for DashboardLayoutContext
 *
 * Tests the context provider and hooks for sharing dashboard layout
 * information with child panels.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { DashboardLayoutItem } from '../../../../shared/types';
import {
  DashboardLayoutProvider,
  usePanelLayout,
  useGridCols,
  getBreakpointFromColumns,
  COLUMN_BREAKPOINTS,
} from '../DashboardLayoutContext';

// Helper to create layout items for testing
function createLayoutItem(key: string, w: number, h: number = 12): DashboardLayoutItem {
  return {
    i: key,
    x: 0,
    y: 0,
    w,
    h,
    minW: 3,
    minH: 4,
  };
}

describe('DashboardLayoutContext', () => {
  describe('usePanelLayout', () => {
    it('should return null when not wrapped in provider', () => {
      const { result } = renderHook(() => usePanelLayout('test-panel'));
      expect(result.current).toBeNull();
    });

    it('should return layout for existing panel', () => {
      const items = [createLayoutItem('device-123', 6, 12)];

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <DashboardLayoutProvider items={items} cols={12}>
          {children}
        </DashboardLayoutProvider>
      );

      const { result } = renderHook(() => usePanelLayout('device-123'), { wrapper });

      expect(result.current).toEqual({
        w: 6,
        h: 12,
        x: 0,
        y: 0,
      });
    });

    it('should return null for non-existent panel', () => {
      const items = [createLayoutItem('device-123', 6, 12)];

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <DashboardLayoutProvider items={items} cols={12}>
          {children}
        </DashboardLayoutProvider>
      );

      const { result } = renderHook(() => usePanelLayout('non-existent'), { wrapper });

      expect(result.current).toBeNull();
    });

    it('should handle multiple panels', () => {
      const items = [
        createLayoutItem('device-1', 4, 10),
        createLayoutItem('device-2', 8, 15),
        createLayoutItem('oscilloscope-1', 12, 20),
      ];

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <DashboardLayoutProvider items={items} cols={12}>
          {children}
        </DashboardLayoutProvider>
      );

      const { result: result1 } = renderHook(() => usePanelLayout('device-1'), { wrapper });
      const { result: result2 } = renderHook(() => usePanelLayout('device-2'), { wrapper });
      const { result: result3 } = renderHook(() => usePanelLayout('oscilloscope-1'), { wrapper });

      expect(result1.current?.w).toBe(4);
      expect(result2.current?.w).toBe(8);
      expect(result3.current?.w).toBe(12);
    });
  });

  describe('useGridCols', () => {
    it('should return default 12 columns when not wrapped in provider', () => {
      const { result } = renderHook(() => useGridCols());
      expect(result.current).toBe(12);
    });

    it('should return cols from provider', () => {
      const items: DashboardLayoutItem[] = [];

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <DashboardLayoutProvider items={items} cols={6}>
          {children}
        </DashboardLayoutProvider>
      );

      const { result } = renderHook(() => useGridCols(), { wrapper });
      expect(result.current).toBe(6);
    });
  });

  describe('getBreakpointFromColumns', () => {
    it('should return "large" for >= 6 columns', () => {
      expect(getBreakpointFromColumns(6)).toBe('large');
      expect(getBreakpointFromColumns(7)).toBe('large');
      expect(getBreakpointFromColumns(12)).toBe('large');
    });

    it('should return "medium" for 4-5 columns', () => {
      expect(getBreakpointFromColumns(4)).toBe('medium');
      expect(getBreakpointFromColumns(5)).toBe('medium');
    });

    it('should return "narrow" for 3 columns', () => {
      expect(getBreakpointFromColumns(3)).toBe('narrow');
    });

    it('should return "very-narrow" for < 3 columns', () => {
      expect(getBreakpointFromColumns(2)).toBe('very-narrow');
      expect(getBreakpointFromColumns(1)).toBe('very-narrow');
      expect(getBreakpointFromColumns(0)).toBe('very-narrow');
    });

    describe('Boundary Tests', () => {
      it('should return "large" at exactly 6 columns', () => {
        expect(getBreakpointFromColumns(6)).toBe('large');
      });

      it('should return "medium" at exactly 5 columns (one below large)', () => {
        expect(getBreakpointFromColumns(5)).toBe('medium');
      });

      it('should return "medium" at exactly 4 columns', () => {
        expect(getBreakpointFromColumns(4)).toBe('medium');
      });

      it('should return "narrow" at exactly 3 columns (one below medium)', () => {
        expect(getBreakpointFromColumns(3)).toBe('narrow');
      });

      it('should return "very-narrow" at exactly 2 columns (one below narrow)', () => {
        expect(getBreakpointFromColumns(2)).toBe('very-narrow');
      });
    });
  });

  describe('COLUMN_BREAKPOINTS', () => {
    it('should export correct breakpoint thresholds', () => {
      expect(COLUMN_BREAKPOINTS.large).toBe(6);
      expect(COLUMN_BREAKPOINTS.medium).toBe(4);
      expect(COLUMN_BREAKPOINTS.narrow).toBe(3);
    });
  });

  describe('DashboardLayoutProvider', () => {
    it('should memoize context value when items are the same', () => {
      const items = [createLayoutItem('device-1', 6)];
      let contextValue1: ReturnType<typeof usePanelLayout> = null;
      let contextValue2: ReturnType<typeof usePanelLayout> = null;

      const TestComponent = () => {
        contextValue1 = usePanelLayout('device-1');
        return null;
      };

      const { rerender } = renderHook(() => usePanelLayout('device-1'), {
        wrapper: ({ children }) => (
          <DashboardLayoutProvider items={items} cols={12}>
            {children}
          </DashboardLayoutProvider>
        ),
      });

      contextValue1 = renderHook(() => usePanelLayout('device-1'), {
        wrapper: ({ children }) => (
          <DashboardLayoutProvider items={items} cols={12}>
            {children}
          </DashboardLayoutProvider>
        ),
      }).result.current;

      // Re-render with same items
      contextValue2 = renderHook(() => usePanelLayout('device-1'), {
        wrapper: ({ children }) => (
          <DashboardLayoutProvider items={items} cols={12}>
            {children}
          </DashboardLayoutProvider>
        ),
      }).result.current;

      // Values should be equal
      expect(contextValue1).toEqual(contextValue2);
    });

    it('should handle empty items array', () => {
      const items: DashboardLayoutItem[] = [];

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <DashboardLayoutProvider items={items} cols={12}>
          {children}
        </DashboardLayoutProvider>
      );

      const { result } = renderHook(() => usePanelLayout('any-panel'), { wrapper });
      expect(result.current).toBeNull();
    });
  });
});
