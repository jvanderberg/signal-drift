/**
 * SequenceEditor - Full edit mode for creating/editing sequences
 *
 * Replaces the entire SequencePanel content when in edit mode.
 * Includes live preview chart that updates as you edit.
 */

import { useState, useMemo } from 'react';
import { useSequencer } from '../../hooks/useSequencer';
import { SequenceChart } from './SequenceChart';
import type {
  SequenceDefinition,
  WaveformType,
  WaveformParams,
  ArbitraryWaveform,
  SequenceStep,
} from '../../types';

interface SequenceEditorProps {
  /** Sequence to edit, or null for creating new */
  sequence: SequenceDefinition | null;
  /** Called when save is clicked */
  onSave: () => void;
  /** Called when cancel is clicked */
  onCancel: () => void;
}

interface FormState {
  name: string;
  unit: string;
  waveformType: WaveformType | 'arbitrary';
  min: number;
  max: number;
  pointsPerCycle: number;
  intervalMs: number;
  arbitrarySteps: string;
  preValue: string;
  postValue: string;
  scale: string;
  offset: string;
  maxClamp: string;
}

const defaultFormState: FormState = {
  name: '',
  unit: 'V',
  waveformType: 'sine',
  min: 0,
  max: 10,
  pointsPerCycle: 20,
  intervalMs: 100,
  arbitrarySteps: '0,100\n5,100\n10,100\n5,100',
  preValue: '',
  postValue: '',
  scale: '',
  offset: '',
  maxClamp: '',
};

const WAVEFORM_TYPES: { value: WaveformType | 'arbitrary'; label: string }[] = [
  { value: 'sine', label: 'Sine' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'ramp', label: 'Ramp' },
  { value: 'square', label: 'Square' },
  { value: 'steps', label: 'Linear Steps' },
  { value: 'arbitrary', label: 'Arbitrary (CSV)' },
];

const UNITS: { value: string; label: string }[] = [
  { value: 'V', label: 'Volts (V)' },
  { value: 'A', label: 'Amps (A)' },
  { value: 'W', label: 'Watts (W)' },
  { value: 'Ω', label: 'Ohms (Ω)' },
];

function parseArbitrarySteps(csv: string): SequenceStep[] | null {
  const lines = csv.trim().split('\n');
  const steps: SequenceStep[] = [];

  for (const line of lines) {
    const parts = line.split(',').map((s) => s.trim());
    if (parts.length < 2) continue;

    const value = parseFloat(parts[0]);
    const dwellMs = parseFloat(parts[1]);

    if (isNaN(value) || isNaN(dwellMs) || dwellMs <= 0) {
      return null;
    }

    steps.push({ value, dwellMs });
  }

  return steps.length > 0 ? steps : null;
}

function isArbitrary(waveform: WaveformParams | ArbitraryWaveform): waveform is ArbitraryWaveform {
  return 'steps' in waveform;
}

function definitionToForm(def: SequenceDefinition): FormState {
  const form: FormState = { ...defaultFormState };

  form.name = def.name;
  form.unit = def.unit;

  if (isArbitrary(def.waveform)) {
    form.waveformType = 'arbitrary';
    form.arbitrarySteps = def.waveform.steps
      .map((s) => `${s.value},${s.dwellMs}`)
      .join('\n');
  } else {
    form.waveformType = def.waveform.type;
    form.min = def.waveform.min;
    form.max = def.waveform.max;
    form.pointsPerCycle = def.waveform.pointsPerCycle;
    form.intervalMs = def.waveform.intervalMs;
  }

  if (def.preValue !== undefined) form.preValue = String(def.preValue);
  if (def.postValue !== undefined) form.postValue = String(def.postValue);
  if (def.scale !== undefined) form.scale = String(def.scale);
  if (def.offset !== undefined) form.offset = String(def.offset);
  if (def.maxClamp !== undefined) form.maxClamp = String(def.maxClamp);

  return form;
}

