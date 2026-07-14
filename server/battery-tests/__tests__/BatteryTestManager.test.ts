import { describe, expect, it, vi } from 'vitest';
import type { DeviceSession } from '../../sessions/DeviceSession.js';
import type { DeviceSessionState, ServerMessage } from '../../../shared/types.js';
import { Ok } from '../../../shared/types.js';
import { createBatteryTestManager } from '../BatteryTestManager.js';

function createLoadSession(overrides: Partial<DeviceSessionState> = {}) {
  const callbacks = new Map<string, (message: ServerMessage) => void>();
  const state: DeviceSessionState = {
    info: { id: 'load-1', type: 'electronic-load', manufacturer: 'Test', model: 'Load' },
    capabilities: {
      deviceClass: 'load', features: {}, modes: ['CC'], modesSettable: true,
      outputs: [{ name: 'current', unit: 'A', decimals: 3, min: 0, max: 10, modes: ['CC'] }],
      measurements: [
        { name: 'voltage', unit: 'V', decimals: 3 },
        { name: 'current', unit: 'A', decimals: 3 },
        { name: 'power', unit: 'W', decimals: 3 },
      ],
    },
    connectionStatus: 'connected', consecutiveErrors: 0, mode: 'CC', outputEnabled: false,
    setpoints: { current: 0 }, measurements: { voltage: 4, current: 0, power: 0 },
    history: { timestamps: [], voltage: [], current: [], power: [] }, lastUpdated: Date.now(),
    ...overrides,
  };
  const session: DeviceSession = {
    getState: () => state,
    getSubscriberCount: () => callbacks.size,
    hasSubscriber: id => callbacks.has(id),
    subscribe: (id, callback) => { callbacks.set(id, callback); },
    unsubscribe: id => { callbacks.delete(id); },
    setMode: vi.fn().mockResolvedValue(Ok()),
    setOutput: vi.fn().mockResolvedValue(Ok()),
    setRemoteSensing: vi.fn().mockResolvedValue(Ok()),
    setValue: vi.fn().mockResolvedValue(Ok()),
    reconnect: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    pauseHeartbeat: vi.fn(), resumeHeartbeat: vi.fn(), isHeartbeatPaused: () => false,
  };
  return { session, emit: (message: ServerMessage) => callbacks.forEach(callback => callback(message)) };
}

