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
} from './deviceStore';

export {
  useOscilloscopeStore,
  selectOscilloscope,
  selectOscilloscopeState,
  selectOscilloscopeStatus,
  selectWaveforms,
  selectMeasurements,
  selectIsStreaming,
  type OscilloscopeSessionState,
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
