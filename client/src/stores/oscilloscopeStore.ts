/**
 * Zustand store for oscilloscope state management
 *
 * Centralizes all oscilloscope-related state and WebSocket handling.
 * Replaces useOscilloscopeSocket hook.
 */

import { create } from 'zustand';
import { subscribeWithSelector, devtools } from 'zustand/middleware';
import { getWebSocketManager, ConnectionState } from '../websocket';
import type {
  ServerMessage,
  OscilloscopeStatus,
  WaveformData,
  OscilloscopeMeasurement,
  OscilloscopeCapabilities,
  DeviceInfo,
} from '../../../shared/types';

// Infer measurement unit from type
function getMeasurementUnit(type: string): string {
  const upper = type.toUpperCase();
  if (upper === 'FREQ') return 'Hz';
  if (upper === 'PER' || upper === 'PERIOD') return 's';
  if (upper.includes('TIM') || upper.includes('RISE') || upper.includes('FALL') || upper.includes('DELAY')) return 's';
  if (upper.includes('WID')) return 's';
  if (upper.includes('DUT')) return '%';
  if (upper === 'OVER' || upper === 'PRES') return '%';
  return 'V';
}

// Type guard to check if state is oscilloscope-specific
function isOscilloscopeState(state: unknown): state is OscilloscopeSessionState {
  if (!state || typeof state !== 'object') return false;
  const s = state as Record<string, unknown>;
  return (
    'capabilities' in s &&
    typeof s.capabilities === 'object' &&
    s.capabilities !== null &&
    'channels' in (s.capabilities as Record<string, unknown>) &&
    typeof (s.capabilities as Record<string, unknown>).channels === 'number'
  );
}

// Per-oscilloscope session state (matches server structure)
export interface OscilloscopeSessionState {
  info: DeviceInfo;
  capabilities: OscilloscopeCapabilities;
  connectionStatus: 'connected' | 'error' | 'disconnected';
  consecutiveErrors: number;
  status: OscilloscopeStatus | null;
  lastUpdated: number;
}

// Per-oscilloscope UI/data state
interface OscilloscopeState {
  sessionState: OscilloscopeSessionState | null;
  isSubscribed: boolean;
  error: string | null;
  waveform: WaveformData | null;
  waveforms: WaveformData[];
  measurements: OscilloscopeMeasurement[];
  screenshot: string | null;
  isStreaming: boolean;
}

// Store state
interface OscilloscopeStoreState {
  // Connection (shared with device store via same WebSocket)
  connectionState: ConnectionState;

  // Per-oscilloscope states (keyed by deviceId)
  oscilloscopeStates: Record<string, OscilloscopeState>;

  // Actions - subscription
  subscribeOscilloscope: (deviceId: string) => void;
  unsubscribeOscilloscope: (deviceId: string) => void;

  // Actions - run control
  run: (deviceId: string) => void;
  stop: (deviceId: string) => void;
  single: (deviceId: string) => void;
  autoSetup: (deviceId: string) => void;

  // Actions - data acquisition
  getWaveform: (deviceId: string, channel: string) => void;
  getMeasurement: (deviceId: string, channel: string, type: string) => void;
  getScreenshot: (deviceId: string) => void;

  // Actions - channel settings
  setChannelEnabled: (deviceId: string, channel: string, enabled: boolean) => void;
  setChannelScale: (deviceId: string, channel: string, scale: number) => void;
  setChannelOffset: (deviceId: string, channel: string, offset: number) => void;
  setChannelCoupling: (deviceId: string, channel: string, coupling: 'AC' | 'DC' | 'GND') => void;
  setChannelProbe: (deviceId: string, channel: string, ratio: number) => void;
  setChannelBwLimit: (deviceId: string, channel: string, enabled: boolean) => void;

  // Actions - timebase settings
  setTimebaseScale: (deviceId: string, scale: number) => void;
  setTimebaseOffset: (deviceId: string, offset: number) => void;

  // Actions - trigger settings
  setTriggerSource: (deviceId: string, source: string) => void;
  setTriggerLevel: (deviceId: string, level: number) => void;
  setTriggerEdge: (deviceId: string, edge: 'rising' | 'falling' | 'either') => void;
  setTriggerSweep: (deviceId: string, sweep: 'auto' | 'normal' | 'single') => void;

