/**
 * SequenceManager - Manages sequence library and active sequence execution
 *
 * - CRUD operations for sequence library (in-memory for now)
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
import { createSequenceController, SequenceController } from './SequenceController.js';

type SubscriberCallback = (message: ServerMessage) => void;

export interface SequenceManager {
  // Library CRUD
  listLibrary(): SequenceDefinition[];
  saveToLibrary(definition: Omit<SequenceDefinition, 'id' | 'createdAt' | 'updatedAt'>): string;
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
  stop(): void;
}

let sequenceIdCounter = 0;

function generateSequenceId(): string {
  return `seq-${++sequenceIdCounter}-${Date.now()}`;
}

export function createSequenceManager(sessionManager: SessionManager): SequenceManager {
  // In-memory library (future: SQLite)
  const library = new Map<string, SequenceDefinition>();

  // Active sequence
  let activeController: SequenceController | null = null;
  let controllerUnsubscribe: (() => void) | null = null;

  // Subscribers for broadcasts
  const subscribers = new Set<SubscriberCallback>();

  function broadcast(message: ServerMessage): void {
    for (const callback of subscribers) {
      try {
        callback(message);
      } catch (err) {
        console.error('SequenceManager subscriber error:', err);
      }
    }
  }

  // Library operations
  function listLibrary(): SequenceDefinition[] {
    return Array.from(library.values());
  }

  function saveToLibrary(partial: Omit<SequenceDefinition, 'id' | 'createdAt' | 'updatedAt'>): string {
    const now = Date.now();
    const definition: SequenceDefinition = {
      ...partial,
      id: generateSequenceId(),
      createdAt: now,
      updatedAt: now,
    };
    library.set(definition.id, definition);
    return definition.id;
  }

  function updateInLibrary(definition: SequenceDefinition): Result<void, Error> {
    if (!library.has(definition.id)) {
      return Err(new Error(`Sequence not found: ${definition.id}`));
    }
    library.set(definition.id, {
      ...definition,
      updatedAt: Date.now(),
    });
    return Ok();
  }

  function deleteFromLibrary(sequenceId: string): Result<void, Error> {
    if (!library.delete(sequenceId)) {
      return Err(new Error(`Sequence not found: ${sequenceId}`));
    }
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

      // Clean up when sequence ends
      if (message.type === 'sequenceCompleted' ||
          message.type === 'sequenceAborted' ||
          message.type === 'sequenceError') {
        cleanupController();
      }
    });

    try {
      await activeController.start();
      return Ok(activeController.getState());
    } catch (err) {
      cleanupController();
      return Err(err instanceof Error ? err : new Error(String(err)));
    }
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

  function stop(): void {
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
    stop,
  };
}
