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
      expect(onToggle).toHaveBeenCalledWith('CHAN2', true);
    });

    it('should call onChannelToggle with false when disabling channel', () => {
      const onToggle = vi.fn();
      render(
        <StreamingControls
          channels={['CHAN1', 'CHAN2']}
          enabledChannels={['CHAN1', 'CHAN2']}
          onChannelToggle={onToggle}
        />
      );

      fireEvent.click(screen.getByTestId('channel-toggle-CHAN1'));
      expect(onToggle).toHaveBeenCalledWith('CHAN1', false);
    });
  });

  describe('Streaming toggle', () => {
    it('should have a start/stop streaming button', () => {
      render(<StreamingControls />);
      expect(screen.getByTestId('streaming-toggle')).toBeInTheDocument();
    });

    it('should call onStreamingToggle when button clicked', () => {
      const onToggle = vi.fn();
      render(<StreamingControls isStreaming={false} onStreamingToggle={onToggle} />);

      fireEvent.click(screen.getByTestId('streaming-toggle'));
      expect(onToggle).toHaveBeenCalledWith(true);
    });

    it('should show "Start" when not streaming', () => {
      render(<StreamingControls isStreaming={false} />);
      const button = screen.getByTestId('streaming-toggle');
      expect(button.textContent).toMatch(/start|play/i);
    });

    it('should show "Stop" when streaming', () => {
      render(<StreamingControls isStreaming />);
      const button = screen.getByTestId('streaming-toggle');
      expect(button.textContent).toMatch(/stop|pause/i);
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

  describe('Interval display', () => {
    it('should show current streaming interval', () => {
      render(<StreamingControls isStreaming intervalMs={200} />);
      expect(screen.getByText(/200\s*ms|5\s*fps/i)).toBeInTheDocument();
    });
  });
});
