import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimebaseControls } from '../TimebaseControls';

describe('TimebaseControls', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<TimebaseControls currentScale={1e-3} onScaleChange={() => {}} />);
      expect(screen.getByText('1 ms/div')).toBeInTheDocument();
    });

    it('should render zoom in and zoom out buttons', () => {
      render(<TimebaseControls currentScale={1e-3} onScaleChange={() => {}} />);
      expect(screen.getByTitle('Zoom in (faster timebase)')).toBeInTheDocument();
      expect(screen.getByTitle('Zoom out (slower timebase)')).toBeInTheDocument();
    });
  });

  describe('Scale display formatting', () => {
    it('should format seconds correctly', () => {
      render(<TimebaseControls currentScale={1} onScaleChange={() => {}} />);
      expect(screen.getByText('1 s/div')).toBeInTheDocument();
    });

    it('should format 5 seconds correctly', () => {
      render(<TimebaseControls currentScale={5} onScaleChange={() => {}} />);
      expect(screen.getByText('5 s/div')).toBeInTheDocument();
    });

    it('should format milliseconds correctly', () => {
      render(<TimebaseControls currentScale={10e-3} onScaleChange={() => {}} />);
      expect(screen.getByText('10 ms/div')).toBeInTheDocument();
    });

    it('should format microseconds correctly', () => {
      render(<TimebaseControls currentScale={100e-6} onScaleChange={() => {}} />);
      expect(screen.getByText('100 us/div')).toBeInTheDocument();
    });

    it('should format nanoseconds correctly', () => {
      render(<TimebaseControls currentScale={50e-9} onScaleChange={() => {}} />);
      expect(screen.getByText('50 ns/div')).toBeInTheDocument();
    });
  });

  describe('Zoom in behavior', () => {
    it('should call onScaleChange with smaller scale when zoom in clicked', () => {
      const onScaleChange = vi.fn();
      render(<TimebaseControls currentScale={1e-3} onScaleChange={onScaleChange} />);

      fireEvent.click(screen.getByTitle('Zoom in (faster timebase)'));

      // 1ms should zoom in to 500us
      expect(onScaleChange).toHaveBeenCalledWith(500e-6);
    });

    it('should disable zoom in at minimum scale', () => {
      render(<TimebaseControls currentScale={2e-9} onScaleChange={() => {}} />);
      expect(screen.getByTitle('Zoom in (faster timebase)')).toBeDisabled();
    });
  });

  describe('Zoom out behavior', () => {
    it('should call onScaleChange with larger scale when zoom out clicked', () => {
      const onScaleChange = vi.fn();
      render(<TimebaseControls currentScale={1e-3} onScaleChange={onScaleChange} />);

      fireEvent.click(screen.getByTitle('Zoom out (slower timebase)'));

      // 1ms should zoom out to 2ms
      expect(onScaleChange).toHaveBeenCalledWith(2e-3);
    });

    it('should disable zoom out at maximum scale', () => {
      render(<TimebaseControls currentScale={10} onScaleChange={() => {}} />);
      expect(screen.getByTitle('Zoom out (slower timebase)')).toBeDisabled();
    });
  });

  describe('Disabled state', () => {
    it('should disable both buttons when disabled prop is true', () => {
      render(<TimebaseControls currentScale={1e-3} onScaleChange={() => {}} disabled />);

      expect(screen.getByTitle('Zoom in (faster timebase)')).toBeDisabled();
      expect(screen.getByTitle('Zoom out (slower timebase)')).toBeDisabled();
    });

    it('should not call onScaleChange when disabled', () => {
      const onScaleChange = vi.fn();
      render(<TimebaseControls currentScale={1e-3} onScaleChange={onScaleChange} disabled />);

      fireEvent.click(screen.getByTitle('Zoom in (faster timebase)'));
      fireEvent.click(screen.getByTitle('Zoom out (slower timebase)'));

      expect(onScaleChange).not.toHaveBeenCalled();
    });
  });

  describe('Scale snapping', () => {
    it('should snap to closest standard scale value', () => {
      // 1.5ms is between 1ms and 2ms - in log scale, 2ms is closer
      render(<TimebaseControls currentScale={1.5e-3} onScaleChange={() => {}} />);
      expect(screen.getByText('2 ms/div')).toBeInTheDocument();
    });

    it('should snap 1.1ms to 1ms (closer in log scale)', () => {
      render(<TimebaseControls currentScale={1.1e-3} onScaleChange={() => {}} />);
      expect(screen.getByText('1 ms/div')).toBeInTheDocument();
    });
  });

  describe('Button labels', () => {
    it('should show - for zoom in button', () => {
      render(<TimebaseControls currentScale={1e-3} onScaleChange={() => {}} />);
      expect(screen.getByTitle('Zoom in (faster timebase)')).toHaveTextContent('-');
    });

    it('should show + for zoom out button', () => {
      render(<TimebaseControls currentScale={1e-3} onScaleChange={() => {}} />);
      expect(screen.getByTitle('Zoom out (slower timebase)')).toHaveTextContent('+');
    });
  });
});
