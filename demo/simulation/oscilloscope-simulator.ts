/**
 * Oscilloscope Simulator (Browser-compatible version)
 * Simulates Rigol DS1054Z oscilloscope for demo mode
 */

import type { VirtualConnection, BoostConverterState } from './virtual-connection';

export interface OscilloscopeSimulator {
  handleCommand(cmd: string): string | null;
  generateWaveformData(channel: string, points: number): number[];
  getChannelConfig(): Record<string, ChannelConfig>;
  getTimebaseScale(): number;
}

interface ChannelConfig {
  enabled: boolean;
  scale: number;
  offset: number;
  coupling: 'AC' | 'DC' | 'GND';
  probe: number;
  bwLimit: boolean;
}

const NUM_CHANNELS = 4;

export function createOscilloscopeSimulator(
  connection: VirtualConnection,
  serialNumber: string = 'DS1ZA000000001'
): OscilloscopeSimulator {
  // Channel configuration
  const channels: Record<string, ChannelConfig> = {};
  for (let i = 1; i <= NUM_CHANNELS; i++) {
    channels[`CHAN${i}`] = {
      enabled: true, // All 4 channels enabled by default for demo
      scale: i === 1 ? 2 : i === 4 ? 0.5 : 5, // 2V/div for CH1, 0.5V for CH4 (current sense), 5V for others
      offset: 0,
      coupling: 'DC',
      probe: 1,
      bwLimit: false,
    };
  }

  // Timebase configuration
  let timebaseScale = 1e-6; // 1µs/div

  // Trigger configuration
  const trigger = {
    source: 'CHAN1',
    level: 2.5,
    slope: 'POS' as 'POS' | 'NEG' | 'RFAL',
    sweep: 'AUTO' as 'AUTO' | 'NORM' | 'SING',
  };

  let running = true;
  let triggerStatus = 'AUTO';

  /**
   * Generate waveform voltage points for a channel based on boost converter state
   */
  function generateWaveform(channel: string, numPoints: number): number[] {
    const boostState = connection.getBoostConverterState();
    const points: number[] = [];

    if (!boostState.active) {
      // Return zeros with small noise
      for (let i = 0; i < numPoints; i++) {
        points.push((Math.random() - 0.5) * 0.02);
      }
      return points;
    }

    const timeSpan = timebaseScale * 12; // 12 divisions
    const period = 1 / boostState.switchingFrequency;
    const dutyCycle = boostState.dutyCycle;

    for (let i = 0; i < numPoints; i++) {
      const t = (i / numPoints) * timeSpan;
      const cyclePos = (t % period) / period;

      let voltage: number;

      switch (channel) {
        case 'CHAN1': // PWM gate drive
          voltage = generatePwmSignal(cyclePos, dutyCycle);
          break;
        case 'CHAN2': // Switching node voltage
          voltage = generateSwitchingNode(cyclePos, dutyCycle, boostState);
          break;
        case 'CHAN3': // Output voltage
          voltage = generateOutputVoltage(cyclePos, dutyCycle, boostState);
          break;
        case 'CHAN4': // Inductor current (as voltage via sense resistor)
          voltage = generateInductorCurrent(cyclePos, dutyCycle, boostState);
          break;
        default:
          voltage = 0;
      }

      // Add small noise
      voltage += (Math.random() - 0.5) * 0.02;
      points.push(voltage);
    }

    return points;
  }

  function generatePwmSignal(cyclePos: number, dutyCycle: number): number {
    const onTime = dutyCycle;
    const riseTime = 0.01; // 1% of cycle for rise/fall

    if (cyclePos < riseTime) {
      return 5 * (cyclePos / riseTime);
    } else if (cyclePos < onTime) {
      return 5;
    } else if (cyclePos < onTime + riseTime) {
      return 5 * (1 - (cyclePos - onTime) / riseTime);
    } else {
      return 0;
    }
  }

  function generateSwitchingNode(
    cyclePos: number,
    dutyCycle: number,
    state: BoostConverterState
  ): number {
    const vOut = state.outputVoltage;
    const rdson = 0.01; // 10mΩ Rds(on)
    const inputCurrent = state.inputCurrent;

    if (cyclePos < dutyCycle) {
      // Switch on - near zero with Rds(on) drop
      return rdson * inputCurrent;
    } else {
      // Switch off - Vout + diode drop
      return vOut + 0.7;
    }
  }

  function generateOutputVoltage(
    cyclePos: number,
    dutyCycle: number,
    state: BoostConverterState
  ): number {
    const vOut = state.outputVoltage;
    const ripple = state.outputRipple;

    // Triangular ripple
    let rippleComponent: number;
    if (cyclePos < dutyCycle) {
      rippleComponent = ripple / 2 - (ripple * cyclePos / dutyCycle);
    } else {
      const offPos = (cyclePos - dutyCycle) / (1 - dutyCycle);
      rippleComponent = -ripple / 2 + (ripple * offPos);
    }

    return vOut + rippleComponent;
  }

  function generateInductorCurrent(
    cyclePos: number,
    dutyCycle: number,
    state: BoostConverterState
  ): number {
    const avgCurrent = state.inputCurrent;
    const ripple = state.inductorRipple;
    const senseGain = 0.1; // 0.1V/A

    let currentOffset: number;
    if (cyclePos < dutyCycle) {
      currentOffset = -ripple / 2 + (ripple * cyclePos / dutyCycle);
    } else {
      const offPos = (cyclePos - dutyCycle) / (1 - dutyCycle);
      currentOffset = ripple / 2 - (ripple * offPos);
    }

    return (avgCurrent + currentOffset) * senseGain;
  }

  function handleCommand(cmd: string): string | null {
    const upper = cmd.trim().toUpperCase();

    // Identity
    if (upper === '*IDN?' || upper === 'IDN?') {
      return `RIGOL TECHNOLOGIES,DS1054Z,${serialNumber},00.04.04.SP4`;
    }

    // Trigger status
    if (upper === ':TRIG:STAT?' || upper === 'TRIG:STAT?') {
      return triggerStatus;
    }

    // Acquisition queries
    if (upper === ':ACQ:SRAT?' || upper === 'ACQ:SRAT?') {
      return '1.000000e+09'; // 1 GSa/s
    }
    if (upper === ':ACQ:MDEP?' || upper === 'ACQ:MDEP?') {
      return '12000';
    }

    // Channel commands
    const chanMatch = upper.match(/^:?(CHAN(\d)):(\w+)\??(.*)$/);
    if (chanMatch) {
      const [, chan, , param, valueStr] = chanMatch;
      const ch = channels[chan];
      if (!ch) return '0';

      const isQuery = upper.includes('?');
      const value = valueStr?.trim();

      switch (param) {
        case 'DISP':
          if (isQuery) return ch.enabled ? '1' : '0';
          ch.enabled = value === 'ON' || value === '1';
          return null;
        case 'SCAL':
          if (isQuery) return ch.scale.toExponential(6);
          ch.scale = parseFloat(value) || 1;
          return null;
        case 'OFFS':
          if (isQuery) return ch.offset.toExponential(6);
          ch.offset = parseFloat(value) || 0;
          return null;
        case 'COUP':
          if (isQuery) return ch.coupling;
          if (value === 'AC' || value === 'DC' || value === 'GND') ch.coupling = value;
          return null;
        case 'PROB':
          if (isQuery) return String(ch.probe);
          ch.probe = parseInt(value, 10) || 1;
          return null;
        case 'BWL':
          if (isQuery) return ch.bwLimit ? 'ON' : 'OFF';
          ch.bwLimit = value === 'ON' || value === '1';
          return null;
      }
    }

    // Timebase commands
    if (upper.includes('TIM:SCAL')) {
      if (upper.includes('?')) return timebaseScale.toExponential(6);
      const match = upper.match(/TIM:SCAL\s+([\d.e+-]+)/i);
      if (match) timebaseScale = parseFloat(match[1]) || 1e-6;
      return null;
    }
    if (upper.includes('TIM:OFFS?')) return '0';
    if (upper.includes('TIM:MODE?')) return 'MAIN';

    // Trigger commands
    if (upper.includes('TRIG:MODE?')) return 'EDGE';
    if (upper.includes('TRIG:COUP?')) return 'DC';
    if (upper.includes('TRIG:EDG:SOUR?')) return trigger.source;
    if (upper.includes('TRIG:EDG:LEV?')) return String(trigger.level);
    if (upper.includes('TRIG:EDG:SLOP?')) return trigger.slope;
    if (upper.includes('TRIG:SWE?')) return trigger.sweep;

    // Trigger setters
    const trigSourMatch = upper.match(/TRIG:EDG:SOUR\s+(\S+)/);
    if (trigSourMatch) {
      trigger.source = trigSourMatch[1];
      return null;
    }
    const trigLevMatch = upper.match(/TRIG:EDG:LEV\s+([\d.e+-]+)/);
    if (trigLevMatch) {
      trigger.level = parseFloat(trigLevMatch[1]);
      return null;
    }
    const trigSlopMatch = upper.match(/TRIG:EDG:SLOP\s+(\S+)/);
    if (trigSlopMatch) {
      trigger.slope = trigSlopMatch[1] as 'POS' | 'NEG' | 'RFAL';
      return null;
    }
    const trigSwpMatch = upper.match(/TRIG:SWE\s+(\S+)/);
    if (trigSwpMatch) {
      trigger.sweep = trigSwpMatch[1] as 'AUTO' | 'NORM' | 'SING';
      return null;
    }

    // Run control
    if (upper === ':RUN' || upper === 'RUN') {
      running = true;
      triggerStatus = 'AUTO';
      return null;
    }
    if (upper === ':STOP' || upper === 'STOP') {
      running = false;
      triggerStatus = 'STOP';
      return null;
    }
    if (upper === ':SING' || upper === 'SING') {
      running = true;
      triggerStatus = 'WAIT';
      return null;
    }
    if (upper === ':AUT' || upper === 'AUT') {
      // Auto setup
      const boostState = connection.getBoostConverterState();
      if (boostState.active && boostState.switchingFrequency > 0) {
        channels['CHAN1'].scale = 2;
        channels['CHAN2'].scale = Math.max(1, boostState.outputVoltage / 4);
        channels['CHAN3'].scale = Math.max(1, boostState.outputVoltage / 4);
        channels['CHAN4'].scale = boostState.inputCurrent * 0.1 / 2 || 0.5;
        timebaseScale = 1 / boostState.switchingFrequency / 2;
      }
      return null;
    }
    if (upper === ':TFOR' || upper === 'TFOR') {
      triggerStatus = 'TD';
      return null;
    }

    // Measurement queries
    const measMatch = upper.match(/MEAS:(\w+)\?(?:\s+(\S+))?/);
    if (measMatch) {
      const [, measType, chanArg] = measMatch;
      const channel = chanArg || 'CHAN1';
      const waveform = generateWaveform(channel, 1000);
      const min = Math.min(...waveform);
      const max = Math.max(...waveform);

      switch (measType) {
        case 'VPP': return String(max - min);
        case 'VMAX': return String(max);
        case 'VMIN': return String(min);
        case 'VAVG': return String(waveform.reduce((a, b) => a + b, 0) / waveform.length);
        case 'FREQ': {
          const boostState = connection.getBoostConverterState();
          return String(boostState.active ? boostState.switchingFrequency : 0);
        }
        case 'PER': {
          const boostState = connection.getBoostConverterState();
          return String(boostState.active ? 1 / boostState.switchingFrequency : 0);
        }
        case 'PDUT': {
          const boostState = connection.getBoostConverterState();
          return String(boostState.active ? boostState.dutyCycle * 100 : 0);
        }
        default:
          return '9.9E37';
      }
    }

    // Default: unknown command
    return '';
  }

  return {
    handleCommand,
    generateWaveformData: generateWaveform,
    getChannelConfig: () => ({ ...channels }),
    getTimebaseScale: () => timebaseScale,
  };
}
