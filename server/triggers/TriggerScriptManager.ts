/**
 * TriggerScriptManager - Manages trigger script library and active script execution
 *
 * - CRUD operations for trigger script library with JSON file persistence
 * - Manages single active trigger script at a time
 * - Integrates with SessionManager for device value monitoring
 * - Integrates with SequenceManager for sequence control actions
 */

import type { SessionManager } from '../sessions/SessionManager.js';
import type { SequenceManager } from '../sequences/SequenceManager.js';
import type {
  TriggerScript,
  TriggerScriptState,
  ServerMessage,
  Result,
} from '../../shared/types.js';
import { Ok, Err } from '../../shared/types.js';
import { validateTriggerScript, TRIGGER_SCRIPT_LIMITS } from '../../shared/waveform.js';
import { createTriggerScriptStore, TriggerScriptStore } from './TriggerScriptStore.js';
import { createTriggerEngine, TriggerEngine } from './TriggerEngine.js';

type SubscriberCallback = (message: ServerMessage) => void;

export interface TriggerScriptManager {
  // Library CRUD
  listLibrary(): TriggerScript[];
  saveToLibrary(script: Omit<TriggerScript, 'id' | 'createdAt' | 'updatedAt'>): Result<string, Error>;
  updateInLibrary(script: TriggerScript): Result<void, Error>;
  deleteFromLibrary(scriptId: string): Result<void, Error>;
  getFromLibrary(scriptId: string): TriggerScript | undefined;

  // Execution
  run(scriptId: string): Promise<Result<TriggerScriptState, Error>>;
  stop(): Promise<void>;
  pause(): Result<void, Error>;
  resume(): Result<void, Error>;
  getActiveState(): TriggerScriptState | undefined;

  // Subscriptions (for WebSocket broadcasts)
  subscribe(callback: SubscriberCallback): () => void;

  // Lifecycle
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
}

let scriptIdCounter = 0;

function generateScriptId(): string {
  return `tscript-${++scriptIdCounter}-${Date.now()}`;
}

