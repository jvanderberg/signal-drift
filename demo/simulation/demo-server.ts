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
  SequenceDefinition,
  SequenceRunConfig,
  SequenceState,
  SequenceStep,
  WaveformParams,
  RandomWalkParams,
  ArbitraryWaveform,
  TriggerScript,
  TriggerScriptState,
  TriggerState,
  DeviceAlias,
  DashboardLayoutData,
  WaveformData,
} from '../../shared/types';
import {
  createVirtualConnection,
  createPsuSimulator,
  createLoadSimulator,
  createOscilloscopeSimulator,
  type VirtualConnection,
  type PsuSimulator,
  type LoadSimulator,
  type OscilloscopeSimulator,
} from '../../shared/simulation';

interface SimulatedDevice {
  id: string;
  info: DeviceInfo;
  capabilities: DeviceCapabilities;
  simulator: PsuSimulator | LoadSimulator | OscilloscopeSimulator;
  isPsu: boolean;
  isOscilloscope?: boolean;
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

// Helper to generate unique IDs
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Helper to generate waveform steps
function generateSteps(waveform: WaveformParams | RandomWalkParams | ArbitraryWaveform): SequenceStep[] {
  if ('steps' in waveform) {
    // Arbitrary waveform
    return waveform.steps;
  }

  if (waveform.type === 'random') {
    // Random walk - generate steps with random values
    const params = waveform as RandomWalkParams;
    const steps: SequenceStep[] = [];
    let value = params.startValue;
    for (let i = 0; i < params.pointsPerCycle; i++) {
      const step = (Math.random() - 0.5) * 2 * params.maxStepSize;
      value = Math.max(params.min, Math.min(params.max, value + step));
      steps.push({ value, duration: params.intervalMs });
    }
    return steps;
  }

  // Standard waveform
  const params = waveform as WaveformParams;
  const steps: SequenceStep[] = [];
  const amplitude = (params.max - params.min) / 2;
  const center = (params.max + params.min) / 2;

  for (let i = 0; i < params.pointsPerCycle; i++) {
    const phase = (i / params.pointsPerCycle) * 2 * Math.PI;
    let value: number;

    switch (params.type) {
      case 'sine':
        value = center + amplitude * Math.sin(phase);
        break;
      case 'triangle':
        // Triangle wave: 0 -> max -> min -> 0
        if (phase < Math.PI) {
          value = params.min + (params.max - params.min) * (phase / Math.PI);
        } else {
          value = params.max - (params.max - params.min) * ((phase - Math.PI) / Math.PI);
        }
        break;
      case 'ramp':
        // Ramp: min to max linearly
        value = params.min + (params.max - params.min) * (i / params.pointsPerCycle);
        break;
      case 'square':
        // Square wave: 50% duty cycle
        value = phase < Math.PI ? params.max : params.min;
        break;
      default:
        value = center;
    }

    steps.push({ value, duration: params.intervalMs });
  }

  return steps;
}

export function createDemoServer(): DemoServer {
  const messageHandlers = new Set<(message: ServerMessage) => void>();
  const subscriptions = new Set<string>();
  const sessions = new Map<string, DeviceSession>();

  // In-memory storage for sequences, trigger scripts, device aliases, and dashboard layout
  const sequenceLibrary = new Map<string, SequenceDefinition>();
  const triggerScriptLibrary = new Map<string, TriggerScript>();
  const deviceAliases = new Map<string, DeviceAlias>();
  let dashboardLayout: DashboardLayoutData | null = null;

  // Running sequence state
  let runningSequence: {
    state: SequenceState;
    steps: SequenceStep[];
    timer: ReturnType<typeof setTimeout> | null;
  } | null = null;

  // Running trigger script state
  let runningTriggerScript: {
    state: TriggerScriptState;
    script: TriggerScript;
    timer: ReturnType<typeof setInterval> | null;
    triggerStates: Map<string, TriggerState>;
  } | null = null;

  // Oscilloscope streaming state
  let scopeStreaming: {
    deviceId: string;
    channels: string[];
    intervalMs: number;
    timer: ReturnType<typeof setInterval> | null;
  } | null = null;

  let connection: VirtualConnection;
  let psuDevice: SimulatedDevice;
  let loadDevice: SimulatedDevice;
  let scopeDevice: SimulatedDevice;

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

    const scopeSimulator = createOscilloscopeSimulator(connection, 'DS1ZA000000001');
    scopeDevice = {
      id: 'rigol-ds1054z-demo',
      info: {
        id: 'rigol-ds1054z-demo',
        type: 'oscilloscope',
        manufacturer: 'Rigol',
        model: 'DS1054Z',
        serial: 'DS1ZA000000001',
      },
      // Oscilloscope capabilities - simplified for demo
      capabilities: {
        deviceClass: 'oscilloscope',
        channels: 4,
        maxSampleRate: 1e9,
        maxBandwidth: 50e6,
        memoryDepth: 12000,
      } as unknown as DeviceCapabilities,
      simulator: scopeSimulator,
      isPsu: false,
      isOscilloscope: true,
    };

    // Create sessions
    sessions.set(psuDevice.id, createSession(psuDevice));
    sessions.set(loadDevice.id, createSession(loadDevice));
    sessions.set(scopeDevice.id, createSession(scopeDevice));
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

  // ============ Oscilloscope Handlers ============

  function handleScopeStartStreaming(deviceId: string, channels: string[], intervalMs: number): void {
    // Stop any existing streaming
    handleScopeStopStreaming();

    const session = sessions.get(deviceId);
    if (!session || !session.device.isOscilloscope) {
      console.log('[Demo] Scope not found:', deviceId);
      return;
    }

    const simulator = session.device.simulator as OscilloscopeSimulator;

    scopeStreaming = {
      deviceId,
      channels,
      intervalMs,
      timer: setInterval(() => {
        // Generate and broadcast waveform for each enabled channel
        const channelConfig = simulator.getChannelConfig();
        const timebaseScale = simulator.getTimebaseScale();

        for (const channel of channels) {
          const config = channelConfig[channel];
          if (!config?.enabled) continue;

          const numPoints = 1200; // Standard waveform length
          const points = simulator.generateWaveformData(channel, numPoints);

          const waveform: WaveformData = {
            points,
            xIncrement: (timebaseScale * 12) / numPoints, // 12 divisions
            xOrigin: 0,
            yIncrement: config.scale / 32, // Approximate ADC scaling
            yOrigin: config.offset,
            yReference: 128,
          };

          broadcast({
            type: 'scopeWaveform',
            deviceId,
            channel,
            waveform,
            timestamp: Date.now(),
          });
        }
      }, intervalMs),
    };

    console.log('[Demo] Started scope streaming for channels:', channels);
  }

  function handleScopeStopStreaming(): void {
    if (scopeStreaming?.timer) {
      clearInterval(scopeStreaming.timer);
      console.log('[Demo] Stopped scope streaming');
    }
    scopeStreaming = null;
  }

  function handleScopeSetChannelEnabled(deviceId: string, channel: string, enabled: boolean): void {
    const session = sessions.get(deviceId);
    if (!session || !session.device.isOscilloscope) return;

    const simulator = session.device.simulator as OscilloscopeSimulator;
    simulator.handleCommand(`:${channel}:DISP ${enabled ? 'ON' : 'OFF'}`);

    // Update streaming channels if active
    if (scopeStreaming && scopeStreaming.deviceId === deviceId) {
      if (enabled && !scopeStreaming.channels.includes(channel)) {
        scopeStreaming.channels.push(channel);
      } else if (!enabled) {
        scopeStreaming.channels = scopeStreaming.channels.filter(ch => ch !== channel);
      }
    }
  }

  function handleScopeSetChannelScale(deviceId: string, channel: string, scale: number): void {
    const session = sessions.get(deviceId);
    if (!session || !session.device.isOscilloscope) return;

    const simulator = session.device.simulator as OscilloscopeSimulator;
    simulator.handleCommand(`:${channel}:SCAL ${scale}`);
  }

  function handleScopeSetChannelOffset(deviceId: string, channel: string, offset: number): void {
    const session = sessions.get(deviceId);
    if (!session || !session.device.isOscilloscope) return;

    const simulator = session.device.simulator as OscilloscopeSimulator;
    simulator.handleCommand(`:${channel}:OFFS ${offset}`);
  }

  function handleScopeSetTimebaseScale(deviceId: string, scale: number): void {
    const session = sessions.get(deviceId);
    if (!session || !session.device.isOscilloscope) return;

    const simulator = session.device.simulator as OscilloscopeSimulator;
    simulator.handleCommand(`:TIM:SCAL ${scale}`);
  }

  function handleScopeRun(deviceId: string): void {
    const session = sessions.get(deviceId);
    if (!session || !session.device.isOscilloscope) return;

    const simulator = session.device.simulator as OscilloscopeSimulator;
    simulator.handleCommand(':RUN');
  }

  function handleScopeStop(deviceId: string): void {
    const session = sessions.get(deviceId);
    if (!session || !session.device.isOscilloscope) return;

    const simulator = session.device.simulator as OscilloscopeSimulator;
    simulator.handleCommand(':STOP');
  }

  function handleScopeAutoSetup(deviceId: string): void {
    const session = sessions.get(deviceId);
    if (!session || !session.device.isOscilloscope) return;

    const simulator = session.device.simulator as OscilloscopeSimulator;
    simulator.handleCommand(':AUT');
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

      // Sequence library operations
      case 'sequenceLibraryList':
        broadcast({ type: 'sequenceLibrary', sequences: Array.from(sequenceLibrary.values()) });
        break;

      case 'sequenceLibrarySave': {
        const now = Date.now();
        const newSequence: SequenceDefinition = {
          ...message.definition,
          id: generateId(),
          createdAt: now,
          updatedAt: now,
        };
        sequenceLibrary.set(newSequence.id, newSequence);
        broadcast({ type: 'sequenceLibrarySaved', sequenceId: newSequence.id });
        broadcast({ type: 'sequenceLibrary', sequences: Array.from(sequenceLibrary.values()) });
        break;
      }

      case 'sequenceLibraryUpdate': {
        const existing = sequenceLibrary.get(message.definition.id);
        if (existing) {
          const updated = { ...message.definition, updatedAt: Date.now() };
          sequenceLibrary.set(updated.id, updated);
          broadcast({ type: 'sequenceLibrarySaved', sequenceId: updated.id });
          broadcast({ type: 'sequenceLibrary', sequences: Array.from(sequenceLibrary.values()) });
        }
        break;
      }

      case 'sequenceLibraryDelete':
        if (sequenceLibrary.delete(message.sequenceId)) {
          broadcast({ type: 'sequenceLibraryDeleted', sequenceId: message.sequenceId });
          broadcast({ type: 'sequenceLibrary', sequences: Array.from(sequenceLibrary.values()) });
        }
        break;

      // Sequence execution
      case 'sequenceRun':
        handleSequenceRun(message.config);
        break;

      case 'sequenceAbort':
        handleSequenceAbort();
        break;

      // Trigger script library operations
      case 'triggerScriptLibraryList':
        broadcast({
          type: 'triggerScriptLibrary',
          scripts: Array.from(triggerScriptLibrary.values()),
          activeState: runningTriggerScript?.state ?? null,
        });
        break;

      case 'triggerScriptLibrarySave': {
        const now = Date.now();
        const newScript: TriggerScript = {
          ...message.script,
          id: generateId(),
          createdAt: now,
          updatedAt: now,
        };
        triggerScriptLibrary.set(newScript.id, newScript);
        broadcast({ type: 'triggerScriptLibrarySaved', scriptId: newScript.id });
        broadcast({
          type: 'triggerScriptLibrary',
          scripts: Array.from(triggerScriptLibrary.values()),
          activeState: runningTriggerScript?.state ?? null,
        });
        break;
      }

      case 'triggerScriptLibraryUpdate': {
        const existing = triggerScriptLibrary.get(message.script.id);
        if (existing) {
          const updated = { ...message.script, updatedAt: Date.now() };
          triggerScriptLibrary.set(updated.id, updated);
          broadcast({ type: 'triggerScriptLibrarySaved', scriptId: updated.id });
          broadcast({
            type: 'triggerScriptLibrary',
            scripts: Array.from(triggerScriptLibrary.values()),
            activeState: runningTriggerScript?.state ?? null,
          });
        }
        break;
      }

      case 'triggerScriptLibraryDelete':
        if (triggerScriptLibrary.delete(message.scriptId)) {
          broadcast({ type: 'triggerScriptLibraryDeleted', scriptId: message.scriptId });
          broadcast({
            type: 'triggerScriptLibrary',
            scripts: Array.from(triggerScriptLibrary.values()),
            activeState: runningTriggerScript?.state ?? null,
          });
        }
        break;

      // Trigger script execution
      case 'triggerScriptRun':
        handleTriggerScriptRun(message.scriptId);
        break;

      case 'triggerScriptStop':
        handleTriggerScriptStop();
        break;

      case 'triggerScriptPause':
        if (runningTriggerScript && runningTriggerScript.state.executionState === 'running') {
          runningTriggerScript.state.executionState = 'paused';
          broadcast({ type: 'triggerScriptPaused', scriptId: runningTriggerScript.state.scriptId });
        }
        break;

      case 'triggerScriptResume':
        if (runningTriggerScript && runningTriggerScript.state.executionState === 'paused') {
          runningTriggerScript.state.executionState = 'running';
          broadcast({ type: 'triggerScriptResumed', scriptId: runningTriggerScript.state.scriptId });
        }
        break;

      // Device alias operations
      case 'deviceAliasList':
        broadcast({ type: 'deviceAliases', aliases: Array.from(deviceAliases.values()) });
        break;

      case 'deviceAliasSet': {
        const now = Date.now();
        const existingAlias = deviceAliases.get(message.idn);
        const alias: DeviceAlias = {
          idn: message.idn,
          alias: message.alias,
          createdAt: existingAlias?.createdAt ?? now,
          updatedAt: now,
        };
        deviceAliases.set(message.idn, alias);
        broadcast({ type: 'deviceAliasChanged', idn: message.idn, alias: message.alias });
        broadcast({ type: 'deviceAliases', aliases: Array.from(deviceAliases.values()) });
        break;
      }

      case 'deviceAliasClear':
        if (deviceAliases.delete(message.idn)) {
          broadcast({ type: 'deviceAliasChanged', idn: message.idn, alias: null });
          broadcast({ type: 'deviceAliases', aliases: Array.from(deviceAliases.values()) });
        }
        break;

      // Settings export/import
      case 'settingsExport':
        broadcast({
          type: 'settingsExported',
          data: {
            version: 1,
            exportedAt: new Date().toISOString(),
            sequences: Array.from(sequenceLibrary.values()),
            triggerScripts: Array.from(triggerScriptLibrary.values()),
            deviceAliases: Array.from(deviceAliases.values()),
          },
        });
        break;

      case 'settingsImport': {
        let seqCount = 0;
        let scriptCount = 0;
        let aliasCount = 0;

        for (const seq of message.data.sequences ?? []) {
          sequenceLibrary.set(seq.id, seq);
          seqCount++;
        }
        for (const script of message.data.triggerScripts ?? []) {
          triggerScriptLibrary.set(script.id, script);
          scriptCount++;
        }
        for (const alias of message.data.deviceAliases ?? []) {
          deviceAliases.set(alias.idn, alias);
          aliasCount++;
        }

        broadcast({
          type: 'settingsImported',
          result: { sequences: seqCount, triggerScripts: scriptCount, deviceAliases: aliasCount },
        });
        broadcast({ type: 'sequenceLibrary', sequences: Array.from(sequenceLibrary.values()) });
        broadcast({
          type: 'triggerScriptLibrary',
          scripts: Array.from(triggerScriptLibrary.values()),
          activeState: runningTriggerScript?.state ?? null,
        });
        broadcast({ type: 'deviceAliases', aliases: Array.from(deviceAliases.values()) });
        break;
      }

      // Dashboard layout operations
      case 'dashboardLayoutGet':
        broadcast({ type: 'dashboardLayout', layout: dashboardLayout });
        break;

      case 'dashboardLayoutSave':
        dashboardLayout = message.layout;
        broadcast({ type: 'dashboardLayoutSaved' });
        break;

      case 'dashboardLayoutClear':
        dashboardLayout = null;
        broadcast({ type: 'dashboardLayout', layout: null });
        break;

      // Oscilloscope messages
      case 'scopeStartStreaming':
        handleScopeStartStreaming(message.deviceId, message.channels, message.intervalMs);
        break;

      case 'scopeStopStreaming':
        handleScopeStopStreaming();
        break;

      case 'scopeSetChannelEnabled':
        handleScopeSetChannelEnabled(message.deviceId, message.channel, message.enabled);
        break;

      case 'scopeSetChannelScale':
        handleScopeSetChannelScale(message.deviceId, message.channel, message.scale);
        break;

      case 'scopeSetChannelOffset':
        handleScopeSetChannelOffset(message.deviceId, message.channel, message.offset);
        break;

      case 'scopeSetTimebaseScale':
        handleScopeSetTimebaseScale(message.deviceId, message.scale);
        break;

      case 'scopeRun':
        handleScopeRun(message.deviceId);
        break;

      case 'scopeStop':
        handleScopeStop(message.deviceId);
        break;

      case 'scopeAutoSetup':
        handleScopeAutoSetup(message.deviceId);
        break;

      default:
        // Ignore unsupported messages in demo mode
        console.log('[Demo] Unsupported message type:', (message as { type: string }).type);
    }
  }

