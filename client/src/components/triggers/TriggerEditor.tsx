/**
 * TriggerEditor - Editor for a single trigger
 *
 * Allows configuring:
 * - Condition (value-based or time-based)
 * - Action (setValue, setOutput, sequence control)
 * - Modifiers (once/repeat, debounce)
 */

import { useState, useCallback } from 'react';
import { useDeviceNames } from '../../hooks/useDeviceNames';
import type {
  Trigger,
  TriggerCondition,
  TriggerAction,
  TriggerOperator,
  TriggerRepeatMode,
  RepeatMode,
  DeviceSummary,
  SequenceDefinition,
} from '../../types';

interface TriggerEditorProps {
  trigger: Trigger;
  index: number;
  devices: DeviceSummary[];
  sequences: SequenceDefinition[];
  onChange: (trigger: Trigger) => void;
  onDelete: () => void;
  // Drag and drop
  onDragStart: (index: number) => void;
  onDragOver: (index: number) => void;
  onDragEnd: () => void;
  isDragTarget: boolean;
  isDragging: boolean;
}

const OPERATORS: { value: TriggerOperator; label: string }[] = [
  { value: '>', label: '>' },
  { value: '<', label: '<' },
  { value: '>=', label: '>=' },
  { value: '<=', label: '<=' },
  { value: '==', label: '==' },
  { value: '!=', label: '!=' },
];

