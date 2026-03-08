import fs from 'node:fs';
import path from 'node:path';

import { setHostCapabilitiesColors } from '../../terminal/capabilities';
import {
  areTerminalColorsEqual,
  getHostColors,
  refreshHostColors as refreshHostColorsCache,
  setHostColors,
  type TerminalColors,
} from '../../terminal/terminal-colors';
import { onHostColorScheme, type HostColorScheme } from '../../terminal/host-color-scheme';
import { applyHostColors } from '../../effect/bridge';
import { watchSystemAppearance } from '../../../native/zig-pty/ts/index';
import * as errore from 'errore';

export interface HostColorSyncDeps {
  renderer: { requestRender: () => void };
  isActive: () => boolean;
  bumpHostColorsVersion: () => void;
}

export interface HostColorSync {
  refreshHostColors: (options?: { timeoutMs?: number; forceApply?: boolean; oscMode?: 'fast' | 'full' }) => Promise<boolean>;
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

  const refreshHostColors = async (
    options?: { timeoutMs?: number; forceApply?: boolean; oscMode?: 'fast' | 'full' }
  ): Promise<boolean> => {
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

      const applyResult = await errore.tryAsync<void, Error>({
        try: () => applyHostColors(next),
        catch: (error) => new Error(String(error), { cause: error }),
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

  const startAppearanceWatcher = () => {
    if (process.platform !== 'darwin') return;
    const home = process.env.HOME ?? '';
    if (!home) return;

    const prefsDir = path.join(home, 'Library', 'Preferences');
    const prefsFile = '.GlobalPreferences.plist';
    const triggerRefresh = () => {
      appearanceSequence += 1;
      const seq = appearanceSequence;
      if (appearanceDebounce) {
        clearTimeout(appearanceDebounce);
      }
      if (appearanceRetryTimer) {
        clearTimeout(appearanceRetryTimer);
        appearanceRetryTimer = null;
      }
      appearanceDebounce = setTimeout(() => {
        const pollIntervalMs = 250;
        const pollWindowMs = 10_000;
        const paletteDelayMs = 400;
        const startedAt = Date.now();

        const attemptFastRefresh = async () => {
          const didChange = await refreshHostColors({ timeoutMs: 200, oscMode: 'fast' }).catch((e) => {
            console.warn('[host-color-sync] Fast refresh failed:', e);
            return false;
          });
          if (!deps.isActive() || seq !== appearanceSequence) return;
          if (didChange) {
            appearanceRetryTimer = setTimeout(() => {
              refreshHostColors({ timeoutMs: 500, oscMode: 'full' }).catch((e) => {
                console.warn('[host-color-sync] Palette delay refresh failed:', e);
              });
            }, paletteDelayMs);
            return;
          }
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
      }, 50);
    };

    const stops: Array<() => void> = [];
    const notifyStop = watchSystemAppearance(triggerRefresh);
    if (notifyStop) {
      stops.push(notifyStop);
    }

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
      setHostColors(cached);
      setHostCapabilitiesColors(cached);
      deps.bumpHostColorsVersion();
      deps.renderer.requestRender();
      applyHostColors(cached).catch((error) => {
        console.warn('[openmux] Failed to apply cached host colors:', error);
      });
    }
    refreshHostColors({ timeoutMs: 200, oscMode: 'fast', forceApply: true }).catch((e) => {
      console.warn('[host-color-sync] Forced refresh failed:', e);
    });
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
