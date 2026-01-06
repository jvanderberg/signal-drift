/**
 * useOscilloscopeSocket - React hook for oscilloscope state via WebSocket
 *
 * Thin wrapper around the Zustand oscilloscopeStore.
 * Provides a convenient hook interface for components that manage a single oscilloscope.
 *
 * REDESIGNED: Streaming state is now derived from server's streaming state.
 * - isStreaming: from sessionState.streaming.isStreaming
 * - fps: from sessionState.streaming.fps
 * - streamingChannels: from sessionState.streaming.channels
 *
 * State management is delegated to the Zustand store - no duplicate local state.
 * Actions are accessed via getState() to avoid unnecessary subscriptions.
 */

import { useEffect, useCallback } from 'react';
import type { ConnectionState } from '../websocket';
import type { WaveformData, OscilloscopeMeasurement } from '../../../shared/types';
import {
  useOscilloscopeStore,
  selectOscilloscope,
  type OscilloscopeSessionState,
} from '../stores';

// Re-export the session state type for consumers
export type { OscilloscopeSessionState };

export interface UseOscilloscopeSocketResult {
  state: OscilloscopeSessionState | null;
  connectionState: ConnectionState;
  isSubscribed: boolean;
  error: string | null;

  // Waveform data (last fetched)
  waveform: WaveformData | null;
  waveforms: WaveformData[];  // Multi-channel waveforms
  measurements: OscilloscopeMeasurement[];
  screenshot: string | null;  // base64 PNG

  // Streaming state (derived from server)
  isStreaming: boolean;
  fps: number;
  streamingChannels: string[];  // Channels currently being streamed by server

  // Display filter (client-side only, instant)
  displayChannels: string[];  // Which channels to show on the chart
  toggleDisplayChannel: (channel: string) => void;  // Toggle a channel's visibility

  // Actions
  subscribe: () => void;
  unsubscribe: () => void;
  run: () => void;
  stop: () => void;
  single: () => void;
  autoSetup: () => void;
  getWaveform: (channel: string) => void;
  getMeasurement: (channel: string, type: string) => void;
  getScreenshot: () => void;
  clearError: () => void;

  // Channel settings
  setChannelEnabled: (channel: string, enabled: boolean) => void;
  setChannelScale: (channel: string, scale: number) => void;
  setChannelOffset: (channel: string, offset: number) => void;
  setChannelCoupling: (channel: string, coupling: 'AC' | 'DC' | 'GND') => void;
  setChannelProbe: (channel: string, ratio: number) => void;
  setChannelBwLimit: (channel: string, enabled: boolean) => void;

  // Timebase settings
  setTimebaseScale: (scale: number) => void;
  setTimebaseOffset: (offset: number) => void;

  // Trigger settings
  setTriggerSource: (source: string) => void;
  setTriggerLevel: (level: number) => void;
  setTriggerEdge: (edge: 'rising' | 'falling' | 'either') => void;
  setTriggerSweep: (sweep: 'auto' | 'normal' | 'single') => void;

  // Streaming (for measurement configuration - streaming auto-starts)
  startStreaming: (channels: string[], intervalMs: number, measurements?: string[]) => void;
  stopStreaming: () => void;
}

// Get actions from store without subscribing (actions are stable references)
const getActions = () => {
  const store = useOscilloscopeStore.getState();
  return {
    subscribeOscilloscope: store.subscribeOscilloscope,
    unsubscribeOscilloscope: store.unsubscribeOscilloscope,
    run: store.run,
    stop: store.stop,
    single: store.single,
    autoSetup: store.autoSetup,
    getWaveform: store.getWaveform,
    getMeasurement: store.getMeasurement,
    getScreenshot: store.getScreenshot,
    clearError: store.clearError,
    setChannelEnabled: store.setChannelEnabled,
    setChannelScale: store.setChannelScale,
    setChannelOffset: store.setChannelOffset,
    setChannelCoupling: store.setChannelCoupling,
    setChannelProbe: store.setChannelProbe,
    setChannelBwLimit: store.setChannelBwLimit,
    setTimebaseScale: store.setTimebaseScale,
    setTimebaseOffset: store.setTimebaseOffset,
    setTriggerSource: store.setTriggerSource,
    setTriggerLevel: store.setTriggerLevel,
    setTriggerEdge: store.setTriggerEdge,
    setTriggerSweep: store.setTriggerSweep,
    startStreaming: store.startStreaming,
    stopStreaming: store.stopStreaming,
    toggleDisplayChannel: store.toggleDisplayChannel,
    _initializeWebSocket: store._initializeWebSocket,
  };
};

