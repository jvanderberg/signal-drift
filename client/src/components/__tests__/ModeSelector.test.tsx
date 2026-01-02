import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModeSelector } from '../ModeSelector';

describe('ModeSelector', () => {
  const defaultModes = ['CC', 'CV', 'CP', 'CR'];

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<ModeSelector modes={defaultModes} currentMode="CC" onChange={() => {}} />);
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('should display Mode label', () => {
      render(<ModeSelector modes={defaultModes} currentMode="CC" onChange={() => {}} />);
      expect(screen.getByText('Mode:')).toBeInTheDocument();
    });

    it('should render all mode options', () => {
      render(<ModeSelector modes={defaultModes} currentMode="CC" onChange={() => {}} />);

      expect(screen.getByRole('option', { name: 'Constant Current' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Constant Voltage' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Constant Power' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Constant Resistance' })).toBeInTheDocument();
    });

    it('should show current mode as selected', () => {
      render(<ModeSelector modes={defaultModes} currentMode="CV" onChange={() => {}} />);
      const select = screen.getByRole('combobox');
      expect(select).toHaveValue('CV');
    });
  });

  describe('Mode names', () => {
    it('should display full name for CC mode', () => {
      render(<ModeSelector modes={['CC']} currentMode="CC" onChange={() => {}} />);
      expect(screen.getByRole('option', { name: 'Constant Current' })).toBeInTheDocument();
    });

    it('should display full name for CV mode', () => {
      render(<ModeSelector modes={['CV']} currentMode="CV" onChange={() => {}} />);
      expect(screen.getByRole('option', { name: 'Constant Voltage' })).toBeInTheDocument();
    });

    it('should display full name for CP mode', () => {
      render(<ModeSelector modes={['CP']} currentMode="CP" onChange={() => {}} />);
      expect(screen.getByRole('option', { name: 'Constant Power' })).toBeInTheDocument();
    });

    it('should display full name for CR mode', () => {
      render(<ModeSelector modes={['CR']} currentMode="CR" onChange={() => {}} />);
      expect(screen.getByRole('option', { name: 'Constant Resistance' })).toBeInTheDocument();
    });

    it('should fall back to mode code for unknown modes', () => {
      render(<ModeSelector modes={['CUSTOM']} currentMode="CUSTOM" onChange={() => {}} />);
      expect(screen.getByRole('option', { name: 'CUSTOM' })).toBeInTheDocument();
    });
  });

  describe('Change behavior', () => {
    it('should call onChange when mode is selected', () => {
      const onChange = vi.fn();
      render(<ModeSelector modes={defaultModes} currentMode="CC" onChange={onChange} />);

      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'CV' } });
      expect(onChange).toHaveBeenCalledWith('CV');
    });

    it('should call onChange with new mode value', () => {
      const onChange = vi.fn();
      render(<ModeSelector modes={defaultModes} currentMode="CC" onChange={onChange} />);

      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'CR' } });
      expect(onChange).toHaveBeenCalledWith('CR');
    });
  });

  describe('Disabled state', () => {
    it('should be disabled when disabled prop is true', () => {
      render(<ModeSelector modes={defaultModes} currentMode="CC" onChange={() => {}} disabled />);
      expect(screen.getByRole('combobox')).toBeDisabled();
    });

    it('should not be disabled by default', () => {
      render(<ModeSelector modes={defaultModes} currentMode="CC" onChange={() => {}} />);
      expect(screen.getByRole('combobox')).not.toBeDisabled();
    });
  });

  describe('Edge cases', () => {
    it('should render with empty modes array', () => {
      render(<ModeSelector modes={[]} currentMode="" onChange={() => {}} />);

      const select = screen.getByRole('combobox');
      expect(select).toBeInTheDocument();
      expect(screen.queryAllByRole('option')).toHaveLength(0);
    });

    it('should handle current mode not in modes array', () => {
      // When currentMode is not in options, HTML select defaults to first option
      render(<ModeSelector modes={['CC', 'CV']} currentMode="UNKNOWN" onChange={() => {}} />);

      const select = screen.getByRole('combobox');
      // Select element will default to first option when value doesn't match any
      expect(select).toHaveValue('CC');
    });

    it('should preserve modes order', () => {
      const orderedModes = ['CR', 'CC', 'CV', 'CP'];
      render(<ModeSelector modes={orderedModes} currentMode="CR" onChange={() => {}} />);

      const options = screen.getAllByRole('option');
      expect(options[0]).toHaveValue('CR');
      expect(options[1]).toHaveValue('CC');
      expect(options[2]).toHaveValue('CV');
      expect(options[3]).toHaveValue('CP');
    });
  });
});
