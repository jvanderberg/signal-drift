/**
 * Zustand store for device state management
 *
 * Centralizes all device-related state and WebSocket handling.
 * Replaces useDeviceSocket and useDeviceList hooks.
 */

import { create } from 'zustand';
import { subscribeWithSelector, devtools } from 'zustand/middleware';
import { getWebSocketManager, ConnectionState } from '../websocket';
import type {
  DeviceSummary,
  DeviceSessionState,
  ServerMessage,
  HistoryData,
} from '../../../shared/types';

// Per-device state
interface DeviceState {
  sessionState: DeviceSessionState | null;
  isSubscribed: boolean;
  error: string | null;
}

// Store state
interface DeviceStoreState {
  // Connection
  connectionState: ConnectionState;

  // Device list (from scanner)
  devices: DeviceSummary[];
  isLoadingDevices: boolean;
  deviceListError: string | null;

  // Per-device states (keyed by deviceId)
  deviceStates: Record<string, DeviceState>;

  // Actions - connection
  connect: () => void;
  disconnect: () => void;

  // Actions - device list
  refreshDevices: () => void;
  scanDevices: () => void;

  // Actions - device subscription
  subscribeDevice: (deviceId: string) => void;
  unsubscribeDevice: (deviceId: string) => void;

  // Actions - device control
  setMode: (deviceId: string, mode: string) => void;
  setOutput: (deviceId: string, enabled: boolean) => void;
  setValue: (deviceId: string, name: string, value: number, immediate?: boolean) => void;

  // Actions - error handling
  clearDeviceError: (deviceId: string) => void;

  // Internal - message handling
  _handleMessage: (message: ServerMessage) => void;
}

// Selector helpers for per-device state
export const selectDevice = (deviceId: string) => (state: DeviceStoreState) =>
  state.deviceStates[deviceId] ?? { sessionState: null, isSubscribed: false, error: null };

export const selectDeviceState = (deviceId: string) => (state: DeviceStoreState) =>
  state.deviceStates[deviceId]?.sessionState ?? null;

export const selectDeviceHistory = (deviceId: string) => (state: DeviceStoreState) =>
  state.deviceStates[deviceId]?.sessionState?.history ?? {
    timestamps: [],
    voltage: [],
    current: [],
    power: [],
  };

export const selectIsSubscribed = (deviceId: string) => (state: DeviceStoreState) =>
  state.deviceStates[deviceId]?.isSubscribed ?? false;

export const selectDeviceError = (deviceId: string) => (state: DeviceStoreState) =>
  state.deviceStates[deviceId]?.error ?? null;

// Max history points per device (~2.7 hours at 1 sample/sec, ~400KB per device)
const MAX_HISTORY_POINTS = 10_000;

// Store unsubscribe functions for cleanup (e.g., testing, HMR)
let unsubscribeStateChange: (() => void) | null = null;
let unsubscribeMessage: (() => void) | null = null;

