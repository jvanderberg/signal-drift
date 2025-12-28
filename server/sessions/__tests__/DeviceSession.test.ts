import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDeviceSession, DeviceSession, DeviceSessionConfig } from '../DeviceSession.js';
import type { DeviceDriver, DeviceStatus } from '../../devices/types.js';
import type { DeviceInfo, DeviceCapabilities } from '../../../shared/types.js';

// Mock driver factory for testing
function createMockDriver(overrides: Partial<{
  getStatusImpl: () => Promise<DeviceStatus>;
  setModeImpl: (mode: string) => Promise<void>;
  setOutputImpl: (enabled: boolean) => Promise<void>;
  setValueImpl: (name: string, value: number) => Promise<void>;
}> = {}): DeviceDriver {
  const info: DeviceInfo = {
    id: 'test-device-1',
    type: 'electronic-load',
    manufacturer: 'Test',
    model: 'Device',
  };

  const capabilities: DeviceCapabilities = {
    modes: ['CC', 'CV', 'CR', 'CP'],
    modesSettable: true,
    outputs: [{ name: 'current', unit: 'A', decimals: 3, min: 0, max: 40 }],
    measurements: [
      { name: 'voltage', unit: 'V', decimals: 3 },
      { name: 'current', unit: 'A', decimals: 3 },
      { name: 'power', unit: 'W', decimals: 3 },
    ],
  };

  let currentStatus: DeviceStatus = {
    mode: 'CC',
    outputEnabled: false,
    setpoints: { current: 1.0 },
    measurements: { voltage: 12.5, current: 0.98, power: 12.25 },
  };

  return {
    info,
    capabilities,
    async probe() { return true; },
    async connect() {},
    async disconnect() {},
    async getStatus() {
      if (overrides.getStatusImpl) {
        return overrides.getStatusImpl();
      }
      return { ...currentStatus };
    },
    async setMode(mode: string) {
      if (overrides.setModeImpl) {
        return overrides.setModeImpl(mode);
      }
      currentStatus = { ...currentStatus, mode };
    },
    async setValue(name: string, value: number) {
      if (overrides.setValueImpl) {
        return overrides.setValueImpl(name, value);
      }
      currentStatus = { ...currentStatus, setpoints: { ...currentStatus.setpoints, [name]: value } };
    },
    async setOutput(enabled: boolean) {
      if (overrides.setOutputImpl) {
        return overrides.setOutputImpl(enabled);
      }
      currentStatus = { ...currentStatus, outputEnabled: enabled };
    },
  };
}

