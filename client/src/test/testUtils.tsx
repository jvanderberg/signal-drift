/**
 * Shared test utilities for integration tests
 *
 * Provides:
 * - Mock factories for devices, states, and capabilities
 * - WebSocket mock with message simulation
 * - Custom render wrapper with providers
 * - Test helpers for common assertions
 */

import { vi } from 'vitest';
import React, { ReactElement } from 'react';
import { render, RenderOptions, act } from '@testing-library/react';
import type {
  DeviceSummary,
  DeviceSessionState,
  DeviceCapabilities,
  DeviceInfo,
  ServerMessage,
  OscilloscopeCapabilities,
  OscilloscopeStatus,
  WaveformData,
  ChannelConfig,
  TimebaseConfig,
  TriggerConfig,
  HistoryData,
  SequenceDefinition,
  TriggerScript,
} from '../../../shared/types';

// ============ WebSocket Mock ============

export interface MockWebSocketState {
  send: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  getState: ReturnType<typeof vi.fn>;
  messageHandlers: ((msg: ServerMessage) => void)[];
  stateHandlers: ((state: string) => void)[];
}

export function createMockWebSocket(): MockWebSocketState {
  return {
    send: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    getState: vi.fn(() => 'connected'),
    messageHandlers: [],
    stateHandlers: [],
  };
}

export function createWebSocketMock(mockState: MockWebSocketState) {
  return {
    getWebSocketManager: () => ({
      send: (...args: unknown[]) => mockState.send(...args),
      connect: () => mockState.connect(),
      disconnect: () => mockState.disconnect(),
      getState: () => mockState.getState(),
      onMessage: (handler: (msg: ServerMessage) => void) => {
        mockState.messageHandlers.push(handler);
        return () => {
          mockState.messageHandlers = mockState.messageHandlers.filter(h => h !== handler);
        };
      },
      onStateChange: (handler: (state: string) => void) => {
        mockState.stateHandlers.push(handler);
        return () => {
          mockState.stateHandlers = mockState.stateHandlers.filter(h => h !== handler);
        };
      },
    }),
  };
}

export function simulateMessage(mockState: MockWebSocketState, msg: ServerMessage) {
  act(() => {
    mockState.messageHandlers.forEach(h => h(msg));
  });
}

export function simulateStateChange(mockState: MockWebSocketState, state: string) {
  act(() => {
    mockState.stateHandlers.forEach(h => h(state));
  });
}

// ============ Device Mock Factories ============

export function createMockDeviceInfo(overrides?: Partial<DeviceInfo>): DeviceInfo {
  return {
    id: 'device-1',
    type: 'power-supply',
    manufacturer: 'Rigol',
    model: 'DP832',
    serial: 'DP8C000000001',
    ...overrides,
  };
}

export function createMockPSUCapabilities(overrides?: Partial<DeviceCapabilities>): DeviceCapabilities {
  return {
    deviceClass: 'psu',
    features: {},
    modes: ['CV', 'CC'],
    modesSettable: false,
    outputs: [
      { name: 'voltage', unit: 'V', decimals: 3, min: 0, max: 30 },
      { name: 'current', unit: 'A', decimals: 3, min: 0, max: 3 },
    ],
    measurements: [
      { name: 'voltage', unit: 'V', decimals: 4 },
      { name: 'current', unit: 'A', decimals: 4 },
      { name: 'power', unit: 'W', decimals: 3 },
    ],
    ...overrides,
  };
}

export function createMockLoadCapabilities(overrides?: Partial<DeviceCapabilities>): DeviceCapabilities {
  return {
    deviceClass: 'load',
    features: {},
    modes: ['CC', 'CV', 'CR', 'CP'],
    modesSettable: true,
    outputs: [
      { name: 'current', unit: 'A', decimals: 3, min: 0, max: 30, modes: ['CC'] },
      { name: 'voltage', unit: 'V', decimals: 2, min: 0, max: 150, modes: ['CV'] },
      { name: 'resistance', unit: 'Ω', decimals: 2, min: 0.1, max: 10000, modes: ['CR'] },
      { name: 'power', unit: 'W', decimals: 2, min: 0, max: 300, modes: ['CP'] },
    ],
    measurements: [
      { name: 'voltage', unit: 'V', decimals: 4 },
      { name: 'current', unit: 'A', decimals: 4 },
      { name: 'power', unit: 'W', decimals: 3 },
      { name: 'resistance', unit: 'Ω', decimals: 2 },
    ],
    ...overrides,
  };
}

export function createMockOscilloscopeCapabilities(overrides?: Partial<OscilloscopeCapabilities>): OscilloscopeCapabilities {
  return {
    channels: 4,
    bandwidth: 100,
    maxSampleRate: 1e9,
    maxMemoryDepth: 1e6,
    supportedMeasurements: ['VPP', 'VMAX', 'VMIN', 'VAVG', 'VRMS', 'FREQ', 'PER', 'RISE', 'FALL'],
    hasAWG: false,
    ...overrides,
  };
}

export function createMockDeviceSummary(overrides?: Partial<DeviceSummary>): DeviceSummary {
  const info = createMockDeviceInfo(overrides?.info);
  return {
    id: info.id,
    info,
    capabilities: createMockPSUCapabilities(),
    connectionStatus: 'connected',
    ...overrides,
  };
}

