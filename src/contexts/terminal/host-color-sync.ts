import fs from 'node:fs';
import path from 'node:path';

import { setHostCapabilitiesColors, getHostCapabilities } from '../../terminal/capabilities';
import {
  areTerminalColorsEqual,
  clearColorCache,
  getHostColors,
  refreshHostColors as refreshHostColorsCache,
  setHostColors,
  type TerminalColors,
} from '../../terminal/terminal-colors';
import { onHostColorScheme, type HostColorScheme } from '../../terminal/host-color-scheme';
import { applyHostColors } from '../../effect/bridge';
import { watchSystemAppearance } from '../../../native/zig-pty/ts/index';
import * as errore from 'errore';
import { TerminalColorError } from '../../effect/errors';

export interface HostColorSyncDeps {
  renderer: { requestRender: () => void };
  isActive: () => boolean;
  bumpHostColorsVersion: () => void;
}

export interface HostColorSync {
  refreshHostColors: (options?: {
    timeoutMs?: number;
    forceApply?: boolean;
    oscMode?: 'fast' | 'full';
  }) => Promise<boolean>;
  start: () => void;
  stop: () => void;
}

export function createHostColorSync(deps: HostColorSyncDeps): HostColorSync {
  let refreshInFlight: Promise<boolean> | null = null;
  const schemeColors = new Map<HostColorScheme, TerminalColors>();
  let lastHostScheme: HostColorScheme | null = null;

  let appearanceWatcherStop: (() => void) | null = null;
  let appearanceDebounce: ReturnType<typeof setTimeout> | null = null;
  let appearanceRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let appearanceSequence = 0;
  let hostSchemeUnsub: (() => void) | null = null;
  let started = false;

  // Check if terminal supports OSC 997 color scheme events
  const supportsColorSchemeEvents = () => {
    const caps = getHostCapabilities();
    return caps?.colorSchemeEvents ?? false;
  };

  const refreshHostColors = async (options?: {
    timeoutMs?: number;
    forceApply?: boolean;
    oscMode?: 'fast' | 'full';
  }): Promise<boolean> => {
    if (refreshInFlight) return refreshInFlight;

    refreshInFlight = (async () => {
      const previous = getHostColors();
      const next = await refreshHostColorsCache({
        timeoutMs: options?.timeoutMs ?? 500,
        oscMode: options?.oscMode,
      });

      if (!deps.isActive()) return false;

      const didChange = !areTerminalColorsEqual(previous, next);
      if (!didChange && !options?.forceApply) return false;

      if (lastHostScheme && !next.isDefault) {
        schemeColors.set(lastHostScheme, next);
      }
      setHostCapabilitiesColors(next);
      if (didChange) {
        deps.bumpHostColorsVersion();
      }
      deps.renderer.requestRender();

      const applyResult = await errore.tryAsync<void, TerminalColorError>({
        try: () => applyHostColors(next),
        catch: (error) =>
          new TerminalColorError({
            operation: 'apply',
            reason: `Failed to apply host colors: ${String(error)}`,
            cause: error,
          }),
      });
      if (applyResult instanceof Error) {
        console.warn('[openmux] Failed to apply host colors:', applyResult);
      }

      return didChange;
    })();

    const result = await refreshInFlight;
    refreshInFlight = null;
    return result;
  };

  /**
   * Event-driven color refresh for OSC 997-capable terminals.
   * Uses a few retries with exponential backoff instead of polling,
   * since the terminal should send OSC 997 events when ready.
   */
  const refreshColorsEventDriven = (seq: number, attempt = 0) => {
    // Max 4 attempts with exponential backoff: 200ms, 400ms, 800ms, 1600ms (total ~3s)
    if (attempt >= 4) return;

    const delays = [200, 400, 800, 1600];
    const delay = delays[attempt];

    appearanceRetryTimer = setTimeout(() => {
      if (!deps.isActive() || seq !== appearanceSequence) return;

      refreshHostColors({ timeoutMs: 300, oscMode: 'fast' })
        .then((didChange) => {
          if (!deps.isActive() || seq !== appearanceSequence) return;

          if (didChange) {
            // Colors changed successfully, do a full palette refresh after delay
            appearanceRetryTimer = setTimeout(() => {
              refreshHostColors({ timeoutMs: 500, oscMode: 'full' }).catch((e) => {
                console.warn('[host-color-sync] Full palette refresh failed:', e);
              });
            }, 300);
          } else if (attempt < 3) {
            // No change yet, retry with next delay
            refreshColorsEventDriven(seq, attempt + 1);
          }
        })
        .catch((e) => {
          console.warn('[host-color-sync] Event-driven refresh failed:', e);
          if (attempt < 3) {
            refreshColorsEventDriven(seq, attempt + 1);
          }
        });
    }, delay);
  };

  /**
   * Polling-based color refresh for legacy terminals without OSC 997.
   * Polls every 250ms for up to 10 seconds until colors change.
   */
  const refreshColorsWithPolling = () => {
    const pollIntervalMs = 500;
    const pollWindowMs = 5_000;
    const paletteDelayMs = 400;
    const startedAt = Date.now();
    const seq = appearanceSequence;

    const attemptFastRefresh = async () => {
      const didChange = await refreshHostColors({ timeoutMs: 200, oscMode: 'fast' }).catch((e) => {
        console.warn('[host-color-sync] Fast refresh failed:', e);
        return false;
      });
      if (!deps.isActive() || seq !== appearanceSequence) return;
      if (didChange) {
        // After detecting change, do a full palette refresh after delay
        appearanceRetryTimer = setTimeout(() => {
          refreshHostColors({ timeoutMs: 500, oscMode: 'full' }).catch((e) => {
            console.warn('[host-color-sync] Palette delay refresh failed:', e);
          });
        }, paletteDelayMs);
        return;
      }
      // Keep polling until timeout
      if (Date.now() - startedAt >= pollWindowMs) {
        refreshHostColors({ timeoutMs: 500, oscMode: 'full' }).catch((e) => {
          console.warn('[host-color-sync] Poll window refresh failed:', e);
        });
        return;
      }
      appearanceRetryTimer = setTimeout(() => {
        attemptFastRefresh().catch((e) => {
          console.warn('[host-color-sync] Poll interval refresh failed:', e);
        });
      }, pollIntervalMs);
    };

    attemptFastRefresh().catch((e) => {
      console.warn('[host-color-sync] Initial appearance refresh failed:', e);
    });
  };

  const startAppearanceWatcher = () => {
    if (process.platform !== 'darwin') return;
    const home = process.env.HOME ?? '';
    if (!home) return;

    const prefsDir = path.join(home, 'Library', 'Preferences');
    const prefsFile = '.GlobalPreferences.plist';

    const triggerRefresh = () => {
      appearanceSequence += 1;
      const seq = appearanceSequence;

      // Clear any pending timers from previous sequence
      if (appearanceDebounce) {
        clearTimeout(appearanceDebounce);
        appearanceDebounce = null;
      }
      if (appearanceRetryTimer) {
        clearTimeout(appearanceRetryTimer);
        appearanceRetryTimer = null;
      }

      // Clear color cache when system appearance changes
      // This ensures we don't compare new colors against stale cached values
      clearColorCache();

      // Debounce rapid notifications (e.g., from multiple watchers)
      appearanceDebounce = setTimeout(() => {
        if (seq !== appearanceSequence) return; // Superseded

        // Use event-driven or polling strategy based on terminal capability
        if (supportsColorSchemeEvents()) {
          refreshColorsEventDriven(seq, 0);
        } else {
          refreshColorsWithPolling();
        }
      }, 50);
    };

    const stops: Array<() => void> = [];
    const notifyStop = watchSystemAppearance(triggerRefresh);
    if (notifyStop) {
      stops.push(notifyStop);
    }

    // File watcher as fallback for system appearance changes
    try {
      const watcher = fs.watch(prefsDir, { persistent: false }, (_event, filename) => {
        if (!filename || filename === prefsFile || filename.endsWith(`/${prefsFile}`)) {
          triggerRefresh();
        }
      });
      stops.push(() => watcher.close());
    } catch {
      // ignore - no directory watcher
    }

    if (stops.length === 0) {
      appearanceWatcherStop = null;
      return;
    }

    appearanceWatcherStop = () => {
      if (appearanceDebounce) {
        clearTimeout(appearanceDebounce);
        appearanceDebounce = null;
      }
      if (appearanceRetryTimer) {
        clearTimeout(appearanceRetryTimer);
        appearanceRetryTimer = null;
      }
      for (const stop of stops) {
        stop();
      }
    };
  };

  const handleScheme = (scheme: HostColorScheme) => {
    if (!deps.isActive()) return;

    const current = getHostColors();
    if (current && !current.isDefault) {
      const opposite: HostColorScheme = scheme === 'light' ? 'dark' : 'light';
      schemeColors.set(opposite, current);
    }
    lastHostScheme = scheme;

    const cached = schemeColors.get(scheme);
    if (cached) {
      // Apply cached colors immediately for instant response
      setHostColors(cached);
      setHostCapabilitiesColors(cached);
      deps.bumpHostColorsVersion();
      deps.renderer.requestRender();
      applyHostColors(cached).catch((error) => {
        console.warn('[openmux] Failed to apply cached host colors:', error);
      });

      // Still refresh to get palette updates, but don't wait for it
      if (!supportsColorSchemeEvents()) {
        refreshHostColors({ timeoutMs: 500, oscMode: 'full' }).catch((e) => {
          console.warn('[host-color-sync] Background palette refresh failed:', e);
        });
      }
    } else {
      // No cached colors - need to query
      refreshHostColors({ timeoutMs: 200, oscMode: 'fast', forceApply: true }).catch((e) => {
        console.warn('[host-color-sync] Forced refresh failed:', e);
      });
    }
  };

  const stop = () => {
    if (hostSchemeUnsub) {
      hostSchemeUnsub();
      hostSchemeUnsub = null;
    }
    if (appearanceWatcherStop) {
      appearanceWatcherStop();
      appearanceWatcherStop = null;
    }
    started = false;
  };

  const start = () => {
    if (started) return;
    started = true;
    startAppearanceWatcher();
    hostSchemeUnsub = onHostColorScheme(handleScheme);
  };

  return {
    refreshHostColors,
    start,
    stop,
  };
}
