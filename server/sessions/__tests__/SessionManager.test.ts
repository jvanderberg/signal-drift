import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSessionManager, SessionManager, SessionManagerConfig } from '../SessionManager.js';
import { createDeviceRegistry, DeviceRegistry } from '../../devices/registry.js';
import type { DeviceDriver, DeviceStatus } from '../../devices/types.js';
import type { DeviceInfo, DeviceCapabilities, DeviceSummary } from '../../../shared/types.js';

// Mock driver factory for testing
function createMockDriver(id: string): DeviceDriver {
  const info: DeviceInfo = {
    id,
    type: 'electronic-load',
    manufacturer: 'Test',
    model: 'Device',
  };

  const capabilities: DeviceCapabilities = {
    deviceClass: 'load',
    features: {},
    modes: ['CC', 'CV'],
    modesSettable: true,
    outputs: [{ name: 'current', unit: 'A', decimals: 3, min: 0, max: 40 }],
    measurements: [
      { name: 'voltage', unit: 'V', decimals: 3 },
      { name: 'current', unit: 'A', decimals: 3 },
      { name: 'power', unit: 'W', decimals: 3 },
    ],
  };

  return {
    info,
    capabilities,
    async probe() { return true; },
    async connect() {},
    async disconnect() {},
    async getStatus() {
      return {
        mode: 'CC',
        outputEnabled: false,
        setpoints: { current: 1.0 },
        measurements: { voltage: 12.5, current: 0.98, power: 12.25 },
      };
    },
    async setMode() {},
    async setValue() {},
    async setOutput() {},
  };
}

