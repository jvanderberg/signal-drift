import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WaveformDisplay } from '../WaveformDisplay';
import type { WaveformData } from '../../../../shared/types';

// Sample waveform data for testing
function createWaveform(options: {
  channel?: string;
  points?: number[];
  xIncrement?: number;
  yIncrement?: number;
}): WaveformData {
  return {
    channel: options.channel ?? 'CHAN1',
    points: options.points ?? [0, 0.5, 1, 0.5, 0, -0.5, -1, -0.5, 0],
    xIncrement: options.xIncrement ?? 0.000001, // 1us
    xOrigin: 0,
    yIncrement: options.yIncrement ?? 0.01,
    yOrigin: 0,
    yReference: 128,
  };
}

describe('WaveformDisplay', () => {
  describe('Rendering', () => {
    it('should render without crashing when no waveform provided', () => {
      render(<WaveformDisplay />);
      // Should show empty state or placeholder
      expect(screen.getByTestId('waveform-display')).toBeInTheDocument();
    });

    it('should render an SVG element for the waveform', () => {
      const waveform = createWaveform({});
      render(<WaveformDisplay waveform={waveform} />);

      const svg = screen.getByTestId('waveform-svg');
      expect(svg).toBeInTheDocument();
      expect(svg.tagName.toLowerCase()).toBe('svg');
    });

    it('should render a path element for the waveform trace', () => {
      const waveform = createWaveform({});
      render(<WaveformDisplay waveform={waveform} />);

      const path = screen.getByTestId('waveform-trace-CHAN1');
      expect(path).toBeInTheDocument();
      expect(path.tagName.toLowerCase()).toBe('path');
    });
  });

  describe('Fit-to-data scaling', () => {
    it('should scale Y-axis to fit waveform data range', () => {
      // Waveform with values from -2 to +3
      const waveform = createWaveform({
        points: [-2, -1, 0, 1, 2, 3, 2, 1, 0],
      });
      render(<WaveformDisplay waveform={waveform} />);

      // Check that axis labels show the actual data range
      const yAxisMin = screen.getByTestId('y-axis-min');
      const yAxisMax = screen.getByTestId('y-axis-max');

      // Should show values close to -2 and +3 (with some padding)
      expect(parseFloat(yAxisMin.textContent ?? '0')).toBeLessThanOrEqual(-2);
      expect(parseFloat(yAxisMax.textContent ?? '0')).toBeGreaterThanOrEqual(3);
    });

    it('should scale X-axis to show actual time span', () => {
      const waveform = createWaveform({
        points: Array(1000).fill(0).map((_, i) => Math.sin(i * 0.1)),
        xIncrement: 0.000001, // 1us per point = 1ms total
      });
      render(<WaveformDisplay waveform={waveform} />);

      // X-axis should show time range
      const xAxisMax = screen.getByTestId('x-axis-max');
      expect(xAxisMax).toBeInTheDocument();
      // 1000 points * 1us = 1ms = 0.001s
      expect(xAxisMax.textContent).toMatch(/1\.?\d*\s*ms|0\.001\s*s|1000\s*[uμ]s/i);
    });
  });

  describe('Trigger level display', () => {
    it('should show trigger level line when triggerLevel is provided', () => {
      const waveform = createWaveform({
        points: [-1, 0, 1, 0, -1],
      });
      render(<WaveformDisplay waveform={waveform} triggerLevel={0.5} />);

      const triggerLine = screen.getByTestId('trigger-level-line');
      expect(triggerLine).toBeInTheDocument();
    });

    it('should not show trigger level line when not provided', () => {
      const waveform = createWaveform({});
      render(<WaveformDisplay waveform={waveform} />);

      expect(screen.queryByTestId('trigger-level-line')).not.toBeInTheDocument();
    });

    it('should position trigger line at correct Y position', () => {
      const waveform = createWaveform({
        points: [0, 1, 2, 1, 0], // Range 0-2
      });
      render(
        <WaveformDisplay
          waveform={waveform}
          triggerLevel={1.0} // Middle of range
          width={400}
          height={200}
        />
      );

      const triggerLine = screen.getByTestId('trigger-level-line');
      // The line should be roughly in the middle vertically
      const y1 = parseFloat(triggerLine.getAttribute('y1') ?? '0');
      const y2 = parseFloat(triggerLine.getAttribute('y2') ?? '0');

      // Trigger at 1.0 in range 0-2 should be around middle (with padding consideration)
      expect(y1).toBeGreaterThan(50);
      expect(y1).toBeLessThan(150);
      expect(y1).toBe(y2); // Horizontal line
    });
  });

  describe('Multi-channel support', () => {
    it('should render multiple waveform traces when given array', () => {
      const waveforms = [
        createWaveform({ channel: 'CHAN1', points: [0, 1, 0, -1, 0] }),
        createWaveform({ channel: 'CHAN2', points: [1, 0, -1, 0, 1] }),
      ];
      render(<WaveformDisplay waveforms={waveforms} />);

      expect(screen.getByTestId('waveform-trace-CHAN1')).toBeInTheDocument();
      expect(screen.getByTestId('waveform-trace-CHAN2')).toBeInTheDocument();
    });

    it('should use different colors for different channels', () => {
      const waveforms = [
        createWaveform({ channel: 'CHAN1', points: [0, 1, 0] }),
        createWaveform({ channel: 'CHAN2', points: [1, 0, 1] }),
      ];
      render(<WaveformDisplay waveforms={waveforms} />);

      const trace1 = screen.getByTestId('waveform-trace-CHAN1');
      const trace2 = screen.getByTestId('waveform-trace-CHAN2');

      const stroke1 = trace1.getAttribute('stroke');
      const stroke2 = trace2.getAttribute('stroke');

      expect(stroke1).not.toBe(stroke2);
    });
  });

  describe('Empty/error states', () => {
    it('should handle waveform with no points gracefully', () => {
      const waveform = createWaveform({ points: [] });
      render(<WaveformDisplay waveform={waveform} />);

      // Should render without crashing
      expect(screen.getByTestId('waveform-display')).toBeInTheDocument();
      // Should show empty state message
      expect(screen.getByText(/no data/i)).toBeInTheDocument();
    });

    it('should handle waveform with single point', () => {
      const waveform = createWaveform({ points: [1.5] });
      render(<WaveformDisplay waveform={waveform} />);

      // Should render without crashing
      expect(screen.getByTestId('waveform-display')).toBeInTheDocument();
    });
  });

  describe('Sizing', () => {
    it('should use provided width and height', () => {
      const waveform = createWaveform({});
      render(<WaveformDisplay waveform={waveform} width={800} height={400} />);

      const svg = screen.getByTestId('waveform-svg');
      expect(svg.getAttribute('width')).toBe('800');
      expect(svg.getAttribute('height')).toBe('400');
    });

    it('should have sensible default dimensions', () => {
      const waveform = createWaveform({});
      render(<WaveformDisplay waveform={waveform} />);

      const svg = screen.getByTestId('waveform-svg');
      const width = parseInt(svg.getAttribute('width') ?? '0');
      const height = parseInt(svg.getAttribute('height') ?? '0');

      expect(width).toBeGreaterThan(200);
      expect(height).toBeGreaterThan(100);
    });
  });

  describe('Grid', () => {
    it('should render subtle grid lines when showGrid is true', () => {
      const waveform = createWaveform({});
      render(<WaveformDisplay waveform={waveform} showGrid />);

      const grid = screen.getByTestId('waveform-grid');
      expect(grid).toBeInTheDocument();
    });

    it('should not render grid when showGrid is false', () => {
      const waveform = createWaveform({});
      render(<WaveformDisplay waveform={waveform} showGrid={false} />);

      expect(screen.queryByTestId('waveform-grid')).not.toBeInTheDocument();
    });
  });

  describe('Performance', () => {
    it('should handle large waveforms without issue', () => {
      // 10000 point waveform
      const points = Array(10000).fill(0).map((_, i) => Math.sin(i * 0.01));
      const waveform = createWaveform({ points });

      const startTime = performance.now();
      render(<WaveformDisplay waveform={waveform} />);
      const renderTime = performance.now() - startTime;

      // Should render in reasonable time (< 100ms)
      expect(renderTime).toBeLessThan(100);
      expect(screen.getByTestId('waveform-trace-CHAN1')).toBeInTheDocument();
    });
  });
});
