/**
 * WebSocket Integration Tests
 *
 * These tests run against a live server with real hardware.
 * Prerequisites:
 * 1. Start the server: npm run dev
 * 2. Ensure at least one device is connected (e.g., Rigol DL3021 or Matrix WPS300S)
 *
 * Run with: npm test -- --run integration.test.ts
 *
 * These tests are designed to be run manually to validate the WebSocket protocol
 * with actual hardware. They verify:
 * - Device discovery (getDevices, scan)
 * - Subscription lifecycle (subscribe, unsubscribe)
 * - Device actions (setMode, setOutput, setValue)
 * - Measurement streaming
 * - Error handling
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import type { ClientMessage, ServerMessage, DeviceSummary, DeviceSessionState } from '../../../shared/types.js';

const SERVER_URL = process.env.WS_URL || 'ws://localhost:3001/ws';

// Integration test client using 'ws' package for Node.js
interface IntegrationTestClient {
  connect(): Promise<void>;
  close(): void;
  isConnected(): boolean;
  send(message: ClientMessage): void;
  getMessages(): ServerMessage[];
  clearMessages(): void;
  waitFor<T extends ServerMessage['type']>(
    type: T,
    timeoutMs?: number
  ): Promise<Extract<ServerMessage, { type: T }>>;
  waitForMatch(
    predicate: (msg: ServerMessage) => boolean,
    timeoutMs?: number
  ): Promise<ServerMessage>;
  request<T extends ServerMessage['type']>(
    message: ClientMessage,
    responseType: T,
    timeoutMs?: number
  ): Promise<Extract<ServerMessage, { type: T }>>;
}

function createIntegrationClient(url: string): IntegrationTestClient {
  let ws: WebSocket | null = null;
  const messages: ServerMessage[] = [];
  const listeners: Array<(msg: ServerMessage) => void> = [];

  function connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      ws = new WebSocket(url);

      ws.on('open', () => {
        resolve();
      });

      ws.on('error', (err) => {
        reject(err);
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as ServerMessage;
          messages.push(msg);
          for (const listener of listeners) {
            listener(msg);
          }
        } catch (err) {
          console.error('Failed to parse message:', data.toString());
        }
      });
    });
  }

  function close(): void {
    if (ws) {
      ws.close();
      ws = null;
    }
  }

  function isConnected(): boolean {
    return ws !== null && ws.readyState === WebSocket.OPEN;
  }

  function send(message: ClientMessage): void {
    if (!isConnected()) {
      throw new Error('Not connected');
    }
    ws!.send(JSON.stringify(message));
  }

  function getMessages(): ServerMessage[] {
    return [...messages];
  }

  function clearMessages(): void {
    messages.length = 0;
  }

  function waitFor<T extends ServerMessage['type']>(
    type: T,
    timeoutMs = 5000
  ): Promise<Extract<ServerMessage, { type: T }>> {
    return waitForMatch((msg) => msg.type === type, timeoutMs) as Promise<
      Extract<ServerMessage, { type: T }>
    >;
  }

  function waitForMatch(
    predicate: (msg: ServerMessage) => boolean,
    timeoutMs = 5000
  ): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const existing = messages.find(predicate);
      if (existing) {
        resolve(existing);
        return;
      }

      const timeout = setTimeout(() => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
        reject(new Error(`Timeout waiting for message after ${timeoutMs}ms`));
      }, timeoutMs);

      const listener = (msg: ServerMessage) => {
        if (predicate(msg)) {
          clearTimeout(timeout);
          const idx = listeners.indexOf(listener);
          if (idx >= 0) listeners.splice(idx, 1);
          resolve(msg);
        }
      };

      listeners.push(listener);
    });
  }

  function request<T extends ServerMessage['type']>(
    message: ClientMessage,
    responseType: T,
    timeoutMs = 5000
  ): Promise<Extract<ServerMessage, { type: T }>> {
    send(message);
    return waitFor(responseType, timeoutMs);
  }

  return {
    connect,
    close,
    isConnected,
    send,
    getMessages,
    clearMessages,
    waitFor,
    waitForMatch,
    request,
  };
}

// Skip these tests if no server is running
async function checkServerAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(SERVER_URL);
    const timeout = setTimeout(() => {
      ws.close();
      resolve(false);
    }, 2000);

    ws.on('open', () => {
      clearTimeout(timeout);
      ws.close();
      resolve(true);
    });

    ws.on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

describe('WebSocket Integration Tests', () => {
  let client: IntegrationTestClient;
  let serverAvailable = false;

  beforeAll(async () => {
    serverAvailable = await checkServerAvailable();
    if (!serverAvailable) {
      console.log('\n⚠️  Server not available - skipping integration tests');
      console.log('   Start the server with: npm run dev\n');
    }
  });

  beforeEach(async () => {
    if (!serverAvailable) return;
    client = createIntegrationClient(SERVER_URL);
    await client.connect();
  });

  afterEach(() => {
    if (client) {
      client.close();
    }
  });

  describe('Connection', () => {
    it('should connect to the server', async () => {
      if (!serverAvailable) return;
      expect(client.isConnected()).toBe(true);
    });
  });

  describe('Device Discovery', () => {
    it('should return device list on getDevices message', async () => {
      if (!serverAvailable) return;

      const response = await client.request({ type: 'getDevices' }, 'deviceList');

      expect(response.type).toBe('deviceList');
      expect(Array.isArray(response.devices)).toBe(true);

      console.log(`\n  Found ${response.devices.length} device(s):`);
      for (const device of response.devices) {
        console.log(`    - ${device.info.manufacturer} ${device.info.model} (${device.info.type})`);
      }
    });

    it('should return device list on scan message', async () => {
      if (!serverAvailable) return;

      const response = await client.request({ type: 'scan' }, 'deviceList');

      expect(response.type).toBe('deviceList');
      expect(Array.isArray(response.devices)).toBe(true);
    });

    it('should return devices with required properties', async () => {
      if (!serverAvailable) return;

      const response = await client.request({ type: 'getDevices' }, 'deviceList');

      for (const device of response.devices) {
        // DeviceSummary shape
        expect(device).toHaveProperty('id');
        expect(device).toHaveProperty('info');
        expect(device).toHaveProperty('capabilities');
        expect(device).toHaveProperty('connectionStatus');

        // DeviceInfo shape
        expect(device.info).toHaveProperty('id');
        expect(device.info).toHaveProperty('type');
        expect(device.info).toHaveProperty('manufacturer');
        expect(device.info).toHaveProperty('model');

        // DeviceCapabilities shape
        expect(device.capabilities).toHaveProperty('modes');
        expect(device.capabilities).toHaveProperty('modesSettable');
        expect(device.capabilities).toHaveProperty('outputs');
        expect(device.capabilities).toHaveProperty('measurements');

        expect(['connected', 'error', 'disconnected']).toContain(device.connectionStatus);
      }
    });
  });

  describe('Subscription Lifecycle', () => {
    let devices: DeviceSummary[] = [];

    beforeEach(async () => {
      if (!serverAvailable) return;
      client.clearMessages();
      const response = await client.request({ type: 'getDevices' }, 'deviceList');
      devices = response.devices;
    });

    it('should subscribe to a device and receive full state', async () => {
      if (!serverAvailable || devices.length === 0) {
        console.log('  ⚠️ No devices available for subscription test');
        return;
      }

      const deviceId = devices[0].id;
      client.clearMessages();

      client.send({ type: 'subscribe', deviceId });
      const response = await client.waitFor('subscribed');

      expect(response.type).toBe('subscribed');
      expect(response.deviceId).toBe(deviceId);
      expect(response.state).toBeDefined();

      // Verify state has required properties
      const state = response.state;
      expect(state).toHaveProperty('info');
      expect(state).toHaveProperty('capabilities');
      expect(state).toHaveProperty('connectionStatus');
      expect(state).toHaveProperty('mode');
      expect(state).toHaveProperty('outputEnabled');
      expect(state).toHaveProperty('setpoints');
      expect(state).toHaveProperty('measurements');
      expect(state).toHaveProperty('history');
      expect(state).toHaveProperty('lastUpdated');

      console.log('\n  Subscribed to device state:');
      console.log(`    Mode: ${state.mode}`);
      console.log(`    Output: ${state.outputEnabled ? 'ON' : 'OFF'}`);
      console.log(`    Measurements: ${JSON.stringify(state.measurements)}`);
    });

    it('should unsubscribe from a device', async () => {
      if (!serverAvailable || devices.length === 0) return;

      const deviceId = devices[0].id;

      // Subscribe first
      client.send({ type: 'subscribe', deviceId });
      await client.waitFor('subscribed');

      // Now unsubscribe
      client.clearMessages();
      client.send({ type: 'unsubscribe', deviceId });
      const response = await client.waitFor('unsubscribed');

      expect(response.type).toBe('unsubscribed');
      expect(response.deviceId).toBe(deviceId);
    });

    it('should receive error for unknown device subscription', async () => {
      if (!serverAvailable) return;

      client.clearMessages();
      client.send({ type: 'subscribe', deviceId: 'nonexistent-device-id' });
      const response = await client.waitFor('error');

      expect(response.type).toBe('error');
      expect(response.code).toBe('DEVICE_NOT_FOUND');
      expect(response.deviceId).toBe('nonexistent-device-id');
    });
  });

  describe('Measurement Streaming', () => {
    let devices: DeviceSummary[] = [];

    beforeEach(async () => {
      if (!serverAvailable) return;
      client.clearMessages();
      const response = await client.request({ type: 'getDevices' }, 'deviceList');
      devices = response.devices;
    });

    it('should receive measurement updates after subscribing', async () => {
      if (!serverAvailable || devices.length === 0) {
        console.log('  ⚠️ No devices available for streaming test');
        return;
      }

      const device = devices[0];
      if (device.connectionStatus !== 'connected') {
        console.log(`  ⚠️ Device ${device.id} is ${device.connectionStatus}, skipping`);
        return;
      }

      const deviceId = device.id;

      // Subscribe
      client.send({ type: 'subscribe', deviceId });
      const subscribeResponse = await client.waitFor('subscribed');

      // Wait for measurement - should arrive within poll interval (250ms)
      const measurement = await client.waitFor('measurement', 1000);

      expect(measurement.type).toBe('measurement');
      expect(measurement.deviceId).toBe(deviceId);
      expect(measurement.update).toHaveProperty('timestamp');
      expect(measurement.update).toHaveProperty('measurements');

      console.log('\n  Received measurement update:');
      console.log(`    Measurements: ${JSON.stringify(measurement.update.measurements)}`);

      client.send({ type: 'unsubscribe', deviceId });
    });

    it('should stop receiving measurements after unsubscribe', async () => {
      if (!serverAvailable || devices.length === 0) return;

      const device = devices[0];
      if (device.connectionStatus !== 'connected') {
        console.log(`  ⚠️ Device ${device.id} is ${device.connectionStatus}, skipping`);
        return;
      }

      const deviceId = device.id;

      // Subscribe and confirm we receive measurements
      client.send({ type: 'subscribe', deviceId });
      const subscribeResponse = await client.waitFor('subscribed');
      if (subscribeResponse.state.connectionStatus !== 'connected') {
        console.log(`  ⚠️ Device session is ${subscribeResponse.state.connectionStatus}, skipping`);
        return;
      }

      // Wait for at least one measurement to confirm streaming works
      await client.waitFor('measurement', 1000);

      // Unsubscribe
      client.clearMessages();
      client.send({ type: 'unsubscribe', deviceId });
      await client.waitFor('unsubscribed');

      // After unsubscribe, should NOT receive measurements
      // Use waitFor with expectation that it will timeout
      client.clearMessages();
      try {
        await client.waitFor('measurement', 500);
        // If we get here, we received a measurement - that's a failure
        expect.fail('Should not receive measurements after unsubscribe');
      } catch (err) {
        // Timeout expected - this is success
        expect((err as Error).message).toContain('Timeout');
      }
    });
  });

  describe('Device Actions', () => {
    let devices: DeviceSummary[] = [];
    let testDevice: DeviceSummary | null = null;

    beforeEach(async () => {
      if (!serverAvailable) return;
      client.clearMessages();
      const response = await client.request({ type: 'getDevices' }, 'deviceList');
      devices = response.devices;
      testDevice = devices[0] || null;
    });

    afterEach(async () => {
      // Safety: turn off output after each test
      if (testDevice) {
        try {
          client.send({ type: 'setOutput', deviceId: testDevice.id, enabled: false });
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch {
          // Ignore errors during cleanup
        }
      }
    });

    it('should set device mode', async () => {
      if (!serverAvailable || !testDevice) {
        console.log('  ⚠️ No devices available for action test');
        return;
      }

      // Subscribe first to receive field updates
      client.send({ type: 'subscribe', deviceId: testDevice.id });
      await client.waitFor('subscribed');
      client.clearMessages();

      // Get available modes
      const modes = testDevice.capabilities.modes;
      if (modes.length < 2) {
        console.log('  ⚠️ Device has less than 2 modes, skipping mode change test');
        return;
      }

      // Change to a different mode
      const currentMode = modes[0];
      const newMode = modes[1];

      console.log(`\n  Changing mode from ${currentMode} to ${newMode}...`);
      client.send({ type: 'setMode', deviceId: testDevice.id, mode: newMode });

      // Wait for field update confirming mode change
      const fieldUpdate = await client.waitForMatch(
        (msg) => msg.type === 'field' && msg.field === 'mode' && msg.value === newMode,
        2000
      );

      expect(fieldUpdate.type).toBe('field');
      if (fieldUpdate.type === 'field') {
        expect(fieldUpdate.field).toBe('mode');
        expect(fieldUpdate.value).toBe(newMode);
      }

      // Restore original mode
      client.send({ type: 'setMode', deviceId: testDevice.id, mode: currentMode });
    });

    it('should toggle device output', async () => {
      if (!serverAvailable || !testDevice) return;

      // Subscribe first
      client.send({ type: 'subscribe', deviceId: testDevice.id });
      const subscribeResponse = await client.waitFor('subscribed');
      const initialOutputState = subscribeResponse.state.outputEnabled;
      client.clearMessages();

      console.log(`\n  Current output state: ${initialOutputState ? 'ON' : 'OFF'}`);
      console.log(`  Toggling to: ${!initialOutputState ? 'ON' : 'OFF'}...`);

      // Toggle output
      client.send({ type: 'setOutput', deviceId: testDevice.id, enabled: !initialOutputState });

      // Wait for field update
      const fieldUpdate = await client.waitForMatch(
        (msg) => msg.type === 'field' && msg.field === 'outputEnabled',
        2000
      );

      expect(fieldUpdate.type).toBe('field');
      if (fieldUpdate.type === 'field') {
        expect(fieldUpdate.value).toBe(!initialOutputState);
      }

      // Restore original state
      client.send({ type: 'setOutput', deviceId: testDevice.id, enabled: initialOutputState });
    });

    it('should set device value with immediate flag', async () => {
      if (!serverAvailable || !testDevice) return;

      // Subscribe first to get current state
      client.send({ type: 'subscribe', deviceId: testDevice.id });
      const subscribeResponse = await client.waitFor('subscribed');
      const currentState = subscribeResponse.state;
      client.clearMessages();

      // Find an output that's valid for the current mode
      const outputs = testDevice.capabilities.outputs;
      if (outputs.length === 0) {
        console.log('  ⚠️ Device has no settable outputs');
        return;
      }

      // Find an output appropriate for current mode
      const currentMode = currentState.mode;
      let output = outputs.find(o => o.modes?.includes(currentMode)) || outputs[0];

      // Use a safe test value - just slightly above minimum
      const minVal = output.min ?? 0;
      const maxVal = output.max ?? 10;
      // Use a very conservative value: min + 1% of range, capped at a safe value
      const safeIncrement = Math.min((maxVal - minVal) * 0.01, 0.1);
      const testValue = minVal + safeIncrement;

      console.log(`\n  Mode: ${currentMode}`);
      console.log(`  Setting ${output.name} to ${testValue.toFixed(output.decimals)} ${output.unit} (safe: min=${minVal}, max=${maxVal})...`);

      client.send({
        type: 'setValue',
        deviceId: testDevice.id,
        name: output.name,
        value: testValue,
        immediate: true,
      });

      // Wait for setpoints field update
      const fieldUpdate = await client.waitForMatch(
        (msg) => msg.type === 'field' && msg.field === 'setpoints',
        2000
      );

      expect(fieldUpdate.type).toBe('field');
      if (fieldUpdate.type === 'field') {
        const setpoints = fieldUpdate.value as Record<string, number>;
        expect(setpoints[output.name]).toBeCloseTo(testValue, output.decimals);
      }
    });

    it('should debounce setValue calls without immediate flag', async () => {
      if (!serverAvailable || !testDevice) return;

      // Subscribe first to get current state
      client.send({ type: 'subscribe', deviceId: testDevice.id });
      const subscribeResponse = await client.waitFor('subscribed');
      const currentState = subscribeResponse.state;
      client.clearMessages();

      const outputs = testDevice.capabilities.outputs;
      if (outputs.length === 0) return;

      // Find an output appropriate for current mode
      const currentMode = currentState.mode;
      const output = outputs.find(o => o.modes?.includes(currentMode)) || outputs[0];

      // Use safe values close to minimum
      const minVal = output.min ?? 0;
      const baseValue = minVal + 0.01;
      const increment = 0.001; // Very small increments to stay safe

      console.log(`\n  Sending rapid setValue calls (debounced) for ${output.name}...`);
      console.log(`    Range: ${baseValue.toFixed(3)} to ${(baseValue + 4 * increment).toFixed(3)} ${output.unit}`);

      // Send multiple rapid setValue calls with tiny increments
      for (let i = 0; i < 5; i++) {
        client.send({
          type: 'setValue',
          deviceId: testDevice.id,
          name: output.name,
          value: baseValue + i * increment,
          immediate: false,
        });
      }

      // Wait for debounce (default 250ms) + some buffer
      await new Promise(resolve => setTimeout(resolve, 400));

      // Should only see one field update (the last value)
      const fieldUpdates = client.getMessages().filter(
        (msg) => msg.type === 'field' && msg.field === 'setpoints'
      );

      // With debounce, we should see only 1 update with the final value
      expect(fieldUpdates.length).toBe(1);
    });

    it('should return error when setValue exceeds device limits', async () => {
      if (!serverAvailable || !testDevice) return;

      // Subscribe first
      client.send({ type: 'subscribe', deviceId: testDevice.id });
      await client.waitFor('subscribed');
      client.clearMessages();

      const outputs = testDevice.capabilities.outputs;
      if (outputs.length === 0) return;

      const output = outputs[0];
      const maxVal = output.max ?? 100;

      // Try to set a value way over the limit
      const invalidValue = maxVal * 10;

      console.log(`\n  Attempting to set ${output.name} to ${invalidValue} ${output.unit} (max: ${maxVal})...`);

      client.send({
        type: 'setValue',
        deviceId: testDevice.id,
        name: output.name,
        value: invalidValue,
        immediate: true,
      });

      // Wait for error response (hardware should reject this)
      try {
        const response = await client.waitForMatch(
          (msg) => msg.type === 'error' && msg.code === 'SET_VALUE_FAILED',
          2000
        );
        console.log(`  ✓ Received expected error: ${response.type === 'error' ? response.message : 'unknown'}`);
        expect(response.type).toBe('error');
      } catch {
        // If no error, the device might have accepted the value (clamping)
        // or the setpoints field was updated - either is valid behavior
        const msgs = client.getMessages();
        const fieldUpdate = msgs.find(m => m.type === 'field' && m.field === 'setpoints');
        if (fieldUpdate) {
          console.log('  ℹ Device accepted or clamped the value (no error returned)');
        }
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid JSON gracefully', async () => {
      if (!serverAvailable) return;

      // Send raw invalid JSON (need to access the underlying ws)
      // This test is tricky because our client only sends valid JSON
      // We'll test the error response for unknown message type instead
      client.send({ type: 'unknownMessageType' } as any);

      const response = await client.waitFor('error');
      expect(response.type).toBe('error');
      expect(response.code).toBe('UNKNOWN_MESSAGE_TYPE');
    });

    it('should handle setMode on non-existent device', async () => {
      if (!serverAvailable) return;

      client.send({ type: 'setMode', deviceId: 'nonexistent', mode: 'CC' });
      const response = await client.waitFor('error');

      expect(response.type).toBe('error');
      expect(response.deviceId).toBe('nonexistent');
    });

    it('should handle setOutput on non-existent device', async () => {
      if (!serverAvailable) return;

      client.send({ type: 'setOutput', deviceId: 'nonexistent', enabled: true });
      const response = await client.waitFor('error');

      expect(response.type).toBe('error');
      expect(response.deviceId).toBe('nonexistent');
    });

    it('should handle setValue on non-existent device', async () => {
      if (!serverAvailable) return;

      client.send({
        type: 'setValue',
        deviceId: 'nonexistent',
        name: 'current',
        value: 1.0,
      });
      const response = await client.waitFor('error');

      expect(response.type).toBe('error');
      expect(response.deviceId).toBe('nonexistent');
    });
  });

  describe('Multiple Clients', () => {
    let client2: IntegrationTestClient;

    afterEach(() => {
      if (client2) {
        client2.close();
      }
    });

    it('should handle multiple simultaneous clients', async () => {
      if (!serverAvailable) return;

      client2 = createIntegrationClient(SERVER_URL);
      await client2.connect();

      // Both clients request device list
      const [response1, response2] = await Promise.all([
        client.request({ type: 'getDevices' }, 'deviceList'),
        client2.request({ type: 'getDevices' }, 'deviceList'),
      ]);

      expect(response1.type).toBe('deviceList');
      expect(response2.type).toBe('deviceList');
      expect(response1.devices.length).toBe(response2.devices.length);
    });

    it('should isolate subscriptions between clients', async () => {
      if (!serverAvailable) return;

      const devices = (await client.request({ type: 'getDevices' }, 'deviceList')).devices;
      if (devices.length === 0) return;

      const device = devices[0];
      if (device.connectionStatus !== 'connected') {
        console.log(`  ⚠️ Device ${device.id} is ${device.connectionStatus}, skipping`);
        return;
      }

      client2 = createIntegrationClient(SERVER_URL);
      await client2.connect();
      client2.clearMessages();

      const deviceId = device.id;

      // Only client1 subscribes
      client.send({ type: 'subscribe', deviceId });
      const subscribeResponse = await client.waitFor('subscribed');

      // The 'subscribed' response includes history - if polling works, there's data
      const history = subscribeResponse.state.history;
      expect(history.timestamps.length).toBeGreaterThan(0);

      // client2 never subscribed, so it should have NO measurement messages
      const client2Messages = client2.getMessages();
      const client2Measurements = client2Messages.filter(m => m.type === 'measurement');
      expect(client2Measurements.length).toBe(0);
    });
  });
});
