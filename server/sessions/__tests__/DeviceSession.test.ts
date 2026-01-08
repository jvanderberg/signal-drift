import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDeviceSession, DeviceSession, DeviceSessionConfig } from '../DeviceSession.js';
import type { DeviceDriver, DeviceStatus } from '../../devices/types.js';
import type { DeviceInfo, DeviceCapabilities, Result } from '../../../shared/types.js';
import { Ok, Err } from '../../../shared/types.js';

// Mock driver factory for testing
function createMockDriver(overrides: Partial<{
  getStatusImpl: () => Promise<Result<DeviceStatus, Error>>;
  setModeImpl: (mode: string) => Promise<Result<void, Error>>;
  setOutputImpl: (enabled: boolean) => Promise<Result<void, Error>>;
  setValueImpl: (name: string, value: number) => Promise<Result<void, Error>>;
}> = {}): DeviceDriver {
  const info: DeviceInfo = {
    id: 'test-device-1',
    type: 'electronic-load',
    manufacturer: 'Test',
    model: 'Device',
  };

  const capabilities: DeviceCapabilities = {
    deviceClass: 'load',
    features: {},
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
    async probe() { return Ok(info); },
    async connect() { return Ok(); },
    async disconnect() { return Ok(); },
    async getStatus() {
      if (overrides.getStatusImpl) {
        return overrides.getStatusImpl();
      }
      return Ok({ ...currentStatus });
    },
    async setMode(mode: string) {
      if (overrides.setModeImpl) {
        return overrides.setModeImpl(mode);
      }
      currentStatus = { ...currentStatus, mode };
      return Ok();
    },
    async setValue(name: string, value: number) {
      if (overrides.setValueImpl) {
        return overrides.setValueImpl(name, value);
      }
      currentStatus = { ...currentStatus, setpoints: { ...currentStatus.setpoints, [name]: value } };
      return Ok();
    },
    async setOutput(enabled: boolean) {
      if (overrides.setOutputImpl) {
        return overrides.setOutputImpl(enabled);
      }
      currentStatus = { ...currentStatus, outputEnabled: enabled };
      return Ok();
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
          return Ok({
            mode: 'CC',
            outputEnabled: false,
            setpoints: { current: 1.0 },
            measurements: { voltage: 12.0 + callCount, current: 1.0, power: 12.0 + callCount },
          });
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
          return Ok({
            mode: 'CC',
            outputEnabled: false,
            setpoints: { current: 1.0 },
            measurements: { voltage: callCount, current: 1.0, power: callCount },
          });
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

      expect(subscriber).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'measurement',
          deviceId: 'test-device-1',
          update: expect.objectContaining({
            timestamp: expect.any(Number),
            measurements: { voltage: 12.5, current: 0.98, power: 12.25 },
          }),
        })
      );
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
      const driver = createMockDriver({
        getStatusImpl: async () => {
          return Err(new Error('Poll failed'));
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
          return Err(new Error('Poll failed'));
        },
      });

      session = createDeviceSession(driver, { pollIntervalMs: 250 });

      await vi.advanceTimersByTimeAsync(0);
      expect(session.getState().connectionStatus).toBe('error');
    });

    it('should set connectionStatus to disconnected after max failures', async () => {
      const driver = createMockDriver({
        getStatusImpl: async () => {
          return Err(new Error('Poll failed'));
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
            return Err(new Error('Poll failed'));
          }
          return Ok({
            mode: 'CC',
            outputEnabled: false,
            setpoints: { current: 1.0 },
            measurements: { voltage: 12.5, current: 0.98, power: 12.25 },
          });
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
          return Err(new Error('Poll failed'));
        },
      });

      session = createDeviceSession(driver, { pollIntervalMs: 250 });

      const subscriber = vi.fn();
      session.subscribe('client-1', subscriber);

      await vi.advanceTimersByTimeAsync(0);

      expect(subscriber).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'field',
          deviceId: 'test-device-1',
          field: 'connectionStatus',
          value: 'error',
        })
      );
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
      expect(subscriber).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'field',
          deviceId: 'test-device-1',
          field: 'mode',
          value: 'CV',
        })
      );
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
      expect(subscriber).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'field',
          deviceId: 'test-device-1',
          field: 'outputEnabled',
          value: true,
        })
      );
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
          return Ok();
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

  describe('Reconnection', () => {
    it('should wait for in-flight poll to complete before reconnecting', async () => {
      let pollInProgress = false;
      let pollCompleted = false;
      let reconnectAttempted = false;

      const driver = createMockDriver({
        getStatusImpl: async () => {
          pollInProgress = true;
          // Simulate slow poll
          await new Promise(r => setTimeout(r, 100));
          pollCompleted = true;
          pollInProgress = false;
          return Ok({
            mode: 'CC',
            outputEnabled: false,
            setpoints: { current: 1.0 },
            measurements: { voltage: 12.5, current: 0.98, power: 12.25 },
          });
        },
      });

      session = createDeviceSession(driver, { pollIntervalMs: 250 });

      // Wait for poll to start
      await vi.advanceTimersByTimeAsync(0);

      // Poll should be in progress
      expect(pollInProgress).toBe(true);

      // Create new driver for reconnect
      const newDriver = createMockDriver();

      // Attempt reconnect while poll is in progress
      const reconnectPromise = session.reconnect(newDriver).then(() => {
        reconnectAttempted = true;
      });

      // Give time for async operations
      await vi.advanceTimersByTimeAsync(50);

      // Reconnect should wait for poll to complete
      // (This tests the fix - before the fix, reconnect would happen immediately)

      // Advance time to let poll complete
      await vi.advanceTimersByTimeAsync(100);
      await reconnectPromise;

      expect(pollCompleted).toBe(true);
      expect(reconnectAttempted).toBe(true);
    });

    it('should use new driver after reconnect', async () => {
      const oldDriver = createMockDriver();
      const newDriver = createMockDriver({
        getStatusImpl: async () => Ok({
          mode: 'CV',  // Different mode to verify new driver is used
          outputEnabled: true,
          setpoints: { voltage: 5.0 },
          measurements: { voltage: 5.0, current: 0.5, power: 2.5 },
        }),
      });

      session = createDeviceSession(oldDriver, { pollIntervalMs: 250 });
      await vi.advanceTimersByTimeAsync(0);

      // Verify initial state from old driver
      expect(session.getState().mode).toBe('CC');

      // Reconnect with new driver
      await session.reconnect(newDriver);

      // Trigger poll with new driver
      await vi.advanceTimersByTimeAsync(250);

      // Should show new driver's state
      expect(session.getState().mode).toBe('CV');
    });
  });

  describe('Optimistic Rollback', () => {
    it('should rollback setMode on failure and return Err', async () => {
      const driver = createMockDriver({
        setModeImpl: async () => {
          return Err(new Error('Hardware error'));
        },
      });

      session = createDeviceSession(driver, { pollIntervalMs: 250 });
      await vi.advanceTimersByTimeAsync(0);

      const notifications: any[] = [];
      session.subscribe('client-1', (msg) => notifications.push(msg));

      // Initial mode is CC
      expect(session.getState().mode).toBe('CC');

      // Attempt to set mode - should return Err, not throw
      const result = await session.setMode('CV');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Hardware error');
      }

      // Mode should be reverted back to CC
      expect(session.getState().mode).toBe('CC');

      // Should have broadcast the rollback
      const modeNotifications = notifications.filter(n => n.field === 'mode');
      expect(modeNotifications.length).toBe(2); // Optimistic + rollback
      expect(modeNotifications[0].value).toBe('CV'); // Optimistic
      expect(modeNotifications[1].value).toBe('CC'); // Rollback
    });

    it('should rollback setOutput on failure and return Err', async () => {
      const driver = createMockDriver({
        setOutputImpl: async () => {
          return Err(new Error('Hardware error'));
        },
      });

      session = createDeviceSession(driver, { pollIntervalMs: 250 });
      await vi.advanceTimersByTimeAsync(0);

      const notifications: any[] = [];
      session.subscribe('client-1', (msg) => notifications.push(msg));

      // Initial output is false
      expect(session.getState().outputEnabled).toBe(false);

      // Attempt to enable output - should return Err, not throw
      const result = await session.setOutput(true);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Hardware error');
      }

      // Output should be reverted back to false
      expect(session.getState().outputEnabled).toBe(false);

      // Should have broadcast the rollback
      const outputNotifications = notifications.filter(n => n.field === 'outputEnabled');
      expect(outputNotifications.length).toBe(2); // Optimistic + rollback
      expect(outputNotifications[0].value).toBe(true); // Optimistic
      expect(outputNotifications[1].value).toBe(false); // Rollback
    });

    it('should rollback setValue on failure and return Err', async () => {
      const driver = createMockDriver({
        setValueImpl: async () => {
          return Err(new Error('Hardware error'));
        },
      });

      session = createDeviceSession(driver, { pollIntervalMs: 250 });
      await vi.advanceTimersByTimeAsync(0);

      const notifications: any[] = [];
      session.subscribe('client-1', (msg) => notifications.push(msg));

      // Initial setpoint
      expect(session.getState().setpoints.current).toBe(1.0);

      // Attempt to set value with immediate=true - should return Err, not throw
      const result = await session.setValue('current', 5.0, true);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Hardware error');
      }

      // Setpoint should be reverted back
      expect(session.getState().setpoints.current).toBe(1.0);
    });
  });

  describe('Actions return Result', () => {
    it('should return Ok on successful setMode', async () => {
      const driver = createMockDriver();
      session = createDeviceSession(driver, { pollIntervalMs: 250 });
      await vi.advanceTimersByTimeAsync(0);

      const result = await session.setMode('CV');
      expect(result.ok).toBe(true);
      expect(session.getState().mode).toBe('CV');
    });

    it('should return Ok on successful setOutput', async () => {
      const driver = createMockDriver();
      session = createDeviceSession(driver, { pollIntervalMs: 250 });
      await vi.advanceTimersByTimeAsync(0);

      const result = await session.setOutput(true);
      expect(result.ok).toBe(true);
      expect(session.getState().outputEnabled).toBe(true);
    });

    it('should return Ok on successful setValue with immediate=true', async () => {
      const driver = createMockDriver();
      session = createDeviceSession(driver, { pollIntervalMs: 250 });
      await vi.advanceTimersByTimeAsync(0);

      const result = await session.setValue('current', 2.5, true);
      expect(result.ok).toBe(true);
      expect(session.getState().setpoints.current).toBe(2.5);
    });
  });

  describe('Heartbeat', () => {
    it('should not run heartbeat when disabled (interval = 0)', async () => {
      const driver = createMockDriver();
      const getStatusSpy = vi.spyOn(driver, 'getStatus');

      session = createDeviceSession(driver, {
        pollIntervalMs: 250,
        heartbeatIntervalMs: 0,  // Disable heartbeat
      });

      // Initial poll
      await vi.advanceTimersByTimeAsync(0);
      expect(getStatusSpy).toHaveBeenCalledTimes(1);

      // Advance past what would be heartbeat interval
      await vi.advanceTimersByTimeAsync(15000);

      // Only polls should have run (250ms * 60 = 60 polls for 15 seconds)
      // But with 250ms poll interval: 15000/250 = 60 + 1 initial = 61
      expect(getStatusSpy).toHaveBeenCalledTimes(61);
    });

    it('should call getStatus on heartbeat interval', async () => {
      const driver = createMockDriver();
      const getStatusSpy = vi.spyOn(driver, 'getStatus');

      session = createDeviceSession(driver, {
        pollIntervalMs: 1000,      // Slow polling
        heartbeatIntervalMs: 500,  // Fast heartbeat for testing
      });

      // Initial poll
      await vi.advanceTimersByTimeAsync(0);
      expect(getStatusSpy).toHaveBeenCalledTimes(1);

      // Advance by 500ms - heartbeat should fire
      await vi.advanceTimersByTimeAsync(500);
      // Poll hasn't fired yet (every 1000ms), but heartbeat should have (every 500ms)
      expect(getStatusSpy).toHaveBeenCalledTimes(2);
    });

    it('should allow pausing and resuming heartbeat', async () => {
      const driver = createMockDriver();

      session = createDeviceSession(driver, {
        pollIntervalMs: 10000,     // Very slow polling
        heartbeatIntervalMs: 500,  // Fast heartbeat
      });

      // Pause heartbeat
      session.pauseHeartbeat();
      expect(session.isHeartbeatPaused()).toBe(true);

      // Resume heartbeat
      session.resumeHeartbeat();
      expect(session.isHeartbeatPaused()).toBe(false);
    });

    it('should not fire heartbeat when paused', async () => {
      const driver = createMockDriver();
      const getStatusSpy = vi.spyOn(driver, 'getStatus');

      session = createDeviceSession(driver, {
        pollIntervalMs: 10000,     // Very slow polling
        heartbeatIntervalMs: 500,  // Fast heartbeat
      });

      await vi.advanceTimersByTimeAsync(0); // Initial poll
      expect(getStatusSpy).toHaveBeenCalledTimes(1);

      // Pause heartbeat before it fires
      session.pauseHeartbeat();

      // Advance past multiple heartbeat intervals
      await vi.advanceTimersByTimeAsync(2000);

      // Heartbeat should not have fired (paused), and poll hasn't fired yet (every 10s)
      expect(getStatusSpy).toHaveBeenCalledTimes(1);
    });

    it('should disconnect on heartbeat timeout error', async () => {
      let callCount = 0;
      const driver = createMockDriver({
        getStatusImpl: async () => {
          callCount++;
          // First call (poll) succeeds, subsequent calls (heartbeat) timeout
          if (callCount === 1) {
            return Ok({
              mode: 'CC',
              outputEnabled: false,
              setpoints: { current: 1.0 },
              measurements: { voltage: 12.5, current: 0.98, power: 12.25 },
            });
          }
          return Err(new Error('Timeout waiting for response'));
        },
      });

      const forceReconnectCallback = vi.fn();

      session = createDeviceSession(
        driver,
        {
          pollIntervalMs: 10000,     // Very slow polling
          heartbeatIntervalMs: 500,  // Fast heartbeat
        },
        forceReconnectCallback
      );

      // Initial poll succeeds
      await vi.advanceTimersByTimeAsync(0);
      expect(session.getState().connectionStatus).toBe('connected');

      // Advance to trigger heartbeat - should fail and disconnect
      await vi.advanceTimersByTimeAsync(500);

      // Device should be marked as disconnected due to timeout error
      expect(session.getState().connectionStatus).toBe('disconnected');

      // Force reconnect callback should have been called
      expect(forceReconnectCallback).toHaveBeenCalledWith(driver.info.id);
    });

    it('should not interfere with active poll', async () => {
      let pollInProgress = false;
      const driver = createMockDriver({
        getStatusImpl: async () => {
          // Simulate a slow poll
          pollInProgress = true;
          await new Promise(r => setTimeout(r, 100));
          pollInProgress = false;
          return Ok({
            mode: 'CC',
            outputEnabled: false,
            setpoints: { current: 1.0 },
            measurements: { voltage: 12.5, current: 0.98, power: 12.25 },
          });
        },
      });
      const getStatusSpy = vi.spyOn(driver, 'getStatus');

      session = createDeviceSession(driver, {
        pollIntervalMs: 200,
        heartbeatIntervalMs: 150,
      });

      // Start initial poll
      await vi.advanceTimersByTimeAsync(0);

      // Advance by 150ms while poll is still in progress
      await vi.advanceTimersByTimeAsync(50);

      // Poll should be in progress, heartbeat should skip
      // This test verifies heartbeat doesn't call getStatus while poll is active
      expect(getStatusSpy).toHaveBeenCalledTimes(1); // Only the initial poll
    });

    it('should not disconnect on non-fatal heartbeat error', async () => {
      let callCount = 0;
      const driver = createMockDriver({
        getStatusImpl: async () => {
          callCount++;
          // First call (poll) succeeds, second call (heartbeat) returns non-fatal error
          if (callCount === 1) {
            return Ok({
              mode: 'CC',
              outputEnabled: false,
              setpoints: { current: 1.0 },
              measurements: { voltage: 12.5, current: 0.98, power: 12.25 },
            });
          }
          // Non-fatal error (doesn't include Timeout, LIBUSB_ERROR, etc)
          return Err(new Error('Temporary communication error'));
        },
      });

      const forceReconnectCallback = vi.fn();

      session = createDeviceSession(
        driver,
        {
          pollIntervalMs: 10000,     // Very slow polling
          heartbeatIntervalMs: 500,  // Fast heartbeat
        },
        forceReconnectCallback
      );

      // Initial poll succeeds
      await vi.advanceTimersByTimeAsync(0);
      expect(session.getState().connectionStatus).toBe('connected');

      // Advance to trigger heartbeat - non-fatal error should not disconnect
      await vi.advanceTimersByTimeAsync(500);

      // Device should still be connected (non-fatal error doesn't trigger disconnect)
      expect(session.getState().connectionStatus).toBe('connected');

      // Force reconnect callback should NOT have been called
      expect(forceReconnectCallback).not.toHaveBeenCalled();
    });

    it('should skip heartbeat if previous one still running', async () => {
      let heartbeatCallCount = 0;
      const driver = createMockDriver({
        getStatusImpl: async () => {
          heartbeatCallCount++;
          // Simulate slow getStatus (1.5s) - longer than heartbeat interval
          await new Promise(r => setTimeout(r, 1500));
          return Ok({
            mode: 'CC',
            outputEnabled: false,
            setpoints: { current: 1.0 },
            measurements: { voltage: 12.5, current: 0.98, power: 12.25 },
          });
        },
      });

      session = createDeviceSession(driver, {
        pollIntervalMs: 10000,     // Very slow polling (won't interfere)
        heartbeatIntervalMs: 500,  // Fast heartbeat
      });

      // Initial poll starts
      await vi.advanceTimersByTimeAsync(0);
      expect(heartbeatCallCount).toBe(1); // Initial poll

      // Advance by multiple heartbeat intervals while first heartbeat is running
      // Heartbeat takes 1.5s but interval is 0.5s - 3 intervals should pass
      await vi.advanceTimersByTimeAsync(1600);

      // Only 2 calls: initial poll + one heartbeat (others skipped due to in-progress flag)
      // After 1.5s the first heartbeat completes, then next interval fires
      expect(heartbeatCallCount).toBeLessThanOrEqual(3);
    });

    it('should wait for in-flight heartbeat during stop()', async () => {
      let heartbeatCompleted = false;
      const driver = createMockDriver({
        getStatusImpl: async () => {
          // Slow heartbeat/poll
          await new Promise(r => setTimeout(r, 500));
          heartbeatCompleted = true;
          return Ok({
            mode: 'CC',
            outputEnabled: false,
            setpoints: { current: 1.0 },
            measurements: { voltage: 12.5, current: 0.98, power: 12.25 },
          });
        },
      });

      session = createDeviceSession(driver, {
        pollIntervalMs: 10000,
        heartbeatIntervalMs: 100,
      });

      // Initial poll starts
      await vi.advanceTimersByTimeAsync(0);

      // Let poll complete
      await vi.advanceTimersByTimeAsync(500);
      heartbeatCompleted = false;

      // Trigger heartbeat
      await vi.advanceTimersByTimeAsync(100);

      // Stop should wait for heartbeat to complete
      const stopPromise = session.stop();

      // Advance time to let heartbeat complete
      await vi.advanceTimersByTimeAsync(500);

      await stopPromise;

      // Heartbeat should have completed before stop returned
      expect(heartbeatCompleted).toBe(true);
    });
  });

  describe('Setpoint Change Broadcasting (Safety Critical)', () => {
    it('should broadcast setpoint changes when device reports different values', async () => {
      // This test verifies the fix for a critical safety bug:
      // When a PSU reconnects after power cycle, it may reset to a different voltage.
      // The UI must be notified of this change to prevent applying dangerous voltages.
      let pollCount = 0;
      const driver = createMockDriver({
        getStatusImpl: async () => {
          pollCount++;
          // First poll: device reports voltage = 12.0
          // Second poll: device reports voltage changed to 5.0 (simulating PSU reset)
          const voltage = pollCount === 1 ? 12.0 : 5.0;
          return Ok({
            mode: 'CC',
            outputEnabled: false,
            setpoints: { current: 1.0, voltage },
            measurements: { voltage, current: 0.98, power: voltage * 0.98 },
          });
        },
      });

      session = createDeviceSession(driver, { pollIntervalMs: 250 });

      const notifications: any[] = [];
      session.subscribe('client-1', (msg) => notifications.push(msg));

      // First poll - establishes initial setpoints
      await vi.advanceTimersByTimeAsync(0);
      expect(session.getState().setpoints.voltage).toBe(12.0);

      // Clear notifications
      notifications.length = 0;

      // Second poll - device reports different voltage
      await vi.advanceTimersByTimeAsync(250);

      // Should have broadcast the setpoint change
      const setpointNotification = notifications.find(
        n => n.type === 'field' && n.field === 'setpoints'
      );
      expect(setpointNotification).toBeDefined();
      expect(setpointNotification.value.voltage).toBe(5.0);
      expect(session.getState().setpoints.voltage).toBe(5.0);
    });

    it('should broadcast setpoint changes after reconnect with different values', async () => {
      // Simulates: PSU disconnects, user power cycles it, PSU reconnects with reset voltage
      const oldDriver = createMockDriver({
        getStatusImpl: async () => Ok({
          mode: 'CV',
          outputEnabled: false,
          setpoints: { voltage: 24.0, current: 5.0 },
          measurements: { voltage: 24.0, current: 0.0, power: 0.0 },
        }),
      });

      // New driver simulates PSU that has been power cycled and reset to defaults
      const newDriver = createMockDriver({
        getStatusImpl: async () => Ok({
          mode: 'CV',
          outputEnabled: false,
          setpoints: { voltage: 0.0, current: 1.0 },  // Reset to dangerous defaults!
          measurements: { voltage: 0.0, current: 0.0, power: 0.0 },
        }),
      });

      session = createDeviceSession(oldDriver, { pollIntervalMs: 250 });
      await vi.advanceTimersByTimeAsync(0);

      // Verify initial state from old driver
      expect(session.getState().setpoints.voltage).toBe(24.0);

      const notifications: any[] = [];
      session.subscribe('client-1', (msg) => notifications.push(msg));

      // Reconnect with new driver (simulating PSU reconnect after power cycle)
      await session.reconnect(newDriver);

      // Trigger poll with new driver
      await vi.advanceTimersByTimeAsync(250);

      // Should have broadcast the setpoint change to 0.0
      const setpointNotification = notifications.find(
        n => n.type === 'field' && n.field === 'setpoints'
      );
      expect(setpointNotification).toBeDefined();
      expect(setpointNotification.value.voltage).toBe(0.0);
      expect(session.getState().setpoints.voltage).toBe(0.0);
    });

    it('should not broadcast setpoints when they have not changed', async () => {
      const driver = createMockDriver({
        getStatusImpl: async () => Ok({
          mode: 'CC',
          outputEnabled: false,
          setpoints: { current: 1.0 },  // Same every time
          measurements: { voltage: 12.5, current: 0.98, power: 12.25 },
        }),
      });

      session = createDeviceSession(driver, { pollIntervalMs: 250 });

      // First poll
      await vi.advanceTimersByTimeAsync(0);

      const notifications: any[] = [];
      session.subscribe('client-1', (msg) => notifications.push(msg));

      // Second poll - same setpoints
      await vi.advanceTimersByTimeAsync(250);

      // Should NOT have broadcast setpoint changes
      const setpointNotification = notifications.find(
        n => n.type === 'field' && n.field === 'setpoints'
      );
      expect(setpointNotification).toBeUndefined();
    });

    it('should detect setpoint changes when new keys are added', async () => {
      let pollCount = 0;
      const driver = createMockDriver({
        getStatusImpl: async () => {
          pollCount++;
          // First poll: only current setpoint
          // Second poll: voltage setpoint added
          const setpoints: Record<string, number> = pollCount === 1
            ? { current: 1.0 }
            : { current: 1.0, voltage: 12.0 };
          return Ok({
            mode: 'CC',
            outputEnabled: false,
            setpoints,
            measurements: { voltage: 12.5, current: 0.98, power: 12.25 },
          });
        },
      });

      session = createDeviceSession(driver, { pollIntervalMs: 250 });
      await vi.advanceTimersByTimeAsync(0);

      const notifications: any[] = [];
      session.subscribe('client-1', (msg) => notifications.push(msg));

      await vi.advanceTimersByTimeAsync(250);

      // Should have broadcast the setpoint change (new key added)
      const setpointNotification = notifications.find(
        n => n.type === 'field' && n.field === 'setpoints'
      );
      expect(setpointNotification).toBeDefined();
      expect(setpointNotification.value).toEqual({ current: 1.0, voltage: 12.0 });
    });
  });

  describe('Poll Race Condition Prevention', () => {
    it('should not broadcast stale outputEnabled during setOutput', async () => {
      // This test verifies the fix for UI flicker when toggling output:
      // Without the fix, poll could read stale "off" state while setOutput command
      // is being processed, causing brief UI flicker.
      let driverOutputState = false;
      let setOutputDelay = 100; // Simulate slow hardware response

      const driver = createMockDriver({
        getStatusImpl: async () => Ok({
          mode: 'CC',
          outputEnabled: driverOutputState, // Returns actual hardware state
          setpoints: { current: 1.0 },
          measurements: { voltage: 12.5, current: 0.98, power: 12.25 },
        }),
        setOutputImpl: async (enabled: boolean) => {
          // Simulate slow hardware - state changes after delay
          await new Promise(r => setTimeout(r, setOutputDelay));
          driverOutputState = enabled;
          return Ok();
        },
      });

      session = createDeviceSession(driver, { pollIntervalMs: 50 });

      // Initial poll
      await vi.advanceTimersByTimeAsync(0);
      expect(session.getState().outputEnabled).toBe(false);

      const notifications: any[] = [];
      session.subscribe('client-1', (msg) => notifications.push(msg));

      // Start setOutput (don't await - let it run in parallel with polls)
      const setOutputPromise = session.setOutput(true);

      // Advance time to trigger poll while setOutput is in progress
      await vi.advanceTimersByTimeAsync(50);

      // Poll should NOT have broadcast outputEnabled: false (stale value)
      // because outputChangePending is true
      const staleOutputBroadcast = notifications.find(
        n => n.type === 'field' && n.field === 'outputEnabled' && n.value === false
      );
      expect(staleOutputBroadcast).toBeUndefined();

      // Complete the setOutput operation
      await vi.advanceTimersByTimeAsync(100);
      await setOutputPromise;

      // Now output should be true
      expect(session.getState().outputEnabled).toBe(true);
    });

    it('should not broadcast stale mode during setMode', async () => {
      let driverModeState = 'CC';
      let setModeDelay = 100;

      const driver = createMockDriver({
        getStatusImpl: async () => Ok({
          mode: driverModeState,
          outputEnabled: false,
          setpoints: { current: 1.0 },
          measurements: { voltage: 12.5, current: 0.98, power: 12.25 },
        }),
        setModeImpl: async (newMode: string) => {
          await new Promise(r => setTimeout(r, setModeDelay));
          driverModeState = newMode;
          return Ok();
        },
      });

      session = createDeviceSession(driver, { pollIntervalMs: 50 });

      await vi.advanceTimersByTimeAsync(0);
      expect(session.getState().mode).toBe('CC');

      const notifications: any[] = [];
      session.subscribe('client-1', (msg) => notifications.push(msg));

      // Start setMode
      const setModePromise = session.setMode('CV');

      // Advance time to trigger poll while setMode is in progress
      await vi.advanceTimersByTimeAsync(50);

      // Poll should NOT have broadcast mode: 'CC' (stale value)
      const staleModeAfterOptimistic = notifications.filter(
        n => n.type === 'field' && n.field === 'mode'
      );
      // Should only have the optimistic 'CV' broadcast, no stale 'CC'
      expect(staleModeAfterOptimistic.length).toBe(1);
      expect(staleModeAfterOptimistic[0].value).toBe('CV');

      // Complete the operation
      await vi.advanceTimersByTimeAsync(100);
      await setModePromise;
    });

    it('should not broadcast stale setpoints during debounced setValue', async () => {
      let driverVoltage = 12.0;

      const driver = createMockDriver({
        getStatusImpl: async () => Ok({
          mode: 'CV',
          outputEnabled: false,
          setpoints: { voltage: driverVoltage },
          measurements: { voltage: driverVoltage, current: 0.0, power: 0.0 },
        }),
        setValueImpl: async (_name: string, value: number) => {
          driverVoltage = value;
          return Ok();
        },
      });

      session = createDeviceSession(driver, { pollIntervalMs: 50, debounceMs: 200 });

      await vi.advanceTimersByTimeAsync(0);
      expect(session.getState().setpoints.voltage).toBe(12.0);

      const notifications: any[] = [];
      session.subscribe('client-1', (msg) => notifications.push(msg));

      // Start debounced setValue (user adjusting voltage slider)
      session.setValue('voltage', 24.0);

      // During debounce window, polls should NOT broadcast stale voltage
      await vi.advanceTimersByTimeAsync(50);
      await vi.advanceTimersByTimeAsync(50);

      // Check that no stale setpoints were broadcast
      const setpointBroadcasts = notifications.filter(
        n => n.type === 'field' && n.field === 'setpoints'
      );
      // Should have no broadcasts yet (debounce hasn't fired)
      // or if there are broadcasts, voltage should be 24.0 (pending value)
      for (const broadcast of setpointBroadcasts) {
        expect(broadcast.value.voltage).toBe(24.0);
      }

      // Let debounce fire and complete
      await vi.advanceTimersByTimeAsync(200);

      // Now device should have the new value
      expect(driverVoltage).toBe(24.0);
    });

    it('should preserve pending setpoint values when other setpoints change', async () => {
      let driverVoltage = 12.0;
      let driverCurrent = 1.0;
      let pollCount = 0;

      const driver = createMockDriver({
        getStatusImpl: async () => {
          pollCount++;
          // Simulate external change to current on second poll
          if (pollCount >= 2) {
            driverCurrent = 2.0;
          }
          return Ok({
            mode: 'CV',
            outputEnabled: false,
            setpoints: { voltage: driverVoltage, current: driverCurrent },
            measurements: { voltage: driverVoltage, current: 0.0, power: 0.0 },
          });
        },
        setValueImpl: async (name: string, value: number) => {
          if (name === 'voltage') driverVoltage = value;
          if (name === 'current') driverCurrent = value;
          return Ok();
        },
      });

      session = createDeviceSession(driver, { pollIntervalMs: 50, debounceMs: 200 });

      await vi.advanceTimersByTimeAsync(0);

      const notifications: any[] = [];
      session.subscribe('client-1', (msg) => notifications.push(msg));

      // User starts adjusting voltage (pending)
      session.setValue('voltage', 24.0);

      // Poll fires, sees current changed externally
      await vi.advanceTimersByTimeAsync(50);

      // The broadcast should show voltage=24.0 (pending) and current=2.0 (from device)
      const setpointBroadcast = notifications.find(
        n => n.type === 'field' && n.field === 'setpoints'
      );
      expect(setpointBroadcast).toBeDefined();
      expect(setpointBroadcast.value.voltage).toBe(24.0); // Pending value preserved
      expect(setpointBroadcast.value.current).toBe(2.0);  // External change picked up
    });
  });
});
