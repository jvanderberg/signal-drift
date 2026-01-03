import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import { useUIStore, getDeviceKey } from '../uiStore';

describe('uiStore', () => {
  // Storage key for reference (used implicitly by the store)
  const _STORAGE_KEY = 'lab-controller-ui';
  void _STORAGE_KEY; // Mark as intentionally unused

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    // Reset store state
    useUIStore.setState({
      toasts: [],
      _toastId: 0,
      theme: 'system',
      resolvedTheme: 'light',
      deviceNames: {},
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  describe('getDeviceKey', () => {
    it('should create lowercase key from manufacturer and model', () => {
      expect(getDeviceKey('Rigol', 'DS1054Z')).toBe('rigol-ds1054z');
    });

    it('should handle already lowercase input', () => {
      expect(getDeviceKey('siglent', 'spd3303x')).toBe('siglent-spd3303x');
    });
  });

  describe('Toast functionality', () => {
    describe('addToast', () => {
      it('should add a toast to the array', () => {
        const store = useUIStore.getState();

        act(() => {
          store.addToast('success', 'Test message');
        });

        expect(useUIStore.getState().toasts).toHaveLength(1);
        expect(useUIStore.getState().toasts[0].type).toBe('success');
        expect(useUIStore.getState().toasts[0].message).toBe('Test message');
      });

      it('should return a unique id', () => {
        const store = useUIStore.getState();

        let id1: number, id2: number;
        act(() => {
          id1 = store.addToast('success', 'Message 1');
          id2 = store.addToast('error', 'Message 2');
        });

        expect(id1!).toBeDefined();
        expect(id2!).toBeDefined();
        expect(id1!).not.toBe(id2!);
      });

      it('should auto-remove toast after default duration', () => {
        const store = useUIStore.getState();

        act(() => {
          store.addToast('success', 'Test message');
        });

        expect(useUIStore.getState().toasts).toHaveLength(1);

        act(() => {
          vi.advanceTimersByTime(3000);
        });

        expect(useUIStore.getState().toasts).toHaveLength(0);
      });

      it('should auto-remove toast after custom duration', () => {
        const store = useUIStore.getState();

        act(() => {
          store.addToast('success', 'Test message', 5000);
        });

        act(() => {
          vi.advanceTimersByTime(3000);
        });

        expect(useUIStore.getState().toasts).toHaveLength(1);

        act(() => {
          vi.advanceTimersByTime(2000);
        });

        expect(useUIStore.getState().toasts).toHaveLength(0);
      });
    });

    describe('removeToast', () => {
      it('should remove toast by id', () => {
        const store = useUIStore.getState();

        let toastId: number;
        act(() => {
          toastId = store.addToast('success', 'Test message');
        });

        expect(useUIStore.getState().toasts).toHaveLength(1);

        act(() => {
          useUIStore.getState().removeToast(toastId);
        });

        expect(useUIStore.getState().toasts).toHaveLength(0);
      });

      it('should only remove specified toast', () => {
        const store = useUIStore.getState();

        let id1: number;
        act(() => {
          id1 = store.addToast('success', 'Message 1');
          store.addToast('error', 'Message 2');
        });

        act(() => {
          useUIStore.getState().removeToast(id1);
        });

        expect(useUIStore.getState().toasts).toHaveLength(1);
        expect(useUIStore.getState().toasts[0].message).toBe('Message 2');
      });
    });

    describe('Convenience methods', () => {
      it('success should add a success toast', () => {
        act(() => {
          useUIStore.getState().success('Success message');
        });

        expect(useUIStore.getState().toasts[0].type).toBe('success');
      });

      it('error should add an error toast', () => {
        act(() => {
          useUIStore.getState().error('Error message');
        });

        expect(useUIStore.getState().toasts[0].type).toBe('error');
      });

      it('info should add an info toast', () => {
        act(() => {
          useUIStore.getState().info('Info message');
        });

        expect(useUIStore.getState().toasts[0].type).toBe('info');
      });
    });
  });

  describe('Theme functionality', () => {
    let originalMatchMedia: typeof window.matchMedia;

    beforeEach(() => {
      originalMatchMedia = window.matchMedia;
      window.matchMedia = vi.fn().mockImplementation(() => ({
        matches: false,
        media: '(prefers-color-scheme: dark)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));
      document.documentElement.removeAttribute('data-theme');
    });

    afterEach(() => {
      window.matchMedia = originalMatchMedia;
    });

    describe('setTheme', () => {
      it('should update theme to light', () => {
        act(() => {
          useUIStore.getState().setTheme('light');
        });

        expect(useUIStore.getState().theme).toBe('light');
        expect(useUIStore.getState().resolvedTheme).toBe('light');
      });

      it('should update theme to dark', () => {
        act(() => {
          useUIStore.getState().setTheme('dark');
        });

        expect(useUIStore.getState().theme).toBe('dark');
        expect(useUIStore.getState().resolvedTheme).toBe('dark');
      });

      it('should set data-theme attribute', () => {
        act(() => {
          useUIStore.getState().setTheme('dark');
        });

        expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      });

      it('should remove data-theme attribute for system', () => {
        document.documentElement.setAttribute('data-theme', 'dark');

        act(() => {
          useUIStore.getState().setTheme('system');
        });

        expect(document.documentElement.getAttribute('data-theme')).toBeNull();
      });
    });
  });

  describe('Device names functionality', () => {
    describe('setCustomName', () => {
      it('should set a custom name for a device', () => {
        act(() => {
          useUIStore.getState().setCustomName('Rigol', 'DS1054Z', 'My Scope', 'Lab Bench 1');
        });

        const state = useUIStore.getState();
        expect(state.deviceNames['rigol-ds1054z']).toEqual({
          title: 'My Scope',
          subtitle: 'Lab Bench 1',
        });
      });

      it('should update existing custom name', () => {
        act(() => {
          useUIStore.getState().setCustomName('Rigol', 'DS1054Z', 'Old Name', 'Old Sub');
          useUIStore.getState().setCustomName('Rigol', 'DS1054Z', 'New Name', 'New Sub');
        });

        const state = useUIStore.getState();
        expect(state.deviceNames['rigol-ds1054z']).toEqual({
          title: 'New Name',
          subtitle: 'New Sub',
        });
      });
    });

    describe('getCustomName', () => {
      it('should return custom name if set', () => {
        act(() => {
          useUIStore.getState().setCustomName('Rigol', 'DS1054Z', 'My Scope', 'Lab 1');
        });

        const customName = useUIStore.getState().getCustomName('Rigol', 'DS1054Z');
        expect(customName).toEqual({ title: 'My Scope', subtitle: 'Lab 1' });
      });

      it('should return null if no custom name set', () => {
        const customName = useUIStore.getState().getCustomName('Rigol', 'DS1054Z');
        expect(customName).toBeNull();
      });

      it('should be case-insensitive', () => {
        act(() => {
          useUIStore.getState().setCustomName('RIGOL', 'ds1054z', 'My Scope', 'Lab 1');
        });

        const customName = useUIStore.getState().getCustomName('rigol', 'DS1054Z');
        expect(customName).toEqual({ title: 'My Scope', subtitle: 'Lab 1' });
      });
    });

    describe('hasCustomName', () => {
      it('should return true if custom name exists', () => {
        act(() => {
          useUIStore.getState().setCustomName('Rigol', 'DS1054Z', 'My Scope', 'Lab 1');
        });

        expect(useUIStore.getState().hasCustomName('Rigol', 'DS1054Z')).toBe(true);
      });

      it('should return false if no custom name', () => {
        expect(useUIStore.getState().hasCustomName('Rigol', 'DS1054Z')).toBe(false);
      });
    });

    describe('resetCustomName', () => {
      it('should remove custom name', () => {
        act(() => {
          useUIStore.getState().setCustomName('Rigol', 'DS1054Z', 'My Scope', 'Lab 1');
          useUIStore.getState().resetCustomName('Rigol', 'DS1054Z');
        });

        expect(useUIStore.getState().hasCustomName('Rigol', 'DS1054Z')).toBe(false);
        expect(useUIStore.getState().getCustomName('Rigol', 'DS1054Z')).toBeNull();
      });

      it('should not affect other device names', () => {
        act(() => {
          useUIStore.getState().setCustomName('Rigol', 'DS1054Z', 'Scope', 'Lab 1');
          useUIStore.getState().setCustomName('Siglent', 'SPD3303X', 'PSU', 'Lab 2');
          useUIStore.getState().resetCustomName('Rigol', 'DS1054Z');
        });

        expect(useUIStore.getState().hasCustomName('Rigol', 'DS1054Z')).toBe(false);
        expect(useUIStore.getState().hasCustomName('Siglent', 'SPD3303X')).toBe(true);
      });
    });

    describe('Multiple devices', () => {
      it('should handle multiple device names independently', () => {
        act(() => {
          useUIStore.getState().setCustomName('Rigol', 'DS1054Z', 'Scope 1', 'Bench A');
          useUIStore.getState().setCustomName('Rigol', 'DS1102Z', 'Scope 2', 'Bench B');
          useUIStore.getState().setCustomName('Siglent', 'SPD3303X', 'PSU', 'Bench A');
        });

        const state = useUIStore.getState();
        expect(Object.keys(state.deviceNames)).toHaveLength(3);
        expect(state.getCustomName('Rigol', 'DS1054Z')?.title).toBe('Scope 1');
        expect(state.getCustomName('Rigol', 'DS1102Z')?.title).toBe('Scope 2');
        expect(state.getCustomName('Siglent', 'SPD3303X')?.title).toBe('PSU');
      });
    });
  });

  describe('State sharing across components', () => {
    it('should share device names state across multiple accesses', () => {
      // Simulate two components accessing the store
      const access1 = useUIStore.getState;
      const access2 = useUIStore.getState;

      // First "component" sets a name
      act(() => {
        access1().setCustomName('Rigol', 'DS1054Z', 'My Scope', 'Lab 1');
      });

      // Second "component" should see the change
      expect(access2().getCustomName('Rigol', 'DS1054Z')).toEqual({
        title: 'My Scope',
        subtitle: 'Lab 1',
      });
    });
  });
});
