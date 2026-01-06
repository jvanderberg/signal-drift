/**
 * Zustand store for oscilloscope state management
 *
 * REDESIGNED: Server is the source of truth for streaming state.
 *
 * Key changes:
 * 1. isStreaming is derived from server's streaming.isStreaming
 * 2. No optimistic state updates - wait for server confirmation
 * 3. Streaming auto-starts on first subscriber (server handles this)
 * 4. Client just filters which channels/measurements to display
 */

import { create } from 'zustand';
import { subscribeWithSelector, devtools } from 'zustand/middleware';
import { getWebSocketManager, ConnectionState } from '../websocket';
import type {
  ServerMessage,
  OscilloscopeStatus,
  WaveformData,
  OscilloscopeMeasurement,
  OscilloscopeSessionState,
  StreamingState,
} from '../../../shared/types';

// Re-export StreamingState for consumers of this module
export type { StreamingState } from '../../../shared/types';

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

// Re-export OscilloscopeSessionState for consumers of this module
export type { OscilloscopeSessionState } from '../../../shared/types';

// Per-oscilloscope UI/data state
interface OscilloscopeState {
  sessionState: OscilloscopeSessionState | null;
  isSubscribed: boolean;
  error: string | null;
  waveform: WaveformData | null;
  waveforms: WaveformData[];
  measurements: OscilloscopeMeasurement[];
  screenshot: string | null;
  // Client-side display filter - which channels to show on the chart
  // This is purely local UI state, no server round-trip
  displayChannels: string[];
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

  // Actions - streaming (now mainly for measurement configuration)
  startStreaming: (deviceId: string, channels: string[], intervalMs: number, measurements?: string[]) => void;
  stopStreaming: (deviceId: string) => void;

  // Actions - display filter (client-side only, instant, no server round-trip)
  toggleDisplayChannel: (deviceId: string, channel: string) => void;
  setDisplayChannels: (deviceId: string, channels: string[]) => void;

  // Actions - error handling
  clearError: (deviceId: string) => void;

  // Internal - message handling
  _handleMessage: (message: ServerMessage) => void;
  _initializeWebSocket: () => void;
}

// Default streaming state
const defaultStreamingState: StreamingState = {
  isStreaming: false,
  channels: [],
  fps: 0,
};

// Default state for new oscilloscope (used by selectors and store)
const defaultOscilloscopeState: OscilloscopeState = {
  sessionState: null,
  isSubscribed: false,
  error: null,
  waveform: null,
  waveforms: [],
  measurements: [],
  screenshot: null,
  displayChannels: [],
};

// Default empty arrays for selectors (stable references to prevent re-renders)
const emptyWaveforms: WaveformData[] = [];
const emptyMeasurements: OscilloscopeMeasurement[] = [];
const emptyChannels: string[] = [];

// Selector helpers - use stable references to prevent infinite re-render loops
export const selectOscilloscope = (deviceId: string) => (state: OscilloscopeStoreState) =>
  state.oscilloscopeStates[deviceId] ?? defaultOscilloscopeState;

export const selectOscilloscopeState = (deviceId: string) => (state: OscilloscopeStoreState) =>
  state.oscilloscopeStates[deviceId]?.sessionState ?? null;

export const selectOscilloscopeStatus = (deviceId: string) => (state: OscilloscopeStoreState) =>
  state.oscilloscopeStates[deviceId]?.sessionState?.status ?? null;

export const selectWaveforms = (deviceId: string) => (state: OscilloscopeStoreState) =>
  state.oscilloscopeStates[deviceId]?.waveforms ?? emptyWaveforms;

export const selectMeasurements = (deviceId: string) => (state: OscilloscopeStoreState) =>
  state.oscilloscopeStates[deviceId]?.measurements ?? emptyMeasurements;

// Streaming state derived from server
export const selectIsStreaming = (deviceId: string) => (state: OscilloscopeStoreState) =>
  state.oscilloscopeStates[deviceId]?.sessionState?.streaming?.isStreaming ?? false;

export const selectStreamingChannels = (deviceId: string) => (state: OscilloscopeStoreState) =>
  state.oscilloscopeStates[deviceId]?.sessionState?.streaming?.channels ?? emptyChannels;

export const selectStreamingFps = (deviceId: string) => (state: OscilloscopeStoreState) =>
  state.oscilloscopeStates[deviceId]?.sessionState?.streaming?.fps ?? 0;

// Client-side display filter (purely local, no server interaction)
export const selectDisplayChannels = (deviceId: string) => (state: OscilloscopeStoreState) =>
  state.oscilloscopeStates[deviceId]?.displayChannels ?? emptyChannels;

// Store unsubscribe functions for cleanup (e.g., testing, HMR)
let _unsubscribeStateChange: (() => void) | null = null;
let _unsubscribeMessage: (() => void) | null = null;
let _isInitialized = false;

