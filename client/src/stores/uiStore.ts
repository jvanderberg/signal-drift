/**
 * Zustand store for UI state management
 *
 * Handles toasts, theme, device names, and other UI-related state.
 * Replaces useToast, useTheme, and useDeviceNames hooks.
 *
 * Key benefit: Device name changes propagate instantly to all components
 * since they all subscribe to the same store.
 */

import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';

// ============ Toast Types ============
export interface Toast {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
}

// ============ Theme Types ============
type Theme = 'light' | 'dark' | 'system';

// ============ Device Names Types ============
interface DeviceCustomName {
  title: string;
  subtitle: string;
}

// Helper to generate device key
export function getDeviceKey(manufacturer: string, model: string): string {
  return `${manufacturer.toLowerCase()}-${model.toLowerCase()}`;
}

// Helper to resolve theme
function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

// ============ Store State ============
interface UIStoreState {
  // Toasts
  toasts: Toast[];
  _toastId: number;
  addToast: (type: Toast['type'], message: string, duration?: number) => number;
  removeToast: (id: number) => void;
  success: (message: string, duration?: number) => number;
  error: (message: string, duration?: number) => number;
  info: (message: string, duration?: number) => number;

  // Theme
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
  _initTheme: () => void;

  // Device Names - all components share this state
  deviceNames: Record<string, DeviceCustomName>;
  getCustomName: (manufacturer: string, model: string) => DeviceCustomName | null;
  setCustomName: (manufacturer: string, model: string, title: string, subtitle: string) => void;
  resetCustomName: (manufacturer: string, model: string) => void;
  hasCustomName: (manufacturer: string, model: string) => boolean;
}

// Flag to prevent duplicate theme listener registration
let themeListenerInitialized = false;

// Create store with persistence for theme and device names
export const useUIStore = create<UIStoreState>()(
  persist(
    subscribeWithSelector((set, get) => ({
      // ============ Toast State & Actions ============
      toasts: [],
      _toastId: 0,

      addToast: (type, message, duration = 3000) => {
        const id = get()._toastId + 1;
        set((state) => ({
          _toastId: id,
          toasts: [...state.toasts, { id, type, message }],
        }));

        setTimeout(() => {
          set((state) => ({
            toasts: state.toasts.filter((t) => t.id !== id),
          }));
        }, duration);

        return id;
      },

      removeToast: (id) => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      },

      success: (message, duration) => get().addToast('success', message, duration),
      error: (message, duration) => get().addToast('error', message, duration),
      info: (message, duration) => get().addToast('info', message, duration),

      // ============ Theme State & Actions ============
      theme: 'system',
      resolvedTheme: 'light',

      setTheme: (theme) => {
        const resolved = resolveTheme(theme);
        set({ theme, resolvedTheme: resolved });

        // Apply to document
        if (theme === 'system') {
          document.documentElement.removeAttribute('data-theme');
        } else {
          document.documentElement.setAttribute('data-theme', theme);
        }
      },

      _initTheme: () => {
        const { theme } = get();
        const resolved = resolveTheme(theme);
        set({ resolvedTheme: resolved });

        // Apply to document
        if (theme === 'system') {
          document.documentElement.removeAttribute('data-theme');
        } else {
          document.documentElement.setAttribute('data-theme', theme);
        }

        // Listen for system theme changes (only register once)
        if (!themeListenerInitialized) {
          themeListenerInitialized = true;
          const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
          mediaQuery.addEventListener('change', (e: MediaQueryListEvent) => {
            if (get().theme === 'system') {
              set({ resolvedTheme: e.matches ? 'dark' : 'light' });
            }
          });
        }
      },

      // ============ Device Names State & Actions ============
      deviceNames: {},

      getCustomName: (manufacturer, model) => {
        const key = getDeviceKey(manufacturer, model);
        return get().deviceNames[key] ?? null;
      },

      setCustomName: (manufacturer, model, title, subtitle) => {
        const key = getDeviceKey(manufacturer, model);
        set((state) => ({
          deviceNames: {
            ...state.deviceNames,
            [key]: { title, subtitle },
          },
        }));
      },

      resetCustomName: (manufacturer, model) => {
        const key = getDeviceKey(manufacturer, model);
        set((state) => {
          const updated = { ...state.deviceNames };
          delete updated[key];
          return { deviceNames: updated };
        });
      },

      hasCustomName: (manufacturer, model) => {
        const key = getDeviceKey(manufacturer, model);
        return key in get().deviceNames;
      },
    })),
    {
      name: 'lab-controller-ui',
      partialize: (state) => ({
        theme: state.theme,
        deviceNames: state.deviceNames,
      }),
      onRehydrateStorage: () => (state) => {
        // Initialize theme after rehydration
        if (state) {
          state._initTheme();
        }
      },
    }
  )
);

// ============ Selectors ============
export const selectToasts = (state: UIStoreState) => state.toasts;
export const selectTheme = (state: UIStoreState) => state.theme;
export const selectResolvedTheme = (state: UIStoreState) => state.resolvedTheme;
export const selectDeviceNames = (state: UIStoreState) => state.deviceNames;
