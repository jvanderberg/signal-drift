/**
 * Simulation Module
 * Creates simulated devices using real drivers with simulated transports
 *
 * Usage:
 *   const { psuDriver, loadDriver, oscilloscopeDriver, connection } = createSimulatedDevices();
 *
 * Topology:
 *   PSU (3-12V) → Boost Converter → 24V Output → Load
 *                      ↓
 *              Oscilloscope observes:
 *              - CH1: PWM gate signal
 *              - CH2: Switching node voltage
 *              - CH3: Output voltage with ripple
 *              - CH4: Input current waveform
 *
 * Configuration via environment variables:
 *   SIM_MEASUREMENT_STABILITY_PPM - Proportional measurement noise (default: 100 PPM)
 *   SIM_MEASUREMENT_NOISE_FLOOR_MV - Absolute noise floor in mV (default: 1.0)
 *   SIM_PSU_OUTPUT_IMPEDANCE - PSU output impedance in ohms (default: 0.005)
 *   SIM_LOAD_CV_GAIN - Load CV mode gain in A/V (default: 10)
 *   SIM_PSU_LATENCY_MS - PSU command latency (default: 50ms)
 *   SIM_LOAD_LATENCY_MS - Load command latency (default: 20ms)
 *   SIM_SCOPE_LATENCY_MS - Oscilloscope command latency (default: 10ms)
 */

import type { DeviceDriver, OscilloscopeDriver } from '../types.js';
import {
  createVirtualConnection,
  type VirtualConnection,
  type VirtualConnectionConfig,
} from './virtual-connection.js';
import { createPsuSimulator } from './psu-simulator.js';
import { createLoadSimulator } from './load-simulator.js';
import { createOscilloscopeSimulator } from './oscilloscope-simulator.js';
import { createSimulatedTransport } from './simulated-transport.js';
import { createMatrixWPS300S } from '../drivers/matrix-wps300s.js';
import { createRigolDL3021 } from '../drivers/rigol-dl3021.js';
import { createRigolOscilloscope } from '../drivers/rigol-oscilloscope.js';

export interface SimulatedDevicesConfig extends VirtualConnectionConfig {
  /** PSU command latency in ms (default: 50, matches real serial behavior) */
  psuLatencyMs?: number;
  /** Load command latency in ms (default: 20, matches USB-TMC) */
  loadLatencyMs?: number;
  /** Oscilloscope command latency in ms (default: 10, fast USB-TMC) */
  scopeLatencyMs?: number;
  /** Latency jitter in ms (default: 5) */
  latencyJitterMs?: number;
  /** Load serial number for identification (default: DL3A000000001) */
  loadSerialNumber?: string;
  /** Oscilloscope serial number for identification (default: DS1ZA000000001) */
  scopeSerialNumber?: string;
}

export interface SimulatedDevices {
  psuDriver: DeviceDriver;
  loadDriver: DeviceDriver;
  oscilloscopeDriver: OscilloscopeDriver;
  connection: VirtualConnection;
}

/**
 * Load configuration from environment variables with defaults.
 */
function loadConfigFromEnv(): SimulatedDevicesConfig {
  const parseFloat = (envVar: string | undefined, defaultVal: number): number => {
    if (!envVar) return defaultVal;
    const parsed = Number.parseFloat(envVar);
    return Number.isNaN(parsed) ? defaultVal : parsed;
  };

  return {
    measurementStabilityPPM: parseFloat(process.env.SIM_MEASUREMENT_STABILITY_PPM, 100),
    measurementNoiseFloorMv: parseFloat(process.env.SIM_MEASUREMENT_NOISE_FLOOR_MV, 1.0),
    psuOutputImpedance: parseFloat(process.env.SIM_PSU_OUTPUT_IMPEDANCE, 0.005),
    loadCvGain: parseFloat(process.env.SIM_LOAD_CV_GAIN, 10),
    psuLatencyMs: parseFloat(process.env.SIM_PSU_LATENCY_MS, 50),
    loadLatencyMs: parseFloat(process.env.SIM_LOAD_LATENCY_MS, 20),
    scopeLatencyMs: parseFloat(process.env.SIM_SCOPE_LATENCY_MS, 10),
    latencyJitterMs: parseFloat(process.env.SIM_LATENCY_JITTER_MS, 5),
    loadSerialNumber: process.env.SIM_LOAD_SERIAL || 'DL3A000000001',
    scopeSerialNumber: process.env.SIM_SCOPE_SERIAL || 'DS1ZA000000001',
  };
}

/**
 * Create a complete simulated device setup with PSU, Load, and Oscilloscope
 * electrically connected through a virtual connection with a boost converter.
 *
 * @param config Optional configuration (defaults loaded from environment variables)
 */
