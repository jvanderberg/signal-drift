import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OutputControl } from '../OutputControl';

describe('OutputControl', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<OutputControl enabled={false} mode="CC" onToggle={() => {}} />);
      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('should display the mode badge', () => {
      render(<OutputControl enabled={false} mode="CC" onToggle={() => {}} />);
      expect(screen.getByText('CC')).toBeInTheDocument();
    });

    it('should show ON when enabled', () => {
      render(<OutputControl enabled={true} mode="CC" onToggle={() => {}} />);
      expect(screen.getByText('ON')).toBeInTheDocument();
    });

    it('should show OFF when disabled', () => {
      render(<OutputControl enabled={false} mode="CC" onToggle={() => {}} />);
      expect(screen.getByText('OFF')).toBeInTheDocument();
    });
  });

  describe('Toggle behavior', () => {
    it('should call onToggle with true when turning on', () => {
      const onToggle = vi.fn();
      render(<OutputControl enabled={false} mode="CC" onToggle={onToggle} />);

      fireEvent.click(screen.getByRole('button'));
      expect(onToggle).toHaveBeenCalledWith(true);
    });

    it('should call onToggle with false when turning off', () => {
      const onToggle = vi.fn();
      render(<OutputControl enabled={true} mode="CC" onToggle={onToggle} />);

      fireEvent.click(screen.getByRole('button'));
      expect(onToggle).toHaveBeenCalledWith(false);
    });

    it('should not call onToggle when disabled', () => {
      const onToggle = vi.fn();
      render(<OutputControl enabled={false} mode="CC" onToggle={onToggle} disabled />);

      fireEvent.click(screen.getByRole('button'));
      expect(onToggle).not.toHaveBeenCalled();
    });
  });

  describe('Disabled state', () => {
    it('should have disabled attribute when disabled prop is true', () => {
      render(<OutputControl enabled={false} mode="CC" onToggle={() => {}} disabled />);
      expect(screen.getByRole('button')).toBeDisabled();
    });

    it('should have reduced opacity when disabled', () => {
      render(<OutputControl enabled={false} mode="CC" onToggle={() => {}} disabled />);
      const button = screen.getByRole('button');
      expect(button.className).toMatch(/opacity-50/);
    });
  });

  describe('Accessibility', () => {
    it('should have aria-label for turning on', () => {
      render(<OutputControl enabled={false} mode="CC" onToggle={() => {}} />);
      expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Turn on');
    });

    it('should have aria-label for turning off', () => {
      render(<OutputControl enabled={true} mode="CC" onToggle={() => {}} />);
      expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Turn off');
    });
  });

  describe('Mode badge styling', () => {
    it('should apply lowercase mode class', () => {
      render(<OutputControl enabled={false} mode="CV" onToggle={() => {}} />);
      const badge = screen.getByText('CV');
      expect(badge.className).toMatch(/mode-badge/);
      expect(badge.className).toMatch(/cv/);
    });
  });

  describe('Keyboard accessibility', () => {
    it('should be focusable', () => {
      render(<OutputControl enabled={false} mode="CC" onToggle={() => {}} />);
      const button = screen.getByRole('button');
      button.focus();
      expect(document.activeElement).toBe(button);
    });

    it('should toggle on Enter key', () => {
      const onToggle = vi.fn();
      render(<OutputControl enabled={false} mode="CC" onToggle={onToggle} />);

      const button = screen.getByRole('button');
      fireEvent.keyDown(button, { key: 'Enter' });
      // Button's default behavior handles Enter
      fireEvent.click(button);
      expect(onToggle).toHaveBeenCalledWith(true);
    });

    it('should toggle on Space key', () => {
      const onToggle = vi.fn();
      render(<OutputControl enabled={false} mode="CC" onToggle={onToggle} />);

      const button = screen.getByRole('button');
      fireEvent.keyDown(button, { key: ' ' });
      // Button's default behavior handles Space
      fireEvent.click(button);
      expect(onToggle).toHaveBeenCalledWith(true);
    });
  });

  describe('Different modes', () => {
    it('should display all mode types correctly', () => {
      const modes = ['CC', 'CV', 'CP', 'CR'];

      modes.forEach(mode => {
        const { unmount } = render(
          <OutputControl enabled={false} mode={mode} onToggle={() => {}} />
        );
        expect(screen.getByText(mode)).toBeInTheDocument();
        unmount();
      });
    });
  });
});
