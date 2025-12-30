import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createOscilloscopeSession } from '../OscilloscopeSession.js';
import type { OscilloscopeDriver, OscilloscopeStatus, WaveformData } from '../../devices/types.js';
import { Ok, Err } from '../../../shared/types.js';

// Mock waveform data
const mockWaveform: WaveformData = {
  channel: 'CHAN1',
  points: [0, 0.5, 1, 0.5, 0, -0.5, -1, -0.5, 0],
  xIncrement: 0.000001,
  xOrigin: 0,
  yIncrement: 0.01,
  yOrigin: 0,
  yReference: 128,
};

// Mock oscilloscope status
const mockStatus: OscilloscopeStatus = {
  running: true,
  triggerStatus: 'triggered',
  sampleRate: 1e9,
  memoryDepth: 12000,
  channels: {
    CHAN1: { enabled: true, scale: 1, offset: 0, coupling: 'DC', probe: 1, bwLimit: false },
    CHAN2: { enabled: false, scale: 1, offset: 0, coupling: 'DC', probe: 1, bwLimit: false },
  },
  trigger: { source: 'CHAN1', mode: 'edge', coupling: 'DC', level: 0, edge: 'rising', sweep: 'auto' },
  timebase: { scale: 0.001, offset: 0, mode: 'main' },
  measurements: [],
};

function createMockDriver(): OscilloscopeDriver {
  return {
    info: {
      id: 'scope-1',
      type: 'oscilloscope',
      manufacturer: 'Rigol',
      model: 'DS1202Z-E',
    },
    capabilities: {
      channels: 2,
      bandwidth: 200,
      maxSampleRate: 1e9,
      maxMemoryDepth: 24000000,
      supportedMeasurements: ['VPP', 'FREQ'],
      hasAWG: false,
    },
    probe: vi.fn().mockResolvedValue(Ok({ id: 'scope-1', type: 'oscilloscope', manufacturer: 'Rigol', model: 'DS1202Z-E' })),
    connect: vi.fn().mockResolvedValue(Ok()),
    disconnect: vi.fn().mockResolvedValue(Ok()),
    getStatus: vi.fn().mockResolvedValue(Ok(mockStatus)),
    getMeasurements: vi.fn().mockResolvedValue(Ok({})),
    getWaveform: vi.fn().mockImplementation(async (channel: string) => Ok({
      ...mockWaveform,
      channel,
    })),
    getScreenshot: vi.fn().mockResolvedValue(Ok(Buffer.from('screenshot'))),
    getMeasurement: vi.fn().mockResolvedValue(Ok(1.5)),
    run: vi.fn().mockResolvedValue(Ok()),
    stop: vi.fn().mockResolvedValue(Ok()),
    single: vi.fn().mockResolvedValue(Ok()),
    autoSetup: vi.fn().mockResolvedValue(Ok()),
    forceTrigger: vi.fn().mockResolvedValue(Ok()),
    setChannelEnabled: vi.fn().mockResolvedValue(Ok()),
    setChannelScale: vi.fn().mockResolvedValue(Ok()),
    setChannelOffset: vi.fn().mockResolvedValue(Ok()),
    setChannelCoupling: vi.fn().mockResolvedValue(Ok()),
    setChannelProbe: vi.fn().mockResolvedValue(Ok()),
    setChannelBwLimit: vi.fn().mockResolvedValue(Ok()),
    setTimebaseScale: vi.fn().mockResolvedValue(Ok()),
    setTimebaseOffset: vi.fn().mockResolvedValue(Ok()),
    setTriggerSource: vi.fn().mockResolvedValue(Ok()),
    setTriggerLevel: vi.fn().mockResolvedValue(Ok()),
    setTriggerEdge: vi.fn().mockResolvedValue(Ok()),
    setTriggerSweep: vi.fn().mockResolvedValue(Ok()),
  };
}

