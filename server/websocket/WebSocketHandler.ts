/**
 * WebSocketHandler - Handles websocket connections and message routing
 *
 * - Manages client subscriptions (client -> Set<deviceId>)
 * - Routes client messages to appropriate DeviceSession
 * - Broadcasts session updates to subscribed clients
 * - Cleans up on client disconnect
 */

import type { WebSocket, WebSocketServer } from 'ws';
import type { SessionManager } from '../sessions/SessionManager.js';
import type { ClientMessage, ServerMessage } from '../../shared/types.js';

export interface WebSocketHandler {
  getClientCount(): number;
  broadcastDeviceList(): void;
  close(): void;
}

interface ClientState {
  id: string;
  ws: WebSocket;
  subscriptions: Set<string>; // Set of deviceIds
}

let clientIdCounter = 0;

function generateClientId(): string {
  return `client-${++clientIdCounter}-${Date.now()}`;
}

export function createWebSocketHandler(
  wss: WebSocketServer,
  sessionManager: SessionManager
): WebSocketHandler {
  const clients = new Map<WebSocket, ClientState>();

  // Send a message to a specific client
  function send(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === 1) { // OPEN
      ws.send(JSON.stringify(message));
    }
  }

  // Handle incoming messages
  function handleMessage(clientState: ClientState, data: string): void {
    let message: ClientMessage;

    try {
      message = JSON.parse(data) as ClientMessage;
    } catch {
      send(clientState.ws, {
        type: 'error',
        code: 'INVALID_MESSAGE',
        message: 'Failed to parse JSON message',
      });
      return;
    }

    switch (message.type) {
      case 'getDevices':
        handleGetDevices(clientState);
        break;

      case 'scan':
        handleScan(clientState);
        break;

      case 'subscribe':
        handleSubscribe(clientState, message.deviceId);
        break;

      case 'unsubscribe':
        handleUnsubscribe(clientState, message.deviceId);
        break;

      case 'setMode':
        handleSetMode(clientState, message.deviceId, message.mode);
        break;

      case 'setOutput':
        handleSetOutput(clientState, message.deviceId, message.enabled);
        break;

      case 'setValue':
        handleSetValue(clientState, message.deviceId, message.name, message.value, message.immediate ?? false);
        break;

      case 'startList':
        // TODO: Implement list mode
        send(clientState.ws, {
          type: 'error',
          deviceId: message.deviceId,
          code: 'NOT_IMPLEMENTED',
          message: 'List mode not yet implemented',
        });
        break;

      case 'stopList':
        // TODO: Implement list mode
        send(clientState.ws, {
          type: 'error',
          deviceId: message.deviceId,
          code: 'NOT_IMPLEMENTED',
          message: 'List mode not yet implemented',
        });
        break;

      // Oscilloscope messages
      case 'scopeRun':
        handleScopeRun(clientState, message.deviceId);
        break;

      case 'scopeStop':
        handleScopeStop(clientState, message.deviceId);
        break;

      case 'scopeSingle':
        handleScopeSingle(clientState, message.deviceId);
        break;

      case 'scopeAutoSetup':
        handleScopeAutoSetup(clientState, message.deviceId);
        break;

      case 'scopeGetWaveform':
        handleScopeGetWaveform(clientState, message.deviceId, message.channel);
        break;

      case 'scopeGetMeasurement':
        handleScopeGetMeasurement(clientState, message.deviceId, message.channel, message.measurementType);
        break;

      case 'scopeGetScreenshot':
        handleScopeGetScreenshot(clientState, message.deviceId);
        break;

      // Oscilloscope channel settings
      case 'scopeSetChannelEnabled':
        handleScopeSetChannelEnabled(clientState, message.deviceId, message.channel, message.enabled);
        break;

      case 'scopeSetChannelScale':
        handleScopeSetChannelScale(clientState, message.deviceId, message.channel, message.scale);
        break;

      case 'scopeSetChannelOffset':
        handleScopeSetChannelOffset(clientState, message.deviceId, message.channel, message.offset);
        break;

      case 'scopeSetChannelCoupling':
        handleScopeSetChannelCoupling(clientState, message.deviceId, message.channel, message.coupling);
        break;

      case 'scopeSetChannelProbe':
        handleScopeSetChannelProbe(clientState, message.deviceId, message.channel, message.ratio);
        break;

      case 'scopeSetChannelBwLimit':
        handleScopeSetChannelBwLimit(clientState, message.deviceId, message.channel, message.enabled);
        break;

      // Oscilloscope timebase settings
      case 'scopeSetTimebaseScale':
        handleScopeSetTimebaseScale(clientState, message.deviceId, message.scale);
        break;

      case 'scopeSetTimebaseOffset':
        handleScopeSetTimebaseOffset(clientState, message.deviceId, message.offset);
        break;

      // Oscilloscope trigger settings
      case 'scopeSetTriggerSource':
        handleScopeSetTriggerSource(clientState, message.deviceId, message.source);
        break;

      case 'scopeSetTriggerLevel':
        handleScopeSetTriggerLevel(clientState, message.deviceId, message.level);
        break;

      case 'scopeSetTriggerEdge':
        handleScopeSetTriggerEdge(clientState, message.deviceId, message.edge);
        break;

      case 'scopeSetTriggerSweep':
        handleScopeSetTriggerSweep(clientState, message.deviceId, message.sweep);
        break;

      // Oscilloscope streaming
      case 'scopeStartStreaming':
        handleScopeStartStreaming(clientState, message.deviceId, message.channels, message.intervalMs, message.measurements);
        break;

      case 'scopeStopStreaming':
        handleScopeStopStreaming(clientState, message.deviceId);
        break;

      default:
        send(clientState.ws, {
          type: 'error',
          code: 'UNKNOWN_MESSAGE_TYPE',
          message: `Unknown message type: ${(message as any).type}`,
        });
    }
  }

  function handleGetDevices(clientState: ClientState): void {
    const devices = sessionManager.getDeviceSummaries();
    send(clientState.ws, { type: 'deviceList', devices });
  }

  function handleScan(clientState: ClientState): void {
    sessionManager.syncDevices();
    const devices = sessionManager.getDeviceSummaries();
    send(clientState.ws, { type: 'deviceList', devices });
  }

  function handleSubscribe(clientState: ClientState, deviceId: string): void {
    const session = sessionManager.getSession(deviceId);
    const scopeSession = sessionManager.getOscilloscopeSession(deviceId);

    if (!session && !scopeSession) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'DEVICE_NOT_FOUND',
        message: `Device not found: ${deviceId}`,
      });
      return;
    }

    // Create callback for session updates
    const callback = (message: ServerMessage) => {
      send(clientState.ws, message);
    };

    // Subscribe through session manager
    const success = sessionManager.subscribe(deviceId, clientState.id, callback);

    if (success) {
      clientState.subscriptions.add(deviceId);

      // Return appropriate state based on device type
      if (session) {
        send(clientState.ws, {
          type: 'subscribed',
          deviceId,
          state: session.getState(),
        });
      } else if (scopeSession) {
        // For oscilloscopes, we send the state via field message
        // since OscilloscopeSessionState has different shape
        send(clientState.ws, {
          type: 'subscribed',
          deviceId,
          state: scopeSession.getState() as any,  // Different state shape
        });
      }
    } else {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SUBSCRIBE_FAILED',
        message: `Failed to subscribe to device: ${deviceId}`,
      });
    }
  }

  function handleUnsubscribe(clientState: ClientState, deviceId: string): void {
    sessionManager.unsubscribe(deviceId, clientState.id);
    clientState.subscriptions.delete(deviceId);
    send(clientState.ws, { type: 'unsubscribed', deviceId });
  }

  async function handleSetMode(clientState: ClientState, deviceId: string, mode: string): Promise<void> {
    try {
      await sessionManager.setMode(deviceId, mode);
    } catch (err) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SET_MODE_FAILED',
        message: err instanceof Error ? err.message : 'Failed to set mode',
      });
    }
  }

  async function handleSetOutput(clientState: ClientState, deviceId: string, enabled: boolean): Promise<void> {
    try {
      await sessionManager.setOutput(deviceId, enabled);
    } catch (err) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SET_OUTPUT_FAILED',
        message: err instanceof Error ? err.message : 'Failed to set output',
      });
    }
  }

  async function handleSetValue(
    clientState: ClientState,
    deviceId: string,
    name: string,
    value: number,
    immediate: boolean
  ): Promise<void> {
    try {
      await sessionManager.setValue(deviceId, name, value, immediate);
    } catch (err) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SET_VALUE_FAILED',
        message: err instanceof Error ? err.message : 'Failed to set value',
      });
    }
  }

  // Oscilloscope handlers
  async function handleScopeRun(clientState: ClientState, deviceId: string): Promise<void> {
    try {
      await sessionManager.oscilloscopeRun(deviceId);
    } catch (err) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_RUN_FAILED',
        message: err instanceof Error ? err.message : 'Failed to run oscilloscope',
      });
    }
  }

  async function handleScopeStop(clientState: ClientState, deviceId: string): Promise<void> {
    try {
      await sessionManager.oscilloscopeStop(deviceId);
    } catch (err) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_STOP_FAILED',
        message: err instanceof Error ? err.message : 'Failed to stop oscilloscope',
      });
    }
  }

  async function handleScopeSingle(clientState: ClientState, deviceId: string): Promise<void> {
    try {
      await sessionManager.oscilloscopeSingle(deviceId);
    } catch (err) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_SINGLE_FAILED',
        message: err instanceof Error ? err.message : 'Failed to set single trigger',
      });
    }
  }

  async function handleScopeAutoSetup(clientState: ClientState, deviceId: string): Promise<void> {
    try {
      await sessionManager.oscilloscopeAutoSetup(deviceId);
    } catch (err) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_AUTO_SETUP_FAILED',
        message: err instanceof Error ? err.message : 'Failed to auto-setup oscilloscope',
      });
    }
  }

  async function handleScopeGetWaveform(clientState: ClientState, deviceId: string, channel: string): Promise<void> {
    try {
      const waveform = await sessionManager.oscilloscopeGetWaveform(deviceId, channel);
      send(clientState.ws, {
        type: 'scopeWaveform',
        deviceId,
        channel,
        waveform,
      });
    } catch (err) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_WAVEFORM_FAILED',
        message: err instanceof Error ? err.message : 'Failed to get waveform',
      });
    }
  }

  async function handleScopeGetMeasurement(
    clientState: ClientState,
    deviceId: string,
    channel: string,
    measurementType: string
  ): Promise<void> {
    try {
      const value = await sessionManager.oscilloscopeGetMeasurement(deviceId, channel, measurementType);
      send(clientState.ws, {
        type: 'scopeMeasurement',
        deviceId,
        channel,
        measurementType,
        value,
      });
    } catch (err) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_MEASUREMENT_FAILED',
        message: err instanceof Error ? err.message : 'Failed to get measurement',
      });
    }
  }

  async function handleScopeGetScreenshot(clientState: ClientState, deviceId: string): Promise<void> {
    try {
      const buffer = await sessionManager.oscilloscopeGetScreenshot(deviceId);
      const base64 = buffer.toString('base64');
      send(clientState.ws, {
        type: 'scopeScreenshot',
        deviceId,
        data: base64,
      });
    } catch (err) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_SCREENSHOT_FAILED',
        message: err instanceof Error ? err.message : 'Failed to get screenshot',
      });
    }
  }

  // Oscilloscope channel settings handlers
  async function handleScopeSetChannelEnabled(
    clientState: ClientState,
    deviceId: string,
    channel: string,
    enabled: boolean
  ): Promise<void> {
    try {
      await sessionManager.oscilloscopeSetChannelEnabled(deviceId, channel, enabled);
    } catch (err) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_SET_CHANNEL_ENABLED_FAILED',
        message: err instanceof Error ? err.message : 'Failed to set channel enabled',
      });
    }
  }

  async function handleScopeSetChannelScale(
    clientState: ClientState,
    deviceId: string,
    channel: string,
    scale: number
  ): Promise<void> {
    try {
      await sessionManager.oscilloscopeSetChannelScale(deviceId, channel, scale);
    } catch (err) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_SET_CHANNEL_SCALE_FAILED',
        message: err instanceof Error ? err.message : 'Failed to set channel scale',
      });
    }
  }

  async function handleScopeSetChannelOffset(
    clientState: ClientState,
    deviceId: string,
    channel: string,
    offset: number
  ): Promise<void> {
    try {
      await sessionManager.oscilloscopeSetChannelOffset(deviceId, channel, offset);
    } catch (err) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_SET_CHANNEL_OFFSET_FAILED',
        message: err instanceof Error ? err.message : 'Failed to set channel offset',
      });
    }
  }

  async function handleScopeSetChannelCoupling(
    clientState: ClientState,
    deviceId: string,
    channel: string,
    coupling: 'AC' | 'DC' | 'GND'
  ): Promise<void> {
    try {
      await sessionManager.oscilloscopeSetChannelCoupling(deviceId, channel, coupling);
    } catch (err) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_SET_CHANNEL_COUPLING_FAILED',
        message: err instanceof Error ? err.message : 'Failed to set channel coupling',
      });
    }
  }

  async function handleScopeSetChannelProbe(
    clientState: ClientState,
    deviceId: string,
    channel: string,
    ratio: number
  ): Promise<void> {
    try {
      await sessionManager.oscilloscopeSetChannelProbe(deviceId, channel, ratio);
    } catch (err) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_SET_CHANNEL_PROBE_FAILED',
        message: err instanceof Error ? err.message : 'Failed to set channel probe ratio',
      });
    }
  }

  async function handleScopeSetChannelBwLimit(
    clientState: ClientState,
    deviceId: string,
    channel: string,
    enabled: boolean
  ): Promise<void> {
    try {
      await sessionManager.oscilloscopeSetChannelBwLimit(deviceId, channel, enabled);
    } catch (err) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_SET_CHANNEL_BW_LIMIT_FAILED',
        message: err instanceof Error ? err.message : 'Failed to set channel bandwidth limit',
      });
    }
  }

  // Oscilloscope timebase settings handlers
  async function handleScopeSetTimebaseScale(
    clientState: ClientState,
    deviceId: string,
    scale: number
  ): Promise<void> {
    try {
      await sessionManager.oscilloscopeSetTimebaseScale(deviceId, scale);
    } catch (err) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_SET_TIMEBASE_SCALE_FAILED',
        message: err instanceof Error ? err.message : 'Failed to set timebase scale',
      });
    }
  }

  async function handleScopeSetTimebaseOffset(
    clientState: ClientState,
    deviceId: string,
    offset: number
  ): Promise<void> {
    try {
      await sessionManager.oscilloscopeSetTimebaseOffset(deviceId, offset);
    } catch (err) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_SET_TIMEBASE_OFFSET_FAILED',
        message: err instanceof Error ? err.message : 'Failed to set timebase offset',
      });
    }
  }

  // Oscilloscope trigger settings handlers
  async function handleScopeSetTriggerSource(
    clientState: ClientState,
    deviceId: string,
    source: string
  ): Promise<void> {
    try {
      await sessionManager.oscilloscopeSetTriggerSource(deviceId, source);
    } catch (err) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_SET_TRIGGER_SOURCE_FAILED',
        message: err instanceof Error ? err.message : 'Failed to set trigger source',
      });
    }
  }

  async function handleScopeSetTriggerLevel(
    clientState: ClientState,
    deviceId: string,
    level: number
  ): Promise<void> {
    try {
      await sessionManager.oscilloscopeSetTriggerLevel(deviceId, level);
    } catch (err) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_SET_TRIGGER_LEVEL_FAILED',
        message: err instanceof Error ? err.message : 'Failed to set trigger level',
      });
    }
  }

  async function handleScopeSetTriggerEdge(
    clientState: ClientState,
    deviceId: string,
    edge: 'rising' | 'falling' | 'either'
  ): Promise<void> {
    try {
      await sessionManager.oscilloscopeSetTriggerEdge(deviceId, edge);
    } catch (err) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_SET_TRIGGER_EDGE_FAILED',
        message: err instanceof Error ? err.message : 'Failed to set trigger edge',
      });
    }
  }

  async function handleScopeSetTriggerSweep(
    clientState: ClientState,
    deviceId: string,
    sweep: 'auto' | 'normal' | 'single'
  ): Promise<void> {
    try {
      await sessionManager.oscilloscopeSetTriggerSweep(deviceId, sweep);
    } catch (err) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_SET_TRIGGER_SWEEP_FAILED',
        message: err instanceof Error ? err.message : 'Failed to set trigger sweep mode',
      });
    }
  }

  // Oscilloscope streaming handlers
  async function handleScopeStartStreaming(
    clientState: ClientState,
    deviceId: string,
    channels: string[],
    intervalMs: number,
    measurements?: string[]
  ): Promise<void> {
    try {
      await sessionManager.oscilloscopeStartStreaming(deviceId, channels, intervalMs, measurements);
    } catch (err) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_START_STREAMING_FAILED',
        message: err instanceof Error ? err.message : 'Failed to start waveform streaming',
      });
    }
  }

  async function handleScopeStopStreaming(
    clientState: ClientState,
    deviceId: string
  ): Promise<void> {
    try {
      await sessionManager.oscilloscopeStopStreaming(deviceId);
    } catch (err) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_STOP_STREAMING_FAILED',
        message: err instanceof Error ? err.message : 'Failed to stop waveform streaming',
      });
    }
  }

  // Handle client disconnect
  function handleDisconnect(ws: WebSocket): void {
    const clientState = clients.get(ws);
    if (clientState) {
      // Unsubscribe from all devices
      sessionManager.unsubscribeAll(clientState.id);
      clients.delete(ws);
    }
  }

  // Set up connection handler
  wss.on('connection', (ws: WebSocket) => {
    const clientState: ClientState = {
      id: generateClientId(),
      ws,
      subscriptions: new Set(),
    };
    clients.set(ws, clientState);

    ws.on('message', (data: Buffer | string) => {
      handleMessage(clientState, data.toString());
    });

    ws.on('close', () => {
      handleDisconnect(ws);
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
      handleDisconnect(ws);
    });
  });

  function getClientCount(): number {
    return clients.size;
  }

  function broadcastDeviceList(): void {
    const devices = sessionManager.getDeviceSummaries();
    const message: ServerMessage = { type: 'deviceList', devices };
    const data = JSON.stringify(message);

    for (const clientState of clients.values()) {
      if (clientState.ws.readyState === 1) { // OPEN
        clientState.ws.send(data);
      }
    }
  }

  function close(): void {
    // Clean up all clients
    for (const [ws, clientState] of clients) {
      sessionManager.unsubscribeAll(clientState.id);
      clients.delete(ws);
    }
  }

  return {
    getClientCount,
    broadcastDeviceList,
    close,
  };
}
