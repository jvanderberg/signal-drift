/**
 * TriggerScriptPanel - Main panel for trigger script management
 *
 * - List of saved trigger scripts with add/delete
 * - Trigger editor for the selected script
 * - Run/stop/pause controls
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { useTriggerScript } from '../../hooks/useTriggerScript';
import { useSequencer } from '../../hooks/useSequencer';
import { useDeviceList } from '../../hooks/useDeviceList';
import { useDeviceNames } from '../../hooks/useDeviceNames';
import { TriggerEditor } from './TriggerEditor';
import type { Trigger, TriggerScript } from '../../types';

type PanelMode = 'run' | 'edit';

let triggerIdCounter = 0;
function generateTriggerId(): string {
  return `trigger-${++triggerIdCounter}-${Date.now()}`;
}

export function TriggerScriptPanel() {
  const {
    library,
    isLibraryLoading,
    activeState,
    isRunning,
    run,
    stop,
    pause,
    resume,
    saveScript,
    updateScript,
    deleteScript,
    error,
    clearError,
  } = useTriggerScript();

  const { library: sequences } = useSequencer();
  const { devices } = useDeviceList();

  // Mode state
  const [mode, setMode] = useState<PanelMode | null>(null);
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);

  // Editing state (for edit mode)
  const [editingScript, setEditingScript] = useState<TriggerScript | null>(null);
  const [scriptName, setScriptName] = useState('');
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [newTriggerId, setNewTriggerId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Drag and drop state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Set initial mode once library is loaded
  useEffect(() => {
    if (!isLibraryLoading && mode === null) {
      setMode(library.length === 0 ? 'edit' : 'run');
    }
  }, [library.length, isLibraryLoading, mode]);

  // Get selected script
  const selectedScript = useMemo(() => {
    return library.find((s) => s.id === selectedScriptId) ?? null;
  }, [library, selectedScriptId]);

  // Handlers for mode switching
  const handleEditScript = () => {
    if (selectedScript) {
      setEditingScript(selectedScript);
      setScriptName(selectedScript.name);
      setTriggers([...selectedScript.triggers]);
      setMode('edit');
    }
  };

  const handleNewScript = () => {
    setEditingScript(null);
    setScriptName('New Script');
    setTriggers([]);
    setMode('edit');
  };

  const handleSave = () => {
    if (editingScript) {
      // Update existing
      updateScript({
        ...editingScript,
        name: scriptName,
        triggers,
      });
    } else {
      // Save new
      saveScript({
        name: scriptName,
        triggers,
      });
    }
    setMode('run');
    setEditingScript(null);
  };

  const handleCancel = () => {
    if (library.length === 0) {
      setEditingScript(null);
      setScriptName('');
      setTriggers([]);
    } else {
      setMode('run');
      setEditingScript(null);
    }
  };

  const handleDeleteScript = () => {
    if (selectedScript && confirm('Delete this trigger script?')) {
      deleteScript(selectedScript.id);
      setSelectedScriptId(null);
    }
  };

  // Trigger editing
  const addTrigger = () => {
    const id = generateTriggerId();
    const newTrigger: Trigger = {
      id,
      condition: {
        type: 'time',
        seconds: 0,
      },
      action: {
        type: 'setOutput',
        deviceId: devices[0]?.id ?? '',
        enabled: true,
      },
      repeatMode: 'once',
      debounceMs: 0,
    };
    setTriggers([...triggers, newTrigger]);
    setNewTriggerId(id);
    // Scroll to bottom after render
    setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, 0);
  };

  const updateTrigger = (index: number, trigger: Trigger) => {
    const newTriggers = [...triggers];
    newTriggers[index] = trigger;
    setTriggers(newTriggers);
  };

  const deleteTrigger = (index: number) => {
    setTriggers(triggers.filter((_, i) => i !== index));
  };

  // Drag and drop handlers
  const handleDragStart = (index: number) => {
    setDragIndex(index);
    setNewTriggerId(null); // Clear any "new trigger" state
  };

  const handleDragOver = (index: number) => {
    if (dragIndex === null || dragIndex === index) return;
    setDragOverIndex(index);
  };

  const handleDragEnd = () => {
    if (dragIndex !== null && dragOverIndex !== null && dragIndex !== dragOverIndex) {
      // Reorder the triggers array
      const newTriggers = [...triggers];
      const [removed] = newTriggers.splice(dragIndex, 1);
      // Adjust target index since removal shifts indices when dragging downward
      const targetIndex = dragIndex < dragOverIndex ? dragOverIndex - 1 : dragOverIndex;
      newTriggers.splice(targetIndex, 0, removed);
      setTriggers(newTriggers);
    }
    setDragIndex(null);
    setDragOverIndex(null);
  };

  // Execution controls
  const handleStart = () => {
    if (selectedScriptId) {
      run(selectedScriptId);
    }
  };

  const handleStop = () => {
    stop();
  };

  const handlePause = () => {
    pause();
  };

  const handleResume = () => {
    resume();
  };

  const executionState = activeState?.executionState ?? 'idle';
  const isPaused = executionState === 'paused';

  const { getCustomName } = useDeviceNames();

  // Helper to get device display name (custom name or model)
  const getDeviceName = (deviceId: string): string => {
    const device = devices.find((d) => d.id === deviceId);
    if (!device) return deviceId;
    const custom = getCustomName(device.info.manufacturer, device.info.model);
    return custom?.title || device.info.model;
  };

  // Helper to format action for display
  const formatAction = (action: Trigger['action']): string => {
    switch (action.type) {
      case 'setValue':
        return `${getDeviceName(action.deviceId)} ${action.parameter} = ${action.value}`;
      case 'setOutput':
        return `${getDeviceName(action.deviceId)} output ${action.enabled ? 'ON' : 'OFF'}`;
      case 'setMode':
        return `${getDeviceName(action.deviceId)} mode → ${action.mode}`;
      case 'startSequence': {
        const seq = sequences.find((s) => s.id === action.sequenceId);
        return `Start ${seq?.name ?? 'sequence'} on ${getDeviceName(action.deviceId)}`;
      }
      case 'stopSequence':
        return 'Stop sequence';
      case 'pauseSequence':
        return 'Pause sequence';
    }
  };

  // Loading state
  if (mode === null) {
    return (
      <div className="h-[470px] bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] rounded-md p-3 flex items-center justify-center">
        <span className="text-sm text-[var(--color-text-secondary)]">Loading...</span>
      </div>
    );
  }

  // Edit mode
  if (mode === 'edit') {
    return (
      <div className="h-[470px] bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] rounded-md p-3 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-3 flex-shrink-0">
          <h2 className="text-sm font-medium">
            {editingScript ? 'Edit Trigger Script' : 'New Trigger Script'}
          </h2>
          <div className="flex items-center gap-2">
            <button
              className="text-xs px-3 py-1 rounded bg-[var(--color-success)] text-white hover:opacity-80"
              onClick={handleSave}
            >
              Save
            </button>
            <button
              className="text-xs px-3 py-1 rounded bg-[var(--color-bg-secondary)] hover:bg-[var(--color-border-dark)]"
              onClick={handleCancel}
            >
              Cancel
            </button>
          </div>
        </div>

        {/* Script name */}
        <div className="mb-3 flex-shrink-0">
          <label className="block text-xs text-[var(--color-text-secondary)] mb-1">
            Script Name
          </label>
          <input
            type="text"
            className="w-full px-2 py-1.5 text-sm rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-dark)]"
            value={scriptName}
            onChange={(e) => setScriptName(e.target.value)}
            placeholder="Enter script name..."
          />
        </div>

        {/* Triggers list - scrollable */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 mb-3">
          {triggers.length === 0 ? (
            <div className="text-center py-8 text-xs text-[var(--color-text-secondary)]">
              No triggers yet. Click "+ Add Trigger" to create one.
            </div>
          ) : (
            triggers.map((trigger, index) => (
              <TriggerEditor
                key={trigger.id}
                trigger={trigger}
                index={index}
                devices={devices}
                sequences={sequences}
                onChange={(t) => updateTrigger(index, t)}
                onDelete={() => deleteTrigger(index)}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
                isDragTarget={dragOverIndex === index}
                isDragging={dragIndex === index}
                defaultExpanded={trigger.id === newTriggerId}
              />
            ))
          )}
        </div>

        {/* Add button - always visible at bottom */}
        <button
          className="w-full text-xs px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 flex-shrink-0"
          onClick={addTrigger}
        >
          + Add Trigger
        </button>
      </div>
    );
  }

  // Run mode
  return (
    <div className="h-[470px] bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] rounded-md p-3 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <h2 className="text-sm font-medium">Trigger Scripts</h2>
        <div className="flex items-center gap-1">
          <button
            className="text-xs px-2 py-1 rounded bg-[var(--color-bg-secondary)] hover:bg-[var(--color-border-dark)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleEditScript}
            disabled={!selectedScript || isRunning}
            title="Edit selected script"
          >
            Edit
          </button>
          <button
            className="text-xs px-2 py-1 rounded bg-[var(--color-bg-secondary)] hover:bg-[var(--color-border-dark)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleNewScript}
            disabled={isRunning}
            title="Create new script"
          >
            + New
          </button>
          {selectedScript && (
            <button
              className="text-xs px-2 py-1 rounded bg-[var(--color-danger)] text-white hover:opacity-80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleDeleteScript}
              disabled={isRunning}
              title="Delete selected script"
            >
              Delete
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

      {/* Main content */}
      <div className="flex gap-3 flex-1 min-h-0">
        {/* Script list - left side */}
        <div className="w-48 flex-shrink-0 flex flex-col">
          <label className="block text-xs text-[var(--color-text-secondary)] mb-1">
            Scripts
          </label>
          <div className="flex-1 overflow-y-auto bg-[var(--color-bg-secondary)] rounded border border-[var(--color-border-dark)]">
            {library.length === 0 ? (
              <div className="text-center py-4 text-xs text-[var(--color-text-secondary)]">
                No scripts
              </div>
            ) : (
              library.map((script) => (
                <div
                  key={script.id}
                  className={`px-2 py-2 cursor-pointer border-b border-[var(--color-border-dark)] last:border-b-0 ${
                    selectedScriptId === script.id
                      ? 'bg-blue-600/20'
                      : 'hover:bg-[var(--color-bg-panel)]'
                  }`}
                  onClick={() => setSelectedScriptId(script.id)}
                >
                  <div className="text-sm font-medium truncate">{script.name}</div>
                  <div className="text-xs text-[var(--color-text-secondary)]">
                    {script.triggers.length} trigger{script.triggers.length !== 1 ? 's' : ''}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Script details - right side */}
        <div className="flex-1 min-w-0 flex flex-col">
          {selectedScript ? (
            <>
              {/* Script info */}
              <div className="mb-3">
                <div className="text-sm font-medium">{selectedScript.name}</div>
                <div className="text-xs text-[var(--color-text-secondary)]">
                  {selectedScript.triggers.length} trigger
                  {selectedScript.triggers.length !== 1 ? 's' : ''}
                </div>
              </div>

              {/* Triggers preview */}
              <div className="flex-1 overflow-y-auto min-h-0 bg-[var(--color-bg-secondary)] rounded p-2">
                {selectedScript.triggers.map((trigger) => (
                  <div
                    key={trigger.id}
                    className="text-xs mb-2 p-2 bg-[var(--color-bg-panel)] rounded border border-[var(--color-border-light)]"
                  >
                    <div className="font-medium">
                      {trigger.condition.type === 'time'
                        ? `At t=${trigger.condition.seconds}s`
                        : `When ${getDeviceName(trigger.condition.deviceId)} ${trigger.condition.parameter} ${trigger.condition.operator} ${trigger.condition.value}`}
                    </div>
                    <div className="text-[var(--color-text-secondary)]">
                      → {formatAction(trigger.action)}
                    </div>

                    {/* Trigger state when running */}
                    {activeState && activeState.scriptId === selectedScript.id && (
                      <div className="mt-1 text-blue-400">
                        {activeState.triggerStates.find((ts) => ts.triggerId === trigger.id)
                          ?.firedCount ?? 0}{' '}
                        fires
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Execution status */}
              {activeState && activeState.scriptId === selectedScript.id && (
                <div className="mt-2 px-2 py-2 bg-[var(--color-bg-readings)] rounded text-xs">
                  <div className="flex justify-between">
                    <span className="capitalize font-medium">{executionState}</span>
                    <span>{(activeState.elapsedMs / 1000).toFixed(1)}s</span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-[var(--color-text-secondary)]">
              Select a script to view details
            </div>
          )}

          {/* Playback controls */}
          <div className="mt-3 flex gap-2">
            {!isRunning ? (
              <button
                className="flex-1 px-3 py-2 text-sm rounded font-medium bg-[var(--color-success)] hover:bg-[var(--color-success)]/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                onClick={handleStart}
                disabled={!selectedScriptId}
              >
                Run
              </button>
            ) : (
              <>
                {isPaused ? (
                  <button
                    className="flex-1 px-3 py-2 text-sm rounded font-medium bg-blue-600 hover:bg-blue-700 transition-colors"
                    onClick={handleResume}
                  >
                    Resume
                  </button>
                ) : (
                  <button
                    className="flex-1 px-3 py-2 text-sm rounded font-medium bg-yellow-600 hover:bg-yellow-700 transition-colors"
                    onClick={handlePause}
                  >
                    Pause
                  </button>
                )}
                <button
                  className="flex-1 px-3 py-2 text-sm rounded font-medium bg-red-600 hover:bg-red-700 transition-colors"
                  onClick={handleStop}
                >
                  Stop
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Empty state */}
      {library.length === 0 && !isLibraryLoading && (
        <div className="text-center py-4 text-xs text-[var(--color-text-secondary)]">
          No trigger scripts.{' '}
          <button
            className="text-[var(--color-text-primary)] underline"
            onClick={handleNewScript}
          >
            Create one
          </button>
        </div>
      )}
    </div>
  );
}
