/**
 * useEmulatorCache - Hook for caching terminal emulators in AggregateView.
 *
 * Manages a cache of ITerminalEmulator instances for PTYs to enable
 * fast preview switching without re-fetching emulators.
 */

import { createEffect, onCleanup, type Accessor } from 'solid-js';
import type { ITerminalEmulator } from '../../../terminal/emulator-interface';
import { getEmulator } from '../../../effect/bridge';

/** Error types for emulator cache operations */
export class EmulatorCacheError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmulatorCacheError';
  }
}

/** Result type for useEmulatorCache hook */
export interface UseEmulatorCacheResult {
  /** Get cached emulator for a PTY, or undefined if not cached */
  get: (ptyId: string) => ITerminalEmulator | undefined;
  /** Preload emulator for a PTY into the cache */
  preload: (ptyId: string) => void;
  /** Clear all cached emulators */
  clear: () => void;
}

/**
 * Hook for caching terminal emulators in AggregateView.
 *
 * @param options - Hook options
 * @param options.isActive - Whether the aggregate view is active
 * @returns UseEmulatorCacheResult with cache operations
 *
 * @example
 * ```tsx
 * const emulatorCache = useEmulatorCache({ isActive: () => state.showAggregateView });
 *
 * // Preload for selected PTY
 * emulatorCache.preload(selectedPtyId);
 *
 * // Get cached emulator
 * const emulator = emulatorCache.get(ptyId) ?? getEmulatorSync(ptyId);
 * ```
 */
export function useEmulatorCache(options: {
  isActive: Accessor<boolean>;
}): UseEmulatorCacheResult {
  // Cache of emulators by PTY ID
  const cache = new Map<string, ITerminalEmulator>();

  // Track pending preloads to avoid duplicate fetches
  const pending = new Set<string>();

  // Epoch for invalidating stale preloads
  let epoch = 0;

  /**
   * Get cached emulator for a PTY.
   */
  const get = (ptyId: string): ITerminalEmulator | undefined => {
    return cache.get(ptyId);
  };

  /**
   * Preload emulator for a PTY into the cache.
   */
  const preload = (ptyId: string): void => {
    if (cache.has(ptyId) || pending.has(ptyId)) return;

    const currentEpoch = epoch;
    pending.add(ptyId);

    void getEmulator(ptyId)
      .then((emulator) => {
        if (!emulator || currentEpoch !== epoch) return;
        cache.set(ptyId, emulator);
      })
      .catch((e) => {
        console.warn(`[useEmulatorCache] Failed to preload emulator for ${ptyId}:`, e);
      })
      .finally(() => {
        pending.delete(ptyId);
      });
  };

  /**
   * Clear all cached emulators.
   */
  const clear = (): void => {
    epoch += 1;
    cache.clear();
    pending.clear();
  };

  // Clear cache when component unmounts or becomes inactive
  createEffect(() => {
    if (!options.isActive()) {
      clear();
    }
  });

  onCleanup(() => {
    clear();
  });

  return {
    get,
    preload,
    clear,
  };
}
