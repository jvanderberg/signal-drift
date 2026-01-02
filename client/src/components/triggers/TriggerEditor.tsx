/**
 * TriggerEditor - Editor for a single trigger
 *
 * Allows configuring:
 * - Condition (value-based or time-based)
 * - Action (setValue, setOutput, sequence control)
 * - Modifiers (once/repeat, debounce)
 */

import { useState } from 'react';
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
  devices: DeviceSummary[];
  sequences: SequenceDefinition[];
  onChange: (trigger: Trigger) => void;
  onDelete: () => void;
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
  devices,
  sequences,
  onChange,
  onDelete,
}: TriggerEditorProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const condition = trigger.condition;
  const action = trigger.action;

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
    <div className="bg-[var(--color-bg-secondary)] rounded border border-[var(--color-border-dark)] mb-2">
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-[var(--color-bg-panel)]"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--color-text-secondary)]">
            {isExpanded ? '▼' : '▶'}
          </span>
          <span className="text-sm font-medium">
            {condition.type === 'time'
              ? `At t=${condition.seconds}s`
              : `When ${condition.parameter} ${condition.operator} ${condition.value}`}
          </span>
        </div>
        <button
          className="text-xs px-2 py-1 rounded bg-[var(--color-danger)] text-white hover:opacity-80"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          Delete
        </button>
      </div>

      {/* Body */}
      {isExpanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-[var(--color-border-dark)]">
          {/* Condition */}
          <div className="pt-3">
            <label className="block text-xs text-[var(--color-text-secondary)] mb-1 font-medium">
              WHEN
            </label>

            {/* Condition type selector */}
            <div className="flex gap-2 mb-2">
              <button
                className={`text-xs px-2 py-1 rounded ${
                  condition.type === 'value'
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'bg-[var(--color-bg-panel)]'
                }`}
                onClick={() => setConditionType('value')}
              >
                Value
              </button>
              <button
                className={`text-xs px-2 py-1 rounded ${
                  condition.type === 'time'
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'bg-[var(--color-bg-panel)]'
                }`}
                onClick={() => setConditionType('time')}
              >
                Time
              </button>
            </div>

            {condition.type === 'value' ? (
              <div className="flex gap-2 items-center flex-wrap">
                <select
                  className="text-xs px-2 py-1 rounded bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)]"
                  value={condition.deviceId}
                  onChange={(e) => updateCondition({ deviceId: e.target.value })}
                >
                  <option value="">Device...</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.info.manufacturer} {d.info.model}
                    </option>
                  ))}
                </select>

                <select
                  className="text-xs px-2 py-1 rounded bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)]"
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
                  className="text-xs px-2 py-1 rounded bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] w-14"
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
                  className="text-xs px-2 py-1 rounded bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] w-20"
                  value={condition.value}
                  onChange={(e) =>
                    updateCondition({ value: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
            ) : (
              <div className="flex gap-2 items-center">
                <span className="text-xs">At t =</span>
                <input
                  type="number"
                  className="text-xs px-2 py-1 rounded bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] w-20"
                  value={condition.seconds}
                  min={0}
                  step={0.1}
                  onChange={(e) =>
                    updateCondition({ seconds: parseFloat(e.target.value) || 0 })
                  }
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
              {(['setValue', 'setOutput', 'startSequence', 'stopSequence'] as const).map(
                (type) => (
                  <button
                    key={type}
                    className={`text-xs px-2 py-1 rounded ${
                      action.type === type
                        ? 'bg-[var(--color-accent)] text-white'
                        : 'bg-[var(--color-bg-panel)]'
                    }`}
                    onClick={() => setActionType(type)}
                  >
                    {type === 'setValue'
                      ? 'Set Value'
                      : type === 'setOutput'
                      ? 'Output On/Off'
                      : type === 'startSequence'
                      ? 'Start Sequence'
                      : 'Stop Sequence'}
                  </button>
                )
              )}
            </div>

            {/* Action config */}
            {action.type === 'setValue' && (
              <div className="flex gap-2 items-center flex-wrap">
                <select
                  className="text-xs px-2 py-1 rounded bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)]"
                  value={action.deviceId}
                  onChange={(e) => updateAction({ deviceId: e.target.value })}
                >
                  <option value="">Device...</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.info.manufacturer} {d.info.model}
                    </option>
                  ))}
                </select>

                <select
                  className="text-xs px-2 py-1 rounded bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)]"
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
                  className="text-xs px-2 py-1 rounded bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] w-20"
                  value={action.value}
                  onChange={(e) =>
                    updateAction({ value: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
            )}

            {action.type === 'setOutput' && (
              <div className="flex gap-2 items-center">
                <select
                  className="text-xs px-2 py-1 rounded bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)]"
                  value={action.deviceId}
                  onChange={(e) => updateAction({ deviceId: e.target.value })}
                >
                  <option value="">Device...</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.info.manufacturer} {d.info.model}
                    </option>
                  ))}
                </select>

                <span className="text-xs">output</span>

                <select
                  className="text-xs px-2 py-1 rounded bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)]"
                  value={action.enabled ? 'on' : 'off'}
                  onChange={(e) => updateAction({ enabled: e.target.value === 'on' })}
                >
                  <option value="on">ON</option>
                  <option value="off">OFF</option>
                </select>
              </div>
            )}

            {action.type === 'startSequence' && (
              <div className="flex gap-2 items-center flex-wrap">
                <select
                  className="text-xs px-2 py-1 rounded bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)]"
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
                  className="text-xs px-2 py-1 rounded bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)]"
                  value={action.deviceId}
                  onChange={(e) => updateAction({ deviceId: e.target.value })}
                >
                  <option value="">Device...</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.info.manufacturer} {d.info.model}
                    </option>
                  ))}
                </select>

                <select
                  className="text-xs px-2 py-1 rounded bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)]"
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
                  className="text-xs px-2 py-1 rounded bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)]"
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
                    className="text-xs px-2 py-1 rounded bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] w-16"
                    value={action.repeatCount ?? 1}
                    min={1}
                    onChange={(e) => updateAction({ repeatCount: parseInt(e.target.value) || 1 })}
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

          {/* Modifiers */}
          <div className="flex gap-4 items-center">
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--color-text-secondary)]">Mode:</label>
              <select
                className="text-xs px-2 py-1 rounded bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)]"
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
                className="text-xs px-2 py-1 rounded bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] w-16"
                value={trigger.debounceMs}
                min={0}
                step={100}
                onChange={(e) =>
                  onChange({
                    ...trigger,
                    debounceMs: parseInt(e.target.value) || 0,
                  })
                }
              />
              <span className="text-xs text-[var(--color-text-secondary)]">ms</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
