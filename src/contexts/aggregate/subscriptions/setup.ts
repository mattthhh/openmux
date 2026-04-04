/**
 * Subscription setup and cleanup for Aggregate View.
 *
 * Manages all reactive subscriptions:
 * - PTY lifecycle events (created/destroyed)
 * - Title changes
 * - Git repo change notifications
 * - Activity-driven metadata refresh
 */

import type { AggregateViewState } from '../types';
import type { SubscriptionManager, SubscriptionSetupDeps } from './types';
import { runStream, streamFromSubscription, tap } from '../../../effect/stream-utils';
import {
  subscribeToPtyLifecycle,
  subscribeToAllTitleChanges,
  subscribeToAllPtyActivity,
  type PtyTitleChangeEvent,
} from '../../../effect/bridge/pty-bridge';
import { subscribeToGitRepoChanges } from '../../../effect/services/pty/helpers';

/**
 * Set up all subscriptions for the aggregate view.
 * Returns when all subscriptions are established or if the view is closed.
 */
export async function setupSubscriptions(
  state: AggregateViewState,
  deps: SubscriptionSetupDeps
): Promise<void> {
  const {
    subscriptions,
    subscriptionsEpoch,
    refreshPtysSubset,
    handleTitleChange,
    lifecycleHandlers,
  } = deps;

  const epoch = ++subscriptionsEpoch.value;

  const lifecycleStream = streamFromSubscription<{ type: 'created' | 'destroyed'; ptyId: string }>(
    ({ emit }) => subscribeToPtyLifecycle(emit)
  );

  const lifecycleUnsub = runStream(
    tap(lifecycleStream, (event) => {
      if (event.type === 'created') {
        void lifecycleHandlers.handlePtyCreated(event.ptyId);
        return;
      }
      lifecycleHandlers.handlePtyDestroyed(event.ptyId);
    }),
    { label: 'aggregate-view-lifecycle' }
  );

  if (epoch !== subscriptionsEpoch.value || !state.showAggregateView) {
    lifecycleUnsub();
    return;
  }
  subscriptions.lifecycle = lifecycleUnsub;

  const titleStream = tap(
    streamFromSubscription<PtyTitleChangeEvent>(({ emit }) => subscribeToAllTitleChanges(emit)),
    (event) => handleTitleChange(event)
  );
  const titleUnsub = runStream(titleStream, { label: 'aggregate-view-title' });

  if (epoch !== subscriptionsEpoch.value || !state.showAggregateView) {
    titleUnsub();
    return;
  }
  subscriptions.titleChange = titleUnsub;

  const gitChangeUnsub = createGitRepoChangeRefresh(
    state,
    subscriptionsEpoch,
    epoch,
    refreshPtysSubset
  );
  if (epoch !== subscriptionsEpoch.value || !state.showAggregateView) {
    gitChangeUnsub();
    return;
  }
  subscriptions.gitChanges = gitChangeUnsub;

  if (epoch !== subscriptionsEpoch.value || !state.showAggregateView) {
    return;
  }

  const activityUnsub = createActivityBasedRefresh(
    state,
    subscriptionsEpoch,
    epoch,
    refreshPtysSubset
  );
  if (epoch !== subscriptionsEpoch.value || !state.showAggregateView) {
    activityUnsub();
    return;
  }
  subscriptions.polling = activityUnsub;
}

export function createGitRepoChangeRefresh(
  state: AggregateViewState,
  subscriptionsEpoch: { value: number },
  epoch: number,
  refreshPtysSubset: (ptyIds: string[]) => Promise<void>
): () => void {
  return subscribeToGitRepoChanges((event) => {
    if (!state.showAggregateView || subscriptionsEpoch.value !== epoch) {
      return;
    }

    const affectedPtyIds = state.allPtys
      .filter((pty) => pty.gitRepoKey === event.repoKey)
      .map((pty) => pty.ptyId);

    if (affectedPtyIds.length === 0) {
      return;
    }

    void refreshPtysSubset(affectedPtyIds);
  });
}

/**
 * Create an activity-based metadata refresh subscription.
 */
export function createActivityBasedRefresh(
  state: AggregateViewState,
  subscriptionsEpoch: { value: number },
  epoch: number,
  refreshPtysSubset: (ptyIds: string[]) => Promise<void>
): () => void {
  const pendingPtyIds = new Set<string>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const debounceMs = 500;

  const flushPending = async (): Promise<void> => {
    debounceTimer = null;

    if (!state.showAggregateView || pendingPtyIds.size === 0) return;

    const ptyIdsToRefresh = Array.from(pendingPtyIds);
    pendingPtyIds.clear();

    if (subscriptionsEpoch.value !== epoch) return;

    await refreshPtysSubset(ptyIdsToRefresh);
  };

  const scheduleFlush = (): void => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => void flushPending(), debounceMs);
  };

  const activityStream = streamFromSubscription<{ ptyId: string }>(({ emit }) =>
    subscribeToAllPtyActivity(emit)
  );

  const activityUnsub = runStream(
    tap(activityStream, (event) => {
      if (!state.allPtysIndex.has(event.ptyId)) return;

      pendingPtyIds.add(event.ptyId);
      scheduleFlush();
    }),
    { label: 'aggregate-view-activity-refresh' }
  );

  return () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    pendingPtyIds.clear();
    activityUnsub();
  };
}

/**
 * Clean up all active subscriptions.
 * Also increments the epoch to cancel any pending subscription setups.
 */
export function cleanupSubscriptions(
  subscriptions: SubscriptionManager,
  subscriptionsEpoch: { value: number }
): void {
  subscriptionsEpoch.value += 1;
  subscriptions.lifecycle?.();
  subscriptions.titleChange?.();
  subscriptions.gitChanges?.();
  subscriptions.polling?.();
  subscriptions.lifecycle = null;
  subscriptions.titleChange = null;
  subscriptions.gitChanges = null;
  subscriptions.polling = null;
}
