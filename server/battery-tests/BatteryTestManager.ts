import type { DeviceSession } from '../sessions/DeviceSession.js';
import type { SessionManager } from '../sessions/SessionManager.js';
import type {
  BatteryTestConfig,
  BatteryTestState,
  BatteryTestTerminationReason,
  BatteryTestSample,
  MeasurementUpdate,
  Result,
  ServerMessage,
} from '../../shared/types.js';
import { Err, Ok } from '../../shared/types.js';

type Subscriber = (message: ServerMessage) => void;

export interface BatteryTestManager {
  start(config: BatteryTestConfig): Promise<Result<BatteryTestState, Error>>;
  stop(): Promise<void>;
  getState(): BatteryTestState | undefined;
  getSamples(): BatteryTestSample[];
  subscribe(callback: Subscriber): () => void;
  close(): Promise<void>;
}

const SUBSCRIBER_ID = 'software-battery-test';
const PREFLIGHT_SUBSCRIBER_ID = 'software-battery-test-preflight';
const RAMP_UPDATE_MS = 1000;
const PREFLIGHT_MEASUREMENT_TIMEOUT_MS = 3000;

export function createBatteryTestManager(sessionManager: Pick<SessionManager, 'getSession'>): BatteryTestManager {
  const subscribers = new Set<Subscriber>();
  let state: BatteryTestState | undefined;
  let session: DeviceSession | undefined;
  let rampTimer: ReturnType<typeof setInterval> | undefined;
  let lastMeasurementAt: number | undefined;
  let lastCurrent = 0;
  let lastPower = 0;
  let stopping = false;
  let samples: BatteryTestSample[] = [];

  function waitForNextMeasurement(targetSession: DeviceSession): Promise<Result<MeasurementUpdate, Error>> {
    return new Promise(resolve => {
      let settled = false;
      const finishWait = (result: Result<MeasurementUpdate, Error>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        targetSession.unsubscribe(PREFLIGHT_SUBSCRIBER_ID);
        resolve(result);
      };
      const timeout = setTimeout(
        () => finishWait(Err(new Error('Timed out waiting for a fresh voltage measurement after configuring remote sense'))),
        PREFLIGHT_MEASUREMENT_TIMEOUT_MS
      );
      targetSession.subscribe(PREFLIGHT_SUBSCRIBER_ID, message => {
        if (message.type === 'measurement') finishWait(Ok(message.update));
        else if (message.type === 'field' && message.field === 'connectionStatus' && message.value === 'disconnected') {
          finishWait(Err(new Error('Electronic load disconnected during battery-test preflight')));
        }
      });
    });
  }

  function broadcast(): void {
    const message: ServerMessage = { type: 'batteryTestState', state: state ?? null };
    for (const callback of subscribers) {
      try {
        callback(message);
      } catch (error) {
        console.error('Battery test subscriber error:', error);
      }
    }
  }

  function broadcastMessage(message: ServerMessage): void {
    for (const callback of subscribers) {
      try {
        callback(message);
      } catch (error) {
        console.error('Battery test subscriber error:', error);
      }
    }
  }

  function clearRuntime(): void {
    if (rampTimer) clearInterval(rampTimer);
    rampTimer = undefined;
    session?.unsubscribe(SUBSCRIBER_ID);
    session = undefined;
    lastMeasurementAt = undefined;
    lastCurrent = 0;
    lastPower = 0;
  }

  async function finish(reason: BatteryTestTerminationReason, error?: string): Promise<void> {
    if (!state || state.executionState !== 'running' || stopping) return;
    stopping = true;
    const activeSession = session;
    if (rampTimer) clearInterval(rampTimer);
    rampTimer = undefined;

    const outputResult = activeSession ? await activeSession.setOutput(false) : Ok();
    const endedAt = Date.now();
    state = {
      ...state,
      executionState: error || !outputResult.ok ? 'error' :
        reason === 'minimum-voltage' || reason === 'charge-limit' || reason === 'energy-limit' ||
        reason === 'current-limit' || reason === 'power-limit' ? 'completed' : 'stopped',
      terminationReason: error || !outputResult.ok ? 'error' : reason,
      endedAt,
      elapsedMs: endedAt - state.startedAt,
      error: error ?? (!outputResult.ok ? `Failed to turn load off: ${outputResult.error.message}` : undefined),
    };
    clearRuntime();
    stopping = false;
    broadcast();
  }

  function integrate(timestamp: number, current: number, power: number): void {
    if (!state || state.executionState !== 'running') return;
    if (lastMeasurementAt !== undefined && timestamp > lastMeasurementAt) {
      const hours = (timestamp - lastMeasurementAt) / 3_600_000;
      state = {
        ...state,
        chargeMah: state.chargeMah + ((lastCurrent + current) / 2) * hours * 1000,
        energyWh: state.energyWh + ((lastPower + power) / 2) * hours,
      };
    }
    lastMeasurementAt = timestamp;
    lastCurrent = current;
    lastPower = power;
  }

  function handleSessionMessage(message: ServerMessage): void {
    if (!state || state.executionState !== 'running' || message.type === 'batteryTestState') return;
    if ('deviceId' in message && message.deviceId !== state.config.deviceId) return;

    if (message.type === 'measurement') {
      const voltage = message.update.measurements.voltage;
      if (voltage === undefined) return;
      const current = message.update.measurements.current ?? 0;
      const power = message.update.measurements.power ?? voltage * current;
      integrate(message.update.timestamp, current, power);
      state = {
        ...state,
        elapsedMs: message.update.timestamp - state.startedAt,
        voltage,
        current,
        power,
      };
      const sample: BatteryTestSample = {
        timestamp: message.update.timestamp,
        voltage,
        current,
        power,
        chargeMah: state.chargeMah,
        energyWh: state.energyWh,
      };
      samples.push(sample);
      broadcastMessage({ type: 'batteryTestSample', sample });
      broadcast();
      if (voltage <= state.config.minVoltage) void finish('minimum-voltage');
      else if (state.config.maxCurrent !== undefined && current >= state.config.maxCurrent) void finish('current-limit');
      else if (state.config.maxPower !== undefined && power >= state.config.maxPower) void finish('power-limit');
      else if (state.config.cutoffMah !== undefined && state.chargeMah >= state.config.cutoffMah) void finish('charge-limit');
      else if (state.config.cutoffWh !== undefined && state.energyWh >= state.config.cutoffWh) void finish('energy-limit');
    } else if (message.type === 'field' && message.field === 'connectionStatus' && message.value === 'disconnected') {
      void finish('device-disconnected', 'Electronic load disconnected during battery test');
    } else if (message.type === 'field' && message.field === 'outputEnabled' && message.value === false) {
      void finish('output-disabled');
    }
  }

  async function updateRamp(): Promise<void> {
    if (!state || state.executionState !== 'running' || !session) return;
    const rampMs = state.config.rampMinutes * 60_000;
    const fraction = rampMs <= 0 ? 1 : Math.min(1, (Date.now() - state.startedAt) / rampMs);
    const commandedCurrent = state.config.targetCurrent * fraction;
    if (Math.abs(commandedCurrent - state.commandedCurrent) < 0.0005) return;
    const result = await session.setValue('current', commandedCurrent, true);
    if (!result.ok) {
      await finish('error', `Failed to set discharge current: ${result.error.message}`);
      return;
    }
    if (state?.executionState === 'running') {
      state = { ...state, commandedCurrent };
      broadcast();
    }
  }

  async function start(config: BatteryTestConfig): Promise<Result<BatteryTestState, Error>> {
    if (state?.executionState === 'running') return Err(new Error('A battery test is already running'));
    if (!Number.isFinite(config.minVoltage) || !Number.isFinite(config.maxVoltage) ||
        !Number.isFinite(config.targetCurrent) || !Number.isFinite(config.rampMinutes)) {
      return Err(new Error('Battery test settings must be finite numbers'));
    }
    if (config.minVoltage < 0 || config.maxVoltage <= config.minVoltage) {
      return Err(new Error('Maximum voltage must be greater than minimum voltage'));
    }
    if (config.targetCurrent <= 0 || config.rampMinutes < 0) {
      return Err(new Error('Target current must be positive and ramp time cannot be negative'));
    }
    if ((config.cutoffMah !== undefined && (!Number.isFinite(config.cutoffMah) || config.cutoffMah <= 0)) ||
        (config.cutoffWh !== undefined && (!Number.isFinite(config.cutoffWh) || config.cutoffWh <= 0)) ||
        (config.maxCurrent !== undefined && (!Number.isFinite(config.maxCurrent) || config.maxCurrent <= 0)) ||
        (config.maxPower !== undefined && (!Number.isFinite(config.maxPower) || config.maxPower <= 0))) {
      return Err(new Error('Optional battery test cutoffs must be positive when enabled'));
    }

    const nextSession = sessionManager.getSession(config.deviceId);
    if (!nextSession) return Err(new Error(`Device session not found: ${config.deviceId}`));
    const deviceState = nextSession.getState();
    if (deviceState.capabilities.deviceClass !== 'load' || deviceState.info.type !== 'electronic-load') {
      return Err(new Error('Battery tests can only run on electronic loads'));
    }
    if (deviceState.connectionStatus !== 'connected') return Err(new Error('Electronic load is not connected'));
    const currentOutput = deviceState.capabilities.outputs.find(output => output.name === 'current' && output.modes?.includes('CC'));
    if (!currentOutput) return Err(new Error('Electronic load does not expose a CC current setpoint'));
    if ((currentOutput.max !== undefined && config.targetCurrent > currentOutput.max) ||
        (currentOutput.min !== undefined && config.targetCurrent < currentOutput.min)) {
      return Err(new Error(`Target current is outside the load range (${currentOutput.min ?? 0}–${currentOutput.max ?? '∞'} A)`));
    }
    let preflightMeasurements = deviceState.measurements;
    const supportsRemoteSensing = deviceState.capabilities.features.remoteSensing === true;
    if (config.remoteSensing && !supportsRemoteSensing) {
      return Err(new Error('The selected electronic load does not support remote sensing'));
    }
    if (supportsRemoteSensing) {
      const senseResult = await nextSession.setRemoteSensing(config.remoteSensing ?? false);
      if (!senseResult.ok) return senseResult;
      const measurementResult = await waitForNextMeasurement(nextSession);
      if (!measurementResult.ok) return measurementResult;
      preflightMeasurements = measurementResult.value.measurements;
    }

    const voltage = preflightMeasurements.voltage;
    if (voltage === undefined) return Err(new Error('Electronic load does not provide voltage measurements'));
    if (voltage < config.minVoltage || voltage > config.maxVoltage) {
      return Err(new Error(`Starting voltage ${voltage.toFixed(3)} V is outside the configured ${config.minVoltage}–${config.maxVoltage} V window`));
    }

    session = nextSession;
    session.subscribe(SUBSCRIBER_ID, handleSessionMessage);
    const modeResult = await session.setMode('CC');
    if (!modeResult.ok) { clearRuntime(); return modeResult; }
    const initialCurrent = config.rampMinutes > 0 ? 0 : config.targetCurrent;
    const currentResult = await session.setValue('current', initialCurrent, true);
    if (!currentResult.ok) { clearRuntime(); return currentResult; }
    const outputResult = await session.setOutput(true);
    if (!outputResult.ok) { clearRuntime(); return outputResult; }

    const startedAt = Date.now();
    state = {
      config,
      executionState: 'running',
      startedAt,
      elapsedMs: 0,
      voltage,
      current: preflightMeasurements.current ?? 0,
      power: preflightMeasurements.power ?? 0,
      commandedCurrent: initialCurrent,
      chargeMah: 0,
      energyWh: 0,
    };
    samples = [{
      timestamp: startedAt,
      voltage,
      current: preflightMeasurements.current ?? 0,
      power: preflightMeasurements.power ?? 0,
      chargeMah: 0,
      energyWh: 0,
    }];
    broadcastMessage({ type: 'batteryTestSample', sample: samples[0] });
    lastMeasurementAt = startedAt;
    lastCurrent = 0;
    lastPower = 0;
    if (config.rampMinutes > 0) rampTimer = setInterval(() => void updateRamp(), RAMP_UPDATE_MS);
    broadcast();
    return Ok(state);
  }

  return {
    start,
    stop: () => finish('user-stopped'),
    getState: () => state,
    getSamples: () => samples,
    subscribe(callback) { subscribers.add(callback); return () => subscribers.delete(callback); },
    async close() { if (state?.executionState === 'running') await finish('user-stopped'); clearRuntime(); subscribers.clear(); },
  };
}
