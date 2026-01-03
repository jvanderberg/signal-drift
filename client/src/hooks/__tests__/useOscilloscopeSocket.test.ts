import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { WaveformData, OscilloscopeMeasurement } from '../../../../shared/types';
import type { OscilloscopeSessionState } from '../../stores';

// Create mock oscilloscope state
function createMockState(deviceId: string): OscilloscopeSessionState {
  return {
    info: {
      id: deviceId,
      type: 'oscilloscope',
      manufacturer: 'RIGOL',
      model: 'DS1202Z-E',
      serial: 'DS1ZA123456789',
    },
    capabilities: {
      channels: 2,
      bandwidth: 200,
      maxSampleRate: 1e9,
      maxMemoryDepth: 24e6,
      supportedMeasurements: ['VPP', 'VAVG', 'FREQ', 'PERIOD'],
      hasAWG: false,
    },
    connectionStatus: 'connected',
    consecutiveErrors: 0,
    status: {
      running: true,
      triggerStatus: 'triggered',
      sampleRate: 1e9,
      memoryDepth: 12e6,
      channels: {
        CHAN1: { enabled: true, scale: 1, offset: 0, coupling: 'DC', probe: 1, bwLimit: false },
        CHAN2: { enabled: false, scale: 1, offset: 0, coupling: 'DC', probe: 1, bwLimit: false },
      },
      timebase: { scale: 0.001, offset: 0, mode: 'main' },
      trigger: { source: 'CHAN1', mode: 'edge', coupling: 'DC', level: 0, edge: 'rising', sweep: 'auto' },
      measurements: [],
    },
    lastUpdated: Date.now(),
  };
}

// Mock store state
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

const mockStoreState = {
  connectionState: 'disconnected' as string,
  oscilloscopeStates: {} as Record<string, OscilloscopeState>,
  subscribeOscilloscope: vi.fn(),
  unsubscribeOscilloscope: vi.fn(),
  run: vi.fn(),
  stop: vi.fn(),
  single: vi.fn(),
  autoSetup: vi.fn(),
  getWaveform: vi.fn(),
  getMeasurement: vi.fn(),
  getScreenshot: vi.fn(),
  clearError: vi.fn(),
  setChannelEnabled: vi.fn(),
  setChannelScale: vi.fn(),
  setChannelOffset: vi.fn(),
  setChannelCoupling: vi.fn(),
  setChannelProbe: vi.fn(),
  setChannelBwLimit: vi.fn(),
  setTimebaseScale: vi.fn(),
  setTimebaseOffset: vi.fn(),
  setTriggerSource: vi.fn(),
  setTriggerLevel: vi.fn(),
  setTriggerEdge: vi.fn(),
  setTriggerSweep: vi.fn(),
  startStreaming: vi.fn(),
  stopStreaming: vi.fn(),
  _initializeWebSocket: vi.fn(),
};

const defaultOscState: OscilloscopeState = {
  sessionState: null,
  isSubscribed: false,
  error: null,
  waveform: null,
  waveforms: [],
  measurements: [],
  screenshot: null,
  isStreaming: false,
};

// Mock the stores module
vi.mock('../../stores', () => ({
  useOscilloscopeStore: (selector: (state: typeof mockStoreState) => unknown) => {
    if (typeof selector === 'function') {
      return selector(mockStoreState);
    }
    return mockStoreState;
  },
  selectOscilloscope: (deviceId: string) => (state: typeof mockStoreState) =>
    state.oscilloscopeStates[deviceId] ?? defaultOscState,
}));

