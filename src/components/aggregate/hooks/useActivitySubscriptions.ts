/**
 * useActivitySubscriptions - Hook for managing PTY activity subscriptions in AggregateView.
 *
 * Manages subscriptions to PTY stdout activity for shimmer effects. Automatically
 * subscribes to the PTYs we are actively tracking and unsubscribes when they
 * leave that tracked set or the aggregate view closes.
 *
 * NOTE: This hook holds a shared PTY update gate while activity tracking is active.
 * PTYs from other sessions have updates disabled by default (for performance), but we
 * need updates enabled to track activity for the shimmer effect without clobbering
 * workspace-visible PTYs when aggregate view closes.
 */

import { createEffect, onCleanup, type Accessor } from 'solid-js';
import * as errore from 'errore';
import { subscribeUnifiedToPty } from '../../../effect/bridge';
import { recordPtyStdoutActivity, clearPtyStdoutActivity } from '../../../core/shimmer';
import { createTaggedError } from 'errore';
import type { PtyInfo } from '../../../contexts/aggregate-view-types';
import {
  ensureActivityPtyEnabled,
  registerActivityPty,
  unregisterActivityPty,
} from '../../terminal-view/visibility';

/** Error when activity subscription fails */
export class ActivitySubscriptionError extends createTaggedError({
  name: 'ActivitySubscriptionError',
  message: 'Activity subscription $operation failed for PTY $ptyId: $reason',
}) {}

/** Subscription entry metadata */
interface SubscriptionEntry {
  ptyId: string;
  unsubscribe: () => void;
  subscribedAt: number;
}

/** Result of useActivitySubscriptions hook */
interface UseActivitySubscriptionsResult {
  /** Force sync subscriptions (normally auto-synced via effects) */
  sync: () => Promise<void>;
  /** Get all active subscription PTY IDs */
  getActivePtyIds: () => string[];
  /** Check if a PTY has an active subscription */
  isSubscribed: (ptyId: string) => boolean;
  /** Manually unsubscribe from a specific PTY */
  unsubscribe: (ptyId: string) => void;
}

/**
 * Hook for managing PTY activity subscriptions with automatic lifecycle management.
 *
 * Subscribes to stdout activity updates for the PTYs we actively want to track and
 * manages cleanup when they leave the tracked set or the aggregate view closes.
 *
 * @param options - Hook options
 * @param options.isActive - Whether subscriptions should be active
 * @param options.getTrackedPtys - Accessor returning the PTYs whose activity should be tracked
 * @returns UseActivitySubscriptionsResult with subscription controls
 *
 * @example
 * ```tsx
 * const activity = useActivitySubscriptions({
 *   isActive: () => state.showAggregateView,
 *   getTrackedPtys: visiblePtys,
 * });
 *
 * // Subscriptions are automatically managed via effects
 * // Manual sync if needed:
 * activity.sync();
 * ```
 */