export function createSimulatedDevices(
  config: SimulatedDevicesConfig = {}
): SimulatedDevices {
  // Merge provided config with environment defaults
  const envConfig = loadConfigFromEnv();
  const resolvedConfig: Required<SimulatedDevicesConfig> = {
    measurementStabilityPPM: config.measurementStabilityPPM ?? envConfig.measurementStabilityPPM ?? 100,
    measurementNoiseFloorMv: config.measurementNoiseFloorMv ?? envConfig.measurementNoiseFloorMv ?? 1.0,
    psuOutputImpedance: config.psuOutputImpedance ?? envConfig.psuOutputImpedance ?? 0.005,
    loadCvGain: config.loadCvGain ?? envConfig.loadCvGain ?? 10,
    boostTargetVoltage: config.boostTargetVoltage ?? envConfig.boostTargetVoltage ?? 24,
    boostSwitchingFrequency: config.boostSwitchingFrequency ?? envConfig.boostSwitchingFrequency ?? 200000,
    boostEfficiency: config.boostEfficiency ?? envConfig.boostEfficiency ?? 0.90,
    boostOutputCapacitance: config.boostOutputCapacitance ?? envConfig.boostOutputCapacitance ?? 100,
    boostInductance: config.boostInductance ?? envConfig.boostInductance ?? 22,
    boostEnabled: config.boostEnabled ?? envConfig.boostEnabled ?? true,
    boostDiodeVoltage: config.boostDiodeVoltage ?? envConfig.boostDiodeVoltage ?? 0.5,
    boostSwitchResistance: config.boostSwitchResistance ?? envConfig.boostSwitchResistance ?? 0.1,
    boostInductorResistance: config.boostInductorResistance ?? envConfig.boostInductorResistance ?? 0.1,
    psuLatencyMs: config.psuLatencyMs ?? envConfig.psuLatencyMs ?? 50,
    loadLatencyMs: config.loadLatencyMs ?? envConfig.loadLatencyMs ?? 20,
    scopeLatencyMs: config.scopeLatencyMs ?? envConfig.scopeLatencyMs ?? 10,
    latencyJitterMs: config.latencyJitterMs ?? envConfig.latencyJitterMs ?? 5,
    loadSerialNumber: config.loadSerialNumber ?? envConfig.loadSerialNumber ?? 'DL3A000000001',
    scopeSerialNumber: config.scopeSerialNumber ?? envConfig.scopeSerialNumber ?? 'DS1ZA000000001',
  };

  // Create the virtual electrical connection with physics config
  const connection = createVirtualConnection({
    measurementStabilityPPM: resolvedConfig.measurementStabilityPPM,
    measurementNoiseFloorMv: resolvedConfig.measurementNoiseFloorMv,
    psuOutputImpedance: resolvedConfig.psuOutputImpedance,
    loadCvGain: resolvedConfig.loadCvGain,
    boostTargetVoltage: resolvedConfig.boostTargetVoltage,
    boostSwitchingFrequency: resolvedConfig.boostSwitchingFrequency,
    boostEfficiency: resolvedConfig.boostEfficiency,
    boostOutputCapacitance: resolvedConfig.boostOutputCapacitance,
    boostInductance: resolvedConfig.boostInductance,
    boostEnabled: resolvedConfig.boostEnabled,
    boostDiodeVoltage: resolvedConfig.boostDiodeVoltage,
    boostSwitchResistance: resolvedConfig.boostSwitchResistance,
    boostInductorResistance: resolvedConfig.boostInductorResistance,
  });

  // Create simulators that use the connection
  const psuSimulator = createPsuSimulator(connection);
  const loadSimulator = createLoadSimulator(connection, resolvedConfig.loadSerialNumber);
  const scopeSimulator = createOscilloscopeSimulator(connection, resolvedConfig.scopeSerialNumber);

  // Create transports that route commands to simulators
  // PSU uses higher latency to match real serial behavior
  const psuTransport = createSimulatedTransport(
    cmd => psuSimulator.handleCommand(cmd),
    {
      latencyMs: resolvedConfig.psuLatencyMs,
      jitterMs: resolvedConfig.latencyJitterMs,
      name: 'psu-sim',
    }
  );

  // Load uses lower latency to match USB-TMC
  const loadTransport = createSimulatedTransport(
    cmd => loadSimulator.handleCommand(cmd),
    {
      latencyMs: resolvedConfig.loadLatencyMs,
      jitterMs: resolvedConfig.latencyJitterMs,
      name: 'load-sim',
    }
  );

  // Oscilloscope uses fast USB-TMC with binary support
  const scopeTransport = createSimulatedTransport(
    cmd => scopeSimulator.handleCommand(cmd),
    {
      latencyMs: resolvedConfig.scopeLatencyMs,
      jitterMs: resolvedConfig.latencyJitterMs,
      name: 'scope-sim',
    },
    cmd => scopeSimulator.handleBinaryCommand(cmd)
  );

  // Create drivers using the simulated transports
  // The drivers work unchanged - they just talk to a different transport
  const psuDriver = createMatrixWPS300S(psuTransport);
  const loadDriver = createRigolDL3021(loadTransport);
  const oscilloscopeDriver = createRigolOscilloscope(scopeTransport);

  // Override the driver IDs to indicate simulation
  // Note: This is a type-safety workaround. A cleaner approach would be
  // to add a simulationId parameter to the driver factories.
  (psuDriver.info as { id: string }).id = 'matrix-wps300s-sim';
  (loadDriver.info as { id: string }).id = `rigol-dl3021-sim-${resolvedConfig.loadSerialNumber}`;
  (oscilloscopeDriver.info as { id: string }).id = `rigol-ds1054z-sim-${resolvedConfig.scopeSerialNumber}`;

  return {
    psuDriver,
    loadDriver,
    oscilloscopeDriver,
    connection,
  };
}

// Re-export types
export type { VirtualConnection, VirtualConnectionConfig, BoostConverterState } from './virtual-connection.js';
export type { PsuSimulator } from './psu-simulator.js';
export type { LoadSimulator } from './load-simulator.js';
export type { OscilloscopeSimulator } from './oscilloscope-simulator.js';
