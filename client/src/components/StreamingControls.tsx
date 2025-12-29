/**
 * StreamingControls - Control waveform streaming and channel selection
 *
 * Features:
 * - Live/Stopped status indicator
 * - Channel enable/disable toggles
 * - Start/Stop streaming button
 * - Scope running status display
 */

// Channel colors using CSS variables for theme support
const CHANNEL_CSS_VARS: Record<string, string> = {
  CHAN1: 'var(--color-waveform-chan1)',
  CHAN2: 'var(--color-waveform-chan2)',
  CHAN3: 'var(--color-waveform-chan3)',
  CHAN4: 'var(--color-waveform-chan4)',
};

export interface StreamingControlsProps {
  isStreaming?: boolean;
  scopeRunning?: boolean;
  channels?: string[];
  enabledChannels?: string[];
  intervalMs?: number;
  onStreamingToggle?: (enabled: boolean) => void;
  onChannelToggle?: (channel: string, enabled: boolean) => void;
}

export function StreamingControls({
  isStreaming = false,
  scopeRunning = false,
  channels = [],
  enabledChannels = [],
  intervalMs,
  onStreamingToggle,
  onChannelToggle,
}: StreamingControlsProps) {
  const handleStreamingToggle = () => {
    onStreamingToggle?.(!isStreaming);
  };

  const handleChannelToggle = (channel: string) => {
    const isEnabled = enabledChannels.includes(channel);
    onChannelToggle?.(channel, !isEnabled);
  };

  const fps = intervalMs ? Math.round(1000 / intervalMs) : null;

  return (
    <div
      data-testid="streaming-controls"
      className="streaming-controls flex items-center gap-4 p-2 bg-[var(--color-bg-tertiary,var(--color-border-dark))] rounded"
    >
      {/* Channel toggles */}
      {channels.length > 0 && (
        <div className="channel-toggles flex gap-1">
          {channels.map((channel) => {
            const isEnabled = enabledChannels.includes(channel);
            const color = CHANNEL_CSS_VARS[channel] ?? 'var(--color-text-primary)';

            return (
              <button
                key={channel}
                data-testid={`channel-toggle-${channel}`}
                onClick={() => handleChannelToggle(channel)}
                className={`channel-toggle px-2 py-1 rounded text-sm font-medium transition-all ${
                  isEnabled
                    ? 'active enabled selected bg-[var(--color-border-light)]'
                    : 'bg-[var(--color-border-dark)] text-[var(--color-text-muted)] hover:bg-[var(--color-border-light)]'
                }`}
                style={{
                  color: isEnabled ? color : undefined,
                  borderBottom: isEnabled ? `2px solid ${color}` : '2px solid transparent',
                }}
              >
                {channel.replace('CHAN', 'CH')}
              </button>
            );
          })}
        </div>
      )}

      {/* Streaming status */}
      <div
        data-testid="streaming-status"
        className="streaming-status flex items-center gap-2"
      >
        <span
          data-testid="streaming-indicator"
          className={`streaming-indicator w-2 h-2 rounded-full ${
            isStreaming ? 'live pulse animate-pulse bg-[var(--color-success)]' : 'bg-[var(--color-text-muted)]'
          }`}
        />
        <span className={`text-sm ${isStreaming ? 'text-[var(--color-success)]' : 'text-[var(--color-text-muted)]'}`}>
          {isStreaming ? 'Live' : 'Stopped'}
        </span>
        {isStreaming && fps && (
          <span className="text-xs text-[var(--color-text-muted)]">
            {intervalMs}ms / {fps} fps
          </span>
        )}
      </div>

      {/* Streaming toggle button */}
      <button
        data-testid="streaming-toggle"
        onClick={handleStreamingToggle}
        className={`streaming-toggle px-3 py-1 rounded text-sm font-medium transition-all ${
          isStreaming
            ? 'bg-red-600 hover:bg-red-700 text-white'
            : 'bg-green-600 hover:bg-green-700 text-white'
        }`}
      >
        {isStreaming ? 'Stop' : 'Start'}
      </button>

      {/* Scope status */}
      <div
        data-testid="scope-status"
        className="scope-status flex items-center gap-1 text-sm text-[var(--color-text-muted)]"
      >
        <span className={`w-2 h-2 rounded-full ${scopeRunning ? 'bg-[var(--color-accent-load)]' : 'bg-[var(--color-text-muted)]'}`} />
        <span>Scope {scopeRunning ? 'Running' : 'Stopped'}</span>
      </div>
    </div>
  );
}
