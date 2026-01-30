import { useState, useEffect, useRef } from 'react';

interface ContainerSize {
  width: number;
  height: number;
}

/**
 * Hook to track the size of a container element using ResizeObserver.
 * Returns a ref to attach to the container and the current size.
 */
export function useContainerSize<T extends HTMLElement = HTMLDivElement>(): [
  React.RefObject<T>,
  ContainerSize
] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<ContainerSize>({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Set initial size before observing to avoid race condition
    const rect = element.getBoundingClientRect();
    setSize({ width: rect.width, height: rect.height });

    const resizeObserver = new ResizeObserver((entries) => {
      // Only process the last entry to avoid multiple state updates
      const entry = entries[entries.length - 1];
      if (entry) {
        const { width, height } = entry.contentRect;
        setSize({ width, height });
      }
    });

    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  return [ref, size];
}

/**
 * Breakpoint sizes for responsive layouts (in pixels).
 * These are based on container width, not viewport width.
 */
export const CONTAINER_BREAKPOINTS = {
  /** Large: Full interface with chart */
  large: 600,
  /** Medium: No chart, but has setters/mode */
  medium: 400,
  /** Narrow: No setters/mode, just readings + toggle */
  narrow: 300,
  /** Below narrow: readings wrap */
} as const;

export type ContainerBreakpoint = 'large' | 'medium' | 'narrow' | 'very-narrow';

/**
 * Get the current breakpoint based on container width.
 */
export function getContainerBreakpoint(width: number): ContainerBreakpoint {
  if (width >= CONTAINER_BREAKPOINTS.large) return 'large';
  if (width >= CONTAINER_BREAKPOINTS.medium) return 'medium';
  if (width >= CONTAINER_BREAKPOINTS.narrow) return 'narrow';
  return 'very-narrow';
}
