import { useEffect, useMemo, useRef, useState } from 'react';
import { useBatteryTest } from '../../hooks/useBatteryTest';
import { useDeviceList } from '../../hooks/useDeviceList';
import { useDeviceSocket } from '../../hooks/useDeviceSocket';
import { BatteryTestChart } from '../BatteryTestChart';
import type { BatteryTestSample } from '../../types';

interface BatteryTestPanelProps {
  onClose?: () => void;
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map(value => value.toString().padStart(2, '0')).join(':');
}

export function BatteryTestPanel({ onClose }: BatteryTestPanelProps) {
  const { standardDevices } = useDeviceList();
  const { state: testState, samples, isRunning, isStarting, serverSupported, error, clearError, start, stop } = useBatteryTest();
  const loads = useMemo(() => standardDevices.filter(device =>
    device.info.type === 'electronic-load' && device.capabilities.deviceClass === 'load'
  ), [standardDevices]);
  const [deviceId, setDeviceId] = useState('');
  const [minVoltage, setMinVoltage] = useState(3);
  const [maxVoltage, setMaxVoltage] = useState(4.2);
  const [targetCurrent, setTargetCurrent] = useState(1);
  const [rampMinutes, setRampMinutes] = useState(0);
  const [remoteSensing, setRemoteSensing] = useState(false);
  const [cutoffMah, setCutoffMah] = useState<number | undefined>();
  const [cutoffWh, setCutoffWh] = useState<number | undefined>();
  const [maxCurrent, setMaxCurrent] = useState<number | undefined>();
  const [maxPower, setMaxPower] = useState<number | undefined>();
  const { state: deviceState, subscribe, unsubscribe } = useDeviceSocket(deviceId);
  const latestDeviceState = useRef(deviceState);
  const [idleChartSamples, setIdleChartSamples] = useState<BatteryTestSample[]>([]);

  useEffect(() => {
    latestDeviceState.current = deviceState;
  }, [deviceState]);

  useEffect(() => {
    const refreshChartHistory = () => {
      const latest = latestDeviceState.current;
      if (!latest) return;
      setIdleChartSamples(latest.history.timestamps.map((timestamp, index) => ({
        timestamp,
        voltage: latest.history.voltage[index] ?? 0,
        current: latest.history.current[index] ?? 0,
        power: latest.history.power[index] ?? 0,
        chargeMah: 0,
        energyWh: 0,
      })));
    };
    refreshChartHistory();
    const timer = setInterval(refreshChartHistory, 2000);
    return () => clearInterval(timer);
  }, [deviceId]);

  useEffect(() => {
    if (!deviceId) return;
    subscribe();
    return unsubscribe;
  }, [deviceId, subscribe, unsubscribe]);

  useEffect(() => {
    if (testState?.executionState === 'running') {
      setDeviceId(testState.config.deviceId);
      setMinVoltage(testState.config.minVoltage);
      setMaxVoltage(testState.config.maxVoltage);
      setTargetCurrent(testState.config.targetCurrent);
      setRampMinutes(testState.config.rampMinutes);
      setRemoteSensing(testState.config.remoteSensing ?? false);
      setCutoffMah(testState.config.cutoffMah);
      setCutoffWh(testState.config.cutoffWh);
      setMaxCurrent(testState.config.maxCurrent);
      setMaxPower(testState.config.maxPower);
    } else if (!deviceId && loads[0]) {
      setDeviceId(loads[0].id);
    }
  }, [deviceId, loads, testState]);

  const selectedLoad = loads.find(device => device.id === deviceId);
  const currentCapability = selectedLoad?.capabilities.outputs.find(output => output.name === 'current');
  const remoteSensingSupported = selectedLoad?.capabilities.features.remoteSensing === true;
  const settingsValid = deviceId !== '' && minVoltage >= 0 && maxVoltage > minVoltage &&
    targetCurrent > 0 && rampMinutes >= 0 &&
    (cutoffMah === undefined || cutoffMah > 0) && (cutoffWh === undefined || cutoffWh > 0) &&
    (maxCurrent === undefined || maxCurrent > 0) && (maxPower === undefined || maxPower > 0) &&
    (currentCapability?.max === undefined || targetCurrent <= currentCapability.max);
  const disabledClass = isRunning ? 'opacity-50 pointer-events-none' : '';
  const liveVoltage = deviceState?.measurements.voltage ?? testState?.voltage ?? 0;
  const liveCurrent = deviceState?.measurements.current ?? testState?.current ?? 0;
  const livePower = deviceState?.measurements.power ?? testState?.power ?? 0;
  const chartSamples = samples.length > 0 ? samples : idleChartSamples;

  return (
    <div className="h-[470px] bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] rounded-md p-3 flex flex-col">
      <div className="flex items-center justify-between mb-3 panel-drag-handle">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">Battery Tester</h2>
          <span className="text-xs text-[var(--color-text-muted)]">Software discharge</span>
        </div>
        <div className="flex gap-1">
          {onClose && <button onClick={onClose} aria-label="Close" className="w-6 h-6 rounded bg-[var(--color-border-light)] text-[var(--color-text-secondary)]">×</button>}
        </div>
      </div>

      {error && <div className="mb-3 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400 flex justify-between"><span>{error}</span><button onClick={clearError}>×</button></div>}

      <div className="flex gap-3 flex-1 min-h-0">
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="grid grid-cols-3 gap-2">
            {[
              ['Voltage', liveVoltage.toFixed(3), 'V'],
              ['Current', liveCurrent.toFixed(3), 'A'],
              ['Power', livePower.toFixed(3), 'W'],
              ['Capacity', (testState?.chargeMah ?? 0).toFixed(2), 'mAh'],
              ['Energy', (testState?.energyWh ?? 0).toFixed(4), 'Wh'],
              ['Duration', formatDuration(testState?.elapsedMs ?? 0), ''],
            ].map(([label, value, unit]) => (
              <div key={label.toString()} className="bg-[var(--color-bg-readings)] rounded px-2 py-1.5 text-center">
                <div className="text-[10px] uppercase text-[var(--color-text-secondary)]">{label}</div>
                <span className="font-mono text-lg font-bold">{value}</span>
                {unit && <span className="text-xs text-[var(--color-text-secondary)] ml-1">{unit}</span>}
              </div>
            ))}
          </div>
          <div className="px-1 py-1.5 text-right text-[10px] capitalize text-[var(--color-text-secondary)]">
            {testState?.executionState ?? 'Ready'}{testState?.terminationReason ? ` · ${testState.terminationReason.replace(/-/g, ' ')}` : ''}
          </div>
          <div className="flex-1 min-h-0 bg-[var(--color-bg-secondary)] rounded p-2">
            <BatteryTestChart samples={chartSamples} />
          </div>
          {isRunning && testState && <div className="text-[10px] text-right text-[var(--color-text-secondary)] pt-1">Commanded: {testState.commandedCurrent.toFixed(3)} A</div>}
        </div>

        <div className="w-64 flex-shrink-0 flex flex-col min-h-0">
          <div className={disabledClass}>
            <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Electronic load</label>
            <select value={deviceId} onChange={event => setDeviceId(event.target.value)} className="w-full px-2 py-1.5 mb-3 text-sm rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]">
              <option value="">Select...</option>
              {loads.map(load => <option key={load.id} value={load.id}>{load.info.manufacturer} {load.info.model}</option>)}
            </select>
            {remoteSensingSupported && (
              <label className="flex items-center justify-between gap-3 mb-3 px-2 py-1.5 rounded bg-[var(--color-bg-secondary)] text-xs cursor-pointer" title="Enable only when S+ and S− are connected directly at the battery terminals">
                <span>
                  <span className="block text-[var(--color-text-primary)]">Use remote sense</span>
                  <span className="text-[10px] text-[var(--color-text-muted)]">Sense leads must be connected</span>
                </span>
                <input type="checkbox" checked={remoteSensing} onChange={event => setRemoteSensing(event.target.checked)} className="accent-[var(--color-success)]" />
              </label>
            )}
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Min voltage" value={minVoltage} unit="V" min={0} onChange={setMinVoltage} />
              <NumberField label="Max voltage" value={maxVoltage} unit="V" min={0} onChange={setMaxVoltage} />
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <NumberField label="Target current" value={targetCurrent} unit="A" min={0} max={currentCapability?.max} onChange={setTargetCurrent} />
              <NumberField label="Ramp time" value={rampMinutes} unit="min" min={0} onChange={setRampMinutes} />
            </div>
            <div className="mt-2">
              <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)] mb-1">Stop conditions</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2"><OptionalNumberField label="Capacity removed" value={cutoffMah} unit="mAh" onChange={setCutoffMah} /></div>
                <div className="col-span-2"><OptionalNumberField label="Energy removed" value={cutoffWh} unit="Wh" onChange={setCutoffWh} /></div>
                <OptionalNumberField label="Max current" value={maxCurrent} unit="A" onChange={setMaxCurrent} />
                <OptionalNumberField label="Max power" value={maxPower} unit="W" onChange={setMaxPower} />
              </div>
            </div>
            <p className="text-[10px] leading-4 text-[var(--color-text-muted)] mt-2">Max voltage checks the battery at start. The first enabled cutoff reached stops the load.</p>
          </div>
          <div className="mt-auto">
            {isRunning ? <button onClick={stop} className="w-full px-3 py-2 text-sm rounded font-medium bg-red-600 hover:bg-red-700">Stop test</button> : <button disabled={!settingsValid || isStarting || serverSupported !== true} onClick={() => start({ deviceId, minVoltage, maxVoltage, targetCurrent, rampMinutes, remoteSensing: remoteSensingSupported && remoteSensing, cutoffMah, cutoffWh, maxCurrent, maxPower })} className="w-full px-3 py-2 text-sm rounded font-medium bg-[var(--color-success)] disabled:opacity-50">{isStarting ? 'Starting…' : serverSupported === null ? 'Checking server…' : serverSupported === false ? 'Server update required' : 'Start test'}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function NumberField({ label, value, unit, min, max, onChange }: { label: string; value: number; unit: string; min?: number; max?: number; onChange: (value: number) => void }) {
  return <label className="block text-xs text-[var(--color-text-secondary)]"><span className="block mb-1">{label}</span><div className="flex"><input type="number" step="any" min={min} max={max} value={value} onChange={event => onChange(event.target.valueAsNumber)} className="min-w-0 w-full px-2 py-1.5 text-sm rounded-l bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]" /><span className="px-1.5 py-1.5 rounded-r bg-[var(--color-border-dark)] text-[10px]">{unit}</span></div></label>;
}

function OptionalNumberField({ label, value, unit, onChange }: { label: string; value?: number; unit: string; onChange: (value?: number) => void }) {
  return <label className="block text-xs text-[var(--color-text-secondary)]"><span className="block mb-1">{label}</span><div className="flex"><input type="number" step="any" min={0} placeholder="Off" value={value ?? ''} onChange={event => onChange(event.target.value === '' ? undefined : event.target.valueAsNumber)} className="min-w-0 w-full px-2 py-1.5 text-sm rounded-l bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]" /><span className="px-1.5 py-1.5 rounded-r bg-[var(--color-border-dark)] text-[10px]">{unit}</span></div></label>;
}