  // Sequence execution handlers
  function handleSequenceRun(config: SequenceRunConfig): void {
    // Abort any running sequence
    handleSequenceAbort();

    const sequence = sequenceLibrary.get(config.sequenceId);
    if (!sequence) {
      broadcast({ type: 'sequenceError', sequenceId: config.sequenceId, error: 'Sequence not found' });
      return;
    }

    const session = sessions.get(config.deviceId);
    if (!session) {
      broadcast({ type: 'sequenceError', sequenceId: config.sequenceId, error: 'Device not found' });
      return;
    }

    const steps = generateSteps(sequence.waveform);
    const totalCycles = config.repeatMode === 'count' ? (config.repeatCount ?? 1) :
                        config.repeatMode === 'once' ? 1 : null;

    const state: SequenceState = {
      sequenceId: config.sequenceId,
      runConfig: config,
      executionState: 'running',
      currentStepIndex: 0,
      totalSteps: steps.length,
      currentCycle: 1,
      totalCycles,
      startedAt: Date.now(),
      elapsedMs: 0,
      commandedValue: steps[0]?.value ?? 0,
    };

    runningSequence = { state, steps, timer: null };

    // Apply pre-value if specified
    if (sequence.preValue !== undefined) {
      applyValue(session, config.parameter, sequence.preValue, sequence);
    }

    broadcast({ type: 'sequenceStarted', state });
    scheduleNextStep();
  }

