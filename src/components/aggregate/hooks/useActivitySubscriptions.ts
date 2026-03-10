/**
 * useActivitySubscriptions - Hook for managing PTY activity subscriptions in AggregateView.
 *
 * Manages subscriptions to PTY stdout activity for shimmer effects. Automatically
 * subscribes to visible PTYs and unsubscribes when they leave the view or the
 * aggregate view closes.
 */

import { createEffect, onCleanup, type Accessor } from 'solid-js';
import * as errore from 'errore';
import { subscribeUnifiedToPty } from '../../../effect/bridge';
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
  sync: () => void;
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
    }
  };

  /**
   * Unsubscribe from all PTYs.
   */
  const unsubscribeAll = (): void => {
    for (const [ptyId, entry] of subscriptions) {
      entry.unsubscribe();
      clearPtyStdoutActivity(ptyId);
    }
    subscriptions.clear();
  };

  /**
   * Subscribe to a PTY's activity.
   */
  const subscribe = async (ptyId: string): Promise<void | ActivitySubscriptionError> => {
    if (subscriptions.has(ptyId)) {
      return;
    }

    let seenInitialUpdate = false;

    const result = await errore.tryAsync<() => void, ActivitySubscriptionError>({
      try: () =>
        subscribeUnifiedToPty(ptyId, (update) => {
          // Skip the first update (initial state, not activity)
          if (!seenInitialUpdate) {
            seenInitialUpdate = true;
            return;
          }

          // Check for stdout activity in dirty rows
          const hasStdoutActivity = update.terminalUpdate.dirtyRows.size > 0;
          if (hasStdoutActivity) {
            recordPtyStdoutActivity(ptyId);
          }
        }),
      catch: (e) =>
        new ActivitySubscriptionError({
          operation: 'subscribe',
          ptyId,
          reason: String(e),
        }),
    });

    if (result instanceof ActivitySubscriptionError) {
      clearPtyStdoutActivity(ptyId);
      return result;
    }

    // Store subscription if still active
    if (options.isActive()) {
      subscriptions.set(ptyId, {
        ptyId,
        unsubscribe: result,
        subscribedAt: Date.now(),
      });
    } else {
      // Unsubscribe immediately if no longer active
      result();
      clearPtyStdoutActivity(ptyId);
    }
  };

  /**
   * Sync subscriptions to match current PTYs.
   */
  const sync = (): void => {
    if (!options.isActive()) {
      unsubscribeAll();
      return;
    }

    const currentPtyIds = new Set(options.getAllPtys().map((pty) => pty.ptyId));

    // Unsubscribe from PTYs no longer in the list
    for (const [ptyId, entry] of subscriptions) {
      if (!currentPtyIds.has(ptyId)) {
        entry.unsubscribe();
        subscriptions.delete(ptyId);
        clearPtyStdoutActivity(ptyId);
      }
    }

    // Subscribe to new PTYs
    for (const ptyId of currentPtyIds) {
      if (!subscriptions.has(ptyId)) {
        void subscribe(ptyId).catch((e) => {
          console.warn(`[useActivitySubscriptions] Failed to subscribe to PTY ${ptyId}:`, e);
        });
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
    sync();

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