describe('BatteryTestManager', () => {
  it('applies remote sense and uses a fresh sensed voltage for preflight', async () => {
    const { session, emit } = createLoadSession({
      capabilities: {
        deviceClass: 'load', features: { remoteSensing: true }, modes: ['CC'], modesSettable: true,
        outputs: [{ name: 'current', unit: 'A', decimals: 3, min: 0, max: 10, modes: ['CC'] }],
        measurements: [
          { name: 'voltage', unit: 'V', decimals: 3 },
          { name: 'current', unit: 'A', decimals: 3 },
          { name: 'power', unit: 'W', decimals: 3 },
        ],
      },
      measurements: { voltage: 2.5, current: 0, power: 0 },
    });
    const manager = createBatteryTestManager({ getSession: () => session });
    const startPromise = manager.start({
      deviceId: 'load-1', minVoltage: 3, maxVoltage: 4.2, targetCurrent: 1, rampMinutes: 0, remoteSensing: true,
    });
    await vi.waitFor(() => expect(session.setRemoteSensing).toHaveBeenCalledWith(true));
    emit({
      type: 'measurement', deviceId: 'load-1',
      update: { timestamp: Date.now(), measurements: { voltage: 4.05, current: 0, power: 0 } },
    });
    const result = await startPromise;
    expect(result.ok).toBe(true);
    expect(manager.getState()?.voltage).toBe(4.05);
  });

  it('runs only on electronic loads and validates the starting voltage window', async () => {
    const { session } = createLoadSession({
      info: { id: 'psu-1', type: 'power-supply', manufacturer: 'Test', model: 'PSU' },
    });
    const manager = createBatteryTestManager({ getSession: () => session });
    const result = await manager.start({ deviceId: 'psu-1', minVoltage: 3, maxVoltage: 4.2, targetCurrent: 1, rampMinutes: 0 });
    expect(result.ok).toBe(false);
  });

  it('integrates measured current and power and stops at the mAh cutoff', async () => {
    const { session, emit } = createLoadSession();
    const manager = createBatteryTestManager({ getSession: () => session });
    const result = await manager.start({ deviceId: 'load-1', minVoltage: 3, maxVoltage: 4.2, targetCurrent: 1, rampMinutes: 0, cutoffMah: 400 });
    expect(result.ok).toBe(true);
    const startedAt = manager.getState()?.startedAt ?? 0;
    emit({ type: 'measurement', deviceId: 'load-1', update: { timestamp: startedAt + 3_600_000, measurements: { voltage: 3.8, current: 1, power: 3.8 } } });
    await vi.waitFor(() => expect(manager.getState()?.executionState).toBe('completed'));
    expect(manager.getState()?.terminationReason).toBe('charge-limit');
    expect(manager.getState()?.chargeMah).toBeCloseTo(500);
    expect(manager.getState()?.energyWh).toBeCloseTo(1.9);
    expect(manager.getSamples()).toHaveLength(2);
    expect(manager.getSamples()[1]).toMatchObject({ voltage: 3.8, current: 1, power: 3.8 });
    expect(session.setOutput).toHaveBeenLastCalledWith(false);
  });

  it('always stops at the minimum voltage safety floor', async () => {
    const { session, emit } = createLoadSession();
    const manager = createBatteryTestManager({ getSession: () => session });
    await manager.start({ deviceId: 'load-1', minVoltage: 3.2, maxVoltage: 4.2, targetCurrent: 1, rampMinutes: 0, cutoffWh: 100 });
    const startedAt = manager.getState()?.startedAt ?? 0;
    emit({ type: 'measurement', deviceId: 'load-1', update: { timestamp: startedAt + 1000, measurements: { voltage: 3.2, current: 1, power: 3.2 } } });
    await vi.waitFor(() => expect(manager.getState()?.terminationReason).toBe('minimum-voltage'));
  });

  it('can stop after removing a configured amount of energy', async () => {
    const { session, emit } = createLoadSession();
    const manager = createBatteryTestManager({ getSession: () => session });
    await manager.start({ deviceId: 'load-1', minVoltage: 3, maxVoltage: 4.2, targetCurrent: 1, rampMinutes: 0, cutoffWh: 1 });
    const startedAt = manager.getState()?.startedAt ?? 0;
    emit({ type: 'measurement', deviceId: 'load-1', update: { timestamp: startedAt + 3_600_000, measurements: { voltage: 4, current: 1, power: 4 } } });
    await vi.waitFor(() => expect(manager.getState()?.terminationReason).toBe('energy-limit'));
    expect(manager.getState()?.energyWh).toBeCloseTo(2);
  });

  it.each([
    { config: { maxCurrent: 1.5 }, current: 1.5, power: 6, reason: 'current-limit' },
    { config: { maxPower: 5 }, current: 1.4, power: 5, reason: 'power-limit' },
  ])('stops at the measured $reason safety cutoff', async ({ config, current, power, reason }) => {
    const { session, emit } = createLoadSession();
    const manager = createBatteryTestManager({ getSession: () => session });
    await manager.start({ deviceId: 'load-1', minVoltage: 3, maxVoltage: 4.2, targetCurrent: 1, rampMinutes: 0, ...config });
    const startedAt = manager.getState()?.startedAt ?? 0;
    emit({ type: 'measurement', deviceId: 'load-1', update: { timestamp: startedAt + 250, measurements: { voltage: 4, current, power } } });
    await vi.waitFor(() => expect(manager.getState()?.terminationReason).toBe(reason));
  });
});
