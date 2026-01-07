/**
 * Oscilloscope Simulator
 * Simulates a Rigol DS1054Z-like oscilloscope with SCPI commands
 *
 * Channels:
 *   - CH1: PWM gate drive signal (0-5V square wave at switching frequency)
 *   - CH2: Switching node voltage (0V during on-time, Vout during off-time, with ringing)
 *   - CH3: Output voltage (DC with switching ripple)
 *   - CH4: Input current waveform (triangle wave representing inductor current)
 *
 * The waveforms are generated based on the boost converter state from VirtualConnection.
 */

import type { VirtualConnection, BoostConverterState } from './virtual-connection.js';

export interface OscilloscopeSimulator {
  handleCommand(cmd: string): string | null;
  handleBinaryCommand(cmd: string): Buffer | null;
}

interface ChannelState {
  enabled: boolean;
  scale: number;      // V/div
  offset: number;     // V
  coupling: 'AC' | 'DC' | 'GND';
  probe: number;      // 1, 10, 100
  bwLimit: boolean;
}

interface TriggerState {
  source: string;
  mode: 'edge' | 'pulse' | 'slope' | 'video';
  coupling: 'AC' | 'DC' | 'LFReject' | 'HFReject';
  level: number;
  slope: 'POS' | 'NEG' | 'RFAL';
  sweep: 'AUTO' | 'NORM' | 'SING';
}

interface TimebaseState {
  scale: number;      // s/div
  offset: number;     // s
  mode: 'MAIN' | 'ZOOM' | 'ROLL';
}

interface WaveformState {
  source: string;
  mode: 'NORM' | 'RAW' | 'MAX';
  format: 'BYTE' | 'WORD' | 'ASC';
  start: number;
  stop: number;
}

const NUM_CHANNELS = 4;
const MEMORY_DEPTH = 12000;  // Screen points
const SAMPLE_RATE = 1e9;     // 1 GSa/s nominal

