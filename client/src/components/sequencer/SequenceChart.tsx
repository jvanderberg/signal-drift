/**
 * SequenceChart - Timeline visualization of sequence steps with playhead
 *
 * Shows:
 * - Step values over time as a step graph
 * - Vertical playhead when sequence is running
 * - Pre/post values if configured
 */

import { useMemo, useRef, useEffect, useState } from 'react';
import type { SequenceDefinition, SequenceState, WaveformParams, ArbitraryWaveform, SequenceStep } from '../../types';

// Hook to detect dark mode (same as LiveChart)
function useIsDarkMode(): boolean {
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    const theme = document.documentElement.getAttribute('data-theme');
    if (theme) return theme === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const observer = new MutationObserver(() => {
      const theme = document.documentElement.getAttribute('data-theme');
      if (theme) {
        setIsDark(theme === 'dark');
      } else {
        setIsDark(mediaQuery.matches);
      }
    });

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    const handleChange = (e: MediaQueryListEvent) => {
      const theme = document.documentElement.getAttribute('data-theme');
      if (!theme) setIsDark(e.matches);
    };
    mediaQuery.addEventListener('change', handleChange);

    return () => {
      observer.disconnect();
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  return isDark;
}

interface SequenceChartProps {
  sequence: SequenceDefinition;
  activeState: SequenceState | null;
}

// Check if waveform is arbitrary (has steps array)
function isArbitrary(waveform: WaveformParams | ArbitraryWaveform): waveform is ArbitraryWaveform {
  return 'steps' in waveform;
}

// Generate steps from waveform params (simplified version - matches server)
function generateSteps(params: WaveformParams): SequenceStep[] {
  const { type, min, max, pointsPerCycle, intervalMs } = params;
  const steps: SequenceStep[] = [];
  const amplitude = (max - min) / 2;
  const center = min + amplitude;

  switch (type) {
    case 'sine':
      // N loopable points, ending at center
      // First point is one step after center, last point is center
      for (let i = 1; i <= pointsPerCycle; i++) {
        const angle = (2 * Math.PI * i) / pointsPerCycle;
        const value = center + amplitude * Math.sin(angle);
        steps.push({ value, dwellMs: intervalMs });
      }
      break;

    case 'triangle':
      // N loopable points, ending at min
      for (let i = 1; i <= pointsPerCycle; i++) {
        const t = i / pointsPerCycle;
        let value: number;
        if (t <= 0.5) {
          value = min + (max - min) * (t * 2);
        } else {
          value = max - (max - min) * ((t - 0.5) * 2);
        }
        steps.push({ value, dwellMs: intervalMs });
      }
      break;

    case 'ramp':
      for (let i = 0; i < pointsPerCycle; i++) {
        const t = pointsPerCycle > 1 ? i / (pointsPerCycle - 1) : 0;
        const value = min + (max - min) * t;
        steps.push({ value, dwellMs: intervalMs });
      }
      break;

    case 'square': {
      const halfPoints = Math.floor(pointsPerCycle / 2);
      for (let i = 0; i < halfPoints; i++) {
        steps.push({ value: max, dwellMs: intervalMs });
      }
      for (let i = 0; i < pointsPerCycle - halfPoints; i++) {
        steps.push({ value: min, dwellMs: intervalMs });
      }
      break;
    }

    case 'steps':
    default:
      for (let i = 0; i < pointsPerCycle; i++) {
        const t = pointsPerCycle > 1 ? i / (pointsPerCycle - 1) : 0;
        const value = min + (max - min) * t;
        steps.push({ value, dwellMs: intervalMs });
      }
      break;
  }

  return steps;
}

// Apply modifiers to steps
function applyModifiers(
  steps: SequenceStep[],
  scale?: number,
  offset?: number,
  maxClamp?: number
): SequenceStep[] {
  if (scale === undefined && offset === undefined && maxClamp === undefined) {
    return steps;
  }

  return steps.map((step) => {
    let value = step.value;
    if (scale !== undefined) value *= scale;
    if (offset !== undefined) value += offset;
    if (maxClamp !== undefined) value = Math.min(value, maxClamp);
    return { ...step, value };
  });
}

export function SequenceChart({ sequence, activeState }: SequenceChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDarkMode = useIsDarkMode();

  // Theme-aware colors (matching LiveChart)
  const colors = useMemo(() => ({
    grid: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(128, 128, 128, 0.15)',
    text: isDarkMode ? '#9090a0' : '#666666',
    waveform: '#3b82f6',
    playhead: '#ef4444',
  }), [isDarkMode]);

  // Compute steps from sequence definition
  const steps = useMemo(() => {
    const rawSteps = isArbitrary(sequence.waveform)
      ? sequence.waveform.steps
      : generateSteps(sequence.waveform);
    return applyModifiers(rawSteps, sequence.scale, sequence.offset, sequence.maxClamp);
  }, [sequence]);

  // Compute timing for all steps
  const timing = useMemo(() => {
    const times: number[] = [];
    let cumulative = 0;
    for (const step of steps) {
      times.push(cumulative);
      cumulative += step.dwellMs;
    }
    return { times, totalDuration: cumulative };
  }, [steps]);

  // Compute value range
  const range = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;

    for (const step of steps) {
      if (step.value < min) min = step.value;
      if (step.value > max) max = step.value;
    }

    // Include pre/post values
    if (sequence.preValue !== undefined) {
      let preVal = sequence.preValue;
      if (sequence.scale !== undefined) preVal *= sequence.scale;
      if (sequence.offset !== undefined) preVal += sequence.offset;
      if (sequence.maxClamp !== undefined) preVal = Math.min(preVal, sequence.maxClamp);
      min = Math.min(min, preVal);
      max = Math.max(max, preVal);
    }
    if (sequence.postValue !== undefined) {
      let postVal = sequence.postValue;
      if (sequence.scale !== undefined) postVal *= sequence.scale;
      if (sequence.offset !== undefined) postVal += sequence.offset;
      if (sequence.maxClamp !== undefined) postVal = Math.min(postVal, sequence.maxClamp);
      min = Math.min(min, postVal);
      max = Math.max(max, postVal);
    }

    // Add padding
    const padding = (max - min) * 0.1 || 1;
    return { min: min - padding, max: max + padding };
  }, [steps, sequence]);

  // Track container size for redraw
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Watch for container resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Draw the chart
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || containerSize.width === 0 || containerSize.height === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Use tracked container size
    const dpr = window.devicePixelRatio || 1;
    canvas.width = containerSize.width * dpr;
    canvas.height = containerSize.height * dpr;
    ctx.scale(dpr, dpr);

    const width = containerSize.width;
    const height = containerSize.height;
    const padding = { left: 40, right: 10, top: 10, bottom: 20 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;

    // Clear (transparent - CSS handles background)
    ctx.clearRect(0, 0, width, height);

    // Helper functions
    const xToPixel = (ms: number) => padding.left + (ms / timing.totalDuration) * plotWidth;
    const yToPixel = (val: number) =>
      padding.top + plotHeight - ((val - range.min) / (range.max - range.min)) * plotHeight;

    // Draw grid lines
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;

    // Horizontal grid (value)
    const valueStep = (range.max - range.min) / 4;
    for (let v = range.min; v <= range.max; v += valueStep) {
      const y = yToPixel(v);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();

      // Label
      ctx.fillStyle = colors.text;
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(v.toFixed(1), padding.left - 4, y + 3);
    }

    // Draw step waveform
    ctx.strokeStyle = colors.waveform;
    ctx.lineWidth = 2;
    ctx.beginPath();

    for (let i = 0; i < steps.length; i++) {
      const x = xToPixel(timing.times[i]);
      const y = yToPixel(steps[i].value);
      const nextX = i < steps.length - 1 ? xToPixel(timing.times[i + 1]) : xToPixel(timing.totalDuration);

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      ctx.lineTo(nextX, y);
    }
    ctx.stroke();

    // Draw playhead if running
    if (activeState && (activeState.executionState === 'running' || activeState.executionState === 'paused')) {
      // Calculate position based on current step index (perfectly synced with server)
      const stepIndex = Math.min(activeState.currentStepIndex, steps.length - 1);
      const x = xToPixel(timing.times[stepIndex] ?? 0);

      ctx.strokeStyle = colors.playhead;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, height - padding.bottom);
      ctx.stroke();

      // Draw current value marker
      const y = yToPixel(activeState.commandedValue);
      ctx.fillStyle = colors.playhead;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Time axis labels
    ctx.fillStyle = colors.text;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';

    const timeLabels = [0, timing.totalDuration / 2, timing.totalDuration];
    for (const t of timeLabels) {
      const x = xToPixel(t);
      ctx.fillText(`${(t / 1000).toFixed(1)}s`, x, height - 4);
    }
  }, [steps, timing, range, activeState, colors, containerSize]);

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full rounded"
        style={{ background: 'var(--color-bg-secondary)' }}
      />
    </div>
  );
}
