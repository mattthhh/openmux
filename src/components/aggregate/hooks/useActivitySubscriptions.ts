/**
 * useActivitySubscriptions - event-based PTY activity tracking.
 *
 * Uses a single global stdout-activity subscription instead of per-PTY unified
 * update subscriptions. This keeps background PTY activity cheap while still
 * letting the aggregate view shimmer for hidden PTYs.
 *
 * When ownership can be resolved, activity is mirrored onto the stable saved-row
 * id for that pane (`saved:<sessionId>:<paneId>`). That lets unloaded or saved
 * rows keep their shimmer state without loading every PTY in the background.
 */

import { createRenderEffect, createMemo, onCleanup, type Accessor } from 'solid-js';
import * as errore from 'errore';
import { subscribeToAllPtyActivity } from '../../../effect/bridge';
import { recordPtyStdoutActivity } from '../../../core/shimmer';
import { getSavedAggregatePtyId } from '../../../contexts/aggregate/rows';
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
  resolvePtyOwnership?: (
    ptyId: string
  ) => { sessionId: string; paneId: string | null | undefined } | null;
}): UseActivitySubscriptionsResult {
  let currentTrackedPtyIds = new Set<string>();
  let currentTrackedPaneAliases = new Set<string>();
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
          const ownership = options.resolvePtyOwnership?.(event.ptyId) ?? null;
          const savedRowId = ownership?.paneId
            ? getSavedAggregatePtyId(ownership.sessionId, ownership.paneId)
            : null;
          const shouldRecordRaw =
            currentTrackedPtyIds.has(event.ptyId) ||
            (savedRowId !== null && currentTrackedPaneAliases.has(savedRowId));

          if (shouldRecordRaw) {
            recordPtyStdoutActivity(event.ptyId);
          }

          if (savedRowId !== null && currentTrackedPaneAliases.has(savedRowId)) {
            recordPtyStdoutActivity(savedRowId);
          }
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
  const trackedPtyIdsMemo = createMemo(() => {
    const trackedPtys = options.getTrackedPtys();

    return {
      ptyIds: new Set(trackedPtys.map((pty) => pty.ptyId)),
      paneAliases: new Set(
        trackedPtys.flatMap((pty) => {
          if (!pty.paneId) {
            return [];
          }

          return [getSavedAggregatePtyId(pty.sessionId, pty.paneId)];
        })
      ),
    };
  });

  createRenderEffect(() => {
    const isActive = options.isActive();
    const tracked = trackedPtyIdsMemo();

    if (!isActive) {
      cleanup();
      return;
    }

    // Only update the tracked set reference, don't resubscribe
    currentTrackedPtyIds = tracked.ptyIds;
    currentTrackedPaneAliases = tracked.paneAliases;

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