  function applyValue(session: DeviceSession, parameter: string, rawValue: number, sequence: SequenceDefinition): void {
    let value = rawValue;

    // Apply scale and offset
    if (sequence.scale !== undefined) value *= sequence.scale;
    if (sequence.offset !== undefined) value += sequence.offset;

    // Apply clamps
    if (sequence.minClamp !== undefined) value = Math.max(sequence.minClamp, value);
    if (sequence.maxClamp !== undefined) value = Math.min(sequence.maxClamp, value);

    // Apply to device
    handleSetValue(session.device.id, parameter, value);
  }

  function scheduleNextStep(): void {
    if (!runningSequence || runningSequence.state.executionState !== 'running') return;

    const { state, steps } = runningSequence;
    const step = steps[state.currentStepIndex];
    const sequence = sequenceLibrary.get(state.sequenceId);
    const session = sessions.get(state.runConfig.deviceId);

    if (!sequence || !session || !step) {
      handleSequenceAbort();
      return;
    }

    // Apply current step value
    applyValue(session, state.runConfig.parameter, step.value, sequence);
    state.commandedValue = step.value;
    state.elapsedMs = Date.now() - (state.startedAt ?? Date.now());

    broadcast({ type: 'sequenceProgress', state: { ...state } });

    // Schedule next step
    runningSequence.timer = setTimeout(() => {
      if (!runningSequence) return;

      state.currentStepIndex++;

      // Check if cycle complete
      if (state.currentStepIndex >= steps.length) {
        state.currentStepIndex = 0;
        state.currentCycle++;

        // For random walk, regenerate steps each cycle
        if ('type' in sequence.waveform && sequence.waveform.type === 'random') {
          runningSequence.steps = generateSteps(sequence.waveform);
        }

        // Check if done
        if (state.totalCycles !== null && state.currentCycle > state.totalCycles) {
          // Apply post-value if specified
          if (sequence.postValue !== undefined) {
            applyValue(session, state.runConfig.parameter, sequence.postValue, sequence);
          }
          state.executionState = 'completed';
          broadcast({ type: 'sequenceCompleted', sequenceId: state.sequenceId });
          runningSequence = null;
          return;
        }
      }

      scheduleNextStep();
    }, step.duration);
  }

