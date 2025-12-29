import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ServerMessage, OscilloscopeStatus, WaveformData } from '../../../../shared/types';
import type { OscilloscopeSessionState } from '../useOscilloscopeSocket';

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

// Mock the websocket manager
const mockSend = vi.fn();
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
let mockOnMessageHandler: ((msg: ServerMessage) => void) | null = null;
let mockState = 'disconnected';

vi.mock('../../websocket', () => ({
  getWebSocketManager: () => ({
    connect: mockConnect,
    disconnect: mockDisconnect,
    send: mockSend,
    getState: () => mockState,
    onMessage: (handler: (msg: ServerMessage) => void) => {
      mockOnMessageHandler = handler;
      return () => { mockOnMessageHandler = null; };
    },
    onStateChange: (_handler: (state: string) => void) => {
      // Handler not used in these tests, but required by the interface
      return () => {};
    },
  }),
  resetWebSocketManager: vi.fn(),
}));

// Helper to simulate receiving a message
function simulateMessage(msg: ServerMessage): void {
  if (mockOnMessageHandler) {
    mockOnMessageHandler(msg);
  }
}

describe('useOscilloscopeSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOnMessageHandler = null;
    mockState = 'disconnected';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Import the hook after mocking
  async function getHook() {
    const { useOscilloscopeSocket } = await import('../useOscilloscopeSocket');
    return useOscilloscopeSocket;
  }

  describe('Channel Settings', () => {
    it('should send setChannelEnabled message', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.setChannelEnabled('CHAN2', true);
      });

      expect(mockSend).toHaveBeenCalledWith({
        type: 'scopeSetChannelEnabled',
        deviceId: 'scope-1',
        channel: 'CHAN2',
        enabled: true,
      });
    });

    it('should send setChannelScale message', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.setChannelScale('CHAN1', 0.5);
      });

      expect(mockSend).toHaveBeenCalledWith({
        type: 'scopeSetChannelScale',
        deviceId: 'scope-1',
        channel: 'CHAN1',
        scale: 0.5,
      });
    });

    it('should send setChannelOffset message', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.setChannelOffset('CHAN1', 1.5);
      });

      expect(mockSend).toHaveBeenCalledWith({
        type: 'scopeSetChannelOffset',
        deviceId: 'scope-1',
        channel: 'CHAN1',
        offset: 1.5,
      });
    });

    it('should send setChannelCoupling message', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.setChannelCoupling('CHAN1', 'AC');
      });

      expect(mockSend).toHaveBeenCalledWith({
        type: 'scopeSetChannelCoupling',
        deviceId: 'scope-1',
        channel: 'CHAN1',
        coupling: 'AC',
      });
    });

    it('should send setChannelProbe message', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.setChannelProbe('CHAN1', 10);
      });

      expect(mockSend).toHaveBeenCalledWith({
        type: 'scopeSetChannelProbe',
        deviceId: 'scope-1',
        channel: 'CHAN1',
        ratio: 10,
      });
    });

    it('should send setChannelBwLimit message', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.setChannelBwLimit('CHAN1', true);
      });

      expect(mockSend).toHaveBeenCalledWith({
        type: 'scopeSetChannelBwLimit',
        deviceId: 'scope-1',
        channel: 'CHAN1',
        enabled: true,
      });
    });
  });

  describe('Timebase Settings', () => {
    it('should send setTimebaseScale message', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.setTimebaseScale(0.0001);
      });

      expect(mockSend).toHaveBeenCalledWith({
        type: 'scopeSetTimebaseScale',
        deviceId: 'scope-1',
        scale: 0.0001,
      });
    });

    it('should send setTimebaseOffset message', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.setTimebaseOffset(0.001);
      });

      expect(mockSend).toHaveBeenCalledWith({
        type: 'scopeSetTimebaseOffset',
        deviceId: 'scope-1',
        offset: 0.001,
      });
    });
  });

  describe('Trigger Settings', () => {
    it('should send setTriggerSource message', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.setTriggerSource('CHAN2');
      });

      expect(mockSend).toHaveBeenCalledWith({
        type: 'scopeSetTriggerSource',
        deviceId: 'scope-1',
        source: 'CHAN2',
      });
    });

    it('should send setTriggerLevel message', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.setTriggerLevel(1.5);
      });

      expect(mockSend).toHaveBeenCalledWith({
        type: 'scopeSetTriggerLevel',
        deviceId: 'scope-1',
        level: 1.5,
      });
    });

    it('should send setTriggerEdge message', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.setTriggerEdge('falling');
      });

      expect(mockSend).toHaveBeenCalledWith({
        type: 'scopeSetTriggerEdge',
        deviceId: 'scope-1',
        edge: 'falling',
      });
    });

    it('should send setTriggerSweep message', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.setTriggerSweep('normal');
      });

      expect(mockSend).toHaveBeenCalledWith({
        type: 'scopeSetTriggerSweep',
        deviceId: 'scope-1',
        sweep: 'normal',
      });
    });
  });

  describe('Streaming', () => {
    it('should send startStreaming message', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.startStreaming(['CHAN1', 'CHAN2'], 200);
      });

      expect(mockSend).toHaveBeenCalledWith({
        type: 'scopeStartStreaming',
        deviceId: 'scope-1',
        channels: ['CHAN1', 'CHAN2'],
        intervalMs: 200,
      });
    });

    it('should send stopStreaming message', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.stopStreaming();
      });

      expect(mockSend).toHaveBeenCalledWith({
        type: 'scopeStopStreaming',
        deviceId: 'scope-1',
      });
    });

    it('should update waveform state when streaming waveform is received', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      const mockWaveform: WaveformData = {
        channel: 'CHAN1',
        points: [0, 0.5, 1, 0.5, 0, -0.5, -1, -0.5],
        xIncrement: 0.000001,
        xOrigin: 0,
        yIncrement: 0.01,
        yOrigin: 0,
        yReference: 128,
      };

      act(() => {
        simulateMessage({
          type: 'scopeWaveform',
          deviceId: 'scope-1',
          channel: 'CHAN1',
          waveform: mockWaveform,
        });
      });

      expect(result.current.waveform).toEqual(mockWaveform);
    });
  });

  describe('Existing Actions', () => {
    it('should send run message', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.run();
      });

      expect(mockSend).toHaveBeenCalledWith({
        type: 'scopeRun',
        deviceId: 'scope-1',
      });
    });

    it('should send stop message', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.stop();
      });

      expect(mockSend).toHaveBeenCalledWith({
        type: 'scopeStop',
        deviceId: 'scope-1',
      });
    });

    it('should send single message', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.single();
      });

      expect(mockSend).toHaveBeenCalledWith({
        type: 'scopeSingle',
        deviceId: 'scope-1',
      });
    });

    it('should send autoSetup message', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      act(() => {
        result.current.autoSetup();
      });

      expect(mockSend).toHaveBeenCalledWith({
        type: 'scopeAutoSetup',
        deviceId: 'scope-1',
      });
    });
  });

  describe('State Updates', () => {
    it('should update state when subscribed message is received', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      const mockState = createMockState('scope-1');

      act(() => {
        simulateMessage({
          type: 'subscribed',
          deviceId: 'scope-1',
          state: mockState as any,
        });
      });

      expect(result.current.state).not.toBeNull();
      expect(result.current.state?.info.id).toBe('scope-1');
      expect(result.current.isSubscribed).toBe(true);
    });

    it('should update oscilloscope status when field message is received', async () => {
      const useOscilloscopeSocket = await getHook();
      const { result } = renderHook(() => useOscilloscopeSocket('scope-1'));

      // First subscribe
      act(() => {
        simulateMessage({
          type: 'subscribed',
          deviceId: 'scope-1',
          state: createMockState('scope-1') as any,
        });
      });

      const newStatus: OscilloscopeStatus = {
        running: false,
        triggerStatus: 'stopped',
        sampleRate: 500e6,
        memoryDepth: 6e6,
        channels: {
          CHAN1: { enabled: true, scale: 2, offset: 0, coupling: 'DC', probe: 10, bwLimit: false },
        },
        timebase: { scale: 0.0001, offset: 0, mode: 'main' },
        trigger: { source: 'CHAN1', mode: 'edge', coupling: 'DC', level: 1.0, edge: 'rising', sweep: 'auto' },
        measurements: [],
      };

      act(() => {
        simulateMessage({
          type: 'field',
          deviceId: 'scope-1',
          field: 'oscilloscopeStatus',
          value: newStatus,
        });
      });

      expect(result.current.state?.status?.running).toBe(false);
      expect(result.current.state?.status?.triggerStatus).toBe('stopped');
    });
  });
});
