/**
 * SequencePanel - Combined edit/run interface for sequences
 *
 * Two modes:
 * - Edit mode: Full sequence editor (SequenceEditor component)
 * - Run mode: Playback controls and chart
 *
 * Defaults to Edit mode if no sequences exist, Run mode otherwise.
 */

import { useState, useMemo, useEffect } from 'react';
import { useSequencer } from '../../hooks/useSequencer';
import { useDeviceList } from '../../hooks/useDeviceList';
import { SequenceChart } from './SequenceChart';
import { SequenceEditor } from './SequenceEditor';
import type { RepeatMode, SequenceDefinition } from '../../types';

type PanelMode = 'run' | 'edit';

export function SequencePanel() {
  const {
    library,
    isLibraryLoading,
    activeState,
    isRunning,
    run,
    abort,
    deleteSequence,
    error,
    clearError,
  } = useSequencer();

  const { devices } = useDeviceList();

  // Mode state - null means "not yet determined"
  const [mode, setMode] = useState<PanelMode | null>(null);
  const [editingSequence, setEditingSequence] = useState<SequenceDefinition | null>(null);

  // Set initial mode once library is loaded
  useEffect(() => {
    if (!isLibraryLoading && mode === null) {
      // Default to edit mode if no sequences, run mode otherwise
      setMode(library.length === 0 ? 'edit' : 'run');
    }
  }, [library.length, isLibraryLoading, mode]);

  // Selection state
  const [selectedSequenceId, setSelectedSequenceId] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [selectedParameter, setSelectedParameter] = useState<string | null>(null);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('once');
  const [repeatCount, setRepeatCount] = useState(1);

  // Get selected sequence
  const selectedSequence = useMemo(() => {
    return library.find((s) => s.id === selectedSequenceId) ?? null;
  }, [library, selectedSequenceId]);

  // Get selected device
  const selectedDevice = useMemo(() => {
    return devices.find((d) => d.id === selectedDeviceId) ?? null;
  }, [devices, selectedDeviceId]);

  // Filter parameters by sequence unit
  const availableParameters = useMemo(() => {
    if (!selectedDevice || !selectedSequence) return [];
    return selectedDevice.capabilities.outputs.filter(
      (o) => o.unit === selectedSequence.unit
    );
  }, [selectedDevice, selectedSequence]);

  // Reset parameter when device or sequence changes
  useMemo(() => {
    if (availableParameters.length > 0) {
      const current = availableParameters.find((p) => p.name === selectedParameter);
      if (!current) {
        setSelectedParameter(availableParameters[0].name);
      }
    } else {
      setSelectedParameter(null);
    }
  }, [availableParameters, selectedParameter]);

  // Filter devices that have matching parameters for selected sequence
  const compatibleDevices = useMemo(() => {
    if (!selectedSequence) return devices;
    return devices.filter((d) =>
      d.capabilities.outputs.some((o) => o.unit === selectedSequence.unit)
    );
  }, [devices, selectedSequence]);

  const handleStart = () => {
    if (!selectedSequenceId || !selectedDeviceId || !selectedParameter) return;
    run({
      sequenceId: selectedSequenceId,
      deviceId: selectedDeviceId,
      parameter: selectedParameter,
      repeatMode,
      repeatCount: repeatMode === 'count' ? repeatCount : undefined,
    });
  };

  const handleAbort = () => {
    abort();
  };

  const canStart =
    selectedSequenceId !== null &&
    selectedDeviceId !== null &&
    selectedParameter !== null &&
    !isRunning;

  const executionState = activeState?.executionState ?? 'idle';

  // Handlers for mode switching
  const handleEditSequence = () => {
    if (selectedSequence) {
      setEditingSequence(selectedSequence);
      setMode('edit');
    }
  };

  const handleNewSequence = () => {
    setEditingSequence(null);
    setMode('edit');
  };

  const handleEditorSave = () => {
    setMode('run');
    setEditingSequence(null);
  };

  const handleEditorCancel = () => {
    // If library is empty, stay in edit mode
    if (library.length === 0) {
      setEditingSequence(null);
    } else {
      setMode('run');
      setEditingSequence(null);
    }
  };

  const handleDeleteSequence = () => {
    if (selectedSequence && confirm('Delete this sequence?')) {
      deleteSequence(selectedSequence.id);
      setSelectedSequenceId(null);
    }
  };

  // Loading state - show placeholder while library loads
  if (mode === null) {
    return (
      <div className="h-[470px] bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] rounded-md p-3 flex items-center justify-center">
        <span className="text-sm text-[var(--color-text-secondary)]">Loading...</span>
      </div>
    );
  }

  // Edit mode - show full editor
  if (mode === 'edit') {
    return (
      <SequenceEditor
        sequence={editingSequence}
        onSave={handleEditorSave}
        onCancel={handleEditorCancel}
      />
    );
  }

  // Run mode - show playback UI
  return (
    <div className="h-[470px] bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] rounded-md p-3 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <h2 className="text-sm font-medium">Sequencer</h2>
        <div className="flex items-center gap-1">
          <button
            className="text-xs px-2 py-1 rounded bg-[var(--color-bg-secondary)] hover:bg-[var(--color-border-dark)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleEditSequence}
            disabled={!selectedSequence || isRunning}
            title="Edit selected sequence"
          >
            ✎ Edit
          </button>
          <button
            className="text-xs px-2 py-1 rounded bg-[var(--color-bg-secondary)] hover:bg-[var(--color-border-dark)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleNewSequence}
            disabled={isRunning}
            title="Create new sequence"
          >
            + New
          </button>
          {selectedSequence && (
            <button
              className="text-xs px-2 py-1 rounded bg-red-500/30 hover:bg-red-500/50 text-red-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleDeleteSequence}
              disabled={isRunning}
              title="Delete selected sequence"
            >
              ✗ Delete
            </button>
          )}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="mb-3 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={clearError} className="ml-2 text-red-300 hover:text-red-200">
            &times;
          </button>
        </div>
      )}

      {/* Main content: Chart left, Controls right */}
      <div className="flex gap-3 flex-1 min-h-0">
        {/* Chart - left side */}
        <div className="flex-1 min-w-0 flex flex-col">
          {selectedSequence ? (
            <div className="flex-1 min-h-0">
              <SequenceChart
                sequence={selectedSequence}
                activeState={activeState}
              />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-[var(--color-bg-secondary)] rounded text-xs text-[var(--color-text-secondary)]">
              Select a sequence to preview
            </div>
          )}

          {/* Status display - below chart */}
          {activeState && (
            <div className="mt-2 px-3 py-2 bg-[var(--color-bg-secondary)] rounded text-xs flex-shrink-0">
              <div className="flex justify-between items-center">
                <span className="capitalize">{executionState}</span>
                <span>
                  Step {activeState.currentStepIndex + 1}/{activeState.totalSteps}
                  {activeState.totalCycles !== null && (
                    <span className="ml-2">
                      Cycle {activeState.currentCycle + 1}/{activeState.totalCycles}
                    </span>
                  )}
                  {activeState.totalCycles === null && (
                    <span className="ml-2">Cycle {activeState.currentCycle + 1}</span>
                  )}
                </span>
              </div>
              <div className="flex justify-between items-center mt-1">
                <span>Value: {activeState.commandedValue.toFixed(3)}</span>
                <span>Elapsed: {(activeState.elapsedMs / 1000).toFixed(1)}s</span>
              </div>
            </div>
          )}
        </div>

        {/* Controls - right side */}
        <div className="w-48 flex-shrink-0">
          {/* Configuration section - disabled during playback */}
          <div className={isRunning ? 'opacity-50 pointer-events-none' : ''}>
            {/* Sequence selector */}
            <div className="mb-2">
              <label className="block text-xs text-[var(--color-text-secondary)] mb-1">
                Sequence
              </label>
              <select
                className="w-full px-2 py-1.5 text-sm rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
                value={selectedSequenceId ?? ''}
                onChange={(e) => setSelectedSequenceId(e.target.value || null)}
                disabled={isLibraryLoading}
              >
                <option value="">Select...</option>
                {library.map((seq) => (
                  <option key={seq.id} value={seq.id}>
                    {seq.name} ({seq.unit})
                  </option>
                ))}
              </select>
            </div>

            {/* Device selector */}
            <div className="mb-2">
              <label className="block text-xs text-[var(--color-text-secondary)] mb-1">
                Device
              </label>
              <select
                className="w-full px-2 py-1.5 text-sm rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
                value={selectedDeviceId ?? ''}
                onChange={(e) => setSelectedDeviceId(e.target.value || null)}
                disabled={!selectedSequence}
              >
                <option value="">Select...</option>
                {compatibleDevices.map((dev) => (
                  <option key={dev.id} value={dev.id}>
                    {dev.info.manufacturer} {dev.info.model}
                  </option>
                ))}
              </select>
              {selectedSequence && compatibleDevices.length === 0 && (
                <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                  No devices with {selectedSequence.unit} outputs
                </p>
              )}
            </div>

            {/* Parameter selector */}
            <div className="mb-2">
              <label className="block text-xs text-[var(--color-text-secondary)] mb-1">
                Parameter
              </label>
              <select
                className="w-full px-2 py-1.5 text-sm rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
                value={selectedParameter ?? ''}
                onChange={(e) => setSelectedParameter(e.target.value || null)}
                disabled={availableParameters.length === 0}
              >
                {availableParameters.length === 0 && (
                  <option value="">No matching</option>
                )}
                {availableParameters.map((param) => (
                  <option key={param.name} value={param.name}>
                    {param.name} ({param.unit})
                  </option>
                ))}
              </select>
            </div>

            {/* Repeat mode */}
            <div className="mb-2">
              <label className="block text-xs text-[var(--color-text-secondary)] mb-1">
                Repeat
              </label>
              <div className="flex items-center gap-1">
                <select
                  className="flex-1 px-2 py-1 text-xs rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
                  value={repeatMode}
                  onChange={(e) => setRepeatMode(e.target.value as RepeatMode)}
                >
                  <option value="once">Once</option>
                  <option value="count">N times</option>
                  <option value="continuous">Forever</option>
                </select>
                {repeatMode === 'count' && (
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={repeatCount}
                    onChange={(e) => setRepeatCount(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-14 px-2 py-1 text-xs rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
                  />
                )}
              </div>
            </div>
          </div>

          {/* Playback controls */}
          <div className="mt-3">
            {!isRunning ? (
              <button
                className="w-full px-3 py-2 text-sm rounded font-medium bg-[var(--color-success)] hover:bg-[var(--color-success)]/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                onClick={handleStart}
                disabled={!canStart}
              >
                Start
              </button>
            ) : (
              <button
                className="w-full px-3 py-2 text-sm rounded font-medium bg-red-600 hover:bg-red-700 transition-colors"
                onClick={handleAbort}
              >
                Abort
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Empty state */}
      {library.length === 0 && !isLibraryLoading && (
        <div className="text-center py-4 text-xs text-[var(--color-text-secondary)]">
          No sequences in library.{' '}
          <button
            className="text-[var(--color-text-primary)] underline"
            onClick={handleNewSequence}
          >
            Create one
          </button>
        </div>
      )}
    </div>
  );
}
