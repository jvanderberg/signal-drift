/**
 * WaveformDisplay - SVG-based waveform visualization
 *
 * Features:
 * - Fit-to-data scaling (Y-axis auto-scales to waveform min/max)
 * - Multi-channel support with distinct colors
 * - Draggable trigger level line
 * - Subtle grid option
 * - Responsive sizing with ResizeObserver
 * - Theme-aware colors via CSS variables
 */

import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import type { WaveformData } from '../../../shared/types';

// Channel colors via CSS variables (theme-aware)
const CHANNEL_COLORS: Record<string, string> = {
  CHAN1: 'var(--color-waveform-chan1)',
  CHAN2: 'var(--color-waveform-chan2)',
  CHAN3: 'var(--color-waveform-chan3)',
  CHAN4: 'var(--color-waveform-chan4)',
};

const DEFAULT_COLOR = 'var(--color-waveform-label)';

export interface WaveformDisplayProps {
  // Single waveform (convenience)
  waveform?: WaveformData;
  // Multiple waveforms
  waveforms?: WaveformData[];
  // Trigger level (voltage)
  triggerLevel?: number;
  // Callback when trigger level is dragged
  onTriggerLevelChange?: (level: number) => void;
  // Display options
  height?: number;
  showGrid?: boolean;
  // Padding for axes
  padding?: { top: number; right: number; bottom: number; left: number };
}

// Format time with appropriate units
function formatTime(seconds: number): string {
  const abs = Math.abs(seconds);
  if (abs >= 1) return `${seconds.toFixed(2)}s`;
  if (abs >= 0.001) return `${(seconds * 1000).toFixed(2)}ms`;
  if (abs >= 0.000001) return `${(seconds * 1000000).toFixed(1)}us`;
  return `${(seconds * 1000000000).toFixed(0)}ns`;
}

// Format voltage with appropriate units
function formatVoltage(volts: number): string {
  const abs = Math.abs(volts);
  if (abs >= 1) return `${volts.toFixed(2)}V`;
  if (abs >= 0.001) return `${(volts * 1000).toFixed(1)}mV`;
  return `${(volts * 1000000).toFixed(0)}uV`;
}

