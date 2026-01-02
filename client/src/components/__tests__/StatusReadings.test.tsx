import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusReadings } from '../StatusReadings';
import type { DeviceStatus, DeviceCapabilities } from '../../types';

describe('StatusReadings', () => {
  const mockCapabilities: DeviceCapabilities = {
    deviceClass: 'load',
    features: {},
    modes: ['CC', 'CV'],
    modesSettable: true,
    outputs: [],
    measurements: [
      { name: 'voltage', unit: 'V', decimals: 3 },
      { name: 'current', unit: 'A', decimals: 3 },
      { name: 'power', unit: 'W', decimals: 2 },
    ],
  };

  const mockStatus: DeviceStatus = {
    mode: 'CC',
    outputEnabled: false,
    setpoints: { current: 1.0 },
    measurements: {
      voltage: 12.567,
      current: 1.234,
      power: 15.51,
    },
  };

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<StatusReadings status={mockStatus} capabilities={mockCapabilities} />);
      expect(screen.getByText('voltage')).toBeInTheDocument();
    });

    it('should render all measurement names', () => {
      render(<StatusReadings status={mockStatus} capabilities={mockCapabilities} />);

      expect(screen.getByText('voltage')).toBeInTheDocument();
      expect(screen.getByText('current')).toBeInTheDocument();
      expect(screen.getByText('power')).toBeInTheDocument();
    });

    it('should render measurement units', () => {
      render(<StatusReadings status={mockStatus} capabilities={mockCapabilities} />);

      expect(screen.getByText('V')).toBeInTheDocument();
      expect(screen.getByText('A')).toBeInTheDocument();
      expect(screen.getByText('W')).toBeInTheDocument();
    });
  });

  describe('Value formatting', () => {
    it('should format voltage with 3 decimals', () => {
      render(<StatusReadings status={mockStatus} capabilities={mockCapabilities} />);
      expect(screen.getByText('12.567')).toBeInTheDocument();
    });

    it('should format current with 3 decimals', () => {
      render(<StatusReadings status={mockStatus} capabilities={mockCapabilities} />);
      expect(screen.getByText('1.234')).toBeInTheDocument();
    });

    it('should format power with 2 decimals', () => {
      render(<StatusReadings status={mockStatus} capabilities={mockCapabilities} />);
      expect(screen.getByText('15.51')).toBeInTheDocument();
    });

    it('should show --- for missing measurement values', () => {
      // Test when a capability's measurement is not present in status
      // This naturally returns undefined without type casting
      const statusWithMissing: DeviceStatus = {
        ...mockStatus,
        measurements: {
          // voltage is missing - will be undefined when looked up
          current: 1.0,
          power: 10.0,
        },
      };

      render(<StatusReadings status={statusWithMissing} capabilities={mockCapabilities} />);
      expect(screen.getByText('---')).toBeInTheDocument();
    });
  });

  describe('Zero values', () => {
    it('should display zero correctly', () => {
      const statusWithZero: DeviceStatus = {
        ...mockStatus,
        measurements: {
          voltage: 0,
          current: 0,
          power: 0,
        },
      };

      render(<StatusReadings status={statusWithZero} capabilities={mockCapabilities} />);
      // Both voltage and current have 3 decimals, so there are two 0.000 values
      expect(screen.getAllByText('0.000')).toHaveLength(2);
      expect(screen.getByText('0.00')).toBeInTheDocument();  // power
    });
  });

  describe('Dynamic measurements', () => {
    it('should render only specified measurements', () => {
      const singleMeasurement: DeviceCapabilities = {
        ...mockCapabilities,
        measurements: [
          { name: 'resistance', unit: 'Ω', decimals: 2 },
        ],
      };

      const status: DeviceStatus = {
        ...mockStatus,
        measurements: { resistance: 100.55 },
      };

      render(<StatusReadings status={status} capabilities={singleMeasurement} />);

      expect(screen.getByText('resistance')).toBeInTheDocument();
      expect(screen.getByText('100.55')).toBeInTheDocument();
      expect(screen.getByText('Ω')).toBeInTheDocument();
      expect(screen.queryByText('voltage')).not.toBeInTheDocument();
    });

    it('should render nothing when measurements array is empty', () => {
      const emptyMeasurements: DeviceCapabilities = {
        ...mockCapabilities,
        measurements: [],
      };

      const { container } = render(
        <StatusReadings status={mockStatus} capabilities={emptyMeasurements} />
      );

      // Should render the container but no measurement items
      const grid = container.querySelector('.grid');
      expect(grid).toBeInTheDocument();
      expect(grid?.children.length).toBe(0);
    });
  });

  describe('Edge cases', () => {
    it('should handle negative values correctly', () => {
      const statusWithNegative: DeviceStatus = {
        ...mockStatus,
        measurements: {
          voltage: -12.345,
          current: 1.0,
          power: -12.35,
        },
      };

      render(<StatusReadings status={statusWithNegative} capabilities={mockCapabilities} />);
      expect(screen.getByText('-12.345')).toBeInTheDocument();
      expect(screen.getByText('-12.35')).toBeInTheDocument();
    });

    it('should handle very large values', () => {
      const statusWithLarge: DeviceStatus = {
        ...mockStatus,
        measurements: {
          voltage: 99999.999,
          current: 1.0,
          power: 100000.0,
        },
      };

      render(<StatusReadings status={statusWithLarge} capabilities={mockCapabilities} />);
      expect(screen.getByText('99999.999')).toBeInTheDocument();
      expect(screen.getByText('100000.00')).toBeInTheDocument();
    });
  });
});
