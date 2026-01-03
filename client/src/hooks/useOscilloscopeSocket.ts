/**
 * useOscilloscopeSocket - React hook for oscilloscope state via WebSocket
 *
 * Thin wrapper around the Zustand oscilloscopeStore.
 * Provides a convenient hook interface for components that manage a single oscilloscope.
 *
 * State management is delegated to the Zustand store - no duplicate local state.
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
  isStreaming: boolean;

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

  // Streaming
  startStreaming: (channels: string[], intervalMs: number, measurements?: string[]) => void;
  stopStreaming: () => void;
}

export function useOscilloscopeSocket(deviceId: string): UseOscilloscopeSocketResult {
  // Get state from Zustand store using selector
  const oscState = useOscilloscopeStore(selectOscilloscope(deviceId));
  const connectionState = useOscilloscopeStore((s) => s.connectionState);

  // Extract individual pieces from oscilloscope state
  const state = oscState.sessionState;
  const isSubscribed = oscState.isSubscribed;
  const error = oscState.error;
  const waveform = oscState.waveform;
  const waveforms = oscState.waveforms;
  const measurements = oscState.measurements;
  const screenshot = oscState.screenshot;
  const isStreaming = oscState.isStreaming;

  // Get store actions
  const subscribeOscilloscope = useOscilloscopeStore((s) => s.subscribeOscilloscope);
  const unsubscribeOscilloscope = useOscilloscopeStore((s) => s.unsubscribeOscilloscope);
  const runAction = useOscilloscopeStore((s) => s.run);
  const stopAction = useOscilloscopeStore((s) => s.stop);
  const singleAction = useOscilloscopeStore((s) => s.single);
  const autoSetupAction = useOscilloscopeStore((s) => s.autoSetup);
  const getWaveformAction = useOscilloscopeStore((s) => s.getWaveform);
  const getMeasurementAction = useOscilloscopeStore((s) => s.getMeasurement);
  const getScreenshotAction = useOscilloscopeStore((s) => s.getScreenshot);
  const clearErrorAction = useOscilloscopeStore((s) => s.clearError);
  const setChannelEnabledAction = useOscilloscopeStore((s) => s.setChannelEnabled);
  const setChannelScaleAction = useOscilloscopeStore((s) => s.setChannelScale);
  const setChannelOffsetAction = useOscilloscopeStore((s) => s.setChannelOffset);
  const setChannelCouplingAction = useOscilloscopeStore((s) => s.setChannelCoupling);
  const setChannelProbeAction = useOscilloscopeStore((s) => s.setChannelProbe);
  const setChannelBwLimitAction = useOscilloscopeStore((s) => s.setChannelBwLimit);
  const setTimebaseScaleAction = useOscilloscopeStore((s) => s.setTimebaseScale);
  const setTimebaseOffsetAction = useOscilloscopeStore((s) => s.setTimebaseOffset);
  const setTriggerSourceAction = useOscilloscopeStore((s) => s.setTriggerSource);
  const setTriggerLevelAction = useOscilloscopeStore((s) => s.setTriggerLevel);
  const setTriggerEdgeAction = useOscilloscopeStore((s) => s.setTriggerEdge);
  const setTriggerSweepAction = useOscilloscopeStore((s) => s.setTriggerSweep);
  const startStreamingAction = useOscilloscopeStore((s) => s.startStreaming);
  const stopStreamingAction = useOscilloscopeStore((s) => s.stopStreaming);
  const initializeWebSocket = useOscilloscopeStore((s) => s._initializeWebSocket);

  // Initialize WebSocket on mount
  useEffect(() => {
    initializeWebSocket();
  }, [initializeWebSocket]);

  // Stable callbacks that delegate to store actions
  const subscribe = useCallback(() => {
    subscribeOscilloscope(deviceId);
  }, [subscribeOscilloscope, deviceId]);

  const unsubscribe = useCallback(() => {
    unsubscribeOscilloscope(deviceId);
  }, [unsubscribeOscilloscope, deviceId]);

  const run = useCallback(() => {
    runAction(deviceId);
  }, [runAction, deviceId]);

  const stop = useCallback(() => {
    stopAction(deviceId);
  }, [stopAction, deviceId]);

  const single = useCallback(() => {
    singleAction(deviceId);
  }, [singleAction, deviceId]);

  const autoSetup = useCallback(() => {
    autoSetupAction(deviceId);
  }, [autoSetupAction, deviceId]);

  const getWaveform = useCallback((channel: string) => {
    getWaveformAction(deviceId, channel);
  }, [getWaveformAction, deviceId]);

  const getMeasurement = useCallback((channel: string, type: string) => {
    getMeasurementAction(deviceId, channel, type);
  }, [getMeasurementAction, deviceId]);

  const getScreenshot = useCallback(() => {
    getScreenshotAction(deviceId);
  }, [getScreenshotAction, deviceId]);

  const clearError = useCallback(() => {
    clearErrorAction(deviceId);
  }, [clearErrorAction, deviceId]);

  // Channel settings
  const setChannelEnabled = useCallback((channel: string, enabled: boolean) => {
    setChannelEnabledAction(deviceId, channel, enabled);
  }, [setChannelEnabledAction, deviceId]);

  const setChannelScale = useCallback((channel: string, scale: number) => {
    setChannelScaleAction(deviceId, channel, scale);
  }, [setChannelScaleAction, deviceId]);

  const setChannelOffset = useCallback((channel: string, offset: number) => {
    setChannelOffsetAction(deviceId, channel, offset);
  }, [setChannelOffsetAction, deviceId]);

  const setChannelCoupling = useCallback((channel: string, coupling: 'AC' | 'DC' | 'GND') => {
    setChannelCouplingAction(deviceId, channel, coupling);
  }, [setChannelCouplingAction, deviceId]);

  const setChannelProbe = useCallback((channel: string, ratio: number) => {
    setChannelProbeAction(deviceId, channel, ratio);
  }, [setChannelProbeAction, deviceId]);

  const setChannelBwLimit = useCallback((channel: string, enabled: boolean) => {
    setChannelBwLimitAction(deviceId, channel, enabled);
  }, [setChannelBwLimitAction, deviceId]);

  // Timebase settings
  const setTimebaseScale = useCallback((scale: number) => {
    setTimebaseScaleAction(deviceId, scale);
  }, [setTimebaseScaleAction, deviceId]);

  const setTimebaseOffset = useCallback((offset: number) => {
    setTimebaseOffsetAction(deviceId, offset);
  }, [setTimebaseOffsetAction, deviceId]);

  // Trigger settings
  const setTriggerSource = useCallback((source: string) => {
    setTriggerSourceAction(deviceId, source);
  }, [setTriggerSourceAction, deviceId]);

  const setTriggerLevel = useCallback((level: number) => {
    setTriggerLevelAction(deviceId, level);
  }, [setTriggerLevelAction, deviceId]);

  const setTriggerEdge = useCallback((edge: 'rising' | 'falling' | 'either') => {
    setTriggerEdgeAction(deviceId, edge);
  }, [setTriggerEdgeAction, deviceId]);

  const setTriggerSweep = useCallback((sweep: 'auto' | 'normal' | 'single') => {
    setTriggerSweepAction(deviceId, sweep);
  }, [setTriggerSweepAction, deviceId]);

  // Streaming
  const startStreaming = useCallback((channels: string[], intervalMs: number, measurements?: string[]) => {
    startStreamingAction(deviceId, channels, intervalMs, measurements);
  }, [startStreamingAction, deviceId]);

  const stopStreaming = useCallback(() => {
    stopStreamingAction(deviceId);
  }, [stopStreamingAction, deviceId]);

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
