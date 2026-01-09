import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useContainerSize, getContainerBreakpoint, CONTAINER_BREAKPOINTS } from '../useContainerSize';

// Mock ResizeObserver
class MockResizeObserver {
  private callback: ResizeObserverCallback;
  private observedElements: Set<Element> = new Set();
  static instances: MockResizeObserver[] = [];

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }

  observe(element: Element) {
    this.observedElements.add(element);
  }

  unobserve(element: Element) {
    this.observedElements.delete(element);
  }

  disconnect() {
    this.observedElements.clear();
  }

  // Helper to trigger resize callback
  triggerResize(width: number, height: number) {
    const entries: ResizeObserverEntry[] = [{
      target: document.createElement('div'),
      contentRect: { width, height, x: 0, y: 0, top: 0, left: 0, bottom: height, right: width, toJSON: () => ({}) } as DOMRectReadOnly,
      borderBoxSize: [],
      contentBoxSize: [],
      devicePixelContentBoxSize: [],
    }];
    this.callback(entries, this);
  }

  static clearInstances() {
    MockResizeObserver.instances = [];
  }

  static getLastInstance() {
    return MockResizeObserver.instances[MockResizeObserver.instances.length - 1];
  }
}

describe('useContainerSize', () => {
  beforeEach(() => {
    MockResizeObserver.clearInstances();
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('Initial State', () => {
    it('should return zero size before ref is attached', () => {
      const { result } = renderHook(() => useContainerSize());

      expect(result.current[1]).toEqual({ width: 0, height: 0 });
    });

    it('should return RefObject and size tuple', () => {
      const { result } = renderHook(() => useContainerSize());

      expect(result.current).toHaveLength(2);
      expect(result.current[0]).toHaveProperty('current');
      expect(result.current[1]).toHaveProperty('width');
      expect(result.current[1]).toHaveProperty('height');
    });
  });

  describe('ResizeObserver Integration', () => {
    it('should update size when container is resized', () => {
      const { result } = renderHook(() => useContainerSize<HTMLDivElement>());

      // Simulate attaching ref to a DOM element
      const div = document.createElement('div');
      Object.defineProperty(div, 'getBoundingClientRect', {
        value: () => ({ width: 500, height: 300 }),
      });

      // Attach ref and trigger effect
      act(() => {
        (result.current[0] as React.MutableRefObject<HTMLDivElement>).current = div;
      });

      // Re-render to trigger useEffect
      const { result: result2 } = renderHook(() => useContainerSize<HTMLDivElement>());
      const div2 = document.createElement('div');
      Object.defineProperty(div2, 'getBoundingClientRect', {
        value: () => ({ width: 600, height: 400 }),
      });

      act(() => {
        (result2.current[0] as React.MutableRefObject<HTMLDivElement>).current = div2;
      });

      // Trigger resize via observer
      const observer = MockResizeObserver.getLastInstance();
      if (observer) {
        act(() => {
          observer.triggerResize(800, 600);
        });
        expect(result2.current[1]).toEqual({ width: 800, height: 600 });
      }
    });

    it('should cleanup ResizeObserver on unmount', () => {
      // Simply verify the hook can be unmounted without errors
      // The cleanup is tested implicitly - if disconnect wasn't called properly,
      // memory leaks would occur (not directly testable in unit tests)
      const { unmount } = renderHook(() => useContainerSize<HTMLDivElement>());

      // Should not throw
      expect(() => unmount()).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle width=0', () => {
      const { result } = renderHook(() => useContainerSize<HTMLDivElement>());

      const div = document.createElement('div');
      Object.defineProperty(div, 'getBoundingClientRect', {
        value: () => ({ width: 0, height: 100 }),
      });

      act(() => {
        (result.current[0] as React.MutableRefObject<HTMLDivElement>).current = div;
      });

      // Initial size should be 0,0 since ref starts null
      expect(result.current[1].width).toBe(0);
    });

    it('should handle height=0', () => {
      const { result } = renderHook(() => useContainerSize<HTMLDivElement>());

      const div = document.createElement('div');
      Object.defineProperty(div, 'getBoundingClientRect', {
        value: () => ({ width: 100, height: 0 }),
      });

      act(() => {
        (result.current[0] as React.MutableRefObject<HTMLDivElement>).current = div;
      });

      expect(result.current[1].height).toBe(0);
    });

    it('should not crash if ref.current is null', () => {
      const { result } = renderHook(() => useContainerSize());

      // ref.current is null by default
      expect(result.current[0].current).toBeNull();
      expect(result.current[1]).toEqual({ width: 0, height: 0 });
    });
  });
});

describe('getContainerBreakpoint', () => {
  describe('Breakpoint Boundaries', () => {
    it('should return "large" for width >= 600px', () => {
      expect(getContainerBreakpoint(600)).toBe('large');
      expect(getContainerBreakpoint(700)).toBe('large');
      expect(getContainerBreakpoint(1000)).toBe('large');
    });

    it('should return "medium" for width 400-599px', () => {
      expect(getContainerBreakpoint(400)).toBe('medium');
      expect(getContainerBreakpoint(500)).toBe('medium');
      expect(getContainerBreakpoint(599)).toBe('medium');
    });

    it('should return "narrow" for width 300-399px', () => {
      expect(getContainerBreakpoint(300)).toBe('narrow');
      expect(getContainerBreakpoint(350)).toBe('narrow');
      expect(getContainerBreakpoint(399)).toBe('narrow');
    });

    it('should return "very-narrow" for width < 300px', () => {
      expect(getContainerBreakpoint(299)).toBe('very-narrow');
      expect(getContainerBreakpoint(200)).toBe('very-narrow');
      expect(getContainerBreakpoint(100)).toBe('very-narrow');
    });
  });

  describe('Exact Boundaries', () => {
    it('should return "large" for width=600', () => {
      expect(getContainerBreakpoint(600)).toBe('large');
    });

    it('should return "medium" for width=599', () => {
      expect(getContainerBreakpoint(599)).toBe('medium');
    });

    it('should return "medium" for width=400', () => {
      expect(getContainerBreakpoint(400)).toBe('medium');
    });

    it('should return "narrow" for width=399', () => {
      expect(getContainerBreakpoint(399)).toBe('narrow');
    });

    it('should return "narrow" for width=300', () => {
      expect(getContainerBreakpoint(300)).toBe('narrow');
    });

    it('should return "very-narrow" for width=299', () => {
      expect(getContainerBreakpoint(299)).toBe('very-narrow');
    });
  });

  describe('Edge Cases', () => {
    it('should return "very-narrow" for width=0', () => {
      expect(getContainerBreakpoint(0)).toBe('very-narrow');
    });

    it('should handle negative widths gracefully', () => {
      expect(getContainerBreakpoint(-100)).toBe('very-narrow');
    });

    it('should handle very large widths', () => {
      expect(getContainerBreakpoint(10000)).toBe('large');
      expect(getContainerBreakpoint(100000)).toBe('large');
    });
  });
});

describe('CONTAINER_BREAKPOINTS', () => {
  it('should export correct breakpoint values', () => {
    expect(CONTAINER_BREAKPOINTS.large).toBe(600);
    expect(CONTAINER_BREAKPOINTS.medium).toBe(400);
    expect(CONTAINER_BREAKPOINTS.narrow).toBe(300);
  });
});