  // Actions - streaming
  startStreaming: (deviceId: string, channels: string[], intervalMs: number, measurements?: string[]) => void;
  stopStreaming: (deviceId: string) => void;

  // Actions - error handling
  clearError: (deviceId: string) => void;

  // Internal - message handling
  _handleMessage: (message: ServerMessage) => void;
  _initializeWebSocket: () => void;
}

// Selector helpers
export const selectOscilloscope = (deviceId: string) => (state: OscilloscopeStoreState) =>
  state.oscilloscopeStates[deviceId] ?? {
    sessionState: null,
    isSubscribed: false,
    error: null,
    waveform: null,
    waveforms: [],
    measurements: [],
    screenshot: null,
    isStreaming: false,
  };

export const selectOscilloscopeState = (deviceId: string) => (state: OscilloscopeStoreState) =>
  state.oscilloscopeStates[deviceId]?.sessionState ?? null;

export const selectOscilloscopeStatus = (deviceId: string) => (state: OscilloscopeStoreState) =>
  state.oscilloscopeStates[deviceId]?.sessionState?.status ?? null;

export const selectWaveforms = (deviceId: string) => (state: OscilloscopeStoreState) =>
  state.oscilloscopeStates[deviceId]?.waveforms ?? [];

export const selectMeasurements = (deviceId: string) => (state: OscilloscopeStoreState) =>
  state.oscilloscopeStates[deviceId]?.measurements ?? [];

export const selectIsStreaming = (deviceId: string) => (state: OscilloscopeStoreState) =>
  state.oscilloscopeStates[deviceId]?.isStreaming ?? false;

// Default state for new oscilloscope
const defaultOscilloscopeState: OscilloscopeState = {
  sessionState: null,
  isSubscribed: false,
  error: null,
  waveform: null,
  waveforms: [],
  measurements: [],
  screenshot: null,
  isStreaming: false,
};

// Store unsubscribe functions for cleanup (e.g., testing, HMR)
let _unsubscribeStateChange: (() => void) | null = null;
let _unsubscribeMessage: (() => void) | null = null;
// Suppress unused variable warnings - these are intentionally stored for future cleanup
void _unsubscribeStateChange;
void _unsubscribeMessage;