/**
 * Cleanup function for testing and HMR.
 * Unsubscribes from WebSocket events and resets initialization state.
 */
export function cleanupOscilloscopeStore(): void {
  if (_unsubscribeStateChange) {
    _unsubscribeStateChange();
    _unsubscribeStateChange = null;
  }
  if (_unsubscribeMessage) {
    _unsubscribeMessage();
    _unsubscribeMessage = null;
  }
  _isInitialized = false;
}

// Create store
export const useOscilloscopeStore = create<OscilloscopeStoreState>()(
  devtools(
    subscribeWithSelector((set, get) => {
      const wsManager = getWebSocketManager();

      return {
        // Initial state
        connectionState: 'disconnected',
        oscilloscopeStates: {},

        // Initialize WebSocket handlers
        _initializeWebSocket: () => {
          if (_isInitialized) return;
          _isInitialized = true;

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
          wsManager.send({ type: 'unsubscribe', deviceId });
          set((state) => ({
            oscilloscopeStates: {
              ...state.oscilloscopeStates,
              [deviceId]: {
                ...(state.oscilloscopeStates[deviceId] ?? defaultOscilloscopeState),
                isSubscribed: false,
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

        // Streaming - sends request, server broadcasts state change
        startStreaming: (deviceId, channels, intervalMs, measurements) => {
          wsManager.send({ type: 'scopeStartStreaming', deviceId, channels, intervalMs, measurements });
          // No optimistic update - wait for server to broadcast streaming state
        },

        stopStreaming: (deviceId) => {
          wsManager.send({ type: 'scopeStopStreaming', deviceId });
          // No optimistic update - wait for server to broadcast streaming state
        },

        // Display filter - pure client-side state, instant, no server round-trip
        toggleDisplayChannel: (deviceId, channel) => {
          set((state) => {
            const oscState = state.oscilloscopeStates[deviceId] ?? defaultOscilloscopeState;
            const currentDisplay = oscState.displayChannels;
            const isDisplayed = currentDisplay.includes(channel);

            return {
              oscilloscopeStates: {
                ...state.oscilloscopeStates,
                [deviceId]: {
                  ...oscState,
                  displayChannels: isDisplayed
                    ? currentDisplay.filter(ch => ch !== channel)
                    : [...currentDisplay, channel],
                },
              },
            };
          });
        },

        setDisplayChannels: (deviceId, channels) => {
          set((state) => ({
            oscilloscopeStates: {
              ...state.oscilloscopeStates,
              [deviceId]: {
                ...(state.oscilloscopeStates[deviceId] ?? defaultOscilloscopeState),
                displayChannels: channels,
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
                // Ensure streaming state has defaults
                if (!oscSessionState.streaming) {
                  oscSessionState.streaming = { ...defaultStreamingState };
                }
                // Initialize displayChannels with enabled hardware channels
                const enabledChannels = oscSessionState.status?.channels
                  ? Object.entries(oscSessionState.status.channels)
                      .filter(([_, ch]) => ch.enabled)
                      .map(([name]) => name)
                  : [];
                set((state) => ({
                  oscilloscopeStates: {
                    ...state.oscilloscopeStates,
                    [deviceId]: {
                      ...defaultOscilloscopeState,
                      sessionState: oscSessionState,
                      isSubscribed: true,
                      displayChannels: enabledChannels,
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
                  case 'streaming': {
                    // Server broadcasts streaming state changes
                    const newStreaming = message.value as StreamingState;
                    updated = { ...prev, streaming: newStreaming };

                    // Remove waveforms and measurements for channels no longer streaming
                    const streamingChannels = newStreaming.channels;
                    const filteredWaveforms = oscState.waveforms.filter(w =>
                      streamingChannels.includes(w.channel)
                    );
                    const filteredMeasurements = oscState.measurements.filter(m =>
                      streamingChannels.includes(m.channel)
                    );

                    return {
                      oscilloscopeStates: {
                        ...state.oscilloscopeStates,
                        [deviceId]: {
                          ...oscState,
                          sessionState: updated,
                          waveforms: filteredWaveforms,
                          measurements: filteredMeasurements,
                          waveform: filteredWaveforms[0] ?? null,
                        },
                      },
                    };
                  }
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

                // Also update fps in streaming state if we have session state
                let sessionState = oscState.sessionState;
                if (sessionState && message.fps !== undefined) {
                  sessionState = {
                    ...sessionState,
                    streaming: {
                      ...sessionState.streaming,
                      fps: message.fps,
                    },
                  };
                }

                return {
                  oscilloscopeStates: {
                    ...state.oscilloscopeStates,
                    [deviceId]: {
                      ...oscState,
                      sessionState,
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
