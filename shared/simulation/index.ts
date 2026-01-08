/**
 * Shared Simulation Module
 *
 * Contains the core physics simulation for the virtual electrical circuit
 * (PSU → Boost Converter → Load) and device simulators that respond to SCPI commands.
 *
 * Used by both:
 * - Server (USE_SIMULATED_DEVICES=true mode)
 * - Demo (browser-based static demo)
 */

export {
  createVirtualConnection,
  type VirtualConnection,
  type VirtualConnectionConfig,
  type VirtualConnectionState,
  type BoostConverterState,
} from './virtual-connection.js';

export {
  createPsuSimulator,
  type PsuSimulator,
} from './psu-simulator.js';

export {
  createLoadSimulator,
  type LoadSimulator,
} from './load-simulator.js';

export {
  createOscilloscopeSimulator,
  type OscilloscopeSimulator,
} from './oscilloscope-simulator.js';