// Create store
export const useOscilloscopeStore = create<OscilloscopeStoreState>()(
  devtools(
    subscribeWithSelector((set, get) => {
      const wsManager = getWebSocketManager();
      let isInitialized = false;

      return {
        // Initial state
        connectionState: 'disconnected',
        oscilloscopeStates: {},

        // Initialize WebSocket handlers
        _initializeWebSocket: () => {
          if (isInitialized) return;
          isInitialized = true;

          _unsubscribeStateChange = wsManager.onStateChange((newState) => {
            set({ connectionState: newState });

            // Re-subscribe on reconnect
            if (newState === 'connected') {
              const { oscilloscopeStates } = get();
              for (const [deviceId, state] of Object.entries(oscilloscopeStates)) {
                if (state.isSubscribed) {
                  wsManager.send({ type: 'subscribe', deviceId });
                }
              }
            }
          });

          _unsubscribeMessage = wsManager.onMessage((message: ServerMessage) => {
            get()._handleMessage(message);
          });

          set({ connectionState: wsManager.getState() });
        },

        // Subscription actions
        subscribeOscilloscope: (deviceId: string) => {
          get()._initializeWebSocket();
          wsManager.connect();
          wsManager.send({ type: 'subscribe', deviceId });
        },

        unsubscribeOscilloscope: (deviceId: string) => {
          // Stop streaming before unsubscribing to clean up server-side resources
          const oscState = get().oscilloscopeStates[deviceId];
          if (oscState?.isStreaming) {
            wsManager.send({ type: 'scopeStopStreaming', deviceId });
          }
          wsManager.send({ type: 'unsubscribe', deviceId });
          set((state) => ({
            oscilloscopeStates: {
              ...state.oscilloscopeStates,
              [deviceId]: {
                ...(state.oscilloscopeStates[deviceId] ?? defaultOscilloscopeState),
                isSubscribed: false,
                isStreaming: false,
              },
            },
          }));
        },

        // Run control
        run: (deviceId) => wsManager.send({ type: 'scopeRun', deviceId }),
        stop: (deviceId) => wsManager.send({ type: 'scopeStop', deviceId }),
        single: (deviceId) => wsManager.send({ type: 'scopeSingle', deviceId }),
        autoSetup: (deviceId) => wsManager.send({ type: 'scopeAutoSetup', deviceId }),

        // Data acquisition
        getWaveform: (deviceId, channel) =>
          wsManager.send({ type: 'scopeGetWaveform', deviceId, channel }),
        getMeasurement: (deviceId, channel, measurementType) =>
          wsManager.send({ type: 'scopeGetMeasurement', deviceId, channel, measurementType }),
        getScreenshot: (deviceId) =>
          wsManager.send({ type: 'scopeGetScreenshot', deviceId }),

        // Channel settings
        setChannelEnabled: (deviceId, channel, enabled) =>
          wsManager.send({ type: 'scopeSetChannelEnabled', deviceId, channel, enabled }),
        setChannelScale: (deviceId, channel, scale) =>
          wsManager.send({ type: 'scopeSetChannelScale', deviceId, channel, scale }),
        setChannelOffset: (deviceId, channel, offset) =>
          wsManager.send({ type: 'scopeSetChannelOffset', deviceId, channel, offset }),
        setChannelCoupling: (deviceId, channel, coupling) =>
          wsManager.send({ type: 'scopeSetChannelCoupling', deviceId, channel, coupling }),
        setChannelProbe: (deviceId, channel, ratio) =>
          wsManager.send({ type: 'scopeSetChannelProbe', deviceId, channel, ratio }),
        setChannelBwLimit: (deviceId, channel, enabled) =>
          wsManager.send({ type: 'scopeSetChannelBwLimit', deviceId, channel, enabled }),

        // Timebase settings
        setTimebaseScale: (deviceId, scale) =>
          wsManager.send({ type: 'scopeSetTimebaseScale', deviceId, scale }),
        setTimebaseOffset: (deviceId, offset) =>
          wsManager.send({ type: 'scopeSetTimebaseOffset', deviceId, offset }),

        // Trigger settings
        setTriggerSource: (deviceId, source) =>
          wsManager.send({ type: 'scopeSetTriggerSource', deviceId, source }),
        setTriggerLevel: (deviceId, level) =>
          wsManager.send({ type: 'scopeSetTriggerLevel', deviceId, level }),
        setTriggerEdge: (deviceId, edge) =>
          wsManager.send({ type: 'scopeSetTriggerEdge', deviceId, edge }),
        setTriggerSweep: (deviceId, sweep) =>
          wsManager.send({ type: 'scopeSetTriggerSweep', deviceId, sweep }),

        // Streaming
        startStreaming: (deviceId, channels, intervalMs, measurements) => {
          wsManager.send({ type: 'scopeStartStreaming', deviceId, channels, intervalMs, measurements });
          set((state) => ({
            oscilloscopeStates: {
              ...state.oscilloscopeStates,
              [deviceId]: {
                ...(state.oscilloscopeStates[deviceId] ?? defaultOscilloscopeState),
                isStreaming: true,
              },
            },
          }));
        },

        stopStreaming: (deviceId) => {
          wsManager.send({ type: 'scopeStopStreaming', deviceId });
          set((state) => ({
            oscilloscopeStates: {
              ...state.oscilloscopeStates,
              [deviceId]: {
                ...(state.oscilloscopeStates[deviceId] ?? defaultOscilloscopeState),
                isStreaming: false,
              },
            },
          }));
        },

        // Error handling
        clearError: (deviceId) => {
          set((state) => ({
            oscilloscopeStates: {
              ...state.oscilloscopeStates,
              [deviceId]: {
                ...(state.oscilloscopeStates[deviceId] ?? defaultOscilloscopeState),
                error: null,
              },
            },
          }));
        },

        // Message handler
        _handleMessage: (message: ServerMessage) => {
          // Only handle oscilloscope-specific messages
          if (!('deviceId' in message) || !message.deviceId) return;

          const deviceId = message.deviceId;

          switch (message.type) {
            case 'subscribed':
              // Only handle if this is an oscilloscope (use type guard for safety)
              if (isOscilloscopeState(message.state)) {
                const oscSessionState = message.state as OscilloscopeSessionState;
                set((state) => ({
                  oscilloscopeStates: {
                    ...state.oscilloscopeStates,
                    [deviceId]: {
                      ...defaultOscilloscopeState,
                      sessionState: oscSessionState,
                      isSubscribed: true,
                    },
                  },
                }));
              }
              break;

            case 'unsubscribed':
              set((state) => ({
                oscilloscopeStates: {
                  ...state.oscilloscopeStates,
                  [deviceId]: {
                    ...(state.oscilloscopeStates[deviceId] ?? defaultOscilloscopeState),
                    isSubscribed: false,
                    isStreaming: false,
                  },
                },
              }));
              break;

            case 'field':
              set((state) => {
                const oscState = state.oscilloscopeStates[deviceId];
                if (!oscState?.sessionState) return state;

                const prev = oscState.sessionState;
                let updated: OscilloscopeSessionState;

                switch (message.field) {
                  case 'connectionStatus':
                    updated = { ...prev, connectionStatus: message.value as OscilloscopeSessionState['connectionStatus'] };
                    break;
                  case 'oscilloscopeStatus':
                    updated = { ...prev, status: message.value as OscilloscopeStatus };
                    break;
                  default:
                    updated = { ...prev, [message.field]: message.value };
                }

                return {
                  oscilloscopeStates: {
                    ...state.oscilloscopeStates,
                    [deviceId]: {
                      ...oscState,
                      sessionState: updated,
                    },
                  },
                };
              });
              break;

            case 'scopeWaveform':
              set((state) => {
                const oscState = state.oscilloscopeStates[deviceId] ?? defaultOscilloscopeState;

                // Update waveforms array (replace if same channel, add if new)
                const waveforms = [...oscState.waveforms];
                const idx = waveforms.findIndex(w => w.channel === message.waveform.channel);
                if (idx >= 0) {
                  waveforms[idx] = message.waveform;
                } else {
                  waveforms.push(message.waveform);
                }

                return {
                  oscilloscopeStates: {
                    ...state.oscilloscopeStates,
                    [deviceId]: {
                      ...oscState,
                      waveform: message.waveform,
                      waveforms,
                    },
                  },
                };
              });
              break;

            case 'scopeScreenshot':
              set((state) => ({
                oscilloscopeStates: {
                  ...state.oscilloscopeStates,
                  [deviceId]: {
                    ...(state.oscilloscopeStates[deviceId] ?? defaultOscilloscopeState),
                    screenshot: message.data,
                  },
                },
              }));
              break;

            case 'scopeMeasurement':
              if (message.value !== null) {
                set((state) => {
                  const oscState = state.oscilloscopeStates[deviceId] ?? defaultOscilloscopeState;
                  const measurements = [...oscState.measurements];

                  const unit = getMeasurementUnit(message.measurementType);
                  const newMeasurement: OscilloscopeMeasurement = {
                    channel: message.channel,
                    type: message.measurementType,
                    value: message.value as number,
                    unit,
                  };

                  const idx = measurements.findIndex(
                    m => m.channel === message.channel && m.type === message.measurementType
                  );
                  if (idx >= 0) {
                    measurements[idx] = newMeasurement;
                  } else {
                    measurements.push(newMeasurement);
                  }

                  return {
                    oscilloscopeStates: {
                      ...state.oscilloscopeStates,
                      [deviceId]: {
                        ...oscState,
                        measurements,
                      },
                    },
                  };
                });
              }
              break;

            case 'error':
              set((state) => ({
                oscilloscopeStates: {
                  ...state.oscilloscopeStates,
                  [deviceId]: {
                    ...(state.oscilloscopeStates[deviceId] ?? defaultOscilloscopeState),
                    error: message.message,
                  },
                },
              }));
              break;
          }
        },
      };
    }),
    { name: 'OscilloscopeStore', enabled: process.env.NODE_ENV === 'development' }
  )
);
