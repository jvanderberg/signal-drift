/**
 * Simulation Module
 * Creates simulated devices using real drivers with simulated transports
 */

import type { DeviceDriver } from '../types.js';
import { createVirtualConnection, VirtualConnection } from './virtual-connection.js';
import { createPsuSimulator } from './psu-simulator.js';
import { createLoadSimulator } from './load-simulator.js';
import { createSimulatedTransport } from './simulated-transport.js';
import { createMatrixWPS300S } from '../drivers/matrix-wps300s.js';
import { createRigolDL3021 } from '../drivers/rigol-dl3021.js';

export interface SimulatedDevices {
  psuDriver: DeviceDriver;
  loadDriver: DeviceDriver;
  connection: VirtualConnection;
}

/**
 * Create a complete simulated device setup with PSU and Load
 * electrically connected through a virtual connection.
 */
export function createSimulatedDevices(): SimulatedDevices {
  // Create the virtual electrical connection
  const connection = createVirtualConnection();

  // Create simulators that use the connection
  const psuSimulator = createPsuSimulator(connection);
  const loadSimulator = createLoadSimulator(connection);

  // Create transports that route commands to simulators
  // PSU uses 50ms latency to match real serial behavior
  const psuTransport = createSimulatedTransport(
    cmd => psuSimulator.handleCommand(cmd),
    { latencyMs: 50, jitterMs: 5, name: 'psu-sim' }
  );

  // Load uses 20ms latency to match USB-TMC
  const loadTransport = createSimulatedTransport(
    cmd => loadSimulator.handleCommand(cmd),
    { latencyMs: 20, jitterMs: 5, name: 'load-sim' }
  );

  // Create drivers using the simulated transports
  // The drivers work unchanged - they just talk to a different transport
  const psuDriver = createMatrixWPS300S(psuTransport);
  const loadDriver = createRigolDL3021(loadTransport);

  // Override the driver IDs to indicate simulation
  (psuDriver.info as { id: string }).id = 'matrix-wps300s-sim';
  (loadDriver.info as { id: string }).id = 'rigol-dl3021-sim-DL3A000000001';

  return {
    psuDriver,
    loadDriver,
    connection,
  };
}

// Re-export types
export type { VirtualConnection } from './virtual-connection.js';
export type { PsuSimulator } from './psu-simulator.js';
export type { LoadSimulator } from './load-simulator.js';