  function handleSequenceAbort(): void {
    if (runningSequence) {
      if (runningSequence.timer) {
        clearTimeout(runningSequence.timer);
      }
      const sequenceId = runningSequence.state.sequenceId;
      runningSequence = null;
      broadcast({ type: 'sequenceAborted', sequenceId });
    }
  }

  // Trigger script execution handlers
  function handleTriggerScriptRun(scriptId: string): void {
    handleTriggerScriptStop();

    const script = triggerScriptLibrary.get(scriptId);
    if (!script) {
      broadcast({ type: 'triggerScriptError', scriptId, error: 'Trigger script not found' });
      return;
    }

    const triggerStates = new Map<string, TriggerState>();
    for (const trigger of script.triggers) {
      triggerStates.set(trigger.id, {
        triggerId: trigger.id,
        firedCount: 0,
        lastFiredAt: null,
        conditionMet: false,
      });
    }

    const state: TriggerScriptState = {
      scriptId,
      executionState: 'running',
      startedAt: Date.now(),
      elapsedMs: 0,
      triggerStates: Array.from(triggerStates.values()),
    };

    runningTriggerScript = { state, script, timer: null, triggerStates };

    broadcast({ type: 'triggerScriptStarted', state });

    // Start monitoring triggers
    runningTriggerScript.timer = setInterval(() => evaluateTriggers(), 100);
  }

