/**
 * StreamingControls - Channel visibility toggles and streaming status display
 *
 * With the "always-on streaming" architecture, streaming auto-starts
 * when there are subscribers. This component:
 * - Shows which channels are visible on the chart (click to toggle display)
 * - Displays live streaming status and FPS
 * - Shows scope running status
 *
 * Channel toggles are INSTANT - purely client-side display filter, no server round-trip.
 * Server streams all enabled hardware channels; this just filters what to show.
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
  channels?: string[];        // Channels available from server streaming
  enabledChannels?: string[]; // Channels displayed on chart (client-side filter)
  fps?: number;               // Actual FPS from server
  onChannelToggle?: (channel: string) => void;  // Instant client-side toggle
}

export function StreamingControls({
  isStreaming = false,
  scopeRunning = false,
  channels = [],
  enabledChannels = [],
  fps = 0,
  onChannelToggle,
}: StreamingControlsProps) {

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
                onClick={() => onChannelToggle?.(channel)}
                className={`channel-toggle px-2 py-1 rounded text-sm font-medium transition-all ${
                  isEnabled
                    ? 'active enabled selected bg-[var(--color-border-light)]'
                    : 'bg-[var(--color-border-dark)] text-[var(--color-text-muted)] hover:bg-[var(--color-border-light)]'
                }`}
                style={{
                  color: isEnabled ? color : undefined,
                  borderBottom: isEnabled ? `2px solid ${color}` : '2px solid transparent',
                }}
                title={isEnabled ? `Hide ${channel}` : `Show ${channel}`}
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
        <span className={`text-sm font-medium ${isStreaming ? 'text-[var(--color-success)]' : 'text-[var(--color-text-muted)]'}`}>
          {isStreaming ? 'Live' : 'Stopped'}
        </span>
        {isStreaming && fps > 0 && (
          <span className="text-xs text-[var(--color-text-muted)]">
            {fps} fps
          </span>
        )}
      </div>

      <div className="flex-1" />

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