export function createTriggerScriptManager(
  sessionManager: SessionManager,
  sequenceManager: SequenceManager
): TriggerScriptManager {
  // In-memory library (synced with persistent storage)
  const library = new Map<string, TriggerScript>();

  // Persistent storage
  const store: TriggerScriptStore = createTriggerScriptStore();

  // Active engine
  let activeEngine: TriggerEngine | null = null;
  let engineUnsubscribe: (() => void) | null = null;

  // Subscribers for broadcasts
  const subscribers = new Set<SubscriberCallback>();

  // Track if we need to persist
  let isDirty = false;
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;

  function broadcast(message: ServerMessage): void {
    for (const callback of subscribers) {
      try {
        callback(message);
      } catch (err) {
        console.error('TriggerScriptManager subscriber error:', err);
      }
    }
  }

  /**
   * Debounced save to persistent storage
   * Saves at most once per second to avoid excessive disk writes
   */
  function scheduleSave(): void {
    if (saveTimeout) return; // Already scheduled

    isDirty = true;
    saveTimeout = setTimeout(async () => {
      saveTimeout = null;
      if (!isDirty) return;

      const scripts = Array.from(library.values());
      const result = await store.save(scripts);
      if (!result.ok) {
        console.error('[TriggerScriptManager] Failed to save library:', result.error);
      }
      isDirty = false;
    }, 1000);
  }

  /**
   * Force immediate save (used on shutdown)
   */
  async function forceSave(): Promise<void> {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    if (isDirty) {
      const scripts = Array.from(library.values());
      const result = await store.save(scripts);
      if (!result.ok) {
        console.error('[TriggerScriptManager] Failed to save library on shutdown:', result.error);
      }
      isDirty = false;
    }
  }

  // Library operations
  function listLibrary(): TriggerScript[] {
    return Array.from(library.values());
  }

  function saveToLibrary(partial: Omit<TriggerScript, 'id' | 'createdAt' | 'updatedAt'>): Result<string, Error> {
    // Validate script
    const validationResult = validateTriggerScript(partial);
    if (!validationResult.ok) {
      return Err(new Error(`Invalid trigger script: ${validationResult.error.field} - ${validationResult.error.message}`));
    }

    // Check library size limit
    if (library.size >= TRIGGER_SCRIPT_LIMITS.MAX_LIBRARY_SIZE) {
      return Err(new Error(`Library full: maximum ${TRIGGER_SCRIPT_LIMITS.MAX_LIBRARY_SIZE} trigger scripts allowed`));
    }

    const now = Date.now();
    const script: TriggerScript = {
      ...partial,
      id: generateScriptId(),
      createdAt: now,
      updatedAt: now,
    };
    library.set(script.id, script);
    scheduleSave();
    return Ok(script.id);
  }

  function updateInLibrary(script: TriggerScript): Result<void, Error> {
    // Validate script
    const validationResult = validateTriggerScript(script);
    if (!validationResult.ok) {
      return Err(new Error(`Invalid trigger script: ${validationResult.error.field} - ${validationResult.error.message}`));
    }

    if (!library.has(script.id)) {
      return Err(new Error(`Trigger script not found: ${script.id}`));
    }

    library.set(script.id, {
      ...script,
      updatedAt: Date.now(),
    });
    scheduleSave();
    return Ok();
  }

  function deleteFromLibrary(scriptId: string): Result<void, Error> {
    if (!library.delete(scriptId)) {
      return Err(new Error(`Trigger script not found: ${scriptId}`));
    }
    scheduleSave();
    return Ok();
  }

  function getFromLibrary(scriptId: string): TriggerScript | undefined {
    return library.get(scriptId);
  }

  // Execution operations
  async function run(scriptId: string): Promise<Result<TriggerScriptState, Error>> {
    const script = library.get(scriptId);
    if (!script) {
      return Err(new Error(`Trigger script not found: ${scriptId}`));
    }

    // Stop any existing engine
    if (activeEngine) {
      await stopEngine();
    }

    // Create and start new engine
    activeEngine = createTriggerEngine(script, sessionManager, sequenceManager);

    // Subscribe to engine events
    engineUnsubscribe = activeEngine.subscribe((message) => {
      broadcast(message);

      // Clean up on completion or error
      if (message.type === 'triggerScriptStopped' ||
          message.type === 'triggerScriptError') {
        queueMicrotask(() => cleanupEngine());
      }
    });

    const startResult = await activeEngine.start();
    if (!startResult.ok) {
      cleanupEngine();
      return startResult;
    }

    return Ok(activeEngine.getState());
  }

  async function stopEngine(): Promise<void> {
    if (activeEngine) {
      await activeEngine.stop();
      cleanupEngine();
    }
  }

  function cleanupEngine(): void {
    if (engineUnsubscribe) {
      engineUnsubscribe();
      engineUnsubscribe = null;
    }
    if (activeEngine) {
      activeEngine.destroy();
      activeEngine = null;
    }
  }

  function pause(): Result<void, Error> {
    if (!activeEngine) {
      return Err(new Error('No trigger script running'));
    }
    return activeEngine.pause();
  }

  function resume(): Result<void, Error> {
    if (!activeEngine) {
      return Err(new Error('No trigger script running'));
    }
    return activeEngine.resume();
  }

  function getActiveState(): TriggerScriptState | undefined {
    return activeEngine?.getState();
  }

  function subscribe(callback: SubscriberCallback): () => void {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
  }

  async function initialize(): Promise<void> {
    console.log(`[TriggerScriptManager] Initializing, storage at: ${store.getStoragePath()}`);

    // Load from persistent storage
    const result = await store.load();
    if (result.ok) {
      for (const script of result.value) {
        library.set(script.id, script);
        // Update counter to avoid ID collisions
        const match = script.id.match(/^tscript-(\d+)-/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num >= scriptIdCounter) {
            scriptIdCounter = num;
          }
        }
      }
      console.log(`[TriggerScriptManager] Loaded ${library.size} trigger scripts`);
    } else {
      console.error('[TriggerScriptManager] Failed to load library:', result.error);
    }
  }

  async function shutdown(): Promise<void> {
    // Force save any pending changes
    await forceSave();

    if (activeEngine) {
      activeEngine.destroy();
      activeEngine = null;
    }
    if (engineUnsubscribe) {
      engineUnsubscribe();
      engineUnsubscribe = null;
    }
    subscribers.clear();
  }

  return {
    listLibrary,
    saveToLibrary,
    updateInLibrary,
    deleteFromLibrary,
    getFromLibrary,
    run,
    stop: stopEngine,
    pause,
    resume,
    getActiveState,
    subscribe,
    initialize,
    shutdown,
  };
}
