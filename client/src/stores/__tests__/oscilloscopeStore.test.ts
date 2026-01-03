import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import type { ServerMessage, WaveformData, OscilloscopeCapabilities, DeviceSessionState, DeviceCapabilities } from '../../../../shared/types';
import type { OscilloscopeSessionState } from '../oscilloscopeStore';

// Helper to create valid mock WaveformData
const createMockWaveform = (channel: string, points: number[] = [0, 0.5, 1, 0.5, 0]): WaveformData => ({
  channel,
  points,
  xIncrement: 0.001,
  xOrigin: 0,
  yIncrement: 0.01,
  yOrigin: 0,
  yReference: 128,
});

// Helper to create valid mock OscilloscopeCapabilities
const createMockOscilloscopeCapabilities = (): OscilloscopeCapabilities => ({
  channels: 4,
  bandwidth: 100,
  maxSampleRate: 1e9,
  maxMemoryDepth: 1e6,
  supportedMeasurements: ['VPP', 'VAVG', 'FREQ'],
  hasAWG: false,
});

// Mark unused imports as intentionally available
void ({} as DeviceCapabilities);

// Helper to create valid mock OscilloscopeSessionState
const createMockOscilloscopeSessionState = (overrides?: Partial<OscilloscopeSessionState>): OscilloscopeSessionState => ({
  info: { id: 'scope-1', type: 'oscilloscope', manufacturer: 'Test', model: 'Scope' },
  capabilities: createMockOscilloscopeCapabilities(),
  connectionStatus: 'connected',
  consecutiveErrors: 0,
  status: null,
  lastUpdated: Date.now(),
  ...overrides,
});

// Helper to create mock DeviceSessionState for PSU (non-oscilloscope) test
const createMockPSUSessionState = (): DeviceSessionState => ({
  info: { id: 'psu-1', type: 'power-supply', manufacturer: 'Test', model: 'PSU' },
  capabilities: { deviceClass: 'psu', features: {}, modes: ['CV'], modesSettable: true, outputs: [], measurements: [] },
  connectionStatus: 'connected',
  consecutiveErrors: 0,
  mode: 'CV',
  outputEnabled: false,
  setpoints: {},
  measurements: {},
  history: { timestamps: [], voltage: [], current: [], power: [] },
  lastUpdated: Date.now(),
});

// Mock state needs to be declared before vi.mock due to hoisting
const mockState = {
  send: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  getState: vi.fn(() => 'disconnected'),
  messageHandlers: [] as ((msg: ServerMessage) => void)[],
  stateHandlers: [] as ((state: string) => void)[],
};

vi.mock('../../websocket', () => ({
  getWebSocketManager: () => ({
    send: (...args: unknown[]) => mockState.send(...args),
    connect: () => mockState.connect(),
    disconnect: () => mockState.disconnect(),
    getState: () => mockState.getState(),
    onMessage: (handler: (msg: ServerMessage) => void) => {
      mockState.messageHandlers.push(handler);
      return () => {
        mockState.messageHandlers = mockState.messageHandlers.filter(h => h !== handler);
      };
    },
    onStateChange: (handler: (state: string) => void) => {
      mockState.stateHandlers.push(handler);
      return () => {
        mockState.stateHandlers = mockState.stateHandlers.filter(h => h !== handler);
      };
    },
  }),
}));

// Import after mock is set up
import {
  useOscilloscopeStore,
  selectOscilloscope,
  selectOscilloscopeState,
  selectWaveforms,
  selectMeasurements,
  selectIsStreaming,
} from '../oscilloscopeStore';

// Helper to simulate WebSocket messages
function simulateMessage(msg: ServerMessage) {
  mockState.messageHandlers.forEach(h => h(msg));
}

