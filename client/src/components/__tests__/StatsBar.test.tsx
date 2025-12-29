import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatsBar } from '../StatsBar';
import type { OscilloscopeMeasurement } from '../../../../shared/types';

describe('StatsBar', () => {
  describe('Rendering', () => {
    it('should render without crashing when no measurements provided', () => {
      render(<StatsBar />);
      expect(screen.getByTestId('stats-bar')).toBeInTheDocument();
    });

    it('should render measurement values', () => {
      const measurements: OscilloscopeMeasurement[] = [
        { channel: 'CHAN1', type: 'VPP', value: 3.28, unit: 'V' },
        { channel: 'CHAN1', type: 'FREQ', value: 1200, unit: 'Hz' },
      ];
      render(<StatsBar measurements={measurements} />);

      expect(screen.getByText(/VPP/)).toBeInTheDocument();
      expect(screen.getByText(/3\.28/)).toBeInTheDocument();
      expect(screen.getByText(/FREQ/)).toBeInTheDocument();
    });

    it('should show label, value, and unit for each measurement', () => {
      const measurements: OscilloscopeMeasurement[] = [
        { channel: 'CHAN1', type: 'VPP', value: 2.5, unit: 'V' },
      ];
      render(<StatsBar measurements={measurements} />);

      const stat = screen.getByTestId('stat-CHAN1-VPP');
      expect(stat).toBeInTheDocument();
      expect(stat.textContent).toMatch(/VPP/);
      expect(stat.textContent).toMatch(/2\.5/);
      expect(stat.textContent).toMatch(/V/);
    });
  });

  describe('Channel color coding', () => {
    it('should color-code measurements by channel', () => {
      const measurements: OscilloscopeMeasurement[] = [
        { channel: 'CHAN1', type: 'VPP', value: 1.0, unit: 'V' },
        { channel: 'CHAN2', type: 'VPP', value: 2.0, unit: 'V' },
      ];
      render(<StatsBar measurements={measurements} />);

      const stat1 = screen.getByTestId('stat-CHAN1-VPP');
      const stat2 = screen.getByTestId('stat-CHAN2-VPP');

      // Check that they have different colors (via style or class)
      expect(stat1.className).not.toBe(stat2.className);
    });
  });

  describe('Null/invalid values', () => {
    it('should show "--" for null measurement values', () => {
      const measurements: OscilloscopeMeasurement[] = [
        { channel: 'CHAN1', type: 'FREQ', value: null as unknown as number, unit: 'Hz' },
      ];
      render(<StatsBar measurements={measurements} />);

      expect(screen.getByText('--')).toBeInTheDocument();
    });

    it('should show "--" for NaN values', () => {
      const measurements: OscilloscopeMeasurement[] = [
        { channel: 'CHAN1', type: 'RISE', value: NaN, unit: 's' },
      ];
      render(<StatsBar measurements={measurements} />);

      expect(screen.getByText('--')).toBeInTheDocument();
    });
  });

  describe('Value formatting', () => {
    it('should format large frequency values with appropriate units', () => {
      const measurements: OscilloscopeMeasurement[] = [
        { channel: 'CHAN1', type: 'FREQ', value: 1200000, unit: 'Hz' },
      ];
      render(<StatsBar measurements={measurements} />);

      // Should show as 1.2MHz or similar
      expect(screen.getByTestId('stat-CHAN1-FREQ').textContent).toMatch(/1\.2\d*\s*MHz|1200\s*kHz/i);
    });

    it('should format small time values with appropriate units', () => {
      const measurements: OscilloscopeMeasurement[] = [
        { channel: 'CHAN1', type: 'RISE', value: 0.000000045, unit: 's' },
      ];
      render(<StatsBar measurements={measurements} />);

      // Should show as 45ns or similar
      expect(screen.getByTestId('stat-CHAN1-RISE').textContent).toMatch(/45\s*ns/i);
    });

    it('should format voltage values appropriately', () => {
      const measurements: OscilloscopeMeasurement[] = [
        { channel: 'CHAN1', type: 'VPP', value: 0.0035, unit: 'V' },
      ];
      render(<StatsBar measurements={measurements} />);

      // Should show as 3.5mV
      expect(screen.getByTestId('stat-CHAN1-VPP').textContent).toMatch(/3\.5\d*\s*mV/i);
    });
  });

  describe('Layout', () => {
    it('should display measurements in a row', () => {
      const measurements: OscilloscopeMeasurement[] = [
        { channel: 'CHAN1', type: 'VPP', value: 1.0, unit: 'V' },
        { channel: 'CHAN1', type: 'FREQ', value: 1000, unit: 'Hz' },
        { channel: 'CHAN1', type: 'RISE', value: 0.00001, unit: 's' },
      ];
      render(<StatsBar measurements={measurements} />);

      const container = screen.getByTestId('stats-bar');
      // Should have flex display for row layout
      expect(container.className).toMatch(/flex|row/i);
    });

    it('should handle many measurements without overflow issues', () => {
      const measurements: OscilloscopeMeasurement[] = [
        { channel: 'CHAN1', type: 'VPP', value: 1.0, unit: 'V' },
        { channel: 'CHAN1', type: 'VAVG', value: 0.5, unit: 'V' },
        { channel: 'CHAN1', type: 'VMAX', value: 1.5, unit: 'V' },
        { channel: 'CHAN1', type: 'VMIN', value: -0.5, unit: 'V' },
        { channel: 'CHAN1', type: 'FREQ', value: 1000, unit: 'Hz' },
        { channel: 'CHAN1', type: 'PERIOD', value: 0.001, unit: 's' },
        { channel: 'CHAN1', type: 'RISE', value: 0.00001, unit: 's' },
        { channel: 'CHAN1', type: 'FALL', value: 0.00001, unit: 's' },
      ];
      render(<StatsBar measurements={measurements} />);

      // All measurements should be rendered
      expect(screen.getByTestId('stat-CHAN1-VPP')).toBeInTheDocument();
      expect(screen.getByTestId('stat-CHAN1-FALL')).toBeInTheDocument();
    });
  });

  describe('Compact mode', () => {
    it('should support compact display mode', () => {
      const measurements: OscilloscopeMeasurement[] = [
        { channel: 'CHAN1', type: 'VPP', value: 1.0, unit: 'V' },
      ];
      render(<StatsBar measurements={measurements} compact />);

      const container = screen.getByTestId('stats-bar');
      expect(container.className).toMatch(/compact/i);
    });
  });

  describe('Empty state', () => {
    it('should show placeholder when no measurements available', () => {
      render(<StatsBar measurements={[]} />);

      expect(screen.getByText(/no measurements/i)).toBeInTheDocument();
    });
  });
});
