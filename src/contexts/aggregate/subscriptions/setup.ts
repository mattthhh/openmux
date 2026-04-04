/**
 * Subscription setup and cleanup for Aggregate View.
 *
 * Manages all reactive subscriptions:
 * - PTY lifecycle events (created/destroyed)
 * - Title changes
 * - Periodic polling for git metadata updates
 */

import type { AggregateViewState } from '../types';
import type {
  SubscriptionManager,
  LifecycleHandlers,
  TitleChangeHandler,
  LifecycleEvent,
} from './types';
import {
  runStream,
  streamFromSubscription,
  tap,
  repeatWithInterval,
} from '../../../effect/stream-utils';
import {
  subscribeToPtyLifecycle,
  subscribeToAllTitleChanges,
  type PtyTitleChangeEvent,
} from '../../../effect/bridge/pty-bridge';

/** Dependencies for subscription setup */
export interface SubscriptionSetupDeps {
  subscriptions: SubscriptionManager;
  subscriptionsEpoch: { value: number };
  refreshPtys: () => Promise<void>;
  refreshPtysSubset: (ptyIds: string[]) => Promise<void>;
  handleTitleChange: TitleChangeHandler;
  lifecycleHandlers: LifecycleHandlers;
}

/** Polling interval in milliseconds */
const DEFAULT_POLL_INTERVAL_MS = 5000; // Reduced from 2000ms to 5000ms

/**
 * Set up all subscriptions for the aggregate view.
 * Returns when all subscriptions are established or if the view is closed.
 */
export async function setupSubscriptions(
  state: AggregateViewState,
  deps: SubscriptionSetupDeps,
  options: { pollIntervalMs?: number } = {}
): Promise<void> {
  const {
    subscriptions,
    subscriptionsEpoch,
    refreshPtysSubset,
    handleTitleChange,
    lifecycleHandlers,
  } = deps;

  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const epoch = ++subscriptionsEpoch.value;

  // Subscribe to PTY lifecycle events for instant updates (no debounce)
  // Use targeted updates instead of full refresh for better performance
  const lifecycleStream = streamFromSubscription<LifecycleEvent>(({ emit }) =>
    subscribeToPtyLifecycle(emit)
  );

  const lifecycleUnsub = runStream(
    tap(lifecycleStream, (event) => {
      if (event.type === 'created') {
        void lifecycleHandlers.handlePtyCreated(event.ptyId);
      } else {
        lifecycleHandlers.handlePtyDestroyed(event.ptyId);
      }
    }),
    { label: 'aggregate-view-lifecycle' }
  );

  if (epoch !== subscriptionsEpoch.value || !state.showAggregateView) {
    lifecycleUnsub();
    return;
  }
  subscriptions.lifecycle = lifecycleUnsub;

  // Subscribe to title changes - use incremental update instead of full refresh
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

  // Predictable polling: refresh visible git metadata on one cadence.
  if (epoch !== subscriptionsEpoch.value || !state.showAggregateView) {
    return;
  }

  const pollStream = repeatWithInterval(async () => {
    if (!state.showAggregateView || state.allPtys.length === 0) return;
    await refreshPtysSubset(state.allPtys.map((pty) => pty.ptyId));
  }, pollIntervalMs);

  subscriptions.polling = runStream(pollStream, { label: 'aggregate-view-poll' });
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
  subscriptions.polling?.();
  subscriptions.lifecycle = null;
  subscriptions.titleChange = null;
  subscriptions.polling = null;
}