export function WaveformDisplay({
  waveform,
  waveforms: waveformsProp,
  triggerLevel,
  onTriggerLevelChange,
  height = 300,
  showGrid = true,
  padding = { top: 20, right: 60, bottom: 30, left: 60 },
}: WaveformDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(600);

  // Drag state
  const [isDragging, setIsDragging] = useState(false);
  const [localTriggerLevel, setLocalTriggerLevel] = useState(triggerLevel ?? 0);
  const lastPropValue = useRef(triggerLevel);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Only sync from prop when it actually changes (server sent update)
  // This prevents snap-back when releasing drag before server responds
  useEffect(() => {
    if (triggerLevel !== undefined && triggerLevel !== lastPropValue.current) {
      lastPropValue.current = triggerLevel;
      if (!isDragging) {
        setLocalTriggerLevel(triggerLevel);
      }
    }
  }, [triggerLevel, isDragging]);

  // Responsive width via ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Set initial width
    if (container.clientWidth > 0) {
      setWidth(container.clientWidth);
    }

    // Use ResizeObserver if available (not in test environments)
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newWidth = entry.contentRect.width;
        if (newWidth > 0) {
          setWidth(newWidth);
        }
      }
    });

    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  // Normalize to array of waveforms
  const waveforms = useMemo(() => {
    if (waveformsProp && waveformsProp.length > 0) return waveformsProp;
    if (waveform) return [waveform];
    return [];
  }, [waveform, waveformsProp]);

  // Calculate plot area
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  // Calculate data ranges across all waveforms
  const { xMin, xMax, yMin, yMax, hasData } = useMemo(() => {
    if (waveforms.length === 0) {
      return { xMin: 0, xMax: 1, yMin: -1, yMax: 1, hasData: false };
    }

    let allPoints: number[] = [];
    let maxTime = 0;

    for (const wf of waveforms) {
      if (wf.points.length === 0) continue;
      allPoints = allPoints.concat(wf.points);
      const wfTime = wf.points.length * wf.xIncrement;
      if (wfTime > maxTime) maxTime = wfTime;
    }

    if (allPoints.length === 0) {
      return { xMin: 0, xMax: 1, yMin: -1, yMax: 1, hasData: false };
    }

    const minVal = Math.min(...allPoints);
    const maxVal = Math.max(...allPoints);

    // Add 10% padding to Y range
    const range = maxVal - minVal || 1;
    const yPadding = range * 0.1;

    return {
      xMin: 0,
      xMax: maxTime || 1,
      yMin: minVal - yPadding,
      yMax: maxVal + yPadding,
      hasData: true,
    };
  }, [waveforms]);

  // Scale functions
  const scaleX = (time: number) => {
    return padding.left + ((time - xMin) / (xMax - xMin)) * plotWidth;
  };

  const scaleY = useCallback((value: number) => {
    // SVG Y is inverted (0 at top)
    return padding.top + plotHeight - ((value - yMin) / (yMax - yMin)) * plotHeight;
  }, [padding.top, plotHeight, yMin, yMax]);

  const unscaleY = useCallback((svgY: number) => {
    // Convert SVG Y coordinate back to voltage
    const fraction = (padding.top + plotHeight - svgY) / plotHeight;
    return yMin + fraction * (yMax - yMin);
  }, [padding.top, plotHeight, yMin, yMax]);

  // Debounced update to scope
  const sendUpdate = useCallback((voltage: number) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      onTriggerLevelChange?.(voltage);
    }, 300);
  }, [onTriggerLevelChange]);

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  // Handle trigger drag
  const handleTriggerMouseDown = useCallback((e: React.MouseEvent) => {
    if (!onTriggerLevelChange) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, [onTriggerLevelChange]);

  // Global mouse move/up handlers for drag
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const svg = svgRef.current;
      if (!svg) return;

      const rect = svg.getBoundingClientRect();
      const svgY = e.clientY - rect.top;

      // Clamp to plot area
      const clampedY = Math.max(padding.top, Math.min(padding.top + plotHeight, svgY));
      const voltage = unscaleY(clampedY);

      setLocalTriggerLevel(voltage);
      sendUpdate(voltage);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, padding.top, plotHeight, unscaleY, sendUpdate]);

  // Generate path for a waveform
  const generatePath = (wf: WaveformData): string => {
    if (wf.points.length === 0) return '';
    if (wf.points.length === 1) {
      const x = scaleX(0);
      const y = scaleY(wf.points[0]);
      return `M ${x} ${y} L ${x + 1} ${y}`;
    }

    const points = wf.points.map((val, i) => {
      const x = scaleX(i * wf.xIncrement);
      const y = scaleY(val);
      return `${x},${y}`;
    });

    return `M ${points.join(' L ')}`;
  };

  // Grid lines
  const gridLines = useMemo(() => {
    if (!showGrid) return null;

    const xLines: JSX.Element[] = [];
    const yLines: JSX.Element[] = [];

    // Vertical grid lines (time divisions)
    const xDivisions = 10;
    for (let i = 0; i <= xDivisions; i++) {
      const x = padding.left + (i / xDivisions) * plotWidth;
      const isMajor = i === 0 || i === xDivisions;
      xLines.push(
        <line
          key={`x-${i}`}
          x1={x}
          y1={padding.top}
          x2={x}
          y2={padding.top + plotHeight}
          stroke={isMajor ? 'var(--color-waveform-grid-major)' : 'var(--color-waveform-grid)'}
          strokeWidth={isMajor ? 1 : 0.5}
        />
      );
    }

    // Horizontal grid lines (voltage divisions)
    const yDivisions = 8;
    for (let i = 0; i <= yDivisions; i++) {
      const y = padding.top + (i / yDivisions) * plotHeight;
      const isMajor = i === 0 || i === yDivisions;
      yLines.push(
        <line
          key={`y-${i}`}
          x1={padding.left}
          y1={y}
          x2={padding.left + plotWidth}
          y2={y}
          stroke={isMajor ? 'var(--color-waveform-grid-major)' : 'var(--color-waveform-grid)'}
          strokeWidth={isMajor ? 1 : 0.5}
        />
      );
    }

    return (
      <g data-testid="waveform-grid">
        {xLines}
        {yLines}
      </g>
    );
  }, [showGrid, plotWidth, plotHeight, padding]);

  // Always use local level - it syncs from prop until user interacts
  const displayTriggerLevel = localTriggerLevel;
  const triggerY = scaleY(displayTriggerLevel);
  const triggerInRange = triggerY >= padding.top && triggerY <= padding.top + plotHeight;

  // Axis labels
  const axisLabels = useMemo(() => {
    return (
      <>
        {/* Y-axis labels */}
        <text
          data-testid="y-axis-max"
          x={padding.left - 5}
          y={padding.top + 5}
          textAnchor="end"
          fill="var(--color-waveform-label)"
          fontSize={10}
        >
          {formatVoltage(yMax)}
        </text>
        <text
          data-testid="y-axis-min"
          x={padding.left - 5}
          y={padding.top + plotHeight}
          textAnchor="end"
          fill="var(--color-waveform-label)"
          fontSize={10}
        >
          {formatVoltage(yMin)}
        </text>

        {/* X-axis labels */}
        <text
          data-testid="x-axis-min"
          x={padding.left}
          y={height - 5}
          textAnchor="start"
          fill="var(--color-waveform-label)"
          fontSize={10}
        >
          {formatTime(xMin)}
        </text>
        <text
          data-testid="x-axis-max"
          x={padding.left + plotWidth}
          y={height - 5}
          textAnchor="end"
          fill="var(--color-waveform-label)"
          fontSize={10}
        >
          {formatTime(xMax)}
        </text>
      </>
    );
  }, [xMin, xMax, yMin, yMax, plotWidth, plotHeight, height, padding]);

  // Render waveform traces
  const traces = useMemo(() => {
    return waveforms.map((wf) => {
      const path = generatePath(wf);
      const color = CHANNEL_COLORS[wf.channel] ?? DEFAULT_COLOR;

      return (
        <path
          key={wf.channel}
          data-testid={`waveform-trace-${wf.channel}`}
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    });
  }, [waveforms, xMin, xMax, yMin, yMax, plotWidth, plotHeight, padding]);

  const canDrag = !!onTriggerLevelChange;

  return (
    <div
      ref={containerRef}
      data-testid="waveform-display"
      className="waveform-display w-full"
    >
      <svg
        ref={svgRef}
        data-testid="waveform-svg"
        width={width}
        height={height}
        className="rounded"
        style={{ backgroundColor: 'var(--color-waveform-bg)' }}
      >
        {/* Grid */}
        {gridLines}

        {/* Axis labels */}
        {axisLabels}

        {/* Waveform traces */}
        {traces}

        {/* Trigger level line and drag handle */}
        {triggerLevel !== undefined && triggerInRange && (
          <g>
            {/* Dashed line across chart */}
            <line
              data-testid="trigger-level-line"
              x1={padding.left}
              y1={triggerY}
              x2={padding.left + plotWidth}
              y2={triggerY}
              stroke={isDragging ? '#facc15' : 'var(--color-waveform-trigger)'}
              strokeWidth={isDragging ? 2 : 1}
              strokeDasharray={isDragging ? 'none' : '5,3'}
            />

            {/* Drag handle on right side */}
            {canDrag && (
              <g
                data-testid="trigger-drag-handle"
                onMouseDown={handleTriggerMouseDown}
                style={{ cursor: 'ns-resize' }}
              >
                {/* Invisible larger hit area */}
                <rect
                  x={padding.left + plotWidth - 2}
                  y={triggerY - 10}
                  width={padding.right + 2}
                  height={20}
                  fill="transparent"
                />
                {/* Small triangle handle */}
                <polygon
                  points={`${padding.left + plotWidth + 2},${triggerY - 5} ${padding.left + plotWidth + 2},${triggerY + 5} ${padding.left + plotWidth + 10},${triggerY}`}
                  fill={isDragging ? '#facc15' : 'var(--color-waveform-trigger)'}
                />
                {/* Voltage label */}
                <text
                  x={padding.left + plotWidth + 12}
                  y={triggerY + 4}
                  fontSize={10}
                  fill={isDragging ? '#facc15' : 'var(--color-waveform-label)'}
                >
                  {formatVoltage(displayTriggerLevel)}
                </text>
              </g>
            )}
          </g>
        )}

        {/* Out of range indicator */}
        {triggerLevel !== undefined && !triggerInRange && (
          <g>
            <text
              x={padding.left + plotWidth + 5}
              y={triggerY < padding.top ? padding.top + 12 : padding.top + plotHeight - 4}
              fontSize={10}
              fill="var(--color-waveform-trigger)"
            >
              T {triggerY < padding.top ? '▲' : '▼'} {formatVoltage(triggerLevel)}
            </text>
          </g>
        )}

        {/* No data message */}
        {!hasData && (
          <text
            x={width / 2}
            y={height / 2}
            textAnchor="middle"
            fill="var(--color-waveform-label)"
            fontSize={14}
          >
            No data
          </text>
        )}
      </svg>
    </div>
  );
}
