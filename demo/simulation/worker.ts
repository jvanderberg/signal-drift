/**
 * Demo Web Worker
 * Runs the simulation server in a Web Worker for non-blocking operation
 */

import { createDemoServer } from './demo-server';
import type { ClientMessage, ServerMessage } from '../../shared/types';

const server = createDemoServer();

// Forward server messages to main thread
server.onMessage((message: ServerMessage) => {
  self.postMessage(message);
});

// Handle messages from main thread
self.onmessage = (event: MessageEvent<ClientMessage>) => {
  server.handleMessage(event.data);
};

// Start the server
server.start();

// Notify main thread that worker is ready
self.postMessage({ type: 'workerReady' });
