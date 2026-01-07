/**
 * Page Visibility Hook
 *
 * Tracks browser tab visibility state using the Page Visibility API.
 * Provides:
 * - Current visibility state
 * - Time the page was last hidden (for stale detection)
 * - Callbacks for visibility changes
 */

import { useEffect, useState, useCallback, useRef } from 'react';

export interface PageVisibilityState {
  /** Whether the page is currently visible */
  isVisible: boolean;
  /** Timestamp when page was last hidden (null if never hidden) */
  lastHiddenAt: number | null;
  /** Timestamp when page became visible again (null if never was hidden) */
  lastVisibleAt: number | null;
  /** How long the page was hidden in the last hide/show cycle (ms) */
  lastHiddenDuration: number | null;
}

interface UsePageVisibilityOptions {
  /** Callback when page becomes hidden */
  onHide?: () => void;
  /** Callback when page becomes visible again */
  onShow?: (hiddenDuration: number) => void;
}

/**
 * Hook to track page visibility and hidden duration
 */
export function usePageVisibility(options: UsePageVisibilityOptions = {}): PageVisibilityState {
  const { onHide, onShow } = options;

  const [state, setState] = useState<PageVisibilityState>(() => ({
    isVisible: typeof document !== 'undefined' ? !document.hidden : true,
    lastHiddenAt: null,
    lastVisibleAt: null,
    lastHiddenDuration: null,
  }));

  // Use refs for callbacks to avoid effect dependencies
  const onHideRef = useRef(onHide);
  const onShowRef = useRef(onShow);
  onHideRef.current = onHide;
  onShowRef.current = onShow;

  useEffect(() => {
    function handleVisibilityChange(): void {
      const isVisible = !document.hidden;
      const now = Date.now();

      setState((prev) => {
        if (isVisible) {
          // Page became visible
          const hiddenDuration = prev.lastHiddenAt ? now - prev.lastHiddenAt : null;

          // Call onShow callback
          if (onShowRef.current && hiddenDuration !== null) {
            onShowRef.current(hiddenDuration);
          }

          return {
            isVisible: true,
            lastHiddenAt: prev.lastHiddenAt,
            lastVisibleAt: now,
            lastHiddenDuration: hiddenDuration,
          };
        } else {
          // Page became hidden
          if (onHideRef.current) {
            onHideRef.current();
          }

          return {
            isVisible: false,
            lastHiddenAt: now,
            lastVisibleAt: prev.lastVisibleAt,
            lastHiddenDuration: prev.lastHiddenDuration,
          };
        }
      });
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  return state;
}

/**
 * Singleton visibility tracker for non-React contexts
 * Used by websocket manager to filter stale messages
 */
interface VisibilityTracker {
  isVisible(): boolean;
  getLastHiddenAt(): number | null;
  getLastVisibleAt(): number | null;
  wasRecentlyHidden(withinMs: number): boolean;
  onVisibilityChange(callback: (isVisible: boolean, hiddenDuration: number | null) => void): () => void;
}

let trackerInstance: VisibilityTracker | null = null;
let trackerCleanup: (() => void) | null = null;

function createVisibilityTracker(): { tracker: VisibilityTracker; cleanup: () => void } {
  let lastHiddenAt: number | null = null;
  let lastVisibleAt: number | null = null;
  const callbacks = new Set<(isVisible: boolean, hiddenDuration: number | null) => void>();

  function handleVisibilityChange(): void {
    const isVisible = !document.hidden;
    const now = Date.now();

    if (isVisible) {
      const hiddenDuration = lastHiddenAt ? now - lastHiddenAt : null;
      lastVisibleAt = now;
      // Wrap callbacks in try-catch to prevent one failure from blocking others
      callbacks.forEach((cb) => {
        try {
          cb(true, hiddenDuration);
        } catch (err) {
          console.error('[VisibilityTracker] Callback error:', err);
        }
      });
    } else {
      lastHiddenAt = now;
      callbacks.forEach((cb) => {
        try {
          cb(false, null);
        } catch (err) {
          console.error('[VisibilityTracker] Callback error:', err);
        }
      });
    }
  }

  document.addEventListener('visibilitychange', handleVisibilityChange);

  const tracker: VisibilityTracker = {
    isVisible: () => !document.hidden,
    getLastHiddenAt: () => lastHiddenAt,
    getLastVisibleAt: () => lastVisibleAt,
    wasRecentlyHidden: (withinMs: number) => {
      if (!lastVisibleAt) return false;
      return Date.now() - lastVisibleAt < withinMs;
    },
    onVisibilityChange: (callback) => {
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },
  };

  const cleanup = (): void => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    callbacks.clear();
  };

  return { tracker, cleanup };
}

export function getVisibilityTracker(): VisibilityTracker {
  if (typeof document === 'undefined') {
    throw new Error('VisibilityTracker requires browser environment');
  }
  if (!trackerInstance) {
    const { tracker, cleanup } = createVisibilityTracker();
    trackerInstance = tracker;
    trackerCleanup = cleanup;
  }
  return trackerInstance;
}

// For testing - reset the singleton and clean up event listeners
export function resetVisibilityTracker(): void {
  if (trackerCleanup) {
    trackerCleanup();
    trackerCleanup = null;
  }
  trackerInstance = null;
}