export function createMockOscilloscopeSummary(overrides?: Partial<DeviceSummary>): DeviceSummary {
  const info = createMockDeviceInfo({
    type: 'oscilloscope',
    manufacturer: 'Rigol',
    model: 'DS1054Z',
    ...overrides?.info,
  });
  return {
    id: info.id,
    info,
    capabilities: createMockOscilloscopeCapabilities() as unknown as DeviceCapabilities,
    connectionStatus: 'connected',
    ...overrides,
  };
}

export function createMockHistoryData(overrides?: Partial<HistoryData>): HistoryData {
  return {
    timestamps: [],
    voltage: [],
    current: [],
    power: [],
    ...overrides,
  };
}

export function createMockSessionState(overrides?: Partial<DeviceSessionState>): DeviceSessionState {
  return {
    info: createMockDeviceInfo(),
    capabilities: createMockPSUCapabilities(),
    connectionStatus: 'connected',
    consecutiveErrors: 0,
    mode: 'CV',
    outputEnabled: false,
    setpoints: { voltage: 12, current: 1 },
    measurements: { voltage: 0, current: 0, power: 0 },
    history: createMockHistoryData(),
    lastUpdated: Date.now(),
    ...overrides,
  };
}

// ============ Oscilloscope Mock Factories ============

export function createMockChannelConfig(overrides?: Partial<ChannelConfig>): ChannelConfig {
  return {
    enabled: true,
    scale: 1.0,
    offset: 0,
    coupling: 'DC',
    probe: 1,
    bwLimit: false,
    ...overrides,
  };
}

export function createMockTimebaseConfig(overrides?: Partial<TimebaseConfig>): TimebaseConfig {
  return {
    scale: 0.001,
    offset: 0,
    mode: 'main',
    ...overrides,
  };
}

export function createMockTriggerConfig(overrides?: Partial<TriggerConfig>): TriggerConfig {
  return {
    source: 'CHAN1',
    mode: 'edge',
    coupling: 'DC',
    level: 1.0,
    edge: 'rising',
    sweep: 'auto',
    ...overrides,
  };
}

export function createMockOscilloscopeStatus(overrides?: Partial<OscilloscopeStatus>): OscilloscopeStatus {
  return {
    running: true,
    triggerStatus: 'auto',
    sampleRate: 1e9,
    memoryDepth: 12000,
    channels: {
      CHAN1: createMockChannelConfig(),
      CHAN2: createMockChannelConfig({ enabled: false }),
      CHAN3: createMockChannelConfig({ enabled: false }),
      CHAN4: createMockChannelConfig({ enabled: false }),
    },
    timebase: createMockTimebaseConfig(),
    trigger: createMockTriggerConfig(),
    measurements: [],
    ...overrides,
  };
}

export function createMockWaveform(channel: string, options?: {
  points?: number[];
  xIncrement?: number;
  yIncrement?: number;
}): WaveformData {
  const points = options?.points ?? Array(1000).fill(0).map((_, i) => Math.sin(i * 0.02) * 2);
  return {
    channel,
    points,
    xIncrement: options?.xIncrement ?? 0.000001,
    xOrigin: 0,
    yIncrement: options?.yIncrement ?? 0.01,
    yOrigin: 0,
    yReference: 128,
  };
}

// ============ Sequence Mock Factories ============

export function createMockSequenceDefinition(overrides?: Partial<SequenceDefinition>): SequenceDefinition {
  return {
    id: 'seq-1',
    name: 'Test Sequence',
    unit: 'V',
    waveform: {
      type: 'sine',
      min: 0,
      max: 10,
      pointsPerCycle: 100,
      intervalMs: 100,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ============ Trigger Script Mock Factories ============

export function createMockTriggerScript(overrides?: Partial<TriggerScript>): TriggerScript {
  return {
    id: 'script-1',
    name: 'Test Script',
    triggers: [
      {
        id: 'trigger-1',
        condition: {
          type: 'value',
          deviceId: 'device-1',
          parameter: 'voltage',
          operator: '>',
          value: 5,
        },
        action: {
          type: 'setOutput',
          deviceId: 'device-1',
          enabled: false,
        },
        repeatMode: 'once',
        debounceMs: 100,
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ============ Custom Render ============

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  withRouter?: boolean;
}

function AllProviders({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function customRender(
  ui: ReactElement,
  options?: CustomRenderOptions
) {
  return render(ui, { wrapper: AllProviders, ...options });
}

// ============ Test Assertions ============

export function expectWebSocketSent(mockState: MockWebSocketState, message: Record<string, unknown>) {
  expect(mockState.send).toHaveBeenCalledWith(expect.objectContaining(message));
}

export function expectWebSocketSentWith(mockState: MockWebSocketState, type: string, props?: Record<string, unknown>) {
  if (props) {
    expect(mockState.send).toHaveBeenCalledWith(expect.objectContaining({ type, ...props }));
  } else {
    expect(mockState.send).toHaveBeenCalledWith(expect.objectContaining({ type }));
  }
}

export function getLastWebSocketMessage(mockState: MockWebSocketState): Record<string, unknown> | undefined {
  const calls = mockState.send.mock.calls;
  if (calls.length === 0) return undefined;
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

// ============ Wait Helpers ============

export async function waitForCondition(
  condition: () => boolean,
  timeout = 1000,
  interval = 50
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error('Condition not met within timeout');
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}

// Re-export testing library utilities
export * from '@testing-library/react';
export { customRender as render };
