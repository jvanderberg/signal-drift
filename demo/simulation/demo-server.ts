/**
 * Demo Server - Browser-based simulation server
 * Handles WebSocket-style message routing with simulated devices
 */

import type {
  ClientMessage,
  ServerMessage,
  DeviceSummary,
  DeviceSessionState,
  DeviceInfo,
  DeviceCapabilities,
  HistoryData,
  MeasurementUpdate,
  ConnectionStatus,
} from '../../shared/types';
import { createVirtualConnection, type VirtualConnection } from './virtual-connection';
import { createPsuSimulator, type PsuSimulator } from './psu-simulator';
import { createLoadSimulator, type LoadSimulator } from './load-simulator';

interface SimulatedDevice {
  id: string;
  info: DeviceInfo;
  capabilities: DeviceCapabilities;
  simulator: PsuSimulator | LoadSimulator;
  isPsu: boolean;
}

interface DeviceSession {
  device: SimulatedDevice;
  mode: string;
  outputEnabled: boolean;
  setpoints: Record<string, number>;
  measurements: Record<string, number>;
  history: HistoryData;
  lastUpdated: number;
  connectionStatus: ConnectionStatus;
  pollTimer: ReturnType<typeof setInterval> | null;
}

export interface DemoServer {
  handleMessage(message: ClientMessage): void;
  onMessage(handler: (message: ServerMessage) => void): () => void;
  start(): void;
  stop(): void;
}

const POLL_INTERVAL = 250;
const HISTORY_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

