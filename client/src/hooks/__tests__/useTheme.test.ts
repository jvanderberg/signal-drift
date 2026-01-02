import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTheme } from '../useTheme';

describe('useTheme', () => {
  const STORAGE_KEY = 'lab-controller-theme';
  let originalMatchMedia: typeof window.matchMedia;

  // Mock matchMedia
  function createMatchMedia(matches: boolean) {
    const listeners: ((e: MediaQueryListEvent) => void)[] = [];
    return vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: (_: string, listener: (e: MediaQueryListEvent) => void) => {
        listeners.push(listener);
      },
      removeEventListener: (_: string, listener: (e: MediaQueryListEvent) => void) => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      },
      dispatchEvent: vi.fn(),
      // Helper to trigger change
      _triggerChange: (newMatches: boolean) => {
        listeners.forEach(l => l({ matches: newMatches } as MediaQueryListEvent));
      },
    }));
  }

  beforeEach(() => {
    // Clear localStorage
    localStorage.clear();
    // Save original matchMedia
    originalMatchMedia = window.matchMedia;
    // Reset document attributes
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    localStorage.clear();
  });

  describe('Initial state', () => {
    it('should default to system theme when no stored preference', () => {
      window.matchMedia = createMatchMedia(false);
      const { result } = renderHook(() => useTheme());

      expect(result.current.theme).toBe('system');
    });

    it('should use stored light theme from localStorage', () => {
      localStorage.setItem(STORAGE_KEY, 'light');
      window.matchMedia = createMatchMedia(false);
      const { result } = renderHook(() => useTheme());

      expect(result.current.theme).toBe('light');
    });

    it('should use stored dark theme from localStorage', () => {
      localStorage.setItem(STORAGE_KEY, 'dark');
      window.matchMedia = createMatchMedia(false);
      const { result } = renderHook(() => useTheme());

      expect(result.current.theme).toBe('dark');
    });

    it('should ignore invalid stored values', () => {
      localStorage.setItem(STORAGE_KEY, 'invalid');
      window.matchMedia = createMatchMedia(false);
      const { result } = renderHook(() => useTheme());

      expect(result.current.theme).toBe('system');
    });
  });

  describe('Resolved theme', () => {
    it('should resolve to light when theme is light', () => {
      localStorage.setItem(STORAGE_KEY, 'light');
      window.matchMedia = createMatchMedia(true); // system prefers dark
      const { result } = renderHook(() => useTheme());

      expect(result.current.resolvedTheme).toBe('light');
    });

    it('should resolve to dark when theme is dark', () => {
      localStorage.setItem(STORAGE_KEY, 'dark');
      window.matchMedia = createMatchMedia(false); // system prefers light
      const { result } = renderHook(() => useTheme());

      expect(result.current.resolvedTheme).toBe('dark');
    });

    it('should resolve to system preference when theme is system (dark)', () => {
      window.matchMedia = createMatchMedia(true); // system prefers dark
      const { result } = renderHook(() => useTheme());

      expect(result.current.resolvedTheme).toBe('dark');
    });

    it('should resolve to system preference when theme is system (light)', () => {
      window.matchMedia = createMatchMedia(false); // system prefers light
      const { result } = renderHook(() => useTheme());

      expect(result.current.resolvedTheme).toBe('light');
    });
  });

  describe('setTheme', () => {
    it('should update theme to light', () => {
      window.matchMedia = createMatchMedia(false);
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setTheme('light');
      });

      expect(result.current.theme).toBe('light');
      expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
    });

    it('should update theme to dark', () => {
      window.matchMedia = createMatchMedia(false);
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setTheme('dark');
      });

      expect(result.current.theme).toBe('dark');
      expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
    });

    it('should remove localStorage when set to system', () => {
      localStorage.setItem(STORAGE_KEY, 'light');
      window.matchMedia = createMatchMedia(false);
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setTheme('system');
      });

      expect(result.current.theme).toBe('system');
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
  });

  describe('System Preference Changes', () => {
    it('should update resolved theme when system preference changes', () => {
      let triggerChange: (newMatches: boolean) => void = () => {};
      const listeners: ((e: MediaQueryListEvent) => void)[] = [];

      window.matchMedia = vi.fn().mockImplementation(() => ({
        matches: false, // Start with light
        media: '(prefers-color-scheme: dark)',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: (_: string, listener: (e: MediaQueryListEvent) => void) => {
          listeners.push(listener);
        },
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      triggerChange = (newMatches: boolean) => {
        listeners.forEach(l => l({ matches: newMatches } as MediaQueryListEvent));
      };

      const { result } = renderHook(() => useTheme());

      // Initially system resolves to light
      expect(result.current.theme).toBe('system');
      expect(result.current.resolvedTheme).toBe('light');

      // Simulate system changing to dark mode
      act(() => {
        triggerChange(true);
      });

      expect(result.current.resolvedTheme).toBe('dark');
    });

    it('should not update resolved theme when preference changes but theme is manual', () => {
      const listeners: Set<(e: MediaQueryListEvent) => void> = new Set();

      window.matchMedia = vi.fn().mockImplementation(() => ({
        matches: false,
        media: '(prefers-color-scheme: dark)',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: (_: string, listener: (e: MediaQueryListEvent) => void) => {
          listeners.add(listener);
        },
        removeEventListener: (_: string, listener: (e: MediaQueryListEvent) => void) => {
          listeners.delete(listener);
        },
        dispatchEvent: vi.fn(),
      }));

      const { result } = renderHook(() => useTheme());

      // Set to manual light theme
      act(() => {
        result.current.setTheme('light');
      });

      expect(result.current.resolvedTheme).toBe('light');
      expect(result.current.theme).toBe('light');

      // Simulate system changing to dark - should have no effect on manual theme
      act(() => {
        listeners.forEach(l => l({ matches: true } as MediaQueryListEvent));
      });

      // Should still be light since we're using manual theme
      expect(result.current.resolvedTheme).toBe('light');
    });
  });

  describe('Document attribute', () => {
    it('should set data-theme attribute to light', () => {
      window.matchMedia = createMatchMedia(false);
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setTheme('light');
      });

      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });

    it('should set data-theme attribute to dark', () => {
      window.matchMedia = createMatchMedia(false);
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setTheme('dark');
      });

      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    it('should remove data-theme attribute for system', () => {
      window.matchMedia = createMatchMedia(false);
      document.documentElement.setAttribute('data-theme', 'light');
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setTheme('system');
      });

      expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    });
  });
});
