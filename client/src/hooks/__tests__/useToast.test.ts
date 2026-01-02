import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useToast } from '../useToast';

describe('useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Initial state', () => {
    it('should start with empty toasts array', () => {
      const { result } = renderHook(() => useToast());
      expect(result.current.toasts).toEqual([]);
    });
  });

  describe('addToast', () => {
    it('should add a toast to the array', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.addToast('success', 'Test message');
      });

      expect(result.current.toasts).toHaveLength(1);
      expect(result.current.toasts[0].type).toBe('success');
      expect(result.current.toasts[0].message).toBe('Test message');
    });

    it('should return a unique id', () => {
      const { result } = renderHook(() => useToast());

      let id1: number, id2: number;
      act(() => {
        id1 = result.current.addToast('success', 'Message 1');
        id2 = result.current.addToast('error', 'Message 2');
      });

      expect(id1!).toBeDefined();
      expect(id2!).toBeDefined();
      expect(id1!).not.toBe(id2!);
    });

    it('should add multiple toasts', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.addToast('success', 'Message 1');
        result.current.addToast('error', 'Message 2');
        result.current.addToast('info', 'Message 3');
      });

      expect(result.current.toasts).toHaveLength(3);
    });
  });

  describe('Auto-remove', () => {
    it('should auto-remove toast after default duration (3000ms)', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.addToast('success', 'Test message');
      });

      expect(result.current.toasts).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(result.current.toasts).toHaveLength(0);
    });

    it('should auto-remove toast after custom duration', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.addToast('success', 'Test message', 5000);
      });

      expect(result.current.toasts).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(result.current.toasts).toHaveLength(1); // Still there

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(result.current.toasts).toHaveLength(0); // Now removed
    });
  });

  describe('removeToast', () => {
    it('should remove toast by id', () => {
      const { result } = renderHook(() => useToast());

      let toastId: number;
      act(() => {
        toastId = result.current.addToast('success', 'Test message');
      });

      expect(result.current.toasts).toHaveLength(1);

      act(() => {
        result.current.removeToast(toastId);
      });

      expect(result.current.toasts).toHaveLength(0);
    });

    it('should only remove specified toast', () => {
      const { result } = renderHook(() => useToast());

      let id1: number;
      act(() => {
        id1 = result.current.addToast('success', 'Message 1');
        result.current.addToast('error', 'Message 2');
      });

      expect(result.current.toasts).toHaveLength(2);

      act(() => {
        result.current.removeToast(id1);
      });

      expect(result.current.toasts).toHaveLength(1);
      expect(result.current.toasts[0].message).toBe('Message 2');
    });

    it('should do nothing for non-existent id', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.addToast('success', 'Test message');
      });

      act(() => {
        result.current.removeToast(99999);
      });

      expect(result.current.toasts).toHaveLength(1);
    });
  });

  describe('Convenience methods', () => {
    describe('success', () => {
      it('should add a success toast', () => {
        const { result } = renderHook(() => useToast());

        act(() => {
          result.current.success('Success message');
        });

        expect(result.current.toasts[0].type).toBe('success');
        expect(result.current.toasts[0].message).toBe('Success message');
      });

      it('should accept custom duration', () => {
        const { result } = renderHook(() => useToast());

        act(() => {
          result.current.success('Success message', 1000);
        });

        expect(result.current.toasts).toHaveLength(1);

        act(() => {
          vi.advanceTimersByTime(1000);
        });

        expect(result.current.toasts).toHaveLength(0);
      });
    });

    describe('error', () => {
      it('should add an error toast', () => {
        const { result } = renderHook(() => useToast());

        act(() => {
          result.current.error('Error message');
        });

        expect(result.current.toasts[0].type).toBe('error');
        expect(result.current.toasts[0].message).toBe('Error message');
      });
    });

    describe('info', () => {
      it('should add an info toast', () => {
        const { result } = renderHook(() => useToast());

        act(() => {
          result.current.info('Info message');
        });

        expect(result.current.toasts[0].type).toBe('info');
        expect(result.current.toasts[0].message).toBe('Info message');
      });
    });
  });

  describe('Hook stability', () => {
    it('should return stable callback references', () => {
      const { result, rerender } = renderHook(() => useToast());

      const firstRender = {
        addToast: result.current.addToast,
        removeToast: result.current.removeToast,
        success: result.current.success,
        error: result.current.error,
        info: result.current.info,
      };

      rerender();

      expect(result.current.addToast).toBe(firstRender.addToast);
      expect(result.current.removeToast).toBe(firstRender.removeToast);
      expect(result.current.success).toBe(firstRender.success);
      expect(result.current.error).toBe(firstRender.error);
      expect(result.current.info).toBe(firstRender.info);
    });
  });

  describe('Timer cleanup', () => {
    it('should not cause errors when component unmounts before timer fires', () => {
      const { result, unmount } = renderHook(() => useToast());

      act(() => {
        result.current.addToast('success', 'Test message', 5000);
      });

      expect(result.current.toasts).toHaveLength(1);

      // Unmount before timer fires
      unmount();

      // Advance timers - should not throw "Cannot update state on unmounted component"
      // Note: In React 18+ with concurrent features, this warning is suppressed
      // but we verify the timer completes without throwing
      expect(() => {
        act(() => {
          vi.advanceTimersByTime(5000);
        });
      }).not.toThrow();
    });

    it('should handle multiple toasts with different durations on unmount', () => {
      const { result, unmount } = renderHook(() => useToast());

      act(() => {
        result.current.addToast('success', 'Short', 1000);
        result.current.addToast('error', 'Medium', 3000);
        result.current.addToast('info', 'Long', 5000);
      });

      expect(result.current.toasts).toHaveLength(3);

      unmount();

      // All timers should complete without errors
      expect(() => {
        act(() => {
          vi.advanceTimersByTime(5000);
        });
      }).not.toThrow();
    });
  });

  describe('Edge cases', () => {
    it('should handle zero duration', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.addToast('success', 'Instant', 0);
      });

      // With 0 duration, should be removed immediately (setTimeout 0)
      act(() => {
        vi.advanceTimersByTime(0);
      });

      expect(result.current.toasts).toHaveLength(0);
    });

    it('should handle adding many toasts', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        for (let i = 0; i < 50; i++) {
          result.current.addToast('info', `Message ${i}`);
        }
      });

      expect(result.current.toasts).toHaveLength(50);
    });
  });
});