export function createOscilloscopeSimulator(
  connection: VirtualConnection,
  serialNumber: string = 'DS1ZA000000001'
): OscilloscopeSimulator {
  // Oscilloscope state
  let running = true;
  let triggerStatus: 'TD' | 'WAIT' | 'RUN' | 'AUTO' | 'STOP' = 'AUTO';

  const channels: Record<string, ChannelState> = {};
  for (let i = 1; i <= NUM_CHANNELS; i++) {
    channels[`CHAN${i}`] = {
      enabled: true,  // All 4 channels enabled by default
      scale: i === 3 ? 5 : i === 4 ? 0.5 : 2,  // 5V/div for output, 0.5V for current, 2V for others
      offset: 0,
      coupling: 'DC',
      probe: 1,
      bwLimit: false,
    };
  }

  const trigger: TriggerState = {
    source: 'CHAN1',
    mode: 'edge',
    coupling: 'DC',
    level: 2.5,  // Middle of PWM signal
    slope: 'POS',
    sweep: 'AUTO',
  };

  const timebase: TimebaseState = {
    scale: 1e-6,  // 1µs/div - good for 200kHz switching
    offset: 0,
    mode: 'MAIN',
  };

  const waveform: WaveformState = {
    source: 'CHAN1',
    mode: 'NORM',
    format: 'BYTE',
    start: 1,
    stop: MEMORY_DEPTH,
  };

  /**
   * Generate waveform points for a channel based on boost converter state
   */
  function generateWaveform(channel: string, numPoints: number): number[] {
    const boostState = connection.getBoostConverterState();
    const points: number[] = new Array(numPoints);

    // Time span based on timebase (12 divisions on screen)
    const timeSpan = timebase.scale * 12;
    const dt = timeSpan / numPoints;

    // Calculate how many switching cycles fit in the time span
    const period = 1 / boostState.switchingFrequency;
    const dutyCycle = boostState.dutyCycle;

    for (let i = 0; i < numPoints; i++) {
      const t = i * dt + timebase.offset;
      // Position within switching cycle (0 to 1)
      const cyclePos = ((t % period) + period) % period / period;

      let voltage: number;

      switch (channel) {
        case 'CHAN1':
          // PWM gate drive signal: 0V during off-time, 5V during on-time
          voltage = generatePwmSignal(cyclePos, dutyCycle, boostState.active);
          break;

        case 'CHAN2':
          // Switching node voltage
          voltage = generateSwitchingNode(cyclePos, dutyCycle, boostState);
          break;

        case 'CHAN3':
          // Output voltage with ripple
          voltage = generateOutputVoltage(cyclePos, dutyCycle, boostState);
          break;

        case 'CHAN4':
          // Input current (inductor current waveform)
          voltage = generateInputCurrent(cyclePos, dutyCycle, boostState);
          break;

        default:
          voltage = 0;
      }

      // Add small noise
      voltage += (Math.random() - 0.5) * 0.02;

      points[i] = voltage;
    }

    return points;
  }

  /**
   * CH1: PWM gate drive signal
   * Square wave: 5V during on-time (0 to D), 0V during off-time (D to 1)
   */
  function generatePwmSignal(cyclePos: number, dutyCycle: number, active: boolean): number {
    if (!active) return 0;

    // Add slight rise/fall time for realism
    const riseTime = 0.01;  // 1% of cycle

    if (cyclePos < dutyCycle - riseTime) {
      return 5.0;  // Fully on
    } else if (cyclePos < dutyCycle) {
      // Falling edge
      const edgePos = (cyclePos - (dutyCycle - riseTime)) / riseTime;
      return 5.0 * (1 - edgePos);
    } else if (cyclePos < dutyCycle + riseTime) {
      // Just after falling edge - some ringing
      const ringing = Math.sin((cyclePos - dutyCycle) / riseTime * Math.PI * 3) * 0.3;
      return ringing;
    } else {
      return 0;  // Off
    }
  }

  /**
   * CH2: Switching node voltage
   * During on-time: ~0V (switch conducting)
   * During off-time: Vout + diode drop + ringing
   */
  function generateSwitchingNode(
    cyclePos: number,
    dutyCycle: number,
    state: BoostConverterState
  ): number {
    if (!state.active) return 0;

    const vOut = state.outputVoltage;
    const vIn = state.inputVoltage;

    if (cyclePos < dutyCycle) {
      // Switch on - voltage near 0 with small Rds(on) drop
      const rdsonDrop = state.inputCurrent * 0.01;  // ~10mΩ Rds(on)
      return rdsonDrop + (Math.random() - 0.5) * 0.1;
    } else {
      // Switch off - voltage rises to Vout + diode drop
      const transitionPos = (cyclePos - dutyCycle) / (1 - dutyCycle);

      if (transitionPos < 0.05) {
        // Rising edge with overshoot
        const overshoot = 1 + 0.15 * Math.exp(-transitionPos * 40) *
          Math.sin(transitionPos * 200);
        // Clamp to non-negative (real switching nodes can't go below ground)
        return Math.max(0, (vOut + 0.7) * Math.min(1, transitionPos * 20) * overshoot);
      } else if (transitionPos < 0.15) {
        // Ringing decay
        const ringing = Math.exp(-(transitionPos - 0.05) * 30) *
          Math.sin((transitionPos - 0.05) * 150) * 0.1 * vOut;
        return vOut + 0.7 + ringing;
      } else {
        // Steady at Vout + diode forward voltage
        return vOut + 0.7;
      }
    }
  }

  /**
   * CH3: Output voltage with switching ripple
   * DC voltage with triangular ripple superimposed
   */
  function generateOutputVoltage(
    cyclePos: number,
    dutyCycle: number,
    state: BoostConverterState
  ): number {
    if (!state.active) return 0;

    const vOut = state.outputVoltage;
    const ripple = state.outputRipple;

    // Triangular ripple: falls during switch-on (cap discharges), rises during switch-off
    // This is simplified - real ripple shape depends on ESR and load
    let rippleComponent: number;

    if (cyclePos < dutyCycle) {
      // During on-time, output cap discharges into load (voltage falls)
      rippleComponent = ripple / 2 - (ripple * cyclePos / dutyCycle);
    } else {
      // During off-time, diode conducts, cap charges (voltage rises)
      const offPos = (cyclePos - dutyCycle) / (1 - dutyCycle);
      rippleComponent = -ripple / 2 + (ripple * offPos);
    }

    return vOut + rippleComponent;
  }

  /**
   * CH4: Input current (inductor current)
   * Triangle wave: ramps up during on-time, ramps down during off-time
   * Displayed as voltage using current sense (0.1V/A)
   */
  function generateInputCurrent(
    cyclePos: number,
    dutyCycle: number,
    state: BoostConverterState
  ): number {
    if (!state.active) return 0;

    const iAvg = state.inputCurrent;
    const iRipple = state.inductorRipple;
    const currentSenseGain = 0.1;  // 0.1V per amp

    // Triangle wave centered on average current
    let current: number;

    if (cyclePos < dutyCycle) {
      // Ramping up during on-time
      const rampPos = cyclePos / dutyCycle;
      current = iAvg - iRipple / 2 + iRipple * rampPos;
    } else {
      // Ramping down during off-time
      const rampPos = (cyclePos - dutyCycle) / (1 - dutyCycle);
      current = iAvg + iRipple / 2 - iRipple * rampPos;
    }

    // Convert to voltage via current sense
    return current * currentSenseGain;
  }

  /**
   * Calculate measurement value for a channel
   */
  function calculateMeasurement(channel: string, type: string): number | null {
    const points = generateWaveform(channel, 1000);
    const min = Math.min(...points);
    const max = Math.max(...points);
    const sum = points.reduce((a, b) => a + b, 0);
    const avg = sum / points.length;

    // RMS calculation
    const sumSquares = points.reduce((a, b) => a + b * b, 0);
    const rms = Math.sqrt(sumSquares / points.length);

    // Frequency calculation (zero crossings)
    const boostState = connection.getBoostConverterState();

    switch (type.toUpperCase()) {
      case 'VPP':
        return max - min;
      case 'VMAX':
        return max;
      case 'VMIN':
        return min;
      case 'VAMP':
        return max - min;
      case 'VTOP':
        return max;
      case 'VBAS':
        return min;
      case 'VAVG':
        return avg;
      case 'VRMS':
        return rms;
      case 'FREQ':
        return boostState.active ? boostState.switchingFrequency : null;
      case 'PER':
        return boostState.active ? 1 / boostState.switchingFrequency : null;
      case 'PDUT':
        return boostState.active ? boostState.dutyCycle * 100 : null;
      case 'NDUT':
        return boostState.active ? (1 - boostState.dutyCycle) * 100 : null;
      case 'PWID':
        return boostState.active ?
          boostState.dutyCycle / boostState.switchingFrequency : null;
      case 'NWID':
        return boostState.active ?
          (1 - boostState.dutyCycle) / boostState.switchingFrequency : null;
      case 'RISE':
        return 10e-9;  // 10ns rise time
      case 'FALL':
        return 10e-9;  // 10ns fall time
      case 'OVER':
        return 5;  // 5% overshoot
      case 'PRES':
        return 3;  // 3% preshoot
      default:
        return null;
    }
  }

  function handleCommand(cmd: string): string | null {
    const trimmed = cmd.trim();
    const upper = trimmed.toUpperCase();

    // Identity
    if (upper === '*IDN?') {
      return `RIGOL TECHNOLOGIES,DS1054Z,${serialNumber},00.04.04.SP4`;
    }

    // Trigger status
    if (upper === ':TRIG:STAT?' || upper === 'TRIG:STAT?') {
      return triggerStatus;
    }

    // Acquisition
    if (upper === ':ACQ:SRAT?' || upper === 'ACQ:SRAT?') {
      return SAMPLE_RATE.toExponential(6);
    }
    if (upper === ':ACQ:MDEP?' || upper === 'ACQ:MDEP?') {
      return String(MEMORY_DEPTH);
    }

    // Channel queries and settings
    const chanMatch = upper.match(/^:?(CHAN\d):(\w+)\??(.*)$/);
    if (chanMatch) {
      const [, chan, param, valueStr] = chanMatch;
      const isQuery = upper.includes('?');
      const value = valueStr?.trim();
      const channelState = channels[chan];

      if (!channelState) {
        return isQuery ? '0' : null;
      }

      switch (param) {
        case 'DISP':
          if (isQuery) return channelState.enabled ? '1' : '0';
          channelState.enabled = value === 'ON' || value === '1';
          return null;
        case 'SCAL':
          if (isQuery) return channelState.scale.toExponential(6);
          channelState.scale = parseFloat(value) || 1;
          return null;
        case 'OFFS':
          if (isQuery) return channelState.offset.toExponential(6);
          channelState.offset = parseFloat(value) || 0;
          return null;
        case 'COUP':
          if (isQuery) return channelState.coupling;
          channelState.coupling = (value as 'AC' | 'DC' | 'GND') || 'DC';
          return null;
        case 'PROB':
          if (isQuery) return String(channelState.probe);
          channelState.probe = parseFloat(value) || 1;
          return null;
        case 'BWL':
          if (isQuery) return channelState.bwLimit ? 'ON' : 'OFF';
          channelState.bwLimit = value === 'ON' || value === '1';
          return null;
      }
    }

    // Timebase queries and settings
    if (upper.startsWith(':TIM:') || upper.startsWith('TIM:')) {
      const timMatch = upper.match(/^:?TIM:(\w+)\??(.*)$/);
      if (timMatch) {
        const [, param, valueStr] = timMatch;
        const isQuery = upper.includes('?');
        const value = valueStr?.trim();

        switch (param) {
          case 'SCAL':
            if (isQuery) return timebase.scale.toExponential(6);
            timebase.scale = parseFloat(value) || 1e-6;
            return null;
          case 'OFFS':
            if (isQuery) return timebase.offset.toExponential(6);
            timebase.offset = parseFloat(value) || 0;
            return null;
          case 'MODE':
            if (isQuery) return timebase.mode;
            timebase.mode = (value as 'MAIN' | 'ZOOM' | 'ROLL') || 'MAIN';
            return null;
        }
      }
    }

    // Trigger queries and settings
    if (upper.startsWith(':TRIG:') || upper.startsWith('TRIG:')) {
      if (upper.includes('MODE?')) return trigger.mode.toUpperCase();
      if (upper.includes('COUP?')) return trigger.coupling;
      if (upper.includes('EDG:SOUR?')) return trigger.source;
      if (upper.includes('EDG:LEV?')) return trigger.level.toExponential(6);
      if (upper.includes('EDG:SLOP?')) return trigger.slope;
      if (upper.includes('SWE?')) return trigger.sweep;

      // Setters
      const trigEdgeSourMatch = upper.match(/EDG:SOUR\s+(\S+)/);
      if (trigEdgeSourMatch) {
        trigger.source = trigEdgeSourMatch[1];
        return null;
      }
      const trigEdgLevMatch = upper.match(/EDG:LEV\s+([\d.eE+-]+)/);
      if (trigEdgLevMatch) {
        trigger.level = parseFloat(trigEdgLevMatch[1]) || 0;
        return null;
      }
      const trigEdgSlopMatch = upper.match(/EDG:SLOP\s+(\S+)/);
      if (trigEdgSlopMatch) {
        trigger.slope = trigEdgSlopMatch[1] as 'POS' | 'NEG' | 'RFAL';
        return null;
      }
      const trigSweMatch = upper.match(/SWE\s+(\S+)/);
      if (trigSweMatch) {
        trigger.sweep = trigSweMatch[1] as 'AUTO' | 'NORM' | 'SING';
        return null;
      }
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
      // Auto setup - adjust scales for current signals
      const boostState = connection.getBoostConverterState();
      if (boostState.active && boostState.switchingFrequency > 0) {
        channels['CHAN1'].scale = 2;  // 2V/div for 5V PWM
        channels['CHAN2'].scale = Math.max(1, boostState.outputVoltage / 4);  // Fit Vout
        channels['CHAN3'].scale = Math.max(1, boostState.outputVoltage / 4);
        channels['CHAN4'].scale = boostState.inputCurrent * 0.1 / 2 || 0.5;
        timebase.scale = 1 / boostState.switchingFrequency / 2;  // 2 cycles
      }
      return null;
    }
    if (upper === ':TFOR' || upper === 'TFOR') {
      triggerStatus = 'TD';
      return null;
    }

    // Measurements
    const measMatch = upper.match(/^:?MEAS:(\w+)\?\s*(\S+)?/);
    if (measMatch) {
      const [, measType, channel] = measMatch;
      const chan = channel || waveform.source;
      const value = calculateMeasurement(chan, measType);
      if (value === null) {
        return '9.9E37';  // Rigol's invalid measurement indicator
      }
      return value.toExponential(6);
    }

    // Waveform setup
    if (upper.match(/^:?WAV:SOUR\s+(\S+)/)) {
      const match = upper.match(/WAV:SOUR\s+(\S+)/);
      if (match) waveform.source = match[1];
      return null;
    }
    if (upper.match(/^:?WAV:MODE\s+(\S+)/)) {
      const match = upper.match(/WAV:MODE\s+(\S+)/);
      if (match) waveform.mode = match[1] as 'NORM' | 'RAW' | 'MAX';
      return null;
    }
    if (upper.match(/^:?WAV:FORM\s+(\S+)/)) {
      const match = upper.match(/WAV:FORM\s+(\S+)/);
      if (match) waveform.format = match[1] as 'BYTE' | 'WORD' | 'ASC';
      return null;
    }
    if (upper.match(/^:?WAV:STAR\s+(\d+)/)) {
      const match = upper.match(/WAV:STAR\s+(\d+)/);
      if (match) {
        const val = parseInt(match[1], 10);
        // Clamp to valid range (1-indexed, max MEMORY_DEPTH)
        waveform.start = Math.max(1, Math.min(val, MEMORY_DEPTH));
      }
      return null;
    }
    if (upper.match(/^:?WAV:STOP\s+(\d+)/)) {
      const match = upper.match(/WAV:STOP\s+(\d+)/);
      if (match) {
        const val = parseInt(match[1], 10);
        // Clamp to valid range and ensure stop >= start
        waveform.stop = Math.max(waveform.start, Math.min(val, MEMORY_DEPTH));
      }
      return null;
    }

    // Waveform preamble
    if (upper === ':WAV:PRE?' || upper === 'WAV:PRE?') {
      // format, type, points, count, xincrement, xorigin, xref, yincrement
      // Rigol DS1054Z: 8 vertical divisions (±4 from center), 256-level ADC
      const points = Math.min(waveform.stop - waveform.start + 1, MEMORY_DEPTH);
      const xIncrement = timebase.scale * 12 / points;
      const yIncrement = (channels[waveform.source]?.scale || 1) / 32;  // (8 divs * scale) / 256 levels
      return `0,0,${points},1,${xIncrement.toExponential(6)},0.0,0,${yIncrement.toExponential(6)}`;
    }

    // Y origin and reference
    if (upper === ':WAV:YOR?' || upper === 'WAV:YOR?') {
      const ch = channels[waveform.source];
      // Y origin is the offset in ADC counts (matching yIncrement = scale/32)
      return String(Math.round((ch?.offset || 0) / ((ch?.scale || 1) / 32)));
    }
    if (upper === ':WAV:YREF?' || upper === 'WAV:YREF?') {
      return '127';  // Center of 8-bit range
    }

    // Unknown command
    console.warn(`[Oscilloscope Simulator] Unknown command: ${cmd}`);
    return '';
  }

  function handleBinaryCommand(cmd: string): Buffer | null {
    const upper = cmd.trim().toUpperCase();

    // Waveform data
    if (upper === ':WAV:DATA?' || upper === 'WAV:DATA?') {
      const numPoints = Math.min(waveform.stop - waveform.start + 1, MEMORY_DEPTH);
      const voltagePoints = generateWaveform(waveform.source, numPoints);

      // Convert voltage to bytes using channel scaling
      const ch = channels[waveform.source];
      const scale = ch?.scale || 1;
      const offset = ch?.offset || 0;

      // Create byte array
      // Matches yIncrement = scale/32, meaning 8 divisions over 256 levels
      const data = Buffer.alloc(numPoints);
      for (let i = 0; i < numPoints; i++) {
        // Convert voltage to byte value (0-255, centered at 127)
        const voltage = voltagePoints[i] - offset;
        const normalized = voltage / (scale * 4);  // ±4 divisions from center
        const byteVal = Math.round(127 + normalized * 128);  // 128 for symmetric 256-level range
        data[i] = Math.max(0, Math.min(255, byteVal));
      }

      // Create TMC block format: #NdddddD...
      // N = number of digits in data length
      // ddddd = data length
      // D... = data bytes
      const dataLenStr = String(data.length);
      const header = `#${dataLenStr.length}${dataLenStr}`;
      return Buffer.concat([Buffer.from(header), data]);
    }

    // Screenshot (return a minimal PNG-like response)
    if (upper.startsWith(':DISP:DATA?')) {
      // Return a minimal valid response - in reality this would be a PNG
      // For simulation, return empty TMC block
      return Buffer.from('#10');
    }

    return null;
  }

  return {
    handleCommand,
    handleBinaryCommand,
  };
}
