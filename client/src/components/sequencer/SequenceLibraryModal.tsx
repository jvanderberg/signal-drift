/**
 * SequenceLibraryModal - Create/Edit/Delete sequences
 *
 * Two views:
 * - List view: Shows all sequences with edit/delete actions
 * - Edit view: Form for creating or editing a sequence
 */

import { useState, useMemo } from 'react';
import { useSequencer } from '../../hooks/useSequencer';
import type {
  SequenceDefinition,
  WaveformType,
  WaveformParams,
  ArbitraryWaveform,
} from '../../types';
import { isArbitrary, parseArbitraryStepsCSV, stepsToCSV, calculateDuration } from '../../types';

interface SequenceLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ViewMode = 'list' | 'edit';

interface FormState {
  name: string;
  unit: string;
  waveformType: WaveformType | 'arbitrary';
  // Standard waveform params
  min: number;
  max: number;
  pointsPerCycle: number;
  intervalMs: number;
  // Arbitrary steps (CSV or table)
  arbitrarySteps: string;
  // Modifiers
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

const UNITS = ['V', 'A', 'W', 'Ω'];

function formToDefinition(
  form: FormState,
  existingId?: string
): Omit<SequenceDefinition, 'id' | 'createdAt' | 'updatedAt'> | null {
  let waveform: WaveformParams | ArbitraryWaveform;

  if (form.waveformType === 'arbitrary') {
    const steps = parseArbitraryStepsCSV(form.arbitrarySteps);
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

  // Optional modifiers
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

function definitionToForm(def: SequenceDefinition): FormState {
  const form: FormState = { ...defaultFormState };

  form.name = def.name;
  form.unit = def.unit;

  if (isArbitrary(def.waveform)) {
    form.waveformType = 'arbitrary';
    form.arbitrarySteps = stepsToCSV(def.waveform.steps);
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

export function SequenceLibraryModal({ isOpen, onClose }: SequenceLibraryModalProps) {
  const { library, saveSequence, updateSequence, deleteSequence } = useSequencer();

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(defaultFormState);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = () => {
    setForm(defaultFormState);
    setEditingId(null);
    setViewMode('edit');
    setError(null);
  };

  const handleEdit = (sequence: SequenceDefinition) => {
    setForm(definitionToForm(sequence));
    setEditingId(sequence.id);
    setViewMode('edit');
    setError(null);
  };

  const handleDelete = (sequenceId: string) => {
    if (confirm('Delete this sequence?')) {
      deleteSequence(sequenceId);
    }
  };

  const handleSave = () => {
    const definition = formToDefinition(form);
    if (!definition) {
      setError('Invalid form data. Check arbitrary steps format (value,dwellMs per line).');
      return;
    }

    if (editingId) {
      // Update existing
      const existing = library.find((s) => s.id === editingId);
      if (existing) {
        updateSequence({
          ...definition,
          id: existing.id,
          createdAt: existing.createdAt,
          updatedAt: Date.now(),
        });
      }
    } else {
      // Create new
      saveSequence(definition);
    }

    setViewMode('list');
    setEditingId(null);
  };

  const handleCancel = () => {
    setViewMode('list');
    setEditingId(null);
    setError(null);
  };

  const updateForm = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
  };

  // Preview duration
  const previewDuration = useMemo(() => {
    if (form.waveformType === 'arbitrary') {
      const steps = parseArbitraryStepsCSV(form.arbitrarySteps);
      if (!steps) return null;
      return calculateDuration(steps);
    }
    return form.pointsPerCycle * form.intervalMs;
  }, [form]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-dark)]">
          <h2 className="text-sm font-medium">
            {viewMode === 'list' ? 'Sequence Library' : editingId ? 'Edit Sequence' : 'New Sequence'}
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {viewMode === 'list' ? (
            // List view
            <div>
              <button
                className="w-full mb-4 px-3 py-2 text-sm rounded bg-[var(--color-success)] hover:bg-[var(--color-success)]/80 transition-colors"
                onClick={handleCreate}
              >
                + New Sequence
              </button>

              {library.length === 0 ? (
                <p className="text-center text-xs text-[var(--color-text-secondary)] py-4">
                  No sequences yet. Create one to get started.
                </p>
              ) : (
                <div className="space-y-2">
                  {library.map((seq) => (
                    <div
                      key={seq.id}
                      className="flex items-center justify-between p-3 bg-[var(--color-bg-secondary)] rounded border border-[var(--color-border-dark)]"
                    >
                      <div>
                        <div className="text-sm font-medium">{seq.name}</div>
                        <div className="text-xs text-[var(--color-text-secondary)]">
                          {isArbitrary(seq.waveform)
                            ? `Arbitrary (${seq.waveform.steps.length} steps)`
                            : `${seq.waveform.type} (${seq.waveform.pointsPerCycle} pts)`}{' '}
                          &bull; {seq.unit}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          className="px-2 py-1 text-xs rounded bg-[var(--color-bg-panel)] hover:bg-[var(--color-border-dark)] transition-colors"
                          onClick={() => handleEdit(seq)}
                        >
                          Edit
                        </button>
                        <button
                          className="px-2 py-1 text-xs rounded bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors"
                          onClick={() => handleDelete(seq.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            // Edit view
            <div className="space-y-4">
              {error && (
                <div className="px-3 py-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
                  {error}
                </div>
              )}

              {/* Name */}
              <div>
                <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => updateForm('name', e.target.value)}
                  placeholder="My Sequence"
                  className="w-full px-2 py-1.5 text-sm rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
                />
              </div>

              {/* Unit */}
              <div>
                <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Unit</label>
                <select
                  value={form.unit}
                  onChange={(e) => updateForm('unit', e.target.value)}
                  className="w-full px-2 py-1.5 text-sm rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>

              {/* Waveform type */}
              <div>
                <label className="block text-xs text-[var(--color-text-secondary)] mb-1">
                  Waveform Type
                </label>
                <select
                  value={form.waveformType}
                  onChange={(e) => updateForm('waveformType', e.target.value as WaveformType | 'arbitrary')}
                  className="w-full px-2 py-1.5 text-sm rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
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
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Min</label>
                    <input
                      type="number"
                      value={form.min}
                      onChange={(e) => updateForm('min', parseFloat(e.target.value) || 0)}
                      className="w-full px-2 py-1.5 text-sm rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Max</label>
                    <input
                      type="number"
                      value={form.max}
                      onChange={(e) => updateForm('max', parseFloat(e.target.value) || 0)}
                      className="w-full px-2 py-1.5 text-sm rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--color-text-secondary)] mb-1">
                      Points/Cycle
                    </label>
                    <input
                      type="number"
                      min={2}
                      value={form.pointsPerCycle}
                      onChange={(e) => updateForm('pointsPerCycle', parseInt(e.target.value) || 2)}
                      className="w-full px-2 py-1.5 text-sm rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--color-text-secondary)] mb-1">
                      Interval (ms)
                    </label>
                    <input
                      type="number"
                      min={50}
                      value={form.intervalMs}
                      onChange={(e) => updateForm('intervalMs', parseInt(e.target.value) || 100)}
                      className="w-full px-2 py-1.5 text-sm rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
                    />
                  </div>
                </div>
              )}

              {/* Arbitrary steps */}
              {form.waveformType === 'arbitrary' && (
                <div>
                  <label className="block text-xs text-[var(--color-text-secondary)] mb-1">
                    Steps (value,dwellMs per line)
                  </label>
                  <textarea
                    value={form.arbitrarySteps}
                    onChange={(e) => updateForm('arbitrarySteps', e.target.value)}
                    placeholder="0,100&#10;5,100&#10;10,100"
                    rows={6}
                    className="w-full px-2 py-1.5 text-sm font-mono rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
                  />
                </div>
              )}

              {/* Duration preview */}
              {previewDuration !== null && (
                <div className="text-xs text-[var(--color-text-secondary)]">
                  Cycle duration: {(previewDuration / 1000).toFixed(2)}s
                </div>
              )}

              {/* Modifiers (collapsible) */}
              <details className="group">
                <summary className="cursor-pointer text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
                  Advanced Options
                </summary>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--color-text-secondary)] mb-1">
                      Pre-Value
                    </label>
                    <input
                      type="text"
                      value={form.preValue}
                      onChange={(e) => updateForm('preValue', e.target.value)}
                      placeholder="(optional)"
                      className="w-full px-2 py-1.5 text-sm rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--color-text-secondary)] mb-1">
                      Post-Value
                    </label>
                    <input
                      type="text"
                      value={form.postValue}
                      onChange={(e) => updateForm('postValue', e.target.value)}
                      placeholder="(optional)"
                      className="w-full px-2 py-1.5 text-sm rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Scale</label>
                    <input
                      type="text"
                      value={form.scale}
                      onChange={(e) => updateForm('scale', e.target.value)}
                      placeholder="1.0"
                      className="w-full px-2 py-1.5 text-sm rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Offset</label>
                    <input
                      type="text"
                      value={form.offset}
                      onChange={(e) => updateForm('offset', e.target.value)}
                      placeholder="0"
                      className="w-full px-2 py-1.5 text-sm rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--color-text-secondary)] mb-1">
                      Max Clamp
                    </label>
                    <input
                      type="text"
                      value={form.maxClamp}
                      onChange={(e) => updateForm('maxClamp', e.target.value)}
                      placeholder="(optional)"
                      className="w-full px-2 py-1.5 text-sm rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
                    />
                  </div>
                </div>
              </details>
            </div>
          )}
        </div>

        {/* Footer */}
        {viewMode === 'edit' && (
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--color-border-dark)]">
            <button
              className="px-3 py-1.5 text-sm rounded bg-[var(--color-bg-secondary)] hover:bg-[var(--color-border-dark)] transition-colors"
              onClick={handleCancel}
            >
              Cancel
            </button>
            <button
              className="px-3 py-1.5 text-sm rounded bg-[var(--color-success)] hover:bg-[var(--color-success)]/80 transition-colors"
              onClick={handleSave}
            >
              {editingId ? 'Update' : 'Create'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