export function useActivitySubscriptions(options: {
  isActive: Accessor<boolean>;
  getTrackedPtys: Accessor<PtyInfo[]>;
}): UseActivitySubscriptionsResult {
  // Map of PTY ID to subscription entry
  const subscriptions = new Map<string, SubscriptionEntry>();

  /**
   * Unsubscribe from a specific PTY.
   */
  const unsubscribe = (ptyId: string): void => {
    const entry = subscriptions.get(ptyId);
    if (entry) {
      entry.unsubscribe();
      subscriptions.delete(ptyId);
      clearPtyStdoutActivity(ptyId);
      unregisterActivityPty(ptyId);
    }
  };

  /**
   * Unsubscribe from all PTYs.
   */
  const unsubscribeAll = (): void => {
    for (const [ptyId, entry] of subscriptions) {
      entry.unsubscribe();
      clearPtyStdoutActivity(ptyId);
      unregisterActivityPty(ptyId);
    }
    subscriptions.clear();
  };

  // Track pending subscriptions to prevent races
  const pendingSubscriptions = new Set<string>();
  
  // Track failed subscriptions for retry
  const failedSubscriptions = new Map<string, number>(); // ptyId -> retry count
  const MAX_RETRIES = 3;
  
  // Guard to prevent concurrent sync calls
  let isSyncing = false;
  let needsResync = false;

  /**
   * Subscribe to a PTY's activity.
   */
  const subscribe = async (ptyId: string): Promise<void> => {
    if (subscriptions.has(ptyId) || pendingSubscriptions.has(ptyId)) {
      return;
    }

    // Mark as pending to prevent duplicate subscription attempts
    pendingSubscriptions.add(ptyId);

    // Keep PTY updates enabled while aggregate activity tracking is subscribed.
    // This shares the same ref-counted gate as visible TerminalViews, so closing
    // aggregate view won't disable a workspace PTY that's still on screen.
    registerActivityPty(ptyId);

    let seenInitialUpdate = false;
    let lastDirtyCount = 0;

    const result = await errore.tryAsync<() => void, ActivitySubscriptionError>({
      try: () =>
        subscribeUnifiedToPty(ptyId, (update) => {
          const dirtyCount = update.terminalUpdate.dirtyRows.size;
          
          // Skip the first update if it has no dirty rows (just initial state)
          // But if first update HAS dirty rows, it's real activity
          if (!seenInitialUpdate) {
            seenInitialUpdate = true;
            lastDirtyCount = dirtyCount;
            if (dirtyCount > 0) {
              recordPtyStdoutActivity(ptyId);
            }
            return;
          }

          // Check for stdout activity in dirty rows
          // Only record if there are NEW dirty rows (not just repeated updates)
          if (dirtyCount > 0) {
            recordPtyStdoutActivity(ptyId);
          }
          
          lastDirtyCount = dirtyCount;
        }),
      catch: (e) =>
        new ActivitySubscriptionError({
          operation: 'subscribe',
          ptyId,
          reason: String(e),
        }),
    });

    // Remove from pending
    pendingSubscriptions.delete(ptyId);

    if (result instanceof ActivitySubscriptionError) {
      clearPtyStdoutActivity(ptyId);
      unregisterActivityPty(ptyId);

      // Track failure for retry
      const retryCount = (failedSubscriptions.get(ptyId) ?? 0) + 1;
      if (retryCount <= MAX_RETRIES) {
        failedSubscriptions.set(ptyId, retryCount);
        console.warn(`[useActivitySubscriptions] Subscription failed for ${ptyId}, will retry (attempt ${retryCount}/${MAX_RETRIES})`);
      } else {
        console.error(`[useActivitySubscriptions] Subscription failed for ${ptyId} after ${MAX_RETRIES} attempts, giving up`);
        failedSubscriptions.delete(ptyId);
      }
      
      return;
    }

    // Success - clear any failure tracking
    failedSubscriptions.delete(ptyId);

    // Double-check we're still active before storing
    if (!options.isActive()) {
      result();
      clearPtyStdoutActivity(ptyId);
      unregisterActivityPty(ptyId);
      return;
    }

    // Check if this PTY is still in the current list
    const currentIds = new Set(options.getTrackedPtys().map((pty) => pty.ptyId));
    if (!currentIds.has(ptyId)) {
      result();
      clearPtyStdoutActivity(ptyId);
      unregisterActivityPty(ptyId);
      return;
    }

    // Store subscription
    subscriptions.set(ptyId, {
      ptyId,
      unsubscribe: result,
      subscribedAt: Date.now(),
    });
  };

  /**
   * Sync subscriptions to match current PTYs.
   */
  const sync = async (): Promise<void> => {
    // Prevent concurrent syncs
    if (isSyncing) {
      needsResync = true;
      return;
    }
    
    isSyncing = true;
    needsResync = false;
    
    try {
      if (!options.isActive()) {
        unsubscribeAll();
        return;
      }

      const currentPtyIds = new Set(options.getTrackedPtys().map((pty) => pty.ptyId));

      // Unsubscribe from PTYs no longer in the list
      // But don't touch pending subscriptions - let them complete
      for (const [ptyId, entry] of subscriptions) {
        if (!currentPtyIds.has(ptyId)) {
          entry.unsubscribe();
          subscriptions.delete(ptyId);
          clearPtyStdoutActivity(ptyId);
          unregisterActivityPty(ptyId);
        }
      }

      // Subscribe to new PTYs (but not ones already being processed)
      const subscribePromises: Promise<void>[] = [];

      for (const ptyId of currentPtyIds) {
        // Subscribe if:
        // - Not already subscribed
        // - Not currently being processed
        // - Hasn't failed too many times
        const retryCount = failedSubscriptions.get(ptyId) ?? 0;
        const shouldSubscribe = !subscriptions.has(ptyId) &&
          !pendingSubscriptions.has(ptyId) &&
          retryCount < MAX_RETRIES;

        if (shouldSubscribe) {
          subscribePromises.push(
            subscribe(ptyId).catch(() => {
              // Error is already logged in subscribe()
            })
          );
          continue;
        }

        if (subscriptions.has(ptyId)) {
          ensureActivityPtyEnabled(ptyId);
        }
      }

      await Promise.all(subscribePromises);
    } finally {
      isSyncing = false;
      
      // If another sync was requested while we were working, run it now
      if (needsResync) {
        void sync();
      }
    }
  };

  /**
   * Get all active subscription PTY IDs.
   */
  const getActivePtyIds = (): string[] => {
    return Array.from(subscriptions.keys());
  };

  /**
   * Check if a PTY has an active subscription.
   */
  const isSubscribed = (ptyId: string): boolean => {
    return subscriptions.has(ptyId);
  };

  // Auto-sync when dependencies change
  createEffect(() => {
    const active = options.isActive();
    const ptys = options.getTrackedPtys();

    // Trigger sync whenever active state or PTYs change
    void sync();

    // Enable/disable shimmer based on active state
    if (active) {
      import('../../../core/shimmer').then(({ setShimmerEnabled }) => {
        setShimmerEnabled(true);
      });
    } else {
      import('../../../core/shimmer').then(({ setShimmerEnabled }) => {
        setShimmerEnabled(false);
      });
    }
  });

  // Cleanup on unmount
  onCleanup(() => {
    unsubscribeAll();
    import('../../../core/shimmer').then(({ setShimmerEnabled }) => {
      setShimmerEnabled(false);
    });
  });

  return {
    sync,
    getActivePtyIds,
    isSubscribed,
    unsubscribe,
  };
}
