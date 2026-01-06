import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StreamingControls } from '../StreamingControls';

describe('StreamingControls', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<StreamingControls />);
      expect(screen.getByTestId('streaming-controls')).toBeInTheDocument();
    });

    it('should show streaming status indicator', () => {
      render(<StreamingControls isStreaming />);
      expect(screen.getByTestId('streaming-status')).toBeInTheDocument();
    });
  });

  describe('Streaming status', () => {
    it('should show "Live" when streaming is active', () => {
      render(<StreamingControls isStreaming />);
      expect(screen.getByText(/live/i)).toBeInTheDocument();
    });

    it('should show "Stopped" when streaming is inactive', () => {
      render(<StreamingControls isStreaming={false} />);
      const status = screen.getByTestId('streaming-status');
      expect(status.textContent).toMatch(/stopped/i);
    });

    it('should show visual indicator for live status', () => {
      render(<StreamingControls isStreaming />);
      const indicator = screen.getByTestId('streaming-indicator');
      expect(indicator.className).toMatch(/live|pulse|animate/i);
    });
  });

  describe('Channel toggles', () => {
    it('should render channel toggle buttons', () => {
      render(
        <StreamingControls
          channels={['CHAN1', 'CHAN2']}
          enabledChannels={['CHAN1']}
        />
      );

      expect(screen.getByTestId('channel-toggle-CHAN1')).toBeInTheDocument();
      expect(screen.getByTestId('channel-toggle-CHAN2')).toBeInTheDocument();
    });

    it('should show enabled channels as active', () => {
      render(
        <StreamingControls
          channels={['CHAN1', 'CHAN2']}
          enabledChannels={['CHAN1']}
        />
      );

      const ch1 = screen.getByTestId('channel-toggle-CHAN1');
      const ch2 = screen.getByTestId('channel-toggle-CHAN2');

      expect(ch1.className).toMatch(/active|enabled|selected/i);
      expect(ch2.className).not.toMatch(/active|enabled|selected/i);
    });

    it('should call onChannelToggle when channel button clicked', () => {
      const onToggle = vi.fn();
      render(
        <StreamingControls
          channels={['CHAN1', 'CHAN2']}
          enabledChannels={['CHAN1']}
          onChannelToggle={onToggle}
        />
      );

      fireEvent.click(screen.getByTestId('channel-toggle-CHAN2'));
      expect(onToggle).toHaveBeenCalledWith('CHAN2');
    });

    it('should call onChannelToggle when toggling off displayed channel', () => {
      const onToggle = vi.fn();
      render(
        <StreamingControls
          channels={['CHAN1', 'CHAN2']}
          enabledChannels={['CHAN1', 'CHAN2']}
          onChannelToggle={onToggle}
        />
      );

      fireEvent.click(screen.getByTestId('channel-toggle-CHAN1'));
      expect(onToggle).toHaveBeenCalledWith('CHAN1');
    });
  });

  describe('Scope sync', () => {
    it('should show scope running status', () => {
      render(<StreamingControls scopeRunning />);
      expect(screen.getByTestId('scope-status')).toBeInTheDocument();
      expect(screen.getByText(/running/i)).toBeInTheDocument();
    });

    it('should show scope stopped status', () => {
      render(<StreamingControls scopeRunning={false} />);
      const scopeStatus = screen.getByTestId('scope-status');
      expect(scopeStatus.textContent).toMatch(/stopped/i);
    });
  });

  describe('FPS display', () => {
    it('should show current streaming FPS', () => {
      render(<StreamingControls isStreaming fps={10} />);
      expect(screen.getByText(/10\s*fps/i)).toBeInTheDocument();
    });
  });
});
