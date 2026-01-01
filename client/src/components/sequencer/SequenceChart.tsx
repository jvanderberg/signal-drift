/**
 * SequenceChart - Timeline visualization of sequence steps with playhead
 *
 * Shows:
 * - Step values over time as a step graph
 * - Vertical playhead when sequence is running
 * - Pre/post values if configured
 */

import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import type { SequenceDefinition, SequenceState } from '../../types';
import { isArbitrary, isRandomWalk, resolveWaveformSteps, applyModifiers } from '../../types';

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

  // Check if this is a random walk (needs live tracking)
  const isRandomWalkWaveform = isRandomWalk(sequence.waveform);

  // Track actual commanded values during playback (for random walk)
  const [actualValues, setActualValues] = useState<number[]>([]);
  const lastCycleRef = useRef<number>(-1);

  // Reset actual values when sequence changes or new run starts
  useEffect(() => {
    if (!activeState || activeState.executionState === 'idle') {
      setActualValues([]);
      lastCycleRef.current = -1;
    } else if (activeState.currentCycle !== lastCycleRef.current) {
      // New cycle started - reset values for this cycle
      setActualValues([]);
      lastCycleRef.current = activeState.currentCycle;
    }
  }, [activeState?.executionState, activeState?.currentCycle]);

  // Record commanded values as they come in
  useEffect(() => {
    if (!activeState || !isRandomWalkWaveform) return;
    if (activeState.executionState !== 'running' && activeState.executionState !== 'paused') return;

    const stepIndex = activeState.currentStepIndex;
    setActualValues(prev => {
      // Only add if we haven't recorded this step yet
      if (prev.length <= stepIndex) {
        const newValues = [...prev];
        // Fill any gaps (shouldn't happen but be safe)
        while (newValues.length < stepIndex) {
          newValues.push(activeState.commandedValue);
        }
        newValues.push(activeState.commandedValue);
        return newValues;
      }
      return prev;
    });
  }, [activeState?.currentStepIndex, activeState?.commandedValue, isRandomWalkWaveform]);

  // Compute steps from sequence definition (using shared utilities)
  const steps = useMemo(() => {
    const rawSteps = resolveWaveformSteps(sequence.waveform);
    return applyModifiers(rawSteps, sequence.scale, sequence.offset, sequence.minClamp, sequence.maxClamp);
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

  // Compute value range (includes actual values for random walk)
  const range = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;

    for (const step of steps) {
      if (step.value < min) min = step.value;
      if (step.value > max) max = step.value;
    }

    // Include actual commanded values (for random walk during playback)
    for (const val of actualValues) {
      if (val < min) min = val;
      if (val > max) max = val;
    }

    // Include pre/post values
    if (sequence.preValue !== undefined) {
      let preVal = sequence.preValue;
      if (sequence.scale !== undefined) preVal *= sequence.scale;
      if (sequence.offset !== undefined) preVal += sequence.offset;
      if (sequence.minClamp !== undefined) preVal = Math.max(preVal, sequence.minClamp);
      if (sequence.maxClamp !== undefined) preVal = Math.min(preVal, sequence.maxClamp);
      min = Math.min(min, preVal);
      max = Math.max(max, preVal);
    }
    if (sequence.postValue !== undefined) {
      let postVal = sequence.postValue;
      if (sequence.scale !== undefined) postVal *= sequence.scale;
      if (sequence.offset !== undefined) postVal += sequence.offset;
      if (sequence.minClamp !== undefined) postVal = Math.max(postVal, sequence.minClamp);
      if (sequence.maxClamp !== undefined) postVal = Math.min(postVal, sequence.maxClamp);
      min = Math.min(min, postVal);
      max = Math.max(max, postVal);
    }

    // Add padding
    const padding = (max - min) * 0.1 || 1;
    return { min: min - padding, max: max + padding };
  }, [steps, sequence, actualValues]);

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

    // For random walk during playback: only show actual values, not preview
    const isPlayingRandomWalk = isRandomWalkWaveform && activeState &&
      (activeState.executionState === 'running' || activeState.executionState === 'paused');

    // Draw waveform - either preview steps or actual commanded values
    ctx.strokeStyle = colors.waveform;
    ctx.lineWidth = 2;
    ctx.beginPath();

    // Use actual values for random walk during playback, otherwise use preview steps
    const valuesToDraw = isPlayingRandomWalk && actualValues.length > 0 ? actualValues : steps.map(s => s.value);

    for (let i = 0; i < valuesToDraw.length; i++) {
      const x = xToPixel(timing.times[i]);
      const y = yToPixel(valuesToDraw[i]);
      const nextX = i < valuesToDraw.length - 1
        ? xToPixel(timing.times[i + 1])
        : xToPixel(timing.totalDuration);

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
  }, [steps, timing, range, activeState, colors, containerSize, actualValues, isRandomWalkWaveform]);

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