describe('useOscilloscopeSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreState.connectionState = 'disconnected';
    mockStoreState.oscilloscopeStates = {};
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Import the hook after mocking
  async function getHook() {
    const { useOscilloscopeSocket } = await import('../useOscilloscopeSocket');
    return useOscilloscopeSocket;
  }

  describe('Initial State', () => {
    it('should start with null state when oscilloscope not in store', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      expect(result.current.state).toBeNull();
      expect(result.current.isSubscribed).toBe(false);
    });

    it('should initialize WebSocket on mount', async () => {
      const useOscilloscopeSocket = await getHook();
      renderHook(() => useOscilloscopeSocket('scope-1'));

      expect(mockStoreState._initializeWebSocket).toHaveBeenCalled();
    });
  });

  describe('Store State Integration', () => {
    it('should return oscilloscope state from store', async () => {
      const mockState = createMockState('scope-1');
      mockStoreState.oscilloscopeStates['scope-1'] = {
        sessionState: mockState,
        isSubscribed: true,
        error: null,
        waveform: null,
        waveforms: [],
        measurements: [],
        screenshot: null,
        isStreaming: false,
      };

      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      expect(result.current.state).toEqual(mockState);
      expect(result.current.isSubscribed).toBe(true);
    });

    it('should return waveform data from store', async () => {
      const mockWaveform: WaveformData = {
        channel: 'CHAN1',
        points: [0, 0.5, 1, 0.5, 0, -0.5, -1, -0.5],
        xIncrement: 0.000001,
        xOrigin: 0,
        yIncrement: 0.01,
        yOrigin: 0,
        yReference: 128,
      };

      mockStoreState.oscilloscopeStates['scope-1'] = {
        ...defaultOscState,
        waveform: mockWaveform,
        waveforms: [mockWaveform],
      };

      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      expect(result.current.waveform).toEqual(mockWaveform);
      expect(result.current.waveforms).toEqual([mockWaveform]);
    });
  });

  describe('Channel Settings Actions', () => {
    it('should call setChannelEnabled with deviceId and params', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.setChannelEnabled('CHAN2', true);
      });

      expect(mockStoreState.setChannelEnabled).toHaveBeenCalledWith('scope-1', 'CHAN2', true);
    });

    it('should call setChannelScale with deviceId and params', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.setChannelScale('CHAN1', 0.5);
      });

      expect(mockStoreState.setChannelScale).toHaveBeenCalledWith('scope-1', 'CHAN1', 0.5);
    });

    it('should call setChannelOffset with deviceId and params', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.setChannelOffset('CHAN1', 1.5);
      });

      expect(mockStoreState.setChannelOffset).toHaveBeenCalledWith('scope-1', 'CHAN1', 1.5);
    });

    it('should call setChannelCoupling with deviceId and params', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.setChannelCoupling('CHAN1', 'AC');
      });

      expect(mockStoreState.setChannelCoupling).toHaveBeenCalledWith('scope-1', 'CHAN1', 'AC');
    });

    it('should call setChannelProbe with deviceId and params', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.setChannelProbe('CHAN1', 10);
      });

      expect(mockStoreState.setChannelProbe).toHaveBeenCalledWith('scope-1', 'CHAN1', 10);
    });

    it('should call setChannelBwLimit with deviceId and params', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.setChannelBwLimit('CHAN1', true);
      });

      expect(mockStoreState.setChannelBwLimit).toHaveBeenCalledWith('scope-1', 'CHAN1', true);
    });
  });

  describe('Timebase Settings Actions', () => {
    it('should call setTimebaseScale with deviceId and scale', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.setTimebaseScale(0.0001);
      });

      expect(mockStoreState.setTimebaseScale).toHaveBeenCalledWith('scope-1', 0.0001);
    });

    it('should call setTimebaseOffset with deviceId and offset', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.setTimebaseOffset(0.001);
      });

      expect(mockStoreState.setTimebaseOffset).toHaveBeenCalledWith('scope-1', 0.001);
    });
  });

  describe('Trigger Settings Actions', () => {
    it('should call setTriggerSource with deviceId and source', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.setTriggerSource('CHAN2');
      });

      expect(mockStoreState.setTriggerSource).toHaveBeenCalledWith('scope-1', 'CHAN2');
    });

    it('should call setTriggerLevel with deviceId and level', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.setTriggerLevel(1.5);
      });

      expect(mockStoreState.setTriggerLevel).toHaveBeenCalledWith('scope-1', 1.5);
    });

    it('should call setTriggerEdge with deviceId and edge', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.setTriggerEdge('falling');
      });

      expect(mockStoreState.setTriggerEdge).toHaveBeenCalledWith('scope-1', 'falling');
    });

    it('should call setTriggerSweep with deviceId and sweep', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.setTriggerSweep('normal');
      });

      expect(mockStoreState.setTriggerSweep).toHaveBeenCalledWith('scope-1', 'normal');
    });
  });

  describe('Streaming Actions', () => {
    it('should call startStreaming with deviceId and params', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.startStreaming(['CHAN1', 'CHAN2'], 200);
      });

      expect(mockStoreState.startStreaming).toHaveBeenCalledWith('scope-1', ['CHAN1', 'CHAN2'], 200, undefined);
    });

    it('should call startStreaming with measurements', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.startStreaming(['CHAN1'], 200, ['VPP', 'FREQ']);
      });

      expect(mockStoreState.startStreaming).toHaveBeenCalledWith('scope-1', ['CHAN1'], 200, ['VPP', 'FREQ']);
    });

    it('should call stopStreaming with deviceId', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.stopStreaming();
      });

      expect(mockStoreState.stopStreaming).toHaveBeenCalledWith('scope-1');
    });
  });

  describe('Run Control Actions', () => {
    it('should call run with deviceId', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.run();
      });

      expect(mockStoreState.run).toHaveBeenCalledWith('scope-1');
    });

    it('should call stop with deviceId', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.stop();
      });

      expect(mockStoreState.stop).toHaveBeenCalledWith('scope-1');
    });

    it('should call single with deviceId', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.single();
      });

      expect(mockStoreState.single).toHaveBeenCalledWith('scope-1');
    });

    it('should call autoSetup with deviceId', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.autoSetup();
      });

      expect(mockStoreState.autoSetup).toHaveBeenCalledWith('scope-1');
    });
  });

  describe('Subscription Actions', () => {
    it('should call subscribeOscilloscope with deviceId', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.subscribe();
      });

      expect(mockStoreState.subscribeOscilloscope).toHaveBeenCalledWith('scope-1');
    });

    it('should call unsubscribeOscilloscope with deviceId', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.unsubscribe();
      });

      expect(mockStoreState.unsubscribeOscilloscope).toHaveBeenCalledWith('scope-1');
    });
  });

  describe('Error Handling', () => {
    it('should return error from store', async () => {
      mockStoreState.oscilloscopeStates['scope-1'] = {
        ...defaultOscState,
        error: 'Connection lost',
      };

      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      expect(result.current.error).toBe('Connection lost');
    });

    it('should call clearError with deviceId', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.clearError();
      });

      expect(mockStoreState.clearError).toHaveBeenCalledWith('scope-1');
    });
  });
});