  function evaluateTriggers(): void {
    if (!runningTriggerScript || runningTriggerScript.state.executionState !== 'running') return;

    const { state, script, triggerStates } = runningTriggerScript;
    const now = Date.now();
    state.elapsedMs = now - (state.startedAt ?? now);

    for (const trigger of script.triggers) {
      const triggerState = triggerStates.get(trigger.id);
      if (!triggerState) continue;

      // Check if already fired and not repeating
      if (trigger.repeatMode === 'once' && triggerState.firedCount > 0) continue;

      // Check debounce
      if (triggerState.lastFiredAt && now - triggerState.lastFiredAt < trigger.debounceMs) continue;

      // Evaluate condition
      let conditionMet = false;

      if (trigger.condition.type === 'time') {
        conditionMet = state.elapsedMs >= trigger.condition.seconds * 1000;
      } else if (trigger.condition.type === 'value') {
        const session = sessions.get(trigger.condition.deviceId);
        if (session) {
          const currentValue = session.measurements[trigger.condition.parameter] ?? 0;
          const targetValue = trigger.condition.value;
          switch (trigger.condition.operator) {
            case '>': conditionMet = currentValue > targetValue; break;
            case '<': conditionMet = currentValue < targetValue; break;
            case '>=': conditionMet = currentValue >= targetValue; break;
            case '<=': conditionMet = currentValue <= targetValue; break;
            case '==': conditionMet = Math.abs(currentValue - targetValue) < 0.0001; break;
            case '!=': conditionMet = Math.abs(currentValue - targetValue) >= 0.0001; break;
          }
        }
      }

      const wasConditionMet = triggerState.conditionMet;
      triggerState.conditionMet = conditionMet;

      // Fire on rising edge
      if (conditionMet && !wasConditionMet) {
        triggerState.firedCount++;
        triggerState.lastFiredAt = now;
        executeTriggerAction(trigger, triggerState);
      }
    }

    state.triggerStates = Array.from(triggerStates.values());
    broadcast({ type: 'triggerScriptProgress', state: { ...state } });
  }