function formToDefinition(
  form: FormState
): Omit<SequenceDefinition, 'id' | 'createdAt' | 'updatedAt'> | null {
  let waveform: WaveformParams | ArbitraryWaveform;

  if (form.waveformType === 'arbitrary') {
    const steps = parseArbitrarySteps(form.arbitrarySteps);
    if (!steps) return null;
    waveform = { steps };
  } else {
    waveform = {
      type: form.waveformType,
      min: form.min,
      max: form.max,
      pointsPerCycle: form.pointsPerCycle,
      intervalMs: form.intervalMs,
    };
  }

  const definition: Omit<SequenceDefinition, 'id' | 'createdAt' | 'updatedAt'> = {
    name: form.name || 'Untitled',
    unit: form.unit,
    waveform,
  };

  if (form.preValue.trim()) {
    const val = parseFloat(form.preValue);
    if (!isNaN(val)) definition.preValue = val;
  }
  if (form.postValue.trim()) {
    const val = parseFloat(form.postValue);
    if (!isNaN(val)) definition.postValue = val;
  }
  if (form.scale.trim()) {
    const val = parseFloat(form.scale);
    if (!isNaN(val)) definition.scale = val;
  }
  if (form.offset.trim()) {
    const val = parseFloat(form.offset);
    if (!isNaN(val)) definition.offset = val;
  }
  if (form.maxClamp.trim()) {
    const val = parseFloat(form.maxClamp);
    if (!isNaN(val)) definition.maxClamp = val;
  }

  return definition;
}