export function createDemoServer(): DemoServer {
  const messageHandlers = new Set<(message: ServerMessage) => void>();
  const subscriptions = new Set<string>();
  const sessions = new Map<string, DeviceSession>();

  let connection: VirtualConnection;
  let psuDevice: SimulatedDevice;
  let loadDevice: SimulatedDevice;

  function broadcast(message: ServerMessage): void {
    for (const handler of messageHandlers) {
      try {
        handler(message);
      } catch (err) {
        console.error('Message handler error:', err);
      }
    }
  }

  function broadcastToSubscribed(deviceId: string, message: ServerMessage): void {
    if (subscriptions.has(deviceId)) {
      broadcast(message);
    }
  }

  function initializeDevices(): void {
    connection = createVirtualConnection({
      measurementStabilityPPM: 100,
      measurementNoiseFloorMv: 1.0,
      psuOutputImpedance: 0.005,
      loadCvGain: 10,
    });

    const psuSimulator = createPsuSimulator(connection);
    const loadSimulator = createLoadSimulator(connection, 'DL3A000000001');

    psuDevice = {
      id: 'matrix-wps300s-demo',
      info: {
        id: 'matrix-wps300s-demo',
        type: 'power-supply',
        manufacturer: 'Matrix',
        model: 'WPS300S',
        serial: 'DEMO001',
      },
      capabilities: {
        deviceClass: 'psu',
        features: {},
        modes: ['CV'],
        modesSettable: false,
        outputs: [
          { name: 'voltage', unit: 'V', decimals: 3, min: 0, max: 80 },
          { name: 'current', unit: 'A', decimals: 4, min: 0, max: 10 },
        ],
        measurements: [
          { name: 'voltage', unit: 'V', decimals: 3 },
          { name: 'current', unit: 'A', decimals: 4 },
          { name: 'power', unit: 'W', decimals: 3 },
        ],
      },
      simulator: psuSimulator,
      isPsu: true,
    };

    loadDevice = {
      id: 'rigol-dl3021-demo',
      info: {
        id: 'rigol-dl3021-demo',
        type: 'electronic-load',
        manufacturer: 'Rigol',
        model: 'DL3021',
        serial: 'DL3A000000001',
      },
      capabilities: {
        deviceClass: 'load',
        features: { listMode: true },
        modes: ['CC', 'CV', 'CR', 'CP'],
        modesSettable: true,
        outputs: [
          { name: 'current', unit: 'A', decimals: 4, min: 0, max: 40, modes: ['CC'] },
          { name: 'voltage', unit: 'V', decimals: 3, min: 0, max: 150, modes: ['CV'] },
          { name: 'resistance', unit: 'Ω', decimals: 3, min: 0.05, max: 15000, modes: ['CR'] },
          { name: 'power', unit: 'W', decimals: 3, min: 0, max: 200, modes: ['CP'] },
        ],
        measurements: [
          { name: 'voltage', unit: 'V', decimals: 4 },
          { name: 'current', unit: 'A', decimals: 4 },
          { name: 'power', unit: 'W', decimals: 4 },
          { name: 'resistance', unit: 'Ω', decimals: 4 },
        ],
      },
      simulator: loadSimulator,
      isPsu: false,
    };

    // Create sessions
    sessions.set(psuDevice.id, createSession(psuDevice));
    sessions.set(loadDevice.id, createSession(loadDevice));
  }

  function createSession(device: SimulatedDevice): DeviceSession {
    return {
      device,
      mode: device.isPsu ? 'CV' : 'CC',
      outputEnabled: false,
      setpoints: device.isPsu
        ? { voltage: 0, current: 10 }
        : { current: 0, voltage: 0, resistance: 1000, power: 0 },
      measurements: { voltage: 0, current: 0, power: 0, resistance: 0 },
      history: {
        timestamps: [],
        voltage: [],
        current: [],
        power: [],
        resistance: [],
      },
      lastUpdated: Date.now(),
      connectionStatus: 'connected',
      pollTimer: null,
    };
  }

  function trimHistory(session: DeviceSession): void {
    const cutoff = Date.now() - HISTORY_WINDOW_MS;
    let trimIndex = 0;

    while (trimIndex < session.history.timestamps.length && session.history.timestamps[trimIndex] < cutoff) {
      trimIndex++;
    }

    if (trimIndex > 0) {
      session.history.timestamps = session.history.timestamps.slice(trimIndex);
      session.history.voltage = session.history.voltage.slice(trimIndex);
      session.history.current = session.history.current.slice(trimIndex);
      session.history.power = session.history.power.slice(trimIndex);
      if (session.history.resistance) {
        session.history.resistance = session.history.resistance.slice(trimIndex);
      }
    }
  }

  function pollDevice(session: DeviceSession): void {
    const device = session.device;
    const now = Date.now();

    // Get measurements from simulator
    if (device.isPsu) {
      const voltage = parseFloat((device.simulator as PsuSimulator).handleCommand('MEAS:VOLT?') || '0');
      const current = parseFloat((device.simulator as PsuSimulator).handleCommand('MEAS:CURR?') || '0');
      session.measurements = {
        voltage,
        current,
        power: voltage * current,
      };
    } else {
      const voltage = parseFloat((device.simulator as LoadSimulator).handleCommand(':MEAS:VOLT?') || '0');
      const current = parseFloat((device.simulator as LoadSimulator).handleCommand(':MEAS:CURR?') || '0');
      const power = parseFloat((device.simulator as LoadSimulator).handleCommand(':MEAS:POW?') || '0');
      const resistance = parseFloat((device.simulator as LoadSimulator).handleCommand(':MEAS:RES?') || '0');
      session.measurements = { voltage, current, power, resistance };
    }

    // Add to history
    session.history.timestamps.push(now);
    session.history.voltage.push(session.measurements.voltage);
    session.history.current.push(session.measurements.current);
    session.history.power.push(session.measurements.power);
    if (session.history.resistance && session.measurements.resistance !== undefined) {
      session.history.resistance.push(session.measurements.resistance);
    }
    trimHistory(session);

    session.lastUpdated = now;

    // Broadcast measurement update
    const update: MeasurementUpdate = {
      timestamp: now,
      measurements: { ...session.measurements },
    };
    broadcastToSubscribed(device.id, {
      type: 'measurement',
      deviceId: device.id,
      update,
    });
  }

  function startPolling(session: DeviceSession): void {
    if (session.pollTimer) return;
    session.pollTimer = setInterval(() => pollDevice(session), POLL_INTERVAL);
    // Poll immediately
    pollDevice(session);
  }

  function stopPolling(session: DeviceSession): void {
    if (session.pollTimer) {
      clearInterval(session.pollTimer);
      session.pollTimer = null;
    }
  }

  function getDeviceSummaries(): DeviceSummary[] {
    const summaries: DeviceSummary[] = [];
    for (const session of sessions.values()) {
      summaries.push({
        id: session.device.id,
        info: session.device.info,
        capabilities: session.device.capabilities,
        connectionStatus: session.connectionStatus,
      });
    }
    return summaries;
  }

  function getSessionState(session: DeviceSession): DeviceSessionState {
    return {
      info: session.device.info,
      capabilities: session.device.capabilities,
      connectionStatus: session.connectionStatus,
      consecutiveErrors: 0,
      mode: session.mode,
      outputEnabled: session.outputEnabled,
      setpoints: { ...session.setpoints },
      measurements: { ...session.measurements },
      history: session.history,
      lastUpdated: session.lastUpdated,
    };
  }

  function handleGetDevices(): void {
    broadcast({
      type: 'deviceList',
      devices: getDeviceSummaries(),
    });
  }

  function handleSubscribe(deviceId: string): void {
    const session = sessions.get(deviceId);
    if (!session) {
      broadcast({
        type: 'error',
        deviceId,
        code: 'DEVICE_NOT_FOUND',
        message: `Device not found: ${deviceId}`,
      });
      return;
    }

    subscriptions.add(deviceId);
    startPolling(session);

    broadcast({
      type: 'subscribed',
      deviceId,
      state: getSessionState(session),
    });
  }

  function handleUnsubscribe(deviceId: string): void {
    subscriptions.delete(deviceId);
    broadcast({
      type: 'unsubscribed',
      deviceId,
    });
  }

  function handleSetMode(deviceId: string, mode: string): void {
    const session = sessions.get(deviceId);
    if (!session) return;

    if (session.device.isPsu) {
      // PSU mode not settable
      return;
    }

    // Set mode on load
    (session.device.simulator as LoadSimulator).handleCommand(`:SOUR:FUNC ${mode}`);
    session.mode = mode;

    broadcastToSubscribed(deviceId, {
      type: 'field',
      deviceId,
      field: 'mode',
      value: mode,
    });
  }

  function handleSetOutput(deviceId: string, enabled: boolean): void {
    const session = sessions.get(deviceId);
    if (!session) return;

    if (session.device.isPsu) {
      (session.device.simulator as PsuSimulator).handleCommand(`OUTP ${enabled ? 'ON' : 'OFF'}`);
    } else {
      (session.device.simulator as LoadSimulator).handleCommand(`:SOUR:INP:STAT ${enabled ? 'ON' : 'OFF'}`);
    }
    session.outputEnabled = enabled;

    broadcastToSubscribed(deviceId, {
      type: 'field',
      deviceId,
      field: 'outputEnabled',
      value: enabled,
    });
  }

  function handleSetValue(deviceId: string, name: string, value: number): void {
    const session = sessions.get(deviceId);
    if (!session) return;

    if (session.device.isPsu) {
      if (name === 'voltage') {
        (session.device.simulator as PsuSimulator).handleCommand(`VOLT ${value}`);
      } else if (name === 'current') {
        (session.device.simulator as PsuSimulator).handleCommand(`CURR ${value}`);
      }
    } else {
      const loadSim = session.device.simulator as LoadSimulator;
      if (name === 'current') {
        loadSim.handleCommand(`:SOUR:CURR:LEV ${value}`);
      } else if (name === 'voltage') {
        loadSim.handleCommand(`:SOUR:VOLT:LEV ${value}`);
      } else if (name === 'resistance') {
        loadSim.handleCommand(`:SOUR:RES:LEV ${value}`);
      } else if (name === 'power') {
        loadSim.handleCommand(`:SOUR:POW:LEV ${value}`);
      }
    }

    session.setpoints[name] = value;

    broadcastToSubscribed(deviceId, {
      type: 'field',
      deviceId,
      field: 'setpoints',
      value: { ...session.setpoints },
    });
  }

  function handleMessage(message: ClientMessage): void {
    switch (message.type) {
      case 'getDevices':
        handleGetDevices();
        break;

      case 'scan':
        handleGetDevices();
        break;

      case 'subscribe':
        handleSubscribe(message.deviceId);
        break;

      case 'unsubscribe':
        handleUnsubscribe(message.deviceId);
        break;

      case 'setMode':
        handleSetMode(message.deviceId, message.mode);
        break;

      case 'setOutput':
        handleSetOutput(message.deviceId, message.enabled);
        break;

      case 'setValue':
        handleSetValue(message.deviceId, message.name, message.value);
        break;

      // Sequence/trigger messages - respond with empty lists for demo
      case 'sequenceLibraryList':
        broadcast({ type: 'sequenceLibrary', sequences: [] });
        break;

      case 'triggerScriptLibraryList':
        broadcast({ type: 'triggerScriptLibrary', scripts: [] });
        break;

      case 'deviceAliasList':
        broadcast({ type: 'deviceAliases', aliases: [] });
        break;

      default:
        // Ignore unsupported messages in demo mode
        console.log('[Demo] Unsupported message type:', (message as { type: string }).type);
    }
  }

  function onMessage(handler: (message: ServerMessage) => void): () => void {
    messageHandlers.add(handler);
    return () => messageHandlers.delete(handler);
  }

  function start(): void {
    initializeDevices();
    // Start polling all devices
    for (const session of sessions.values()) {
      startPolling(session);
    }
  }

  function stop(): void {
    for (const session of sessions.values()) {
      stopPolling(session);
    }
    sessions.clear();
    subscriptions.clear();
  }

  return {
    handleMessage,
    onMessage,
    start,
    stop,
  };
}
