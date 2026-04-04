/**
 * useActivitySubscriptions - event-based PTY activity tracking.
 *
 * Uses a single global stdout-activity subscription instead of per-PTY unified
 * update subscriptions. This keeps background PTY activity cheap while still
 * letting the aggregate view shimmer for hidden PTYs.
 */

import { createRenderEffect, createMemo, onCleanup, type Accessor } from 'solid-js';
import * as errore from 'errore';
import { subscribeToAllPtyActivity } from '../../../effect/bridge';
import { recordPtyStdoutActivity } from '../../../core/shimmer';
import type { PtyInfo } from '../../../contexts/aggregate-view-types';

/** Error when activity subscription fails */
export class ActivitySubscriptionError extends errore.createTaggedError({
  name: 'ActivitySubscriptionError',
  message: 'Activity subscription $operation failed: $reason',
}) {}

/** Result of useActivitySubscriptions hook */
interface UseActivitySubscriptionsResult {
  /** Check if a PTY has recent activity */
  hasRecentActivity: (ptyId: string) => boolean;
  /** Manually record activity for a PTY */
  recordActivity: (ptyId: string) => void;
}

export function useActivitySubscriptions(options: {
  isActive: Accessor<boolean>;
  getTrackedPtys: Accessor<PtyInfo[]>;
}): UseActivitySubscriptionsResult {
  let currentTrackedPtyIds = new Set<string>();
  let unsubscribe: (() => void) | null = null;
  let subscribeInFlight = false;
  let disposed = false;

  const cleanup = (): void => {
    unsubscribe?.();
    unsubscribe = null;
  };

  const ensureSubscribed = async (): Promise<void> => {
    if (unsubscribe || subscribeInFlight || !options.isActive()) return;
    subscribeInFlight = true;

    const result = await errore.tryAsync<() => void, ActivitySubscriptionError>({
      try: () =>
        subscribeToAllPtyActivity((event) => {
          if (!currentTrackedPtyIds.has(event.ptyId)) return;
          recordPtyStdoutActivity(event.ptyId);
        }),
      catch: (e) =>
        new ActivitySubscriptionError({
          operation: 'subscribe',
          reason: String(e),
          cause: e,
        }),
    });

    subscribeInFlight = false;

    if (result instanceof ActivitySubscriptionError) {
      console.warn(
        '[useActivitySubscriptions] Failed to subscribe to PTY activity:',
        result.message
      );
      return;
    }

    if (disposed || !options.isActive()) {
      result();
      return;
    }

    unsubscribe = result;
  };

  // Use createMemo to only recompute when tracked PTYs actually change
  const trackedPtyIdsMemo = createMemo(
    () => new Set(options.getTrackedPtys().map((pty) => pty.ptyId))
  );

  createRenderEffect(() => {
    const isActive = options.isActive();
    const ptyIds = trackedPtyIdsMemo();

    if (!isActive) {
      cleanup();
      return;
    }

    // Only update the tracked set reference, don't resubscribe
    currentTrackedPtyIds = ptyIds;

    void ensureSubscribed();
  });

  onCleanup(() => {
    disposed = true;
    cleanup();
  });

  return {
    hasRecentActivity: (ptyId: string) => {
      const { hasRecentPtyStdoutActivity } = require('../../../core/shimmer');
      return hasRecentPtyStdoutActivity(ptyId);
    },
    recordActivity: recordPtyStdoutActivity,
  };
}