describe('DeviceSession', () => {
  let session: DeviceSession;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (session) {
      session.stop();
    }
    vi.useRealTimers();
  });

  describe('Polling Lifecycle', () => {
    it('should start polling immediately when created', async () => {
      const driver = createMockDriver();
      const getStatusSpy = vi.spyOn(driver, 'getStatus');

      session = createDeviceSession(driver, { pollIntervalMs: 250 });

      // Let first poll complete
      await vi.advanceTimersByTimeAsync(0);

      expect(getStatusSpy).toHaveBeenCalledTimes(1);
    });

    it('should continue polling at configured interval', async () => {
      const driver = createMockDriver();
      const getStatusSpy = vi.spyOn(driver, 'getStatus');

      session = createDeviceSession(driver, { pollIntervalMs: 250 });

      // Initial poll
      await vi.advanceTimersByTimeAsync(0);
      expect(getStatusSpy).toHaveBeenCalledTimes(1);

      // After 250ms, second poll
      await vi.advanceTimersByTimeAsync(250);
      expect(getStatusSpy).toHaveBeenCalledTimes(2);

      // After another 250ms, third poll
      await vi.advanceTimersByTimeAsync(250);
      expect(getStatusSpy).toHaveBeenCalledTimes(3);
    });

    it('should continue polling with zero subscribers', async () => {
      const driver = createMockDriver();
      const getStatusSpy = vi.spyOn(driver, 'getStatus');

      session = createDeviceSession(driver, { pollIntervalMs: 250 });

      // No subscribers added
      await vi.advanceTimersByTimeAsync(750);

      expect(getStatusSpy).toHaveBeenCalledTimes(4); // 0, 250, 500, 750
    });

    it('should stop polling when stop() is called', async () => {
      const driver = createMockDriver();
      const getStatusSpy = vi.spyOn(driver, 'getStatus');

      session = createDeviceSession(driver, { pollIntervalMs: 250 });

      await vi.advanceTimersByTimeAsync(0);
      expect(getStatusSpy).toHaveBeenCalledTimes(1);

      session.stop();

      await vi.advanceTimersByTimeAsync(500);
      expect(getStatusSpy).toHaveBeenCalledTimes(1); // No more polls
    });
  });

  describe('History Management', () => {
    it('should accumulate history data with measurements', async () => {
      let callCount = 0;
      const driver = createMockDriver({
        getStatusImpl: async () => {
          callCount++;
          return {
            mode: 'CC',
            outputEnabled: false,
            setpoints: { current: 1.0 },
            measurements: { voltage: 12.0 + callCount, current: 1.0, power: 12.0 + callCount },
          };
        },
      });

      session = createDeviceSession(driver, { pollIntervalMs: 250, historyWindowMs: 60000 });

      // Let multiple polls complete
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(250);
      await vi.advanceTimersByTimeAsync(250);

      const state = session.getState();
      expect(state.history.timestamps.length).toBe(3);
      expect(state.history.voltage.length).toBe(3);
      expect(state.history.voltage).toEqual([13, 14, 15]);
    });

    it('should trim history to configured window', async () => {
      let callCount = 0;
      const driver = createMockDriver({
        getStatusImpl: async () => {
          callCount++;
          return {
            mode: 'CC',
            outputEnabled: false,
            setpoints: { current: 1.0 },
            measurements: { voltage: callCount, current: 1.0, power: callCount },
          };
        },
      });

      // Short history window of 500ms
      session = createDeviceSession(driver, { pollIntervalMs: 100, historyWindowMs: 500 });

      // Let several polls complete over 1 second
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);

      const state = session.getState();
      // With 500ms window, only last ~5 measurements should remain
      expect(state.history.timestamps.length).toBeLessThanOrEqual(6);
      expect(state.history.timestamps.length).toBeGreaterThan(3);
    });
  });

  describe('Subscriber Notifications', () => {
    it('should notify all subscribers on measurement update', async () => {
      const driver = createMockDriver();
      session = createDeviceSession(driver, { pollIntervalMs: 250 });

      const subscriber1 = vi.fn();
      const subscriber2 = vi.fn();

      session.subscribe('client-1', subscriber1);
      session.subscribe('client-2', subscriber2);

      await vi.advanceTimersByTimeAsync(0);

      expect(subscriber1).toHaveBeenCalled();
      expect(subscriber2).toHaveBeenCalled();
    });

    it('should send measurement update to subscribers after poll', async () => {
      const driver = createMockDriver();
      session = createDeviceSession(driver, { pollIntervalMs: 250 });

      const subscriber = vi.fn();
      session.subscribe('client-1', subscriber);

      await vi.advanceTimersByTimeAsync(0);

      expect(subscriber).toHaveBeenCalledWith({
        type: 'measurement',
        deviceId: 'test-device-1',
        update: expect.objectContaining({
          timestamp: expect.any(Number),
          measurements: { voltage: 12.5, current: 0.98, power: 12.25 },
        }),
      });
    });

    it('should not notify unsubscribed clients', async () => {
      const driver = createMockDriver();
      session = createDeviceSession(driver, { pollIntervalMs: 250 });

      const subscriber = vi.fn();
      session.subscribe('client-1', subscriber);
      session.unsubscribe('client-1');

      await vi.advanceTimersByTimeAsync(0);

      expect(subscriber).not.toHaveBeenCalled();
    });
  });

  describe('State Access', () => {
    it('should provide current full state via getState()', async () => {
      const driver = createMockDriver();
      session = createDeviceSession(driver, { pollIntervalMs: 250 });

      await vi.advanceTimersByTimeAsync(0);

      const state = session.getState();

      expect(state.info.id).toBe('test-device-1');
      expect(state.capabilities.modes).toEqual(['CC', 'CV', 'CR', 'CP']);
      expect(state.connectionStatus).toBe('connected');
      expect(state.mode).toBe('CC');
      expect(state.outputEnabled).toBe(false);
      expect(state.measurements).toEqual({ voltage: 12.5, current: 0.98, power: 12.25 });
      expect(state.history.timestamps.length).toBe(1);
    });

    it('should include lastUpdated timestamp in state', async () => {
      const driver = createMockDriver();
      const now = Date.now();
      vi.setSystemTime(now);

      session = createDeviceSession(driver, { pollIntervalMs: 250 });
      await vi.advanceTimersByTimeAsync(0);

      const state = session.getState();
      expect(state.lastUpdated).toBe(now);
    });
  });

  describe('Error Handling', () => {
    it('should track consecutive poll failures', async () => {
      let failCount = 0;
      const driver = createMockDriver({
        getStatusImpl: async () => {
          failCount++;
          throw new Error('Poll failed');
        },
      });

      session = createDeviceSession(driver, { pollIntervalMs: 250 });

      await vi.advanceTimersByTimeAsync(0);
      expect(session.getState().consecutiveErrors).toBe(1);

      await vi.advanceTimersByTimeAsync(250);
      expect(session.getState().consecutiveErrors).toBe(2);
    });

    it('should set connectionStatus to error on failures', async () => {
      const driver = createMockDriver({
        getStatusImpl: async () => {
          throw new Error('Poll failed');
        },
      });

      session = createDeviceSession(driver, { pollIntervalMs: 250 });

      await vi.advanceTimersByTimeAsync(0);
      expect(session.getState().connectionStatus).toBe('error');
    });

    it('should set connectionStatus to disconnected after max failures', async () => {
      const driver = createMockDriver({
        getStatusImpl: async () => {
          throw new Error('Poll failed');
        },
      });

      session = createDeviceSession(driver, { pollIntervalMs: 250, maxConsecutiveErrors: 3 });

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(250);
      await vi.advanceTimersByTimeAsync(250);

      expect(session.getState().connectionStatus).toBe('disconnected');
      expect(session.getState().consecutiveErrors).toBe(3);
    });

    it('should reset error count on successful poll', async () => {
      let failCount = 0;
      const driver = createMockDriver({
        getStatusImpl: async () => {
          failCount++;
          if (failCount <= 2) {
            throw new Error('Poll failed');
          }
          return {
            mode: 'CC',
            outputEnabled: false,
            setpoints: { current: 1.0 },
            measurements: { voltage: 12.5, current: 0.98, power: 12.25 },
          };
        },
      });

      session = createDeviceSession(driver, { pollIntervalMs: 250, maxConsecutiveErrors: 5 });

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(250);
      expect(session.getState().consecutiveErrors).toBe(2);

      await vi.advanceTimersByTimeAsync(250);
      expect(session.getState().consecutiveErrors).toBe(0);
      expect(session.getState().connectionStatus).toBe('connected');
    });

    it('should notify subscribers of field changes on error status', async () => {
      const driver = createMockDriver({
        getStatusImpl: async () => {
          throw new Error('Poll failed');
        },
      });

      session = createDeviceSession(driver, { pollIntervalMs: 250 });

      const subscriber = vi.fn();
      session.subscribe('client-1', subscriber);

      await vi.advanceTimersByTimeAsync(0);

      expect(subscriber).toHaveBeenCalledWith({
        type: 'field',
        deviceId: 'test-device-1',
        field: 'connectionStatus',
        value: 'error',
      });
    });
  });

  describe('Actions', () => {
    it('should execute setMode and broadcast field change', async () => {
      const driver = createMockDriver();
      const setModeSpy = vi.spyOn(driver, 'setMode');

      session = createDeviceSession(driver, { pollIntervalMs: 250 });
      await vi.advanceTimersByTimeAsync(0);

      const subscriber = vi.fn();
      session.subscribe('client-1', subscriber);

      await session.setMode('CV');

      expect(setModeSpy).toHaveBeenCalledWith('CV');
      expect(subscriber).toHaveBeenCalledWith({
        type: 'field',
        deviceId: 'test-device-1',
        field: 'mode',
        value: 'CV',
      });
    });

    it('should execute setOutput and broadcast field change', async () => {
      const driver = createMockDriver();
      const setOutputSpy = vi.spyOn(driver, 'setOutput');

      session = createDeviceSession(driver, { pollIntervalMs: 250 });
      await vi.advanceTimersByTimeAsync(0);

      const subscriber = vi.fn();
      session.subscribe('client-1', subscriber);

      await session.setOutput(true);

      expect(setOutputSpy).toHaveBeenCalledWith(true);
      expect(subscriber).toHaveBeenCalledWith({
        type: 'field',
        deviceId: 'test-device-1',
        field: 'outputEnabled',
        value: true,
      });
    });

    it('should debounce setValue calls by default', async () => {
      const driver = createMockDriver();
      const setValueSpy = vi.spyOn(driver, 'setValue');

      session = createDeviceSession(driver, { pollIntervalMs: 250, debounceMs: 200 });
      await vi.advanceTimersByTimeAsync(0);

      // Rapid succession of setValue calls
      session.setValue('current', 1.0);
      session.setValue('current', 1.5);
      session.setValue('current', 2.0);

      // Not called yet (debounced)
      expect(setValueSpy).not.toHaveBeenCalled();

      // After debounce period
      await vi.advanceTimersByTimeAsync(200);

      // Only last value should be sent
      expect(setValueSpy).toHaveBeenCalledTimes(1);
      expect(setValueSpy).toHaveBeenCalledWith('current', 2.0);
    });

    it('should execute setValue immediately when immediate flag is true', async () => {
      const driver = createMockDriver();
      const setValueSpy = vi.spyOn(driver, 'setValue');

      session = createDeviceSession(driver, { pollIntervalMs: 250, debounceMs: 200 });
      await vi.advanceTimersByTimeAsync(0);

      await session.setValue('current', 1.5, true);

      expect(setValueSpy).toHaveBeenCalledTimes(1);
      expect(setValueSpy).toHaveBeenCalledWith('current', 1.5);
    });

    it('should broadcast optimistic field update before hardware execution', async () => {
      let hardwareExecuted = false;
      const driver = createMockDriver({
        setModeImpl: async () => {
          hardwareExecuted = true;
        },
      });

      session = createDeviceSession(driver, { pollIntervalMs: 250 });
      await vi.advanceTimersByTimeAsync(0);

      const notifications: unknown[] = [];
      session.subscribe('client-1', (msg) => {
        notifications.push({ ...msg, hardwareExecuted });
      });

      await session.setMode('CV');

      // First notification should have been sent before hardware execution
      const modeNotification = notifications.find(
        (n: any) => n.type === 'field' && n.field === 'mode'
      ) as any;
      expect(modeNotification).toBeDefined();
      expect(modeNotification.hardwareExecuted).toBe(false);
    });
  });

  describe('Subscriber Count', () => {
    it('should track subscriber count', () => {
      const driver = createMockDriver();
      session = createDeviceSession(driver, { pollIntervalMs: 250 });

      expect(session.getSubscriberCount()).toBe(0);

      session.subscribe('client-1', vi.fn());
      expect(session.getSubscriberCount()).toBe(1);

      session.subscribe('client-2', vi.fn());
      expect(session.getSubscriberCount()).toBe(2);

      session.unsubscribe('client-1');
      expect(session.getSubscriberCount()).toBe(1);
    });
  });
});
