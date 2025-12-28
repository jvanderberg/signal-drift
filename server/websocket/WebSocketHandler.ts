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

    if (!session) {
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
      send(clientState.ws, {
        type: 'subscribed',
        deviceId,
        state: session.getState(),
      });
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