describe('OscilloscopeSession Streaming', () => {
  let mockDriver: OscilloscopeDriver;

  beforeEach(() => {
    vi.useFakeTimers();
    mockDriver = createMockDriver();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('startStreaming', () => {
    it('should start periodic waveform fetch for single channel', async () => {
      const session = createOscilloscopeSession(mockDriver);
      const callback = vi.fn();
      session.subscribe('client-1', callback);

      // Wait for initial poll
      await vi.advanceTimersByTimeAsync(0);
      callback.mockClear();

      await session.startStreaming(['CHAN1'], 200);

      // Should have fetched once immediately
      expect(mockDriver.getWaveform).toHaveBeenCalledWith('CHAN1');
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'scopeWaveform',
          deviceId: 'scope-1',
          channel: 'CHAN1',
        })
      );

      session.stopSession();
    });

    it('should start periodic waveform fetch for multiple channels', async () => {
      const session = createOscilloscopeSession(mockDriver);
      const callback = vi.fn();
      session.subscribe('client-1', callback);

      // Wait for initial poll
      await vi.advanceTimersByTimeAsync(0);
      callback.mockClear();

      await session.startStreaming(['CHAN1', 'CHAN2'], 350);

      // Should have fetched both channels
      expect(mockDriver.getWaveform).toHaveBeenCalledWith('CHAN1');
      expect(mockDriver.getWaveform).toHaveBeenCalledWith('CHAN2');

      session.stopSession();
    });

    it('should broadcast scopeWaveform messages to all subscribers', async () => {
      const session = createOscilloscopeSession(mockDriver);
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      session.subscribe('client-1', callback1);
      session.subscribe('client-2', callback2);

      // Wait for initial poll
      await vi.advanceTimersByTimeAsync(0);
      callback1.mockClear();
      callback2.mockClear();

      await session.startStreaming(['CHAN1'], 200);

      // Both subscribers should receive the waveform
      expect(callback1).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'scopeWaveform', channel: 'CHAN1' })
      );
      expect(callback2).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'scopeWaveform', channel: 'CHAN1' })
      );

      session.stopSession();
    });

    it('should continue fetching at interval', async () => {
      const session = createOscilloscopeSession(mockDriver);
      const callback = vi.fn();
      session.subscribe('client-1', callback);

      // Wait for initial poll
      await vi.advanceTimersByTimeAsync(0);
      (mockDriver.getWaveform as ReturnType<typeof vi.fn>).mockClear();

      await session.startStreaming(['CHAN1'], 200);
      expect(mockDriver.getWaveform).toHaveBeenCalledTimes(1);

      // Advance time to trigger next fetch
      await vi.advanceTimersByTimeAsync(200);
      expect(mockDriver.getWaveform).toHaveBeenCalledTimes(2);

      // Advance again
      await vi.advanceTimersByTimeAsync(200);
      expect(mockDriver.getWaveform).toHaveBeenCalledTimes(3);

      session.stopSession();
    });
  });

  describe('Minimum interval enforcement', () => {
    it('should enforce minimum 200ms interval for single channel', async () => {
      const session = createOscilloscopeSession(mockDriver);

      // Wait for initial poll
      await vi.advanceTimersByTimeAsync(0);
      (mockDriver.getWaveform as ReturnType<typeof vi.fn>).mockClear();

      // Request 100ms interval (below minimum)
      await session.startStreaming(['CHAN1'], 100);
      expect(mockDriver.getWaveform).toHaveBeenCalledTimes(1);

      // At 100ms, should NOT have fetched again (minimum is 200ms)
      await vi.advanceTimersByTimeAsync(100);
      expect(mockDriver.getWaveform).toHaveBeenCalledTimes(1);

      // At 200ms, should have fetched
      await vi.advanceTimersByTimeAsync(100);
      expect(mockDriver.getWaveform).toHaveBeenCalledTimes(2);

      session.stopSession();
    });

    it('should enforce minimum 350ms interval for dual channel', async () => {
      const session = createOscilloscopeSession(mockDriver);

      // Wait for initial poll
      await vi.advanceTimersByTimeAsync(0);
      (mockDriver.getWaveform as ReturnType<typeof vi.fn>).mockClear();

      // Request 200ms interval for dual channel (below 350ms minimum)
      await session.startStreaming(['CHAN1', 'CHAN2'], 200);
      // Initial fetch for both channels
      expect(mockDriver.getWaveform).toHaveBeenCalledTimes(2);

      // At 200ms, should NOT have fetched again
      await vi.advanceTimersByTimeAsync(200);
      expect(mockDriver.getWaveform).toHaveBeenCalledTimes(2);

      // At 350ms, should have fetched again (both channels)
      await vi.advanceTimersByTimeAsync(150);
      expect(mockDriver.getWaveform).toHaveBeenCalledTimes(4);

      session.stopSession();
    });

    it('should allow intervals above minimum', async () => {
      const session = createOscilloscopeSession(mockDriver);

      // Wait for initial poll
      await vi.advanceTimersByTimeAsync(0);
      (mockDriver.getWaveform as ReturnType<typeof vi.fn>).mockClear();

      // Request 500ms interval for single channel
      await session.startStreaming(['CHAN1'], 500);
      expect(mockDriver.getWaveform).toHaveBeenCalledTimes(1);

      // At 200ms, should NOT have fetched
      await vi.advanceTimersByTimeAsync(200);
      expect(mockDriver.getWaveform).toHaveBeenCalledTimes(1);

      // At 500ms, should have fetched
      await vi.advanceTimersByTimeAsync(300);
      expect(mockDriver.getWaveform).toHaveBeenCalledTimes(2);

      session.stopSession();
    });
  });

  describe('stopStreaming', () => {
    it('should stop the streaming interval', async () => {
      const session = createOscilloscopeSession(mockDriver);

      // Wait for initial poll
      await vi.advanceTimersByTimeAsync(0);
      (mockDriver.getWaveform as ReturnType<typeof vi.fn>).mockClear();

      await session.startStreaming(['CHAN1'], 200);
      expect(mockDriver.getWaveform).toHaveBeenCalledTimes(1);

      // Stop streaming
      await session.stopStreaming();

      // Advance time - should NOT fetch more
      await vi.advanceTimersByTimeAsync(400);
      expect(mockDriver.getWaveform).toHaveBeenCalledTimes(1);

      session.stopSession();
    });

    it('should be safe to call when not streaming', async () => {
      const session = createOscilloscopeSession(mockDriver);

      // Wait for initial poll
      await vi.advanceTimersByTimeAsync(0);

      // Should not throw
      await expect(session.stopStreaming()).resolves.not.toThrow();

      session.stopSession();
    });
  });

  describe('Streaming restart', () => {
    it('should stop previous streaming when starting new one', async () => {
      const session = createOscilloscopeSession(mockDriver);

      // Wait for initial poll
      await vi.advanceTimersByTimeAsync(0);
      (mockDriver.getWaveform as ReturnType<typeof vi.fn>).mockClear();

      // Start first streaming
      await session.startStreaming(['CHAN1'], 200);
      expect(mockDriver.getWaveform).toHaveBeenCalledTimes(1);

      // Start second streaming (should stop first)
      await session.startStreaming(['CHAN2'], 200);
      expect(mockDriver.getWaveform).toHaveBeenCalledTimes(2); // One more for CHAN2

      // Advance time - should only get CHAN2
      await vi.advanceTimersByTimeAsync(200);
      expect(mockDriver.getWaveform).toHaveBeenCalledTimes(3);
      expect(mockDriver.getWaveform).toHaveBeenLastCalledWith('CHAN2');

      session.stopSession();
    });
  });

  describe('Session destruction', () => {
    it('should stop streaming when session is destroyed', async () => {
      const session = createOscilloscopeSession(mockDriver);

      // Wait for initial poll
      await vi.advanceTimersByTimeAsync(0);
      (mockDriver.getWaveform as ReturnType<typeof vi.fn>).mockClear();

      await session.startStreaming(['CHAN1'], 200);
      expect(mockDriver.getWaveform).toHaveBeenCalledTimes(1);

      // Destroy session
      session.stopSession();

      // Advance time - should NOT fetch more
      await vi.advanceTimersByTimeAsync(400);
      expect(mockDriver.getWaveform).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error handling', () => {
    it('should continue streaming after waveform fetch error', async () => {
      const session = createOscilloscopeSession(mockDriver);

      // Wait for initial poll
      await vi.advanceTimersByTimeAsync(0);

      // Clear previous calls and make first fetch fail (return Err), then succeed (return Ok)
      (mockDriver.getWaveform as ReturnType<typeof vi.fn>).mockClear();
      (mockDriver.getWaveform as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(Err(new Error('Fetch failed')))
        .mockResolvedValue(Ok(mockWaveform));

      await session.startStreaming(['CHAN1'], 200);

      // Advance time - should continue fetching despite error
      await vi.advanceTimersByTimeAsync(200);
      expect(mockDriver.getWaveform).toHaveBeenCalledTimes(2);

      session.stopSession();
    });
  });
});