export function TriggerEditor({
  trigger,
  index,
  devices,
  sequences,
  onChange,
  onDelete,
  onDragStart,
  onDragOver,
  onDragEnd,
  isDragTarget,
  isDragging,
  defaultExpanded = false,
}: TriggerEditorProps & { defaultExpanded?: boolean }) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { getCustomName } = useDeviceNames();

  // Drag handlers
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
    onDragStart(index);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    onDragOver(index);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    onDragEnd();
  };

  const handleDragEnd = () => {
    // Called when drag ends (success or cancel)
    onDragEnd();
  };

  // Normalize numeric input on blur (removes leading zeros like "010" -> "10")
  const normalizeNumericInput = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    const parsed = parseFloat(e.target.value);
    if (!isNaN(parsed)) {
      e.target.value = String(parsed);
    }
  }, []);

  const condition = trigger.condition;
  const action = trigger.action;

  // Helper to get device display name (custom name or model)
  const getDeviceName = (deviceId: string): string => {
    const device = devices.find((d) => d.id === deviceId);
    if (!device) return deviceId;
    const custom = getCustomName(device.info.manufacturer, device.info.model);
    return custom?.title || device.info.model;
  };

  // Get available parameters for the selected device (condition)
  const conditionDevice = condition.type === 'value'
    ? devices.find((d) => d.id === condition.deviceId)
    : null;
  const conditionParams = conditionDevice?.capabilities.measurements ?? [];

  // Get deviceId from actions that have it (setValue, setOutput, startSequence)
  const getActionDeviceId = (): string | undefined => {
    if (action.type === 'setValue') return action.deviceId;
    if (action.type === 'setOutput') return action.deviceId;
    if (action.type === 'startSequence') return action.deviceId;
    return undefined;
  };

  // Get available parameters for the action device
  const actionDeviceId = getActionDeviceId();
  const actionDevice = actionDeviceId ? devices.find((d) => d.id === actionDeviceId) : null;
  const actionParams = actionDevice?.capabilities.outputs ?? [];

  // Update condition
  const updateCondition = (updates: Partial<TriggerCondition>) => {
    onChange({
      ...trigger,
      condition: { ...condition, ...updates } as TriggerCondition,
    });
  };

  // Update action
  const updateAction = (updates: Partial<TriggerAction>) => {
    onChange({
      ...trigger,
      action: { ...action, ...updates } as TriggerAction,
    });
  };

  // Change condition type
  const setConditionType = (type: 'value' | 'time') => {
    if (type === 'time') {
      onChange({
        ...trigger,
        condition: { type: 'time', seconds: 5 },
      });
    } else {
      const firstDevice = devices[0];
      onChange({
        ...trigger,
        condition: {
          type: 'value',
          deviceId: firstDevice?.id ?? '',
          parameter: firstDevice?.capabilities.measurements[0]?.name ?? '',
          operator: '>',
          value: 0,
        },
      });
    }
  };

  // Change action type
  const setActionType = (type: TriggerAction['type']) => {
    const firstDevice = devices[0];
    const firstSequence = sequences[0];

    switch (type) {
      case 'setValue':
        onChange({
          ...trigger,
          action: {
            type: 'setValue',
            deviceId: firstDevice?.id ?? '',
            parameter: firstDevice?.capabilities.outputs[0]?.name ?? '',
            value: 0,
          },
        });
        break;
      case 'setOutput':
        onChange({
          ...trigger,
          action: {
            type: 'setOutput',
            deviceId: firstDevice?.id ?? '',
            enabled: true,
          },
        });
        break;
      case 'setMode':
        onChange({
          ...trigger,
          action: {
            type: 'setMode',
            deviceId: firstDevice?.id ?? '',
            mode: firstDevice?.capabilities.modes[0] ?? '',
          },
        });
        break;
      case 'startSequence':
        onChange({
          ...trigger,
          action: {
            type: 'startSequence',
            sequenceId: firstSequence?.id ?? '',
            deviceId: firstDevice?.id ?? '',
            parameter: firstDevice?.capabilities.outputs[0]?.name ?? '',
            repeatMode: 'once',
          },
        });
        break;
      case 'stopSequence':
        onChange({
          ...trigger,
          action: { type: 'stopSequence' },
        });
        break;
      case 'pauseSequence':
        onChange({
          ...trigger,
          action: { type: 'pauseSequence' },
        });
        break;
    }
  };

  return (
    <div
      className="relative"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drop indicator line - shows above when this is the drop target */}
      {isDragTarget && (
        <div className="absolute -top-1.5 left-0 right-0 flex items-center z-10">
          <div className="w-3 h-3 rounded-full bg-blue-500 -ml-1.5" />
          <div className="flex-1 h-0.5 bg-blue-500" />
          <div className="w-3 h-3 rounded-full bg-blue-500 -mr-1.5" />
        </div>
      )}

      <div
        className={`bg-[var(--color-bg-secondary)] rounded border border-[var(--color-border-light)] mb-3 transition-opacity duration-150 ${
          isDragging ? 'opacity-40' : ''
        }`}
      >
        {/* Header - compact summary */}
        {confirmingDelete ? (
          <div className="flex items-center justify-between px-3 py-2 bg-[var(--color-danger)]/10">
            <span className="text-xs text-[var(--color-danger)]">Delete this trigger?</span>
            <div className="flex items-center gap-2">
              <button
                className="text-xs px-3 py-1 rounded bg-[var(--color-bg-panel)] hover:bg-[var(--color-border-dark)]"
                onClick={() => setConfirmingDelete(false)}
              >
                Cancel
              </button>
              <button
                className="text-xs px-3 py-1 rounded bg-[var(--color-danger)] text-white hover:opacity-80"
                onClick={() => onDelete()}
              >
                Delete
              </button>
            </div>
          </div>
        ) : (
          <div
            draggable
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            className="flex items-center gap-1 py-2 pr-3 cursor-grab active:cursor-grabbing"
          >
            {/* Drag handle icon */}
            <div
              className="px-2 py-1 text-[var(--color-text-muted)]"
              title="Drag to reorder"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <circle cx="3" cy="2" r="1.5" />
                <circle cx="9" cy="2" r="1.5" />
                <circle cx="3" cy="6" r="1.5" />
                <circle cx="9" cy="6" r="1.5" />
                <circle cx="3" cy="10" r="1.5" />
                <circle cx="9" cy="10" r="1.5" />
              </svg>
            </div>

            {/* Expand/collapse and summary */}
            <div
              className="flex items-center gap-2 min-w-0 flex-1 hover:bg-[var(--color-bg-panel)] rounded px-1 py-1"
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }}
            >
            <span className="text-xs text-[var(--color-text-secondary)] flex-shrink-0">
              {isExpanded ? '▼' : '▶'}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">
                {condition.type === 'time'
                  ? `At t=${condition.seconds}s`
                  : `When ${getDeviceName(condition.deviceId)} ${condition.parameter} ${condition.operator} ${condition.value}`}
              </div>
              {!isExpanded && (
                <div className="text-xs text-[var(--color-text-secondary)] truncate">
                  → {action.type === 'setValue'
                    ? `${getDeviceName(action.deviceId)} ${action.parameter} = ${action.value}`
                    : action.type === 'setOutput'
                    ? `${getDeviceName(action.deviceId)} output ${action.enabled ? 'ON' : 'OFF'}`
                    : action.type === 'setMode'
                    ? `${getDeviceName(action.deviceId)} mode → ${action.mode}`
                    : action.type === 'startSequence'
                    ? `Start ${sequences.find(s => s.id === action.sequenceId)?.name ?? 'sequence'} on ${getDeviceName(action.deviceId)}`
                    : action.type === 'stopSequence'
                    ? 'Stop sequence'
                    : 'Pause sequence'}
                </div>
              )}
            </div>
          </div>
          <button
            className="text-xs px-1.5 py-0.5 rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-danger)]/20 hover:text-[var(--color-danger)] flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmingDelete(true);
            }}
            title="Delete trigger"
          >
            ×
          </button>
        </div>
      )}

      {/* Body - animated expand/collapse using CSS grid */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="px-3 pb-3 space-y-3 border-t border-[var(--color-border-light)]">
            {/* Condition */}
            <div className="pt-3">
            <label className="block text-xs text-[var(--color-text-secondary)] mb-1 font-medium">
              WHEN
            </label>

            {/* Condition type selector */}
            <div className="flex gap-2 mb-2">
              <button
                className={`text-xs px-3 py-1.5 rounded font-medium ${
                  condition.type === 'value'
                    ? 'bg-blue-600 text-white'
                    : 'bg-[var(--color-bg-panel)] text-[var(--color-text-secondary)]'
                }`}
                onClick={() => setConditionType('value')}
              >
                Value
              </button>
              <button
                className={`text-xs px-3 py-1.5 rounded font-medium ${
                  condition.type === 'time'
                    ? 'bg-blue-600 text-white'
                    : 'bg-[var(--color-bg-panel)] text-[var(--color-text-secondary)]'
                }`}
                onClick={() => setConditionType('time')}
              >
                Time
              </button>
            </div>

            {condition.type === 'value' ? (
              <div className="flex gap-2 items-center flex-wrap">
                <select
                  className="text-xs px-2 py-1 rounded"
                  value={condition.deviceId}
                  onChange={(e) => updateCondition({ deviceId: e.target.value })}
                >
                  <option value="">Device...</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {getDeviceName(d.id)}
                    </option>
                  ))}
                </select>

                <select
                  className="text-xs px-2 py-1 rounded"
                  value={condition.parameter}
                  onChange={(e) => updateCondition({ parameter: e.target.value })}
                >
                  {conditionParams.length === 0 ? (
                    <option value="">Select device first</option>
                  ) : (
                    conditionParams.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name}
                      </option>
                    ))
                  )}
                </select>

                <select
                  className="text-xs px-2 py-1 rounded w-14"
                  value={condition.operator}
                  onChange={(e) =>
                    updateCondition({ operator: e.target.value as TriggerOperator })
                  }
                >
                  {OPERATORS.map((op) => (
                    <option key={op.value} value={op.value}>
                      {op.label}
                    </option>
                  ))}
                </select>

                <input
                  type="number"
                  className="text-xs px-2 py-1 rounded w-20"
                  value={condition.value}
                  onChange={(e) =>
                    updateCondition({ value: parseFloat(e.target.value) || 0 })
                  }
                  onBlur={normalizeNumericInput}
                />
              </div>
            ) : (
              <div className="flex gap-2 items-center">
                <span className="text-xs">At t =</span>
                <input
                  type="number"
                  className="text-xs px-2 py-1 rounded w-20"
                  value={condition.seconds}
                  min={0}
                  step={0.1}
                  onChange={(e) =>
                    updateCondition({ seconds: parseFloat(e.target.value) || 0 })
                  }
                  onBlur={normalizeNumericInput}
                />
                <span className="text-xs">seconds</span>
              </div>
            )}
          </div>

          {/* Action */}
          <div>
            <label className="block text-xs text-[var(--color-text-secondary)] mb-1 font-medium">
              THEN
            </label>

            {/* Action type selector */}
            <div className="flex gap-1 mb-2 flex-wrap">
              {(['setValue', 'setOutput', 'setMode', 'startSequence', 'stopSequence'] as const).map(
                (type) => (
                  <button
                    key={type}
                    className={`text-xs px-2 py-1.5 rounded font-medium ${
                      action.type === type
                        ? 'bg-blue-600 text-white'
                        : 'bg-[var(--color-bg-panel)] text-[var(--color-text-secondary)]'
                    }`}
                    onClick={() => setActionType(type)}
                  >
                    {type === 'setValue'
                      ? 'Set Value'
                      : type === 'setOutput'
                      ? 'Output'
                      : type === 'setMode'
                      ? 'Set Mode'
                      : type === 'startSequence'
                      ? 'Start Seq'
                      : 'Stop Seq'}
                  </button>
                )
              )}
            </div>

            {/* Action config */}
            {action.type === 'setValue' && (
              <div className="flex gap-2 items-center flex-wrap">
                <select
                  className="text-xs px-2 py-1 rounded"
                  value={action.deviceId}
                  onChange={(e) => updateAction({ deviceId: e.target.value })}
                >
                  <option value="">Device...</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {getDeviceName(d.id)}
                    </option>
                  ))}
                </select>

                <select
                  className="text-xs px-2 py-1 rounded"
                  value={action.parameter}
                  onChange={(e) => updateAction({ parameter: e.target.value })}
                >
                  {actionParams.length === 0 ? (
                    <option value="">Select device first</option>
                  ) : (
                    actionParams.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name}
                      </option>
                    ))
                  )}
                </select>

                <span className="text-xs">=</span>

                <input
                  type="number"
                  className="text-xs px-2 py-1 rounded w-20"
                  value={action.value}
                  onChange={(e) =>
                    updateAction({ value: parseFloat(e.target.value) || 0 })
                  }
                  onBlur={normalizeNumericInput}
                />
              </div>
            )}

            {action.type === 'setOutput' && (
              <div className="flex gap-2 items-center">
                <select
                  className="text-xs px-2 py-1 rounded"
                  value={action.deviceId}
                  onChange={(e) => updateAction({ deviceId: e.target.value })}
                >
                  <option value="">Device...</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {getDeviceName(d.id)}
                    </option>
                  ))}
                </select>

                <span className="text-xs">output</span>

                <select
                  className="text-xs px-2 py-1 rounded"
                  value={action.enabled ? 'on' : 'off'}
                  onChange={(e) => updateAction({ enabled: e.target.value === 'on' })}
                >
                  <option value="on">ON</option>
                  <option value="off">OFF</option>
                </select>
              </div>
            )}

            {action.type === 'setMode' && (
              <div className="flex gap-2 items-center flex-wrap">
                <select
                  className="text-xs px-2 py-1 rounded"
                  value={action.deviceId}
                  onChange={(e) => {
                    const newDevice = devices.find((d) => d.id === e.target.value);
                    updateAction({
                      deviceId: e.target.value,
                      mode: newDevice?.capabilities.modes[0] ?? '',
                    });
                  }}
                >
                  <option value="">Device...</option>
                  {devices.filter((d) => d.capabilities.modesSettable).map((d) => (
                    <option key={d.id} value={d.id}>
                      {getDeviceName(d.id)}
                    </option>
                  ))}
                </select>

                <span className="text-xs">mode</span>

                <select
                  className="text-xs px-2 py-1 rounded"
                  value={action.mode}
                  onChange={(e) => updateAction({ mode: e.target.value })}
                >
                  {(devices.find((d) => d.id === action.deviceId)?.capabilities.modes ?? []).map(
                    (m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    )
                  )}
                </select>
              </div>
            )}

            {action.type === 'startSequence' && (
              <div className="flex gap-2 items-center flex-wrap">
                <select
                  className="text-xs px-2 py-1 rounded"
                  value={action.sequenceId}
                  onChange={(e) => updateAction({ sequenceId: e.target.value })}
                >
                  <option value="">Sequence...</option>
                  {sequences.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>

                <span className="text-xs">on</span>

                <select
                  className="text-xs px-2 py-1 rounded"
                  value={action.deviceId}
                  onChange={(e) => updateAction({ deviceId: e.target.value })}
                >
                  <option value="">Device...</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {getDeviceName(d.id)}
                    </option>
                  ))}
                </select>

                <select
                  className="text-xs px-2 py-1 rounded"
                  value={action.parameter}
                  onChange={(e) => updateAction({ parameter: e.target.value })}
                >
                  {actionParams.length === 0 ? (
                    <option value="">Select device first</option>
                  ) : (
                    actionParams.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name}
                      </option>
                    ))
                  )}
                </select>

                <select
                  className="text-xs px-2 py-1 rounded"
                  value={action.repeatMode}
                  onChange={(e) => updateAction({ repeatMode: e.target.value as RepeatMode })}
                >
                  <option value="once">Once</option>
                  <option value="count">Count</option>
                  <option value="continuous">Continuous</option>
                </select>

                {action.repeatMode === 'count' && (
                  <input
                    type="number"
                    className="text-xs px-2 py-1 rounded w-16"
                    value={action.repeatCount ?? 1}
                    min={1}
                    onChange={(e) => updateAction({ repeatCount: parseInt(e.target.value) || 1 })}
                    onBlur={normalizeNumericInput}
                    placeholder="×"
                  />
                )}
              </div>
            )}

            {action.type === 'stopSequence' && (
              <div className="text-xs text-[var(--color-text-secondary)]">
                Stops any running sequence
              </div>
            )}
          </div>

          {/* Modifiers - only show for value-based triggers */}
          {condition.type === 'value' && (
            <div className="flex gap-4 items-center">
              <div className="flex items-center gap-2">
                <label className="text-xs text-[var(--color-text-secondary)]">Mode:</label>
                <select
                  className="text-xs px-2 py-1 rounded"
                  value={trigger.repeatMode}
                  onChange={(e) =>
                    onChange({
                      ...trigger,
                      repeatMode: e.target.value as TriggerRepeatMode,
                    })
                  }
                >
                  <option value="once">Once</option>
                  <option value="repeat">Repeat</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <label className="text-xs text-[var(--color-text-secondary)]">
                  Debounce:
                </label>
                <input
                  type="number"
                  className="text-xs px-2 py-1 rounded w-16"
                  value={trigger.debounceMs}
                min={0}
                step={100}
                onChange={(e) =>
                  onChange({
                    ...trigger,
                    debounceMs: parseInt(e.target.value) || 0,
                  })
                }
                onBlur={normalizeNumericInput}
              />
              <span className="text-xs text-[var(--color-text-secondary)]">ms</span>
            </div>
          </div>
          )}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