  function executeTriggerAction(trigger: TriggerScript['triggers'][0], triggerState: TriggerState): void {
    if (!runningTriggerScript) return;

    const action = trigger.action;
    try {
      switch (action.type) {
        case 'setValue':
          handleSetValue(action.deviceId, action.parameter, action.value);
          break;
        case 'setOutput':
          handleSetOutput(action.deviceId, action.enabled);
          break;
        case 'setMode':
          handleSetMode(action.deviceId, action.mode);
          break;
        case 'startSequence':
          handleSequenceRun({
            sequenceId: action.sequenceId,
            deviceId: action.deviceId,
            parameter: action.parameter,
            repeatMode: action.repeatMode,
            repeatCount: action.repeatCount,
          });
          break;
        case 'stopSequence':
          handleSequenceAbort();
          break;
        case 'pauseSequence':
          if (runningSequence) {
            runningSequence.state.executionState = 'paused';
            if (runningSequence.timer) clearTimeout(runningSequence.timer);
          }
          break;
      }

      broadcast({
        type: 'triggerFired',
        scriptId: runningTriggerScript.state.scriptId,
        triggerId: trigger.id,
        triggerState,
      });
    } catch (err) {
      broadcast({
        type: 'triggerActionFailed',
        scriptId: runningTriggerScript.state.scriptId,
        triggerId: trigger.id,
        actionType: action.type,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function handleTriggerScriptStop(): void {
    if (runningTriggerScript) {
      if (runningTriggerScript.timer) {
        clearInterval(runningTriggerScript.timer);
      }
      const scriptId = runningTriggerScript.state.scriptId;
      runningTriggerScript = null;
      broadcast({ type: 'triggerScriptStopped', scriptId });
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
    // Stop running sequences and trigger scripts
    if (runningSequence?.timer) {
      clearTimeout(runningSequence.timer);
      runningSequence = null;
    }
    if (runningTriggerScript?.timer) {
      clearInterval(runningTriggerScript.timer);
      runningTriggerScript = null;
    }
    // Stop scope streaming
    handleScopeStopStreaming();

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