describe('SessionManager', () => {
  let registry: DeviceRegistry;
  let manager: SessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    registry = createDeviceRegistry();
  });

  afterEach(() => {
    if (manager) {
      manager.stop();
    }
    vi.useRealTimers();
  });

  describe('Session Creation', () => {
    it('should create a session when a device is added to registry', async () => {
      manager = createSessionManager(registry, { pollIntervalMs: 250 });

      const driver = createMockDriver('device-1');
      registry.addDevice(driver);

      // Session manager should detect the new device
      manager.syncDevices();

      expect(manager.hasSession('device-1')).toBe(true);
    });

    it('should not create duplicate sessions for the same device', async () => {
      manager = createSessionManager(registry, { pollIntervalMs: 250 });

      const driver = createMockDriver('device-1');
      registry.addDevice(driver);
      manager.syncDevices();
      manager.syncDevices(); // Sync again

      expect(manager.getSessionCount()).toBe(1);
    });

    it('should create sessions for multiple devices', async () => {
      manager = createSessionManager(registry, { pollIntervalMs: 250 });

      registry.addDevice(createMockDriver('device-1'));
      registry.addDevice(createMockDriver('device-2'));
      registry.addDevice(createMockDriver('device-3'));
      manager.syncDevices();

      expect(manager.getSessionCount()).toBe(3);
      expect(manager.hasSession('device-1')).toBe(true);
      expect(manager.hasSession('device-2')).toBe(true);
      expect(manager.hasSession('device-3')).toBe(true);
    });
  });

  describe('Session Persistence', () => {
    it('should keep session alive when device disconnects', async () => {
      manager = createSessionManager(registry, { pollIntervalMs: 250 });

      const driver = createMockDriver('device-1');
      registry.addDevice(driver);
      manager.syncDevices();

      expect(manager.hasSession('device-1')).toBe(true);

      // Device disconnects but session persists (unlike old behavior)
      // Sessions are only created, never removed
      manager.syncDevices();

      expect(manager.hasSession('device-1')).toBe(true);
    });

    it('should report if session is disconnected', async () => {
      manager = createSessionManager(registry, { pollIntervalMs: 250, maxConsecutiveErrors: 3 });

      const driver = createMockDriver('device-1');
      driver.getStatus = vi.fn().mockRejectedValue(new Error('SERIAL_PORT_DISCONNECTED'));

      registry.addDevice(driver);
      manager.syncDevices();

      // Let poll happen and fail with fatal error
      await vi.advanceTimersByTimeAsync(0);

      expect(manager.isSessionDisconnected('device-1')).toBe(true);
    });
  });

  describe('Session Access', () => {
    it('should return session by device id', async () => {
      manager = createSessionManager(registry, { pollIntervalMs: 250 });

      registry.addDevice(createMockDriver('device-1'));
      manager.syncDevices();

      const session = manager.getSession('device-1');
      expect(session).toBeDefined();
      expect(session?.getState().info.id).toBe('device-1');
    });

    it('should return undefined for unknown device id', () => {
      manager = createSessionManager(registry, { pollIntervalMs: 250 });

      const session = manager.getSession('unknown');
      expect(session).toBeUndefined();
    });
  });

  describe('Device Summaries', () => {
    it('should return device summaries for all sessions', async () => {
      manager = createSessionManager(registry, { pollIntervalMs: 250 });

      registry.addDevice(createMockDriver('device-1'));
      registry.addDevice(createMockDriver('device-2'));
      manager.syncDevices();

      // Let first poll complete to get status
      await vi.advanceTimersByTimeAsync(0);

      const summaries = manager.getDeviceSummaries();
      expect(summaries.length).toBe(2);

      const summary1 = summaries.find(s => s.id === 'device-1');
      expect(summary1).toBeDefined();
      expect(summary1?.info.manufacturer).toBe('Test');
      expect(summary1?.connectionStatus).toBe('connected');
    });

    it('should return empty array when no sessions exist', () => {
      manager = createSessionManager(registry, { pollIntervalMs: 250 });

      const summaries = manager.getDeviceSummaries();
      expect(summaries).toEqual([]);
    });
  });

  describe('Stop All', () => {
    it('should stop all sessions when manager is stopped', async () => {
      manager = createSessionManager(registry, { pollIntervalMs: 250 });

      const driver1 = createMockDriver('device-1');
      const driver2 = createMockDriver('device-2');
      const spy1 = vi.spyOn(driver1, 'getStatus');
      const spy2 = vi.spyOn(driver2, 'getStatus');

      registry.addDevice(driver1);
      registry.addDevice(driver2);
      manager.syncDevices();

      await vi.advanceTimersByTimeAsync(0);
      expect(spy1).toHaveBeenCalledTimes(1);
      expect(spy2).toHaveBeenCalledTimes(1);

      manager.stop();

      await vi.advanceTimersByTimeAsync(500);
      expect(spy1).toHaveBeenCalledTimes(1);
      expect(spy2).toHaveBeenCalledTimes(1);
    });
  });

  describe('Auto Sync', () => {
    it('should auto-sync devices at configured interval', async () => {
      manager = createSessionManager(registry, {
        pollIntervalMs: 250,
        scanIntervalMs: 1000,
      });

      // Initially no devices
      expect(manager.getSessionCount()).toBe(0);

      // Add a device
      registry.addDevice(createMockDriver('device-1'));

      // Wait for auto-sync
      await vi.advanceTimersByTimeAsync(1000);

      expect(manager.getSessionCount()).toBe(1);
    });
  });

  describe('Subscriber Management', () => {
    it('should forward subscription to the correct session', async () => {
      manager = createSessionManager(registry, { pollIntervalMs: 250 });

      registry.addDevice(createMockDriver('device-1'));
      manager.syncDevices();

      const callback = vi.fn();
      const result = manager.subscribe('device-1', 'client-1', callback);

      expect(result).toBe(true);

      // Get session and verify subscriber was added
      const session = manager.getSession('device-1');
      expect(session?.getSubscriberCount()).toBe(1);
    });

    it('should return false when subscribing to unknown device', () => {
      manager = createSessionManager(registry, { pollIntervalMs: 250 });

      const result = manager.subscribe('unknown', 'client-1', vi.fn());
      expect(result).toBe(false);
    });

    it('should forward unsubscription to the correct session', async () => {
      manager = createSessionManager(registry, { pollIntervalMs: 250 });

      registry.addDevice(createMockDriver('device-1'));
      manager.syncDevices();

      manager.subscribe('device-1', 'client-1', vi.fn());
      expect(manager.getSession('device-1')?.getSubscriberCount()).toBe(1);

      manager.unsubscribe('device-1', 'client-1');
      expect(manager.getSession('device-1')?.getSubscriberCount()).toBe(0);
    });

    it('should unsubscribe client from all sessions', async () => {
      manager = createSessionManager(registry, { pollIntervalMs: 250 });

      registry.addDevice(createMockDriver('device-1'));
      registry.addDevice(createMockDriver('device-2'));
      manager.syncDevices();

      const callback = vi.fn();
      manager.subscribe('device-1', 'client-1', callback);
      manager.subscribe('device-2', 'client-1', callback);

      expect(manager.getSession('device-1')?.getSubscriberCount()).toBe(1);
      expect(manager.getSession('device-2')?.getSubscriberCount()).toBe(1);

      manager.unsubscribeAll('client-1');

      expect(manager.getSession('device-1')?.getSubscriberCount()).toBe(0);
      expect(manager.getSession('device-2')?.getSubscriberCount()).toBe(0);
    });
  });

  describe('Action Forwarding', () => {
    it('should forward setMode to the correct session', async () => {
      manager = createSessionManager(registry, { pollIntervalMs: 250 });

      const driver = createMockDriver('device-1');
      const setModeSpy = vi.spyOn(driver, 'setMode');
      registry.addDevice(driver);
      manager.syncDevices();

      await manager.setMode('device-1', 'CV');

      expect(setModeSpy).toHaveBeenCalledWith('CV');
    });

    it('should forward setOutput to the correct session', async () => {
      manager = createSessionManager(registry, { pollIntervalMs: 250 });

      const driver = createMockDriver('device-1');
      const setOutputSpy = vi.spyOn(driver, 'setOutput');
      registry.addDevice(driver);
      manager.syncDevices();

      await manager.setOutput('device-1', true);

      expect(setOutputSpy).toHaveBeenCalledWith(true);
    });

    it('should forward setValue to the correct session', async () => {
      manager = createSessionManager(registry, { pollIntervalMs: 250 });

      const driver = createMockDriver('device-1');
      const setValueSpy = vi.spyOn(driver, 'setValue');
      registry.addDevice(driver);
      manager.syncDevices();

      await manager.setValue('device-1', 'current', 2.5, true);

      expect(setValueSpy).toHaveBeenCalledWith('current', 2.5);
    });

    it('should throw error when action targets unknown device', async () => {
      manager = createSessionManager(registry, { pollIntervalMs: 250 });

      await expect(manager.setMode('unknown', 'CV')).rejects.toThrow('Session not found');
    });
  });
});
