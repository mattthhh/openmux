/**
 * useActivitySubscriptions - Hook for managing PTY activity subscriptions in AggregateView.
 *
 * Manages subscriptions to PTY stdout activity for shimmer effects. Automatically
 * subscribes to visible PTYs and unsubscribes when they leave the view or the
 * aggregate view closes.
 *
 * NOTE: This hook also enables PTY updates via setPtyUpdateEnabled. PTYs from other
 * sessions have updates disabled by default (for performance), but we need updates
 * enabled to track activity for the shimmer effect.
 */

import { createEffect, onCleanup, type Accessor } from 'solid-js';
import * as errore from 'errore';
import { subscribeUnifiedToPty, setPtyUpdateEnabled } from '../../../effect/bridge';
import { recordPtyStdoutActivity, clearPtyStdoutActivity } from '../../../core/shimmer';
import { createTaggedError } from 'errore';
import type { PtyInfo } from '../../../contexts/aggregate-view-types';

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
 * Subscribes to stdout activity updates for all visible PTYs and manages
 * cleanup when PTYs leave the view or the aggregate view closes.
 *
 * @param options - Hook options
 * @param options.isActive - Whether subscriptions should be active
 * @param options.getAllPtys - Accessor returning all PTYs to subscribe to
 * @returns UseActivitySubscriptionsResult with subscription controls
 *
 * @example
 * ```tsx
 * const activity = useActivitySubscriptions({
 *   isActive: () => state.showAggregateView,
 *   getAllPtys: () => state.allPtys,
 * });
 *
 * // Subscriptions are automatically managed via effects
 * // Manual sync if needed:
 * activity.sync();
 * ```
 */
export function useActivitySubscriptions(options: {
  isActive: Accessor<boolean>;
  getAllPtys: Accessor<PtyInfo[]>;
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
      // Disable updates for this PTY (safe to call even if PTY is visible elsewhere,
      // as the visibility system has its own reference counting)
      void setPtyUpdateEnabled(ptyId, false);
    }
  };

  /**
   * Unsubscribe from all PTYs.
   */
  const unsubscribeAll = (): void => {
    for (const [ptyId, entry] of subscriptions) {
      entry.unsubscribe();
      clearPtyStdoutActivity(ptyId);
      // Disable updates for this PTY
      void setPtyUpdateEnabled(ptyId, false);
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
  const subscribe = async (ptyId: string): Promise<void | ActivitySubscriptionError> => {
    if (subscriptions.has(ptyId) || pendingSubscriptions.has(ptyId)) {
      return;
    }

    // Mark as pending to prevent duplicate subscription attempts
    pendingSubscriptions.add(ptyId);

    // Enable updates for this PTY so we can track activity
    // PTYs from other sessions have updates disabled by default for performance
    await setPtyUpdateEnabled(ptyId, true);

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
      // Re-disable updates since subscription failed
      void setPtyUpdateEnabled(ptyId, false);
      
      // Track failure for retry
      const retryCount = (failedSubscriptions.get(ptyId) ?? 0) + 1;
      if (retryCount <= MAX_RETRIES) {
        failedSubscriptions.set(ptyId, retryCount);
        console.warn(`[useActivitySubscriptions] Subscription failed for ${ptyId}, will retry (attempt ${retryCount}/${MAX_RETRIES})`);
      } else {
        console.error(`[useActivitySubscriptions] Subscription failed for ${ptyId} after ${MAX_RETRIES} attempts, giving up`);
        failedSubscriptions.delete(ptyId);
      }
      
      return result;
    }

    // Success - clear any failure tracking
    failedSubscriptions.delete(ptyId);

    // Double-check we're still active before storing
    if (!options.isActive()) {
      result();
      clearPtyStdoutActivity(ptyId);
      void setPtyUpdateEnabled(ptyId, false);
      return;
    }

    // Check if this PTY is still in the current list
    const currentIds = new Set(options.getAllPtys().map((pty) => pty.ptyId));
    if (!currentIds.has(ptyId)) {
      result();
      clearPtyStdoutActivity(ptyId);
      void setPtyUpdateEnabled(ptyId, false);
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

      const currentPtyIds = new Set(options.getAllPtys().map((pty) => pty.ptyId));

      // Unsubscribe from PTYs no longer in the list
      // But don't touch pending subscriptions - let them complete
      for (const [ptyId, entry] of subscriptions) {
        if (!currentPtyIds.has(ptyId)) {
          entry.unsubscribe();
          subscriptions.delete(ptyId);
          clearPtyStdoutActivity(ptyId);
          // Disable updates for this PTY since we're no longer tracking it
          await setPtyUpdateEnabled(ptyId, false);
        }
      }

      // Subscribe to new PTYs (but not ones already being processed)
      const subscribePromises: Promise<void>[] = [];
      const reenablePromises: Promise<void>[] = [];
      
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
            subscribe(ptyId).catch((e) => {
              // Error is already logged in subscribe()
            })
          );
        } else if (subscriptions.has(ptyId)) {
          // Already subscribed - re-enable updates to ensure they weren't disabled
          // by the visibility system (e.g., when switching workspaces)
          reenablePromises.push(
            setPtyUpdateEnabled(ptyId, true).catch((e) => {
              // Silently ignore - PTY might have been destroyed
            })
          );
        }
      }
      
      // Wait for all operations to complete
      await Promise.all([...subscribePromises, ...reenablePromises]);
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
    const ptys = options.getAllPtys();

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
