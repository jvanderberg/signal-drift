/**
 * WaveformDisplay - SVG-based waveform visualization
 *
 * Features:
 * - Fit-to-data scaling (Y-axis auto-scales to waveform min/max)
 * - Multi-channel support with distinct colors
 * - Trigger level overlay
 * - Subtle grid option
 * - Responsive sizing
 */

import { useMemo } from 'react';
import type { WaveformData } from '../../../shared/types';

// Channel colors (oscilloscope-inspired)
const CHANNEL_COLORS: Record<string, string> = {
  CHAN1: '#FFD700', // Yellow (typical for CH1)
  CHAN2: '#00FFFF', // Cyan (typical for CH2)
  CHAN3: '#FF00FF', // Magenta
  CHAN4: '#00FF00', // Green
};

const DEFAULT_COLOR = '#FFFFFF';

export interface WaveformDisplayProps {
  // Single waveform (convenience)
  waveform?: WaveformData;
  // Multiple waveforms
  waveforms?: WaveformData[];
  // Trigger level (voltage)
  triggerLevel?: number;
  // Display options
  width?: number;
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
  width = 600,
  height = 300,
  showGrid = true,
  padding = { top: 20, right: 60, bottom: 30, left: 60 },
}: WaveformDisplayProps) {
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

  const scaleY = (value: number) => {
    // SVG Y is inverted (0 at top)
    return padding.top + plotHeight - ((value - yMin) / (yMax - yMin)) * plotHeight;
  };

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
      xLines.push(
        <line
          key={`x-${i}`}
          x1={x}
          y1={padding.top}
          x2={x}
          y2={padding.top + plotHeight}
          stroke="#333"
          strokeWidth={i === 0 || i === xDivisions ? 1 : 0.5}
        />
      );
    }

    // Horizontal grid lines (voltage divisions)
    const yDivisions = 8;
    for (let i = 0; i <= yDivisions; i++) {
      const y = padding.top + (i / yDivisions) * plotHeight;
      yLines.push(
        <line
          key={`y-${i}`}
          x1={padding.left}
          y1={y}
          x2={padding.left + plotWidth}
          y2={y}
          stroke="#333"
          strokeWidth={i === 0 || i === yDivisions ? 1 : 0.5}
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

  // Trigger level line
  const triggerLine = useMemo(() => {
    if (triggerLevel === undefined) return null;

    const y = scaleY(triggerLevel);

    // Only show if within visible range
    if (y < padding.top || y > padding.top + plotHeight) return null;

    return (
      <line
        data-testid="trigger-level-line"
        x1={padding.left}
        y1={y}
        x2={padding.left + plotWidth}
        y2={y}
        stroke="#FF6600"
        strokeWidth={1}
        strokeDasharray="5,3"
      />
    );
  }, [triggerLevel, yMin, yMax, plotWidth, padding]);

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
          fill="#888"
          fontSize={10}
        >
          {formatVoltage(yMax)}
        </text>
        <text
          data-testid="y-axis-min"
          x={padding.left - 5}
          y={padding.top + plotHeight}
          textAnchor="end"
          fill="#888"
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
          fill="#888"
          fontSize={10}
        >
          {formatTime(xMin)}
        </text>
        <text
          data-testid="x-axis-max"
          x={padding.left + plotWidth}
          y={height - 5}
          textAnchor="end"
          fill="#888"
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

  return (
    <div data-testid="waveform-display" className="waveform-display">
      <svg
        data-testid="waveform-svg"
        width={width}
        height={height}
        style={{ backgroundColor: '#1a1a1a' }}
      >
        {/* Grid */}
        {gridLines}

        {/* Axis labels */}
        {axisLabels}

        {/* Waveform traces */}
        {traces}

        {/* Trigger level */}
        {triggerLine}

        {/* No data message */}
        {!hasData && (
          <text
            x={width / 2}
            y={height / 2}
            textAnchor="middle"
            fill="#666"
            fontSize={14}
          >
            No data
          </text>
        )}
      </svg>
    </div>
  );
}