describe('oscilloscopeStore', () => {
  // Initialize store handlers once before all tests
  beforeAll(() => {
    // Trigger store initialization
    useOscilloscopeStore.getState().subscribeOscilloscope('init-device');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store state but keep handlers registered
    useOscilloscopeStore.setState({
      connectionState: 'disconnected',
      oscilloscopeStates: {},
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Initial state', () => {
    it('should have correct initial state', () => {
      const state = useOscilloscopeStore.getState();
      expect(state.connectionState).toBe('disconnected');
      expect(state.oscilloscopeStates).toEqual({});
    });
  });

  describe('Subscription actions', () => {
    it('subscribeOscilloscope should call connect and send subscribe', () => {
      act(() => {
        useOscilloscopeStore.getState().subscribeOscilloscope('scope-1');
      });

      expect(mockState.connect).toHaveBeenCalled();
      expect(mockState.send).toHaveBeenCalledWith({ type: 'subscribe', deviceId: 'scope-1' });
    });

    it('unsubscribeOscilloscope should send unsubscribe and update state', () => {
      useOscilloscopeStore.setState({
        oscilloscopeStates: {
          'scope-1': {
            sessionState: null,
            isSubscribed: true,
            isStreaming: true,
            error: null,
            waveform: null,
            waveforms: [],
            measurements: [],
            screenshot: null,
          },
        },
      });

      act(() => {
        useOscilloscopeStore.getState().unsubscribeOscilloscope('scope-1');
      });

      // Should stop streaming first
      expect(mockState.send).toHaveBeenCalledWith({ type: 'scopeStopStreaming', deviceId: 'scope-1' });
      expect(mockState.send).toHaveBeenCalledWith({ type: 'unsubscribe', deviceId: 'scope-1' });

      const state = useOscilloscopeStore.getState().oscilloscopeStates['scope-1'];
      expect(state.isSubscribed).toBe(false);
      expect(state.isStreaming).toBe(false);
    });
  });

  describe('Run control actions', () => {
    it('run should send scopeRun message', () => {
      act(() => {
        useOscilloscopeStore.getState().run('scope-1');
      });
      expect(mockState.send).toHaveBeenCalledWith({ type: 'scopeRun', deviceId: 'scope-1' });
    });

    it('stop should send scopeStop message', () => {
      act(() => {
        useOscilloscopeStore.getState().stop('scope-1');
      });
      expect(mockState.send).toHaveBeenCalledWith({ type: 'scopeStop', deviceId: 'scope-1' });
    });

    it('single should send scopeSingle message', () => {
      act(() => {
        useOscilloscopeStore.getState().single('scope-1');
      });
      expect(mockState.send).toHaveBeenCalledWith({ type: 'scopeSingle', deviceId: 'scope-1' });
    });

    it('autoSetup should send scopeAutoSetup message', () => {
      act(() => {
        useOscilloscopeStore.getState().autoSetup('scope-1');
      });
      expect(mockState.send).toHaveBeenCalledWith({ type: 'scopeAutoSetup', deviceId: 'scope-1' });
    });
  });

  describe('Data acquisition actions', () => {
    it('getWaveform should send scopeGetWaveform message', () => {
      act(() => {
        useOscilloscopeStore.getState().getWaveform('scope-1', 'CH1');
      });
      expect(mockState.send).toHaveBeenCalledWith({
        type: 'scopeGetWaveform',
        deviceId: 'scope-1',
        channel: 'CH1',
      });
    });

    it('getMeasurement should send scopeGetMeasurement message', () => {
      act(() => {
        useOscilloscopeStore.getState().getMeasurement('scope-1', 'CH1', 'FREQ');
      });
      expect(mockState.send).toHaveBeenCalledWith({
        type: 'scopeGetMeasurement',
        deviceId: 'scope-1',
        channel: 'CH1',
        measurementType: 'FREQ',
      });
    });

    it('getScreenshot should send scopeGetScreenshot message', () => {
      act(() => {
        useOscilloscopeStore.getState().getScreenshot('scope-1');
      });
      expect(mockState.send).toHaveBeenCalledWith({ type: 'scopeGetScreenshot', deviceId: 'scope-1' });
    });
  });

  describe('Channel settings', () => {
    it('setChannelEnabled should send correct message', () => {
      act(() => {
        useOscilloscopeStore.getState().setChannelEnabled('scope-1', 'CH1', true);
      });
      expect(mockState.send).toHaveBeenCalledWith({
        type: 'scopeSetChannelEnabled',
        deviceId: 'scope-1',
        channel: 'CH1',
        enabled: true,
      });
    });

    it('setChannelScale should send correct message', () => {
      act(() => {
        useOscilloscopeStore.getState().setChannelScale('scope-1', 'CH1', 1.0);
      });
      expect(mockState.send).toHaveBeenCalledWith({
        type: 'scopeSetChannelScale',
        deviceId: 'scope-1',
        channel: 'CH1',
        scale: 1.0,
      });
    });

    it('setChannelOffset should send correct message', () => {
      act(() => {
        useOscilloscopeStore.getState().setChannelOffset('scope-1', 'CH1', 2.5);
      });
      expect(mockState.send).toHaveBeenCalledWith({
        type: 'scopeSetChannelOffset',
        deviceId: 'scope-1',
        channel: 'CH1',
        offset: 2.5,
      });
    });

    it('setChannelCoupling should send correct message', () => {
      act(() => {
        useOscilloscopeStore.getState().setChannelCoupling('scope-1', 'CH1', 'DC');
      });
      expect(mockState.send).toHaveBeenCalledWith({
        type: 'scopeSetChannelCoupling',
        deviceId: 'scope-1',
        channel: 'CH1',
        coupling: 'DC',
      });
    });
  });

  describe('Trigger settings', () => {
    it('setTriggerLevel should send correct message', () => {
      act(() => {
        useOscilloscopeStore.getState().setTriggerLevel('scope-1', 1.5);
      });
      expect(mockState.send).toHaveBeenCalledWith({
        type: 'scopeSetTriggerLevel',
        deviceId: 'scope-1',
        level: 1.5,
      });
    });

    it('setTriggerEdge should send correct message', () => {
      act(() => {
        useOscilloscopeStore.getState().setTriggerEdge('scope-1', 'rising');
      });
      expect(mockState.send).toHaveBeenCalledWith({
        type: 'scopeSetTriggerEdge',
        deviceId: 'scope-1',
        edge: 'rising',
      });
    });
  });

  describe('Streaming', () => {
    it('startStreaming should send message and set state', () => {
      act(() => {
        useOscilloscopeStore.getState().startStreaming('scope-1', ['CH1', 'CH2'], 100, ['FREQ']);
      });

      expect(mockState.send).toHaveBeenCalledWith({
        type: 'scopeStartStreaming',
        deviceId: 'scope-1',
        channels: ['CH1', 'CH2'],
        intervalMs: 100,
        measurements: ['FREQ'],
      });

      expect(useOscilloscopeStore.getState().oscilloscopeStates['scope-1'].isStreaming).toBe(true);
    });

    it('stopStreaming should send message and clear state', () => {
      useOscilloscopeStore.setState({
        oscilloscopeStates: {
          'scope-1': {
            sessionState: null,
            isSubscribed: true,
            isStreaming: true,
            error: null,
            waveform: null,
            waveforms: [],
            measurements: [],
            screenshot: null,
          },
        },
      });

      act(() => {
        useOscilloscopeStore.getState().stopStreaming('scope-1');
      });

      expect(mockState.send).toHaveBeenCalledWith({
        type: 'scopeStopStreaming',
        deviceId: 'scope-1',
      });

      expect(useOscilloscopeStore.getState().oscilloscopeStates['scope-1'].isStreaming).toBe(false);
    });
  });

  describe('Message handling', () => {
    describe('subscribed message', () => {
      it('should set up oscilloscope state on subscription', () => {
        const mockSessionState = createMockOscilloscopeSessionState();

        act(() => {
          simulateMessage({
            type: 'subscribed',
            deviceId: 'scope-1',
            // The server sends DeviceSessionState but oscilloscopes have extra fields
            // The store uses isOscilloscopeState() to check and cast at runtime
            state: mockSessionState as unknown as DeviceSessionState,
          });
        });

        const state = useOscilloscopeStore.getState().oscilloscopeStates['scope-1'];
        expect(state).toBeDefined();
        expect(state.isSubscribed).toBe(true);
        expect(state.sessionState).toEqual(mockSessionState);
      });

      it('should ignore non-oscilloscope subscriptions', () => {
        // Create a PSU state that looks like a non-oscilloscope device
        const mockPSUState = createMockPSUSessionState();

        act(() => {
          simulateMessage({
            type: 'subscribed',
            deviceId: 'psu-1',
            state: mockPSUState,
          });
        });

        expect(useOscilloscopeStore.getState().oscilloscopeStates['psu-1']).toBeUndefined();
      });
    });

    describe('scopeWaveform message', () => {
      it('should add waveform data', () => {
        useOscilloscopeStore.setState({
          oscilloscopeStates: {
            'scope-1': {
              sessionState: null,
              isSubscribed: true,
              isStreaming: true,
              error: null,
              waveform: null,
              waveforms: [],
              measurements: [],
              screenshot: null,
            },
          },
        });

        const mockWaveform = createMockWaveform('CH1');

        act(() => {
          simulateMessage({
            type: 'scopeWaveform',
            deviceId: 'scope-1',
            channel: 'CH1',
            waveform: mockWaveform,
          });
        });

        const state = useOscilloscopeStore.getState().oscilloscopeStates['scope-1'];
        expect(state.waveform).toEqual(mockWaveform);
        expect(state.waveforms).toHaveLength(1);
        expect(state.waveforms[0]).toEqual(mockWaveform);
      });

      it('should replace existing waveform for same channel', () => {
        const existingWaveform = createMockWaveform('CH1', [0, 0]);
        useOscilloscopeStore.setState({
          oscilloscopeStates: {
            'scope-1': {
              sessionState: null,
              isSubscribed: true,
              isStreaming: true,
              error: null,
              waveform: existingWaveform,
              waveforms: [existingWaveform],
              measurements: [],
              screenshot: null,
            },
          },
        });

        const newWaveform = createMockWaveform('CH1', [1, 1, 1]);

        act(() => {
          simulateMessage({
            type: 'scopeWaveform',
            deviceId: 'scope-1',
            channel: 'CH1',
            waveform: newWaveform,
          });
        });

        const state = useOscilloscopeStore.getState().oscilloscopeStates['scope-1'];
        expect(state.waveforms).toHaveLength(1);
        expect(state.waveforms[0].points).toEqual([1, 1, 1]);
      });
    });

    describe('scopeMeasurement message', () => {
      it('should add measurement data', () => {
        useOscilloscopeStore.setState({
          oscilloscopeStates: {
            'scope-1': {
              sessionState: null,
              isSubscribed: true,
              isStreaming: true,
              error: null,
              waveform: null,
              waveforms: [],
              measurements: [],
              screenshot: null,
            },
          },
        });

        act(() => {
          simulateMessage({
            type: 'scopeMeasurement',
            deviceId: 'scope-1',
            channel: 'CH1',
            measurementType: 'FREQ',
            value: 1000,
          });
        });

        const state = useOscilloscopeStore.getState().oscilloscopeStates['scope-1'];
        expect(state.measurements).toHaveLength(1);
        expect(state.measurements[0]).toEqual({
          channel: 'CH1',
          type: 'FREQ',
          value: 1000,
          unit: 'Hz',
        });
      });

      it('should update existing measurement', () => {
        useOscilloscopeStore.setState({
          oscilloscopeStates: {
            'scope-1': {
              sessionState: null,
              isSubscribed: true,
              isStreaming: true,
              error: null,
              waveform: null,
              waveforms: [],
              measurements: [{ channel: 'CH1', type: 'FREQ', value: 500, unit: 'Hz' }],
              screenshot: null,
            },
          },
        });

        act(() => {
          simulateMessage({
            type: 'scopeMeasurement',
            deviceId: 'scope-1',
            channel: 'CH1',
            measurementType: 'FREQ',
            value: 1000,
          });
        });

        const state = useOscilloscopeStore.getState().oscilloscopeStates['scope-1'];
        expect(state.measurements).toHaveLength(1);
        expect(state.measurements[0].value).toBe(1000);
      });

      it('should ignore null measurements', () => {
        useOscilloscopeStore.setState({
          oscilloscopeStates: {
            'scope-1': {
              sessionState: null,
              isSubscribed: true,
              isStreaming: true,
              error: null,
              waveform: null,
              waveforms: [],
              measurements: [],
              screenshot: null,
            },
          },
        });

        act(() => {
          simulateMessage({
            type: 'scopeMeasurement',
            deviceId: 'scope-1',
            channel: 'CH1',
            measurementType: 'FREQ',
            value: null,
          });
        });

        const state = useOscilloscopeStore.getState().oscilloscopeStates['scope-1'];
        expect(state.measurements).toHaveLength(0);
      });
    });

    describe('scopeScreenshot message', () => {
      it('should store screenshot data', () => {
        useOscilloscopeStore.setState({
          oscilloscopeStates: {
            'scope-1': {
              sessionState: null,
              isSubscribed: true,
              isStreaming: false,
              error: null,
              waveform: null,
              waveforms: [],
              measurements: [],
              screenshot: null,
            },
          },
        });

        act(() => {
          simulateMessage({
            type: 'scopeScreenshot',
            deviceId: 'scope-1',
            data: 'base64-png-data',
          });
        });

        expect(useOscilloscopeStore.getState().oscilloscopeStates['scope-1'].screenshot).toBe('base64-png-data');
      });
    });

    describe('error message', () => {
      it('should set device error', () => {
        useOscilloscopeStore.setState({
          oscilloscopeStates: {
            'scope-1': {
              sessionState: null,
              isSubscribed: true,
              isStreaming: false,
              error: null,
              waveform: null,
              waveforms: [],
              measurements: [],
              screenshot: null,
            },
          },
        });

        act(() => {
          simulateMessage({
            type: 'error',
            deviceId: 'scope-1',
            code: 'CONNECTION_TIMEOUT',
            message: 'Connection timeout',
          });
        });

        expect(useOscilloscopeStore.getState().oscilloscopeStates['scope-1'].error).toBe('Connection timeout');
      });
    });
  });

  describe('Selectors', () => {
    let sampleSessionState: OscilloscopeSessionState;
    let sampleWaveform: WaveformData;

    beforeEach(() => {
      sampleSessionState = createMockOscilloscopeSessionState();
      sampleWaveform = createMockWaveform('CH1', [1, 2, 3]);
      useOscilloscopeStore.setState({
        oscilloscopeStates: {
          'scope-1': {
            sessionState: sampleSessionState,
            isSubscribed: true,
            isStreaming: true,
            error: null,
            waveform: sampleWaveform,
            waveforms: [sampleWaveform],
            measurements: [{ channel: 'CH1', type: 'FREQ', value: 1000, unit: 'Hz' }],
            screenshot: null,
          },
        },
      });
    });

    it('selectOscilloscope should return oscilloscope state or default', () => {
      const existing = selectOscilloscope('scope-1')(useOscilloscopeStore.getState());
      expect(existing.isSubscribed).toBe(true);

      const nonExisting = selectOscilloscope('scope-999')(useOscilloscopeStore.getState());
      expect(nonExisting.isSubscribed).toBe(false);
      expect(nonExisting.waveforms).toEqual([]);
    });

    it('selectOscilloscopeState should return session state or null', () => {
      expect(selectOscilloscopeState('scope-1')(useOscilloscopeStore.getState())).toEqual(sampleSessionState);
      expect(selectOscilloscopeState('scope-999')(useOscilloscopeStore.getState())).toBeNull();
    });

    it('selectWaveforms should return waveforms array', () => {
      expect(selectWaveforms('scope-1')(useOscilloscopeStore.getState())).toHaveLength(1);
      expect(selectWaveforms('scope-999')(useOscilloscopeStore.getState())).toEqual([]);
    });

    it('selectMeasurements should return measurements array', () => {
      expect(selectMeasurements('scope-1')(useOscilloscopeStore.getState())).toHaveLength(1);
      expect(selectMeasurements('scope-999')(useOscilloscopeStore.getState())).toEqual([]);
    });

    it('selectIsStreaming should return streaming status', () => {
      expect(selectIsStreaming('scope-1')(useOscilloscopeStore.getState())).toBe(true);
      expect(selectIsStreaming('scope-999')(useOscilloscopeStore.getState())).toBe(false);
    });
  });

  describe('Error handling', () => {
    it('clearError should clear device error', () => {
      useOscilloscopeStore.setState({
        oscilloscopeStates: {
          'scope-1': {
            sessionState: null,
            isSubscribed: true,
            isStreaming: false,
            error: 'Some error',
            waveform: null,
            waveforms: [],
            measurements: [],
            screenshot: null,
          },
        },
      });

      act(() => {
        useOscilloscopeStore.getState().clearError('scope-1');
      });

      expect(useOscilloscopeStore.getState().oscilloscopeStates['scope-1'].error).toBeNull();
    });
  });
});