export function SequenceEditor({ sequence, onSave, onCancel }: SequenceEditorProps) {
  const { library, saveSequence, updateSequence, deleteSequence } = useSequencer();

  const [form, setForm] = useState<FormState>(
    sequence ? definitionToForm(sequence) : defaultFormState
  );
  const [error, setError] = useState<string | null>(null);

  const updateForm = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
  };

  // Build preview sequence definition for the chart
  const previewSequence = useMemo((): SequenceDefinition | null => {
    const def = formToDefinition(form);
    if (!def) return null;
    return {
      ...def,
      id: sequence?.id || 'preview',
      createdAt: sequence?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
  }, [form, sequence]);

  // Preview duration
  const previewDuration = useMemo(() => {
    if (form.waveformType === 'arbitrary') {
      const steps = parseArbitrarySteps(form.arbitrarySteps);
      if (!steps) return null;
      return steps.reduce((sum, s) => sum + s.dwellMs, 0);
    }
    return form.pointsPerCycle * form.intervalMs;
  }, [form]);

  const handleSave = () => {
    const definition = formToDefinition(form);
    if (!definition) {
      setError('Invalid form data. Check arbitrary steps format (value,dwellMs per line).');
      return;
    }

    if (sequence) {
      // Update existing
      updateSequence({
        ...definition,
        id: sequence.id,
        createdAt: sequence.createdAt,
        updatedAt: Date.now(),
      });
    } else {
      // Create new
      saveSequence(definition);
    }

    onSave();
  };

  const handleDelete = () => {
    if (sequence && confirm('Delete this sequence?')) {
      deleteSequence(sequence.id);
      onCancel();
    }
  };

  return (
    <div className="h-[470px] bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] rounded-md p-3 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3 flex-shrink-0">
        <h2 className="text-sm font-medium">
          {sequence ? 'Edit Sequence' : 'New Sequence'}
        </h2>
        <div className="flex items-center gap-1">
          <button
            className="text-xs px-2 py-1 rounded bg-[var(--color-success)] hover:bg-[var(--color-success)]/80 transition-colors"
            onClick={handleSave}
            title="Save"
          >
            ✓ Save
          </button>
          <button
            className="text-xs px-2 py-1 rounded bg-[var(--color-bg-secondary)] hover:bg-[var(--color-border-dark)] transition-colors"
            onClick={onCancel}
            title="Cancel"
          >
            ✕ Cancel
          </button>
          {sequence && (
            <button
              className="text-xs px-2 py-1 rounded bg-red-500/30 hover:bg-red-500/50 text-red-300 transition-colors"
              onClick={handleDelete}
              title="Delete sequence"
            >
              ✗ Delete
            </button>
          )}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="mb-3 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400 flex-shrink-0">
          {error}
        </div>
      )}

      {/* Main content: Form left, Preview right */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Form - left side */}
        <div className="w-56 flex-shrink-0 overflow-y-auto">
          <div className="grid grid-cols-2 gap-x-2 gap-y-2">
            {/* Name - spans both columns */}
            <div className="col-span-2">
              <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => updateForm('name', e.target.value)}
                placeholder="My Sequence"
                className="w-full px-2 py-1 text-xs rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
              />
            </div>

            {/* Unit */}
            <div>
              <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Unit</label>
              <select
                value={form.unit}
                onChange={(e) => updateForm('unit', e.target.value)}
                className="w-full px-2 py-1 text-xs rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
              >
                {UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Waveform type */}
            <div>
              <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Waveform</label>
              <select
                value={form.waveformType}
                onChange={(e) => updateForm('waveformType', e.target.value as WaveformType | 'arbitrary')}
                className="w-full px-2 py-1 text-xs rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
              >
                {WAVEFORM_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Standard waveform params */}
            {form.waveformType !== 'arbitrary' && (
              <>
                <div>
                  <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Min</label>
                  <input
                    type="number"
                    value={form.min}
                    onChange={(e) => updateForm('min', parseFloat(e.target.value) || 0)}
                    className="w-full px-2 py-1 text-xs rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Max</label>
                  <input
                    type="number"
                    value={form.max}
                    onChange={(e) => updateForm('max', parseFloat(e.target.value) || 0)}
                    className="w-full px-2 py-1 text-xs rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Points</label>
                  <input
                    type="number"
                    min={2}
                    value={form.pointsPerCycle}
                    onChange={(e) => updateForm('pointsPerCycle', parseInt(e.target.value) || 2)}
                    className="w-full px-2 py-1 text-xs rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Interval (ms)</label>
                  <input
                    type="number"
                    min={50}
                    value={form.intervalMs}
                    onChange={(e) => updateForm('intervalMs', parseInt(e.target.value) || 100)}
                    className="w-full px-2 py-1 text-xs rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
                  />
                </div>
              </>
            )}

            {/* Arbitrary steps - spans both columns */}
            {form.waveformType === 'arbitrary' && (
              <div className="col-span-2">
                <label className="block text-xs text-[var(--color-text-secondary)] mb-1">
                  Steps (value,dwellMs)
                </label>
                <textarea
                  value={form.arbitrarySteps}
                  onChange={(e) => updateForm('arbitrarySteps', e.target.value)}
                  placeholder="0,100&#10;5,100&#10;10,100"
                  rows={6}
                  className="w-full px-2 py-1 text-xs font-mono rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
                />
              </div>
            )}

            {/* Pre/Post values */}
            <div>
              <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Pre-Value</label>
              <input
                type="text"
                value={form.preValue}
                onChange={(e) => updateForm('preValue', e.target.value)}
                placeholder="—"
                className="w-full px-2 py-1 text-xs rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Post-Value</label>
              <input
                type="text"
                value={form.postValue}
                onChange={(e) => updateForm('postValue', e.target.value)}
                placeholder="—"
                className="w-full px-2 py-1 text-xs rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
              />
            </div>

            {/* Scale/Offset */}
            <div>
              <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Scale</label>
              <input
                type="text"
                value={form.scale}
                onChange={(e) => updateForm('scale', e.target.value)}
                placeholder="1.0"
                className="w-full px-2 py-1 text-xs rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Offset</label>
              <input
                type="text"
                value={form.offset}
                onChange={(e) => updateForm('offset', e.target.value)}
                placeholder="0"
                className="w-full px-2 py-1 text-xs rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
              />
            </div>

            {/* Max Clamp */}
            <div className="col-span-2">
              <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Max Clamp</label>
              <input
                type="text"
                value={form.maxClamp}
                onChange={(e) => updateForm('maxClamp', e.target.value)}
                placeholder="—"
                className="w-full px-2 py-1 text-xs rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
              />
            </div>

            {/* Duration preview */}
            {previewDuration !== null && (
              <div className="col-span-2 text-xs text-[var(--color-text-secondary)] mt-1">
                Cycle duration: {(previewDuration / 1000).toFixed(2)}s
              </div>
            )}
          </div>
        </div>

        {/* Preview chart - right side */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="text-xs text-[var(--color-text-secondary)] mb-2 flex-shrink-0">Preview</div>
          <div className="flex-1 min-h-0">
            {previewSequence ? (
              <SequenceChart sequence={previewSequence} activeState={null} />
            ) : (
              <div className="h-full flex items-center justify-center bg-[var(--color-bg-secondary)] rounded text-xs text-[var(--color-text-secondary)]">
                Invalid configuration
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
