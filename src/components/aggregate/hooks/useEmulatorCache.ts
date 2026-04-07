/**
 * useEmulatorCache - Hook for caching terminal emulators in AggregateView.
 *
 * Manages a cache of ITerminalEmulator instances for PTYs to enable
 * fast preview switching without re-fetching emulators.
 */

import { createRenderEffect, onCleanup, type Accessor } from 'solid-js';
import type { ITerminalEmulator } from '../../../terminal/emulator-interface';
import { getEmulator } from '../../../effect/bridge/pty-bridge';

/** Result type for useEmulatorCache hook */
export interface UseEmulatorCacheResult {
  /** Get cached emulator for a PTY, or undefined if not cached */
  get: (ptyId: string) => ITerminalEmulator | undefined;
  /** Get all cached PTY IDs */
  getCachedPtyIds: () => string[];
  /** Check if a PTY is currently being fetched */
  isPending: (ptyId: string) => boolean;
  /** Get current epoch value (for testing) */
  getEpoch: () => number;
  /** Preload emulator for a PTY into the cache */
  preload: (ptyId: string) => void;
  /** Reset the cache (alias for clear) */
  reset: () => void;
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
  getSelectedPtyId?: Accessor<string | null>;
  loadEmulator?: (ptyId: string) => Promise<ITerminalEmulator | null>;
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

    const loadEmulator = options.loadEmulator ?? getEmulator;

    void loadEmulator(ptyId)
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
   * Get all cached PTY IDs.
   */
  const getCachedPtyIds = (): string[] => {
    return Array.from(cache.keys());
  };

  /**
   * Check if a PTY is currently being fetched.
   */
  const isPending = (ptyId: string): boolean => {
    return pending.has(ptyId);
  };

  /**
   * Get current epoch value (for testing).
   */
  const getEpoch = (): number => {
    return epoch;
  };

  /**
   * Clear all cached emulators.
   */
  const clear = (): void => {
    epoch += 1;
    cache.clear();
    pending.clear();
  };

  /**
   * Reset the cache (alias for clear).
   */
  const reset = (): void => {
    clear();
  };

  createRenderEffect(() => {
    if (!options.isActive()) {
      clear();
      return;
    }

    const selectedPtyId = options.getSelectedPtyId?.();
    if (!selectedPtyId) return;

    preload(selectedPtyId);
  });

  onCleanup(() => {
    clear();
  });

  return {
    get,
    getCachedPtyIds,
    isPending,
    getEpoch,
    preload,
    reset,
    clear,
  };
}
