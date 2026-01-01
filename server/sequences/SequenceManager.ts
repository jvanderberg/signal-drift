/**
 * SequenceManager - Manages sequence library and active sequence execution
 *
 * - CRUD operations for sequence library with JSON file persistence
 * - Validates all sequence definitions before saving
 * - Manages single active sequence at a time
 * - Integrates with SessionManager to get DeviceSessions
 */

import type { SessionManager } from '../sessions/SessionManager.js';
import type {
  SequenceDefinition,
  SequenceRunConfig,
  SequenceState,
  ServerMessage,
  Result,
} from '../../shared/types.js';
import { Ok, Err } from '../../shared/types.js';
import { validateSequenceDefinition, WAVEFORM_LIMITS } from '../../shared/waveform.js';
import { createSequenceController, SequenceController } from './SequenceController.js';
import { createSequenceStore, SequenceStore } from './SequenceStore.js';

type SubscriberCallback = (message: ServerMessage) => void;

export interface SequenceManager {
  // Library CRUD
  listLibrary(): SequenceDefinition[];
  saveToLibrary(definition: Omit<SequenceDefinition, 'id' | 'createdAt' | 'updatedAt'>): Result<string, Error>;
  updateInLibrary(definition: SequenceDefinition): Result<void, Error>;
  deleteFromLibrary(sequenceId: string): Result<void, Error>;
  getFromLibrary(sequenceId: string): SequenceDefinition | undefined;

  // Playback
  run(config: SequenceRunConfig): Promise<Result<SequenceState, Error>>;
  abort(): Promise<void>;
  getActiveState(): SequenceState | undefined;

  // Subscriptions (for WebSocket broadcasts)
  subscribe(callback: SubscriberCallback): () => void;

  // Lifecycle
  initialize(): Promise<void>;
  stop(): void;
}

let sequenceIdCounter = 0;

function generateSequenceId(): string {
  return `seq-${++sequenceIdCounter}-${Date.now()}`;
}

