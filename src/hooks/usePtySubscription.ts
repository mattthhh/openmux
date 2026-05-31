/**
 * PTY subscription management utilities
 * Consolidates duplicated subscription logic from TerminalContext
 */

import { onPtyExit, subscribeUnifiedToPty, getEmulator } from '../effect/bridge';
import type { TerminalScrollState, UnifiedTerminalUpdate } from '../core/types';
import type { ITerminalEmulator } from '../terminal/emulator-interface';
import { runStream, streamFromSubscription } from '../effect/stream-utils';

/**
 * Caches used for synchronous access to PTY state
 */
export interface PtyCaches {
  scrollStates: Map<string, TerminalScrollState>;
  emulators: Map<string, ITerminalEmulator>;
}

/**
 * Subscribe to a PTY and manage all callbacks
 * Returns unsubscribe function
 */
export async function subscribeToPtyWithCaches(
  ptyId: string,
  paneId: string,
  caches: PtyCaches,
  onExit: (ptyId: string, paneId: string) => void,
  options?: { cacheScrollState?: boolean; skipExit?: boolean }
): Promise<() => void> {
  const unsubExit = options?.skipExit ? () => {} : await subscribeToPtyExit(ptyId, paneId, onExit);

  // Cache the emulator for synchronous access (selection text extraction),
  // but do not block session resume on this fetch.
  void getEmulator(ptyId)
    .then((emulator) => {
      if (emulator) {
        caches.emulators.set(ptyId, emulator);
      }
    })
    .catch((error) => {
      console.warn(`[usePtySubscription] Failed to cache emulator for ${ptyId}:`, error);
    });

  // Subscribe to unified updates (terminal + scroll combined).
  // Scroll state is updated synchronously by the TerminalView's
  // unified-subscription.ts callback (via setScrollStateCache), which
  // runs inside notifySubscribers. We do NOT update scrollState here
  // because this tap processes updates asynchronously (via the stream's
  // await iterator.next()) and would overwrite the cache with stale
  // values from earlier updates, causing false snap-to-bottom.
  const unifiedStream = streamFromSubscription<UnifiedTerminalUpdate>(({ emit }) =>
    subscribeUnifiedToPty(ptyId, emit)
  );
  const stopUpdates = runStream(unifiedStream, { label: 'pty-unified-updates' });

  // Return combined unsubscribe function
  return () => {
    unsubExit();
    stopUpdates();
  };
}

/**
 * Subscribe to PTY exit events only.
 */
export async function subscribeToPtyExit(
  ptyId: string,
  paneId: string,
  onExit: (ptyId: string, paneId: string) => void
): Promise<() => void> {
  return onPtyExit(ptyId, () => {
    onExit(ptyId, paneId);
  });
}

/**
 * Clear all caches for a PTY
 */
export function clearPtyCaches(ptyId: string, caches: PtyCaches): void {
  caches.scrollStates.delete(ptyId);
  caches.emulators.delete(ptyId);
}

/**
 * Clear all caches
 */
export function clearAllPtyCaches(caches: PtyCaches): void {
  caches.scrollStates.clear();
  caches.emulators.clear();
}