export function useOscilloscopeSocket(deviceId: string): UseOscilloscopeSocketResult {
  // Get state from Zustand store using selector (2 subscriptions for reactive state)
  const oscState = useOscilloscopeStore(selectOscilloscope(deviceId));
  const connectionState = useOscilloscopeStore((s) => s.connectionState);

  // Extract individual pieces from oscilloscope state (no additional subscriptions)
  const state = oscState.sessionState;
  const isSubscribed = oscState.isSubscribed;
  const error = oscState.error;
  const waveform = oscState.waveform;
  const waveforms = oscState.waveforms;
  const measurements = oscState.measurements;
  const screenshot = oscState.screenshot;
  const displayChannels = oscState.displayChannels;

  // Derive streaming state from server's streaming state
  const isStreaming = state?.streaming?.isStreaming ?? false;
  const fps = state?.streaming?.fps ?? 0;
  const streamingChannels = state?.streaming?.channels ?? [];

  // Initialize WebSocket on mount
  useEffect(() => {
    getActions()._initializeWebSocket();
  }, []);

  // Stable callbacks that delegate to store actions
  // Using getActions() inside callbacks to avoid subscribing to action changes
  const subscribe = useCallback(() => {
    getActions().subscribeOscilloscope(deviceId);
  }, [deviceId]);

  const unsubscribe = useCallback(() => {
    getActions().unsubscribeOscilloscope(deviceId);
  }, [deviceId]);

  const run = useCallback(() => {
    getActions().run(deviceId);
  }, [deviceId]);

  const stop = useCallback(() => {
    getActions().stop(deviceId);
  }, [deviceId]);

  const single = useCallback(() => {
    getActions().single(deviceId);
  }, [deviceId]);

  const autoSetup = useCallback(() => {
    getActions().autoSetup(deviceId);
  }, [deviceId]);

  const getWaveform = useCallback((channel: string) => {
    getActions().getWaveform(deviceId, channel);
  }, [deviceId]);

  const getMeasurement = useCallback((channel: string, type: string) => {
    getActions().getMeasurement(deviceId, channel, type);
  }, [deviceId]);

  const getScreenshot = useCallback(() => {
    getActions().getScreenshot(deviceId);
  }, [deviceId]);

  const clearError = useCallback(() => {
    getActions().clearError(deviceId);
  }, [deviceId]);

  // Channel settings
  const setChannelEnabled = useCallback((channel: string, enabled: boolean) => {
    getActions().setChannelEnabled(deviceId, channel, enabled);
  }, [deviceId]);

  const setChannelScale = useCallback((channel: string, scale: number) => {
    getActions().setChannelScale(deviceId, channel, scale);
  }, [deviceId]);

  const setChannelOffset = useCallback((channel: string, offset: number) => {
    getActions().setChannelOffset(deviceId, channel, offset);
  }, [deviceId]);

  const setChannelCoupling = useCallback((channel: string, coupling: 'AC' | 'DC' | 'GND') => {
    getActions().setChannelCoupling(deviceId, channel, coupling);
  }, [deviceId]);

  const setChannelProbe = useCallback((channel: string, ratio: number) => {
    getActions().setChannelProbe(deviceId, channel, ratio);
  }, [deviceId]);

  const setChannelBwLimit = useCallback((channel: string, enabled: boolean) => {
    getActions().setChannelBwLimit(deviceId, channel, enabled);
  }, [deviceId]);

  // Timebase settings
  const setTimebaseScale = useCallback((scale: number) => {
    getActions().setTimebaseScale(deviceId, scale);
  }, [deviceId]);

  const setTimebaseOffset = useCallback((offset: number) => {
    getActions().setTimebaseOffset(deviceId, offset);
  }, [deviceId]);

  // Trigger settings
  const setTriggerSource = useCallback((source: string) => {
    getActions().setTriggerSource(deviceId, source);
  }, [deviceId]);

  const setTriggerLevel = useCallback((level: number) => {
    getActions().setTriggerLevel(deviceId, level);
  }, [deviceId]);

  const setTriggerEdge = useCallback((edge: 'rising' | 'falling' | 'either') => {
    getActions().setTriggerEdge(deviceId, edge);
  }, [deviceId]);

  const setTriggerSweep = useCallback((sweep: 'auto' | 'normal' | 'single') => {
    getActions().setTriggerSweep(deviceId, sweep);
  }, [deviceId]);

  // Streaming
  const startStreaming = useCallback((channels: string[], intervalMs: number, measurements?: string[]) => {
    getActions().startStreaming(deviceId, channels, intervalMs, measurements);
  }, [deviceId]);

  const stopStreaming = useCallback(() => {
    getActions().stopStreaming(deviceId);
  }, [deviceId]);

  // Display filter toggle (client-side only, instant)
  const toggleDisplayChannel = useCallback((channel: string) => {
    getActions().toggleDisplayChannel(deviceId, channel);
  }, [deviceId]);

  return {
    state,
    connectionState,
    isSubscribed,
    error,
    waveform,
    waveforms,
    measurements,
    screenshot,
    isStreaming,
    fps,
    streamingChannels,
    displayChannels,
    toggleDisplayChannel,
    subscribe,
    unsubscribe,
    run,
    stop,
    single,
    autoSetup,
    getWaveform,
    getMeasurement,
    getScreenshot,
    clearError,
    setChannelEnabled,
    setChannelScale,
    setChannelOffset,
    setChannelCoupling,
    setChannelProbe,
    setChannelBwLimit,
    setTimebaseScale,
    setTimebaseOffset,
    setTriggerSource,
    setTriggerLevel,
    setTriggerEdge,
    setTriggerSweep,
    startStreaming,
    stopStreaming,
  };
}