export function createSequenceManager(sessionManager: SessionManager): SequenceManager {
  // In-memory library (synced with persistent storage)
  const library = new Map<string, SequenceDefinition>();

  // Persistent storage
  const store: SequenceStore = createSequenceStore();

  // Active sequence
  let activeController: SequenceController | null = null;
  let controllerUnsubscribe: (() => void) | null = null;

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
        console.error('SequenceManager subscriber error:', err);
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

      const sequences = Array.from(library.values());
      const result = await store.save(sequences);
      if (!result.ok) {
        console.error('[SequenceManager] Failed to save library:', result.error);
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
      const sequences = Array.from(library.values());
      const result = await store.save(sequences);
      if (!result.ok) {
        console.error('[SequenceManager] Failed to save library on shutdown:', result.error);
      }
      isDirty = false;
    }
  }

  // Library operations
  function listLibrary(): SequenceDefinition[] {
    return Array.from(library.values());
  }

  function saveToLibrary(partial: Omit<SequenceDefinition, 'id' | 'createdAt' | 'updatedAt'>): Result<string, Error> {
    // Validate before saving
    const validationResult = validateSequenceDefinition(partial);
    if (!validationResult.ok) {
      return Err(new Error(`Validation failed: ${validationResult.error.field} - ${validationResult.error.message}`));
    }

    // Check library size limit
    if (library.size >= WAVEFORM_LIMITS.MAX_LIBRARY_SIZE) {
      return Err(new Error(`Library full: maximum ${WAVEFORM_LIMITS.MAX_LIBRARY_SIZE} sequences allowed`));
    }

    const now = Date.now();
    const definition: SequenceDefinition = {
      ...partial,
      id: generateSequenceId(),
      createdAt: now,
      updatedAt: now,
    };
    library.set(definition.id, definition);
    scheduleSave();
    return Ok(definition.id);
  }

  function updateInLibrary(definition: SequenceDefinition): Result<void, Error> {
    if (!library.has(definition.id)) {
      return Err(new Error(`Sequence not found: ${definition.id}`));
    }

    // Validate before updating
    const validationResult = validateSequenceDefinition(definition);
    if (!validationResult.ok) {
      return Err(new Error(`Validation failed: ${validationResult.error.field} - ${validationResult.error.message}`));
    }

    library.set(definition.id, {
      ...definition,
      updatedAt: Date.now(),
    });
    scheduleSave();
    return Ok();
  }

  function deleteFromLibrary(sequenceId: string): Result<void, Error> {
    if (!library.delete(sequenceId)) {
      return Err(new Error(`Sequence not found: ${sequenceId}`));
    }
    scheduleSave();
    return Ok();
  }

  function getFromLibrary(sequenceId: string): SequenceDefinition | undefined {
    return library.get(sequenceId);
  }

  // Playback operations
  async function run(config: SequenceRunConfig): Promise<Result<SequenceState, Error>> {
    // Get sequence from library
    const definition = library.get(config.sequenceId);
    if (!definition) {
      return Err(new Error(`Sequence not found: ${config.sequenceId}`));
    }

    // Get device session
    const session = sessionManager.getSession(config.deviceId);
    if (!session) {
      return Err(new Error(`Device session not found: ${config.deviceId}`));
    }

    // Validate parameter matches unit
    const state = session.getState();
    const output = state.capabilities.outputs.find(o => o.name === config.parameter);
    if (!output) {
      return Err(new Error(`Parameter not found: ${config.parameter}`));
    }
    if (output.unit !== definition.unit) {
      return Err(new Error(`Unit mismatch: sequence is ${definition.unit}, parameter is ${output.unit}`));
    }

    // Abort any existing sequence
    if (activeController) {
      await abort();
    }

    // Create and start controller
    activeController = createSequenceController(definition, config, session);

    // Subscribe to controller events and forward to our subscribers
    controllerUnsubscribe = activeController.subscribe((message) => {
      broadcast(message);

      // Defer cleanup to allow run() to complete and return state
      if (message.type === 'sequenceCompleted' ||
          message.type === 'sequenceAborted' ||
          message.type === 'sequenceError') {
        queueMicrotask(() => cleanupController());
      }
    });

    // Capture controller reference before start() since cleanup may happen during execution
    const controller = activeController;
    const startResult = await controller.start();
    if (!startResult.ok) {
      cleanupController();
      return startResult;
    }
    return Ok(controller.getState());
  }

  async function abort(): Promise<void> {
    if (activeController) {
      await activeController.abort();
      cleanupController();
    }
  }

  function cleanupController(): void {
    if (controllerUnsubscribe) {
      controllerUnsubscribe();
      controllerUnsubscribe = null;
    }
    if (activeController) {
      activeController.destroy();
      activeController = null;
    }
  }

  function getActiveState(): SequenceState | undefined {
    return activeController?.getState();
  }

  function subscribe(callback: SubscriberCallback): () => void {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
  }

  async function initialize(): Promise<void> {
    console.log(`[SequenceManager] Initializing, storage at: ${store.getStoragePath()}`);

    // Load from persistent storage
    const result = await store.load();
    if (result.ok) {
      for (const seq of result.value) {
        library.set(seq.id, seq);
        // Update counter to avoid ID collisions
        const match = seq.id.match(/^seq-(\d+)-/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num >= sequenceIdCounter) {
            sequenceIdCounter = num;
          }
        }
      }
      console.log(`[SequenceManager] Loaded ${library.size} sequences`);
    } else {
      console.error('[SequenceManager] Failed to load library:', result.error);
    }
  }

  async function stop(): Promise<void> {
    // Force save any pending changes
    await forceSave();

    if (activeController) {
      activeController.destroy();
      activeController = null;
    }
    if (controllerUnsubscribe) {
      controllerUnsubscribe();
      controllerUnsubscribe = null;
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
    abort,
    getActiveState,
    subscribe,
    initialize,
    stop,
  };
}
