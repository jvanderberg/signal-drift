/**
 * Tab Keep-Alive Utility
 *
 * Prevents browser tab throttling and sleep using multiple strategies:
 * 1. Silent audio playback - Most reliable cross-browser method
 * 2. Screen Wake Lock API - Prevents device sleep (modern browsers)
 *
 * Usage:
 *   const keepAlive = getTabKeepAlive();
 *   keepAlive.start();  // Call when streaming starts
 *   keepAlive.stop();   // Call when streaming stops
 */

export interface TabKeepAlive {
  start(): void;
  stop(): void;
  isActive(): boolean;
}

let instance: TabKeepAlive | null = null;

function createTabKeepAlive(): TabKeepAlive {
  let audioContext: AudioContext | null = null;
  let oscillator: OscillatorNode | null = null;
  let gainNode: GainNode | null = null;
  let wakeLock: WakeLockSentinel | null = null;
  let active = false;

  /**
   * Start silent audio playback
   * Uses a gain of 0 so it's completely inaudible
   */
  function startSilentAudio(): void {
    if (audioContext) return;

    try {
      audioContext = new AudioContext();

      // Create oscillator (generates audio signal)
      oscillator = audioContext.createOscillator();
      oscillator.frequency.value = 1; // Very low frequency
      oscillator.type = 'sine';

      // Create gain node and set to 0 (silent)
      gainNode = audioContext.createGain();
      gainNode.gain.value = 0;

      // Connect: oscillator -> gain -> output
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      // Start the oscillator
      oscillator.start();

      console.debug('[TabKeepAlive] Silent audio started');
    } catch (err) {
      console.warn('[TabKeepAlive] Failed to start silent audio:', err);
    }
  }

  /**
   * Stop silent audio playback
   */
  function stopSilentAudio(): void {
    if (oscillator) {
      try {
        oscillator.stop();
        oscillator.disconnect();
      } catch {
        // Ignore errors during cleanup
      }
      oscillator = null;
    }

    if (gainNode) {
      gainNode.disconnect();
      gainNode = null;
    }

    if (audioContext) {
      audioContext.close().catch(() => {
        // Ignore close errors
      });
      audioContext = null;
    }

    console.debug('[TabKeepAlive] Silent audio stopped');
  }

  /**
   * Request a screen wake lock to prevent device sleep
   */
  async function requestWakeLock(): Promise<void> {
    if (!('wakeLock' in navigator)) {
      console.debug('[TabKeepAlive] Wake Lock API not supported');
      return;
    }

    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        console.debug('[TabKeepAlive] Wake lock released');
        wakeLock = null;
        // Re-acquire if still active
        if (active) {
          requestWakeLock();
        }
      });
      console.debug('[TabKeepAlive] Wake lock acquired');
    } catch (err) {
      console.warn('[TabKeepAlive] Failed to acquire wake lock:', err);
    }
  }

  /**
   * Release the screen wake lock
   */
  async function releaseWakeLock(): Promise<void> {
    if (wakeLock) {
      try {
        await wakeLock.release();
      } catch {
        // Ignore release errors
      }
      wakeLock = null;
      console.debug('[TabKeepAlive] Wake lock released');
    }
  }

  /**
   * Handle visibility change - re-acquire wake lock when tab becomes visible
   */
  function handleVisibilityChange(): void {
    if (document.visibilityState === 'visible' && active) {
      // Re-acquire wake lock when returning to tab
      requestWakeLock();
      // Resume audio context if it was suspended
      if (audioContext?.state === 'suspended') {
        audioContext.resume().catch(() => {
          // Ignore resume errors
        });
      }
    }
  }

  // Listen for visibility changes to re-acquire wake lock
  document.addEventListener('visibilitychange', handleVisibilityChange);

  function start(): void {
    if (active) return;
    active = true;

    startSilentAudio();
    requestWakeLock();

    console.debug('[TabKeepAlive] Started');
  }

  function stop(): void {
    if (!active) return;
    active = false;

    stopSilentAudio();
    releaseWakeLock();

    console.debug('[TabKeepAlive] Stopped');
  }

  function isActive(): boolean {
    return active;
  }

  return {
    start,
    stop,
    isActive,
  };
}

// Singleton accessor
export function getTabKeepAlive(): TabKeepAlive {
  if (!instance) {
    instance = createTabKeepAlive();
  }
  return instance;
}

// For testing - reset the singleton
export function resetTabKeepAlive(): void {
  if (instance) {
    instance.stop();
    instance = null;
  }
}
