/**
 * Zustand stores - centralized state management
 *
 * This replaces the scattered hook-based state management with
 * a clean, centralized approach using Zustand stores.
 *
 * Key benefits:
 * - Device name changes propagate instantly to all components
 * - Single source of truth for all state
 * - DevTools support in development
 * - Persistence for UI preferences
 */

export {
  useDeviceStore,
  selectDevice,
  selectDeviceState,
  selectDeviceHistory,
  selectIsSubscribed,
  selectDeviceError,
  cleanupDeviceStore,
} from './deviceStore';

export {
  useOscilloscopeStore,
  selectOscilloscope,
  selectOscilloscopeState,
  selectOscilloscopeStatus,
  selectWaveforms,
  selectMeasurements,
  selectIsStreaming,
  selectStreamingChannels,
  selectStreamingFps,
  cleanupOscilloscopeStore,
  type OscilloscopeSessionState,
  type StreamingState,
} from './oscilloscopeStore';

export {
  useUIStore,
  selectToasts,
  selectTheme,
  selectResolvedTheme,
  selectDeviceNames,
  getDeviceKey,
  type Toast,
} from './uiStore';

export {
  useLayoutStore,
  initializeLayoutStore,
  selectLayouts,
  selectIsLayoutLoading,
  selectIsLayoutLoaded,
  GRID_COLS,
  GRID_BREAKPOINTS,
  ROW_HEIGHT,
} from './layoutStore';
