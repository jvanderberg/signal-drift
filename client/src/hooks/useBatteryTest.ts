import { useCallback, useEffect, useRef, useState } from 'react';
import type { BatteryTestConfig, BatteryTestSample, BatteryTestState, ServerMessage } from '../types';
import { getWebSocketManager } from '../websocket';

export function useBatteryTest() {
  const [state, setState] = useState<BatteryTestState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [serverSupported, setServerSupported] = useState<boolean | null>(null);
  const [samples, setSamples] = useState<BatteryTestSample[]>([]);
  const startTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const supportTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSamples = useRef<BatteryTestSample[]>([]);

  const clearStartTimeout = useCallback(() => {
    if (startTimeout.current) clearTimeout(startTimeout.current);
    startTimeout.current = null;
    setIsStarting(false);
  }, []);

  useEffect(() => {
    const manager = getWebSocketManager();
    const checkServerSupport = () => {
      if (supportTimeout.current) clearTimeout(supportTimeout.current);
      setServerSupported(null);
      manager.send({ type: 'batteryTestGetState' });
      supportTimeout.current = setTimeout(() => {
        supportTimeout.current = null;
        setServerSupported(false);
        setError('The connected driver server does not support software battery tests. Update and restart it first.');
      }, 2000);
    };
    const unsubscribeMessage = manager.onMessage((message: ServerMessage) => {
      if (message.type === 'batteryTestState') {
        if (supportTimeout.current) clearTimeout(supportTimeout.current);
        supportTimeout.current = null;
        setServerSupported(true);
        clearStartTimeout();
        setState(message.state);
        setError(message.state?.error ?? null);
      } else if (message.type === 'batteryTestHistory') {
        pendingSamples.current = [];
        setSamples(message.samples);
      } else if (message.type === 'batteryTestSample') {
        pendingSamples.current.push(message.sample);
      } else if (message.type === 'error' && message.code.startsWith('BATTERY_TEST')) {
        if (supportTimeout.current) clearTimeout(supportTimeout.current);
        supportTimeout.current = null;
        setServerSupported(true);
        clearStartTimeout();
        setError(message.message);
      }
    });
    const unsubscribeState = manager.onStateChange(connectionState => {
      if (connectionState === 'connected') {
        checkServerSupport();
      }
    });
    manager.connect();
    checkServerSupport();
    const sampleFlushTimer = setInterval(() => {
      if (pendingSamples.current.length === 0) return;
      const batch = pendingSamples.current;
      pendingSamples.current = [];
      setSamples(previous => [...previous, ...batch]);
    }, 2000);
    return () => {
      unsubscribeMessage();
      unsubscribeState();
      if (startTimeout.current) clearTimeout(startTimeout.current);
      if (supportTimeout.current) clearTimeout(supportTimeout.current);
      clearInterval(sampleFlushTimer);
    };
  }, [clearStartTimeout]);

  const start = useCallback((config: BatteryTestConfig) => {
    setError(null);
    pendingSamples.current = [];
    setSamples([]);
    setIsStarting(true);
    getWebSocketManager().send({ type: 'batteryTestStart', config });
    if (startTimeout.current) clearTimeout(startTimeout.current);
    startTimeout.current = setTimeout(() => {
      startTimeout.current = null;
      setIsStarting(false);
      setError('Driver server did not acknowledge the battery test. Update and restart the server, then try again.');
    }, 8000);
  }, []);
  const stop = useCallback(() => getWebSocketManager().send({ type: 'batteryTestStop' }), []);

  return { state, samples, isRunning: state?.executionState === 'running', isStarting, serverSupported, error, clearError: () => setError(null), start, stop };
}