// Create store with subscribeWithSelector for fine-grained subscriptions
export const useDeviceStore = create<DeviceStoreState>()(
  devtools(
    subscribeWithSelector((set, get) => {
      const wsManager = getWebSocketManager();
      let isInitialized = false;

      // Initialize WebSocket handlers once
      const initializeWebSocket = () => {
        if (isInitialized) return;
        isInitialized = true;

        // Track connection state
        unsubscribeStateChange = wsManager.onStateChange((newState) => {
          set({ connectionState: newState });

          // Re-request device list on reconnect
          if (newState === 'connected') {
            wsManager.send({ type: 'getDevices' });

            // Re-subscribe to any previously subscribed devices
            const { deviceStates } = get();
            for (const [deviceId, state] of Object.entries(deviceStates)) {
              if (state.isSubscribed) {
                wsManager.send({ type: 'subscribe', deviceId });
              }
            }
          }
        });

        // Handle all incoming messages
        unsubscribeMessage = wsManager.onMessage((message: ServerMessage) => {
          get()._handleMessage(message);
        });

        // Set initial state
        set({ connectionState: wsManager.getState() });
      };

      return {
        // Initial state
        connectionState: 'disconnected',
        devices: [],
        isLoadingDevices: true,
        deviceListError: null,
        deviceStates: {},

        // Connection actions
        connect: () => {
          initializeWebSocket();
          wsManager.connect();
          wsManager.send({ type: 'getDevices' });
        },

        disconnect: () => {
          wsManager.disconnect();
        },

        // Device list actions
        refreshDevices: () => {
          set({ isLoadingDevices: true });
          wsManager.send({ type: 'getDevices' });
        },

        scanDevices: () => {
          set({ isLoadingDevices: true });
          wsManager.send({ type: 'scan' });
        },

        // Device subscription actions
        subscribeDevice: (deviceId: string) => {
          wsManager.send({ type: 'subscribe', deviceId });
        },

        unsubscribeDevice: (deviceId: string) => {
          wsManager.send({ type: 'unsubscribe', deviceId });
          set((state) => ({
            deviceStates: {
              ...state.deviceStates,
              [deviceId]: {
                ...state.deviceStates[deviceId],
                isSubscribed: false,
              },
            },
          }));
        },

        // Device control actions
        setMode: (deviceId: string, mode: string) => {
          wsManager.send({ type: 'setMode', deviceId, mode });
        },

        setOutput: (deviceId: string, enabled: boolean) => {
          wsManager.send({ type: 'setOutput', deviceId, enabled });
        },

        setValue: (deviceId: string, name: string, value: number, immediate = false) => {
          wsManager.send({ type: 'setValue', deviceId, name, value, immediate });
        },

        // Error handling
        clearDeviceError: (deviceId: string) => {
          set((state) => ({
            deviceStates: {
              ...state.deviceStates,
              [deviceId]: {
                ...state.deviceStates[deviceId],
                error: null,
              },
            },
          }));
        },

        // Internal message handler
        _handleMessage: (message: ServerMessage) => {
          switch (message.type) {
            case 'deviceList':
              set({
                devices: message.devices,
                isLoadingDevices: false,
                deviceListError: null,
              });
              break;

            case 'subscribed':
              if (message.deviceId) {
                // Skip oscilloscopes - they're handled by oscilloscopeStore
                if (message.state && 'capabilities' in message.state) {
                  return;
                }
                set((state) => ({
                  deviceStates: {
                    ...state.deviceStates,
                    [message.deviceId]: {
                      sessionState: message.state,
                      isSubscribed: true,
                      error: null,
                    },
                  },
                }));
              }
              break;

            case 'unsubscribed':
              if (message.deviceId) {
                set((state) => ({
                  deviceStates: {
                    ...state.deviceStates,
                    [message.deviceId]: {
                      ...state.deviceStates[message.deviceId],
                      isSubscribed: false,
                    },
                  },
                }));
              }
              break;

            case 'measurement':
              if (message.deviceId) {
                const { timestamp, measurements } = message.update;
                set((state) => {
                  const deviceState = state.deviceStates[message.deviceId];
                  if (!deviceState?.sessionState) return state;

                  const prev = deviceState.sessionState;
                  const newMeasurements = { ...prev.measurements, ...measurements };

                  const newHistory: HistoryData = {
                    timestamps: [...prev.history.timestamps, timestamp].slice(-MAX_HISTORY_POINTS),
                    voltage: [...prev.history.voltage, measurements.voltage ?? prev.measurements.voltage ?? 0].slice(-MAX_HISTORY_POINTS),
                    current: [...prev.history.current, measurements.current ?? prev.measurements.current ?? 0].slice(-MAX_HISTORY_POINTS),
                    power: [...prev.history.power, measurements.power ?? prev.measurements.power ?? 0].slice(-MAX_HISTORY_POINTS),
                    resistance: measurements.resistance !== undefined
                      ? [...(prev.history.resistance ?? []), measurements.resistance].slice(-MAX_HISTORY_POINTS)
                      : prev.history.resistance,
                  };

                  return {
                    deviceStates: {
                      ...state.deviceStates,
                      [message.deviceId]: {
                        ...deviceState,
                        sessionState: {
                          ...prev,
                          measurements: newMeasurements,
                          history: newHistory,
                          lastUpdated: timestamp,
                        },
                      },
                    },
                  };
                });
              }
              break;

            case 'field':
              if (message.deviceId) {
                set((state) => {
                  const deviceState = state.deviceStates[message.deviceId];
                  if (!deviceState?.sessionState) return state;

                  const prev = deviceState.sessionState;
                  let updated: DeviceSessionState;

                  switch (message.field) {
                    case 'mode':
                      updated = { ...prev, mode: message.value as string };
                      break;
                    case 'outputEnabled':
                      updated = { ...prev, outputEnabled: message.value as boolean };
                      break;
                    case 'connectionStatus':
                      updated = { ...prev, connectionStatus: message.value as DeviceSessionState['connectionStatus'] };
                      break;
                    case 'setpoints':
                      updated = { ...prev, setpoints: message.value as Record<string, number> };
                      break;
                    case 'listRunning':
                      updated = { ...prev, listRunning: message.value as boolean };
                      break;
                    default:
                      updated = { ...prev, [message.field]: message.value };
                  }

                  return {
                    deviceStates: {
                      ...state.deviceStates,
                      [message.deviceId]: {
                        ...deviceState,
                        sessionState: updated,
                      },
                    },
                  };
                });
              }
              break;

            case 'error':
              if (message.deviceId) {
                // Device-specific error
                const errorDeviceId = message.deviceId;
                set((state) => ({
                  deviceStates: {
                    ...state.deviceStates,
                    [errorDeviceId]: {
                      ...state.deviceStates[errorDeviceId],
                      error: message.message,
                    },
                  },
                }));
              } else {
                // Global error (likely device list related)
                set({
                  deviceListError: message.message,
                  isLoadingDevices: false,
                });
              }
              break;
          }
        },
      };
    }),
    { name: 'DeviceStore', enabled: process.env.NODE_ENV === 'development' }
  )
);
