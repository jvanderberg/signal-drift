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
import type { SequenceManager } from '../sequences/SequenceManager.js';
import type { TriggerScriptManager } from '../triggers/TriggerScriptManager.js';
import type { DeviceAliasStore } from '../db/DeviceAliasStore.js';
import type { SettingsManager } from '../db/SettingsManager.js';
import type { ClientMessage, ServerMessage, DeviceSessionState, SettingsExportData } from '../../shared/types.js';

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
  sessionManager: SessionManager,
  sequenceManager?: SequenceManager,
  triggerScriptManager?: TriggerScriptManager,
  deviceAliasStore?: DeviceAliasStore,
  settingsManager?: SettingsManager
): WebSocketHandler {
  const clients = new Map<WebSocket, ClientState>();

  // Subscribe to sequence manager events and broadcast to all clients
  if (sequenceManager) {
    sequenceManager.subscribe((message) => {
      broadcastToAll(message);
    });
  }

  // Subscribe to trigger script manager events and broadcast to all clients
  if (triggerScriptManager) {
    triggerScriptManager.subscribe((message) => {
      broadcastToAll(message);
    });
  }

  function broadcastToAll(message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const clientState of clients.values()) {
      if (clientState.ws.readyState === 1) { // OPEN
        clientState.ws.send(data);
      }
    }
  }

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

      // Sequence messages - library
      case 'sequenceLibraryList':
        handleSequenceLibraryList(clientState);
        break;

      case 'sequenceLibrarySave':
        handleSequenceLibrarySave(clientState, message.definition);
        break;

      case 'sequenceLibraryUpdate':
        handleSequenceLibraryUpdate(clientState, message.definition);
        break;

      case 'sequenceLibraryDelete':
        handleSequenceLibraryDelete(clientState, message.sequenceId);
        break;

      // Sequence messages - playback
      case 'sequenceRun':
        handleSequenceRun(clientState, message.config);
        break;

      case 'sequenceAbort':
        handleSequenceAbort(clientState);
        break;

      // Trigger script messages - library
      case 'triggerScriptLibraryList':
        handleTriggerScriptLibraryList(clientState);
        break;

      case 'triggerScriptLibrarySave':
        handleTriggerScriptLibrarySave(clientState, message.script);
        break;

      case 'triggerScriptLibraryUpdate':
        handleTriggerScriptLibraryUpdate(clientState, message.script);
        break;

      case 'triggerScriptLibraryDelete':
        handleTriggerScriptLibraryDelete(clientState, message.scriptId);
        break;

      // Trigger script messages - execution
      case 'triggerScriptRun':
        handleTriggerScriptRun(clientState, message.scriptId);
        break;

      case 'triggerScriptStop':
        handleTriggerScriptStop(clientState);
        break;

      case 'triggerScriptPause':
        handleTriggerScriptPause(clientState);
        break;

      case 'triggerScriptResume':
        handleTriggerScriptResume(clientState);
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

      // Device alias messages
      case 'deviceAliasList':
        handleDeviceAliasList(clientState);
        break;

      case 'deviceAliasSet':
        handleDeviceAliasSet(clientState, message.idn, message.alias);
        break;

      case 'deviceAliasClear':
        handleDeviceAliasClear(clientState, message.idn);
        break;

      // Settings export/import messages
      case 'settingsExport':
        handleSettingsExport(clientState);
        break;

      case 'settingsImport':
        handleSettingsImport(clientState, message.data);
        break;

      default: {
        // Extract type from unknown message for error reporting
        const unknownMessage = message as { type?: string };
        send(clientState.ws, {
          type: 'error',
          code: 'UNKNOWN_MESSAGE_TYPE',
          message: `Unknown message type: ${unknownMessage.type ?? 'unknown'}`,
        });
      }
    }
  }

  // Helper to enrich device summaries with aliases
  function enrichWithAliases(devices: ReturnType<SessionManager['getDeviceSummaries']>) {
    if (!deviceAliasStore) return devices;

    const aliasResult = deviceAliasStore.getAll();
    if (!aliasResult.ok) return devices;

    const aliasMap = aliasResult.value;

    return devices.map(device => {
      // Build IDN from device info (format: manufacturer,model,serial,version)
      const serial = device.info.serial || '';
      const idn = `${device.info.manufacturer},${device.info.model},${serial}`;

      // Try to find alias by partial match (IDN may have version suffix)
      let alias: string | undefined;
      for (const [storedIdn, storedAlias] of aliasMap) {
        if (storedIdn.startsWith(idn) || idn.startsWith(storedIdn)) {
          alias = storedAlias;
          break;
        }
      }

      // Also try exact match on full IDN string from info
      if (!alias) {
        // The device registry might store full IDN differently
        alias = aliasMap.get(idn);
      }

      return alias ? { ...device, alias } : device;
    });
  }

  function handleGetDevices(clientState: ClientState): void {
    const devices = enrichWithAliases(sessionManager.getDeviceSummaries());
    send(clientState.ws, { type: 'deviceList', devices });
  }

  function handleScan(clientState: ClientState): void {
    sessionManager.syncDevices();
    const devices = enrichWithAliases(sessionManager.getDeviceSummaries());
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
        // OscilloscopeSessionState differs from DeviceSessionState
        // Client hook (useOscilloscopeSocket) expects the oscilloscope shape
        send(clientState.ws, {
          type: 'subscribed',
          deviceId,
          state: scopeSession.getState() as unknown as DeviceSessionState,
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
    const result = await sessionManager.setMode(deviceId, mode);
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SET_MODE_FAILED',
        message: result.error.message,
      });
    }
  }

  async function handleSetOutput(clientState: ClientState, deviceId: string, enabled: boolean): Promise<void> {
    const result = await sessionManager.setOutput(deviceId, enabled);
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SET_OUTPUT_FAILED',
        message: result.error.message,
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
    const result = await sessionManager.setValue(deviceId, name, value, immediate);
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SET_VALUE_FAILED',
        message: result.error.message,
      });
    }
  }

  // Sequence handlers
  function handleSequenceLibraryList(clientState: ClientState): void {
    if (!sequenceManager) {
      send(clientState.ws, {
        type: 'error',
        code: 'SEQUENCE_NOT_AVAILABLE',
        message: 'Sequence manager not available',
      });
      return;
    }
    const sequences = sequenceManager.listLibrary();
    send(clientState.ws, {
      type: 'sequenceLibrary',
      sequences,
    });
  }

  function handleSequenceLibrarySave(
    clientState: ClientState,
    definition: Parameters<NonNullable<typeof sequenceManager>['saveToLibrary']>[0]
  ): void {
    if (!sequenceManager) {
      send(clientState.ws, {
        type: 'error',
        code: 'SEQUENCE_NOT_AVAILABLE',
        message: 'Sequence manager not available',
      });
      return;
    }
    const result = sequenceManager.saveToLibrary(definition);
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        code: 'SEQUENCE_SAVE_FAILED',
        message: result.error.message,
      });
      return;
    }
    send(clientState.ws, {
      type: 'sequenceLibrarySaved',
      sequenceId: result.value,
    });
  }

  function handleSequenceLibraryUpdate(
    clientState: ClientState,
    definition: Parameters<NonNullable<typeof sequenceManager>['updateInLibrary']>[0]
  ): void {
    if (!sequenceManager) {
      send(clientState.ws, {
        type: 'error',
        code: 'SEQUENCE_NOT_AVAILABLE',
        message: 'Sequence manager not available',
      });
      return;
    }
    const result = sequenceManager.updateInLibrary(definition);
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        code: 'SEQUENCE_UPDATE_FAILED',
        message: result.error.message,
      });
      return;
    }
    send(clientState.ws, {
      type: 'sequenceLibrarySaved',
      sequenceId: definition.id,
    });
  }

  function handleSequenceLibraryDelete(clientState: ClientState, sequenceId: string): void {
    if (!sequenceManager) {
      send(clientState.ws, {
        type: 'error',
        code: 'SEQUENCE_NOT_AVAILABLE',
        message: 'Sequence manager not available',
      });
      return;
    }
    const result = sequenceManager.deleteFromLibrary(sequenceId);
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        code: 'SEQUENCE_DELETE_FAILED',
        message: result.error.message,
      });
      return;
    }
    send(clientState.ws, {
      type: 'sequenceLibraryDeleted',
      sequenceId,
    });
  }

  async function handleSequenceRun(
    clientState: ClientState,
    config: Parameters<NonNullable<typeof sequenceManager>['run']>[0]
  ): Promise<void> {
    if (!sequenceManager) {
      send(clientState.ws, {
        type: 'error',
        code: 'SEQUENCE_NOT_AVAILABLE',
        message: 'Sequence manager not available',
      });
      return;
    }
    const result = await sequenceManager.run(config);
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        code: 'SEQUENCE_RUN_FAILED',
        message: result.error.message,
      });
    }
    // Note: success broadcast is handled by SequenceManager's subscriber
  }

  async function handleSequenceAbort(clientState: ClientState): Promise<void> {
    if (!sequenceManager) {
      send(clientState.ws, {
        type: 'error',
        code: 'SEQUENCE_NOT_AVAILABLE',
        message: 'Sequence manager not available',
      });
      return;
    }
    await sequenceManager.abort();
    // Note: abort broadcast is handled by SequenceManager's subscriber
  }

  // Trigger script handlers
  function handleTriggerScriptLibraryList(clientState: ClientState): void {
    if (!triggerScriptManager) {
      send(clientState.ws, {
        type: 'error',
        code: 'TRIGGER_SCRIPT_NOT_AVAILABLE',
        message: 'Trigger script manager not available',
      });
      return;
    }
    const scripts = triggerScriptManager.listLibrary();
    send(clientState.ws, {
      type: 'triggerScriptLibrary',
      scripts,
    });
  }

  function handleTriggerScriptLibrarySave(
    clientState: ClientState,
    script: Parameters<NonNullable<typeof triggerScriptManager>['saveToLibrary']>[0]
  ): void {
    if (!triggerScriptManager) {
      send(clientState.ws, {
        type: 'error',
        code: 'TRIGGER_SCRIPT_NOT_AVAILABLE',
        message: 'Trigger script manager not available',
      });
      return;
    }
    const result = triggerScriptManager.saveToLibrary(script);
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        code: 'TRIGGER_SCRIPT_SAVE_FAILED',
        message: result.error.message,
      });
      return;
    }
    send(clientState.ws, {
      type: 'triggerScriptLibrarySaved',
      scriptId: result.value,
    });
  }

  function handleTriggerScriptLibraryUpdate(
    clientState: ClientState,
    script: Parameters<NonNullable<typeof triggerScriptManager>['updateInLibrary']>[0]
  ): void {
    if (!triggerScriptManager) {
      send(clientState.ws, {
        type: 'error',
        code: 'TRIGGER_SCRIPT_NOT_AVAILABLE',
        message: 'Trigger script manager not available',
      });
      return;
    }
    const result = triggerScriptManager.updateInLibrary(script);
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        code: 'TRIGGER_SCRIPT_UPDATE_FAILED',
        message: result.error.message,
      });
      return;
    }
    send(clientState.ws, {
      type: 'triggerScriptLibrarySaved',
      scriptId: script.id,
    });
  }

  function handleTriggerScriptLibraryDelete(clientState: ClientState, scriptId: string): void {
    if (!triggerScriptManager) {
      send(clientState.ws, {
        type: 'error',
        code: 'TRIGGER_SCRIPT_NOT_AVAILABLE',
        message: 'Trigger script manager not available',
      });
      return;
    }
    const result = triggerScriptManager.deleteFromLibrary(scriptId);
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        code: 'TRIGGER_SCRIPT_DELETE_FAILED',
        message: result.error.message,
      });
      return;
    }
    send(clientState.ws, {
      type: 'triggerScriptLibraryDeleted',
      scriptId,
    });
  }

  async function handleTriggerScriptRun(clientState: ClientState, scriptId: string): Promise<void> {
    if (!triggerScriptManager) {
      send(clientState.ws, {
        type: 'error',
        code: 'TRIGGER_SCRIPT_NOT_AVAILABLE',
        message: 'Trigger script manager not available',
      });
      return;
    }
    const result = await triggerScriptManager.run(scriptId);
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        code: 'TRIGGER_SCRIPT_RUN_FAILED',
        message: result.error.message,
      });
    }
    // Note: success broadcast is handled by TriggerScriptManager's subscriber
  }

  async function handleTriggerScriptStop(clientState: ClientState): Promise<void> {
    if (!triggerScriptManager) {
      send(clientState.ws, {
        type: 'error',
        code: 'TRIGGER_SCRIPT_NOT_AVAILABLE',
        message: 'Trigger script manager not available',
      });
      return;
    }
    await triggerScriptManager.stop();
    // Note: stop broadcast is handled by TriggerScriptManager's subscriber
  }

  function handleTriggerScriptPause(clientState: ClientState): void {
    if (!triggerScriptManager) {
      send(clientState.ws, {
        type: 'error',
        code: 'TRIGGER_SCRIPT_NOT_AVAILABLE',
        message: 'Trigger script manager not available',
      });
      return;
    }
    const result = triggerScriptManager.pause();
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        code: 'TRIGGER_SCRIPT_PAUSE_FAILED',
        message: result.error.message,
      });
    }
    // Note: pause broadcast is handled by TriggerScriptManager's subscriber
  }

  function handleTriggerScriptResume(clientState: ClientState): void {
    if (!triggerScriptManager) {
      send(clientState.ws, {
        type: 'error',
        code: 'TRIGGER_SCRIPT_NOT_AVAILABLE',
        message: 'Trigger script manager not available',
      });
      return;
    }
    const result = triggerScriptManager.resume();
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        code: 'TRIGGER_SCRIPT_RESUME_FAILED',
        message: result.error.message,
      });
    }
    // Note: resume broadcast is handled by TriggerScriptManager's subscriber
  }

  // Oscilloscope handlers
  async function handleScopeRun(clientState: ClientState, deviceId: string): Promise<void> {
    const result = await sessionManager.oscilloscopeRun(deviceId);
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_RUN_FAILED',
        message: result.error.message,
      });
    }
  }

  async function handleScopeStop(clientState: ClientState, deviceId: string): Promise<void> {
    const result = await sessionManager.oscilloscopeStop(deviceId);
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_STOP_FAILED',
        message: result.error.message,
      });
    }
  }

  async function handleScopeSingle(clientState: ClientState, deviceId: string): Promise<void> {
    const result = await sessionManager.oscilloscopeSingle(deviceId);
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_SINGLE_FAILED',
        message: result.error.message,
      });
    }
  }

  async function handleScopeAutoSetup(clientState: ClientState, deviceId: string): Promise<void> {
    const result = await sessionManager.oscilloscopeAutoSetup(deviceId);
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_AUTO_SETUP_FAILED',
        message: result.error.message,
      });
    }
  }

  async function handleScopeGetWaveform(clientState: ClientState, deviceId: string, channel: string): Promise<void> {
    const result = await sessionManager.oscilloscopeGetWaveform(deviceId, channel);
    if (result.ok) {
      send(clientState.ws, {
        type: 'scopeWaveform',
        deviceId,
        channel,
        waveform: result.value,
      });
    } else {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_WAVEFORM_FAILED',
        message: result.error.message,
      });
    }
  }

  async function handleScopeGetMeasurement(
    clientState: ClientState,
    deviceId: string,
    channel: string,
    measurementType: string
  ): Promise<void> {
    const result = await sessionManager.oscilloscopeGetMeasurement(deviceId, channel, measurementType);
    if (result.ok) {
      send(clientState.ws, {
        type: 'scopeMeasurement',
        deviceId,
        channel,
        measurementType,
        value: result.value,
      });
    } else {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_MEASUREMENT_FAILED',
        message: result.error.message,
      });
    }
  }

  async function handleScopeGetScreenshot(clientState: ClientState, deviceId: string): Promise<void> {
    const result = await sessionManager.oscilloscopeGetScreenshot(deviceId);
    if (result.ok) {
      const base64 = result.value.toString('base64');
      send(clientState.ws, {
        type: 'scopeScreenshot',
        deviceId,
        data: base64,
      });
    } else {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_SCREENSHOT_FAILED',
        message: result.error.message,
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
    const result = await sessionManager.oscilloscopeSetChannelEnabled(deviceId, channel, enabled);
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_SET_CHANNEL_ENABLED_FAILED',
        message: result.error.message,
      });
    }
  }

  async function handleScopeSetChannelScale(
    clientState: ClientState,
    deviceId: string,
    channel: string,
    scale: number
  ): Promise<void> {
    const result = await sessionManager.oscilloscopeSetChannelScale(deviceId, channel, scale);
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_SET_CHANNEL_SCALE_FAILED',
        message: result.error.message,
      });
    }
  }

  async function handleScopeSetChannelOffset(
    clientState: ClientState,
    deviceId: string,
    channel: string,
    offset: number
  ): Promise<void> {
    const result = await sessionManager.oscilloscopeSetChannelOffset(deviceId, channel, offset);
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_SET_CHANNEL_OFFSET_FAILED',
        message: result.error.message,
      });
    }
  }

  async function handleScopeSetChannelCoupling(
    clientState: ClientState,
    deviceId: string,
    channel: string,
    coupling: 'AC' | 'DC' | 'GND'
  ): Promise<void> {
    const result = await sessionManager.oscilloscopeSetChannelCoupling(deviceId, channel, coupling);
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_SET_CHANNEL_COUPLING_FAILED',
        message: result.error.message,
      });
    }
  }

  async function handleScopeSetChannelProbe(
    clientState: ClientState,
    deviceId: string,
    channel: string,
    ratio: number
  ): Promise<void> {
    const result = await sessionManager.oscilloscopeSetChannelProbe(deviceId, channel, ratio);
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_SET_CHANNEL_PROBE_FAILED',
        message: result.error.message,
      });
    }
  }

  async function handleScopeSetChannelBwLimit(
    clientState: ClientState,
    deviceId: string,
    channel: string,
    enabled: boolean
  ): Promise<void> {
    const result = await sessionManager.oscilloscopeSetChannelBwLimit(deviceId, channel, enabled);
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_SET_CHANNEL_BW_LIMIT_FAILED',
        message: result.error.message,
      });
    }
  }

  // Oscilloscope timebase settings handlers
  async function handleScopeSetTimebaseScale(
    clientState: ClientState,
    deviceId: string,
    scale: number
  ): Promise<void> {
    const result = await sessionManager.oscilloscopeSetTimebaseScale(deviceId, scale);
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_SET_TIMEBASE_SCALE_FAILED',
        message: result.error.message,
      });
    }
  }

  async function handleScopeSetTimebaseOffset(
    clientState: ClientState,
    deviceId: string,
    offset: number
  ): Promise<void> {
    const result = await sessionManager.oscilloscopeSetTimebaseOffset(deviceId, offset);
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_SET_TIMEBASE_OFFSET_FAILED',
        message: result.error.message,
      });
    }
  }

  // Oscilloscope trigger settings handlers
  async function handleScopeSetTriggerSource(
    clientState: ClientState,
    deviceId: string,
    source: string
  ): Promise<void> {
    const result = await sessionManager.oscilloscopeSetTriggerSource(deviceId, source);
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_SET_TRIGGER_SOURCE_FAILED',
        message: result.error.message,
      });
    }
  }

  async function handleScopeSetTriggerLevel(
    clientState: ClientState,
    deviceId: string,
    level: number
  ): Promise<void> {
    const result = await sessionManager.oscilloscopeSetTriggerLevel(deviceId, level);
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_SET_TRIGGER_LEVEL_FAILED',
        message: result.error.message,
      });
    }
  }

  async function handleScopeSetTriggerEdge(
    clientState: ClientState,
    deviceId: string,
    edge: 'rising' | 'falling' | 'either'
  ): Promise<void> {
    const result = await sessionManager.oscilloscopeSetTriggerEdge(deviceId, edge);
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_SET_TRIGGER_EDGE_FAILED',
        message: result.error.message,
      });
    }
  }

  async function handleScopeSetTriggerSweep(
    clientState: ClientState,
    deviceId: string,
    sweep: 'auto' | 'normal' | 'single'
  ): Promise<void> {
    const result = await sessionManager.oscilloscopeSetTriggerSweep(deviceId, sweep);
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_SET_TRIGGER_SWEEP_FAILED',
        message: result.error.message,
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
    const result = await sessionManager.oscilloscopeStartStreaming(deviceId, channels, intervalMs, measurements);
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_START_STREAMING_FAILED',
        message: result.error.message,
      });
    }
  }

  async function handleScopeStopStreaming(
    clientState: ClientState,
    deviceId: string
  ): Promise<void> {
    const result = await sessionManager.oscilloscopeStopStreaming(deviceId);
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        deviceId,
        code: 'SCOPE_STOP_STREAMING_FAILED',
        message: result.error.message,
      });
    }
  }

  // Device alias handlers
  function handleDeviceAliasList(clientState: ClientState): void {
    if (!deviceAliasStore) {
      send(clientState.ws, {
        type: 'error',
        code: 'DEVICE_ALIAS_NOT_AVAILABLE',
        message: 'Device alias store not available',
      });
      return;
    }
    const result = deviceAliasStore.list();
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        code: 'DEVICE_ALIAS_LIST_FAILED',
        message: result.error.message,
      });
      return;
    }
    send(clientState.ws, {
      type: 'deviceAliases',
      aliases: result.value,
    });
  }

  function handleDeviceAliasSet(clientState: ClientState, idn: string, alias: string): void {
    if (!deviceAliasStore) {
      send(clientState.ws, {
        type: 'error',
        code: 'DEVICE_ALIAS_NOT_AVAILABLE',
        message: 'Device alias store not available',
      });
      return;
    }
    const result = deviceAliasStore.set(idn, alias);
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        code: 'DEVICE_ALIAS_SET_FAILED',
        message: result.error.message,
      });
      return;
    }
    // Broadcast the change to all clients
    broadcastToAll({
      type: 'deviceAliasChanged',
      idn,
      alias,
    });
    // Also update device list since aliases may have changed
    broadcastDeviceList();
  }

  function handleDeviceAliasClear(clientState: ClientState, idn: string): void {
    if (!deviceAliasStore) {
      send(clientState.ws, {
        type: 'error',
        code: 'DEVICE_ALIAS_NOT_AVAILABLE',
        message: 'Device alias store not available',
      });
      return;
    }
    const result = deviceAliasStore.clear(idn);
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        code: 'DEVICE_ALIAS_CLEAR_FAILED',
        message: result.error.message,
      });
      return;
    }
    // Broadcast the change to all clients
    broadcastToAll({
      type: 'deviceAliasChanged',
      idn,
      alias: null,
    });
    // Also update device list since aliases may have changed
    broadcastDeviceList();
  }

  // Settings export/import handlers
  async function handleSettingsExport(clientState: ClientState): Promise<void> {
    if (!settingsManager) {
      send(clientState.ws, {
        type: 'error',
        code: 'SETTINGS_NOT_AVAILABLE',
        message: 'Settings manager not available',
      });
      return;
    }
    const result = await settingsManager.exportSettings();
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        code: 'SETTINGS_EXPORT_FAILED',
        message: result.error.message,
      });
      return;
    }
    send(clientState.ws, {
      type: 'settingsExported',
      data: result.value,
    });
  }

  async function handleSettingsImport(clientState: ClientState, data: SettingsExportData): Promise<void> {
    if (!settingsManager) {
      send(clientState.ws, {
        type: 'error',
        code: 'SETTINGS_NOT_AVAILABLE',
        message: 'Settings manager not available',
      });
      return;
    }
    const result = await settingsManager.importSettings(data);
    if (!result.ok) {
      send(clientState.ws, {
        type: 'error',
        code: 'SETTINGS_IMPORT_FAILED',
        message: result.error.message,
      });
      return;
    }
    send(clientState.ws, {
      type: 'settingsImported',
      result: result.value,
    });
    // Broadcast updated library lists to all clients
    if (sequenceManager) {
      broadcastToAll({
        type: 'sequenceLibrary',
        sequences: sequenceManager.listLibrary(),
      });
    }
    if (triggerScriptManager) {
      broadcastToAll({
        type: 'triggerScriptLibrary',
        scripts: triggerScriptManager.listLibrary(),
      });
    }
    if (deviceAliasStore) {
      const aliasResult = deviceAliasStore.list();
      if (aliasResult.ok) {
        broadcastToAll({
          type: 'deviceAliases',
          aliases: aliasResult.value,
        });
      }
    }
    // Also update device list since aliases may have changed
    broadcastDeviceList();
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
    const devices = enrichWithAliases(sessionManager.getDeviceSummaries());
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
