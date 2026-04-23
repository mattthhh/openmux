/**
 * Aggregate view subscription and refresh barrel.
 *
 * The aggregate internals are split into focused modules, but the context layer
 * still imports them through this shared surface to keep the wiring readable.
 */

import type { SetStoreFunction } from 'solid-js/store';

import type { AggregateViewState } from './aggregate-view-types';
import { didPtyInfoChange } from './aggregate/git';
import { createAggregateViewRefreshers } from './aggregate/refresh';
import type { SuspendedPtyCache } from './aggregate/refresh/suspended-pty-cache';
import {
  cleanupSubscriptions,
  createActivityBasedRefresh,
  createGitRepoChangeRefresh,
  createLifecycleHandlers as createAggregateLifecycleHandlers,
  createMetadataChangeHandler,
  createRefreshState,
  createSubscriptionManager,
  setupSubscriptions as setupAggregateSubscriptions,
  type CurrentSessionHints,
  type CurrentSessionPty,
  type LifecycleEvent,
  type LifecycleHandlerDeps,
  type LifecycleHandlers,
  type MetadataChangeEvent,
  type PtyOwnership,
  type RefreshFlagKey,
  type RefreshState,
  type SubscriptionManager,
  type SubscriptionSetupDeps,
} from './aggregate/subscriptions';

export {
  didPtyInfoChange,
  createSubscriptionManager,
  createRefreshState,
  createMetadataChangeHandler,
};
export {
  createAggregateViewRefreshers,
  createGitRepoChangeRefresh,
  createActivityBasedRefresh,
  cleanupSubscriptions,
};

export type {
  SubscriptionManager,
  RefreshState,
  RefreshFlagKey,
  PtyOwnership,
  CurrentSessionHints,
  CurrentSessionPty,
  MetadataChangeEvent,
  LifecycleEvent,
  LifecycleHandlers,
  SubscriptionSetupDeps,
  LifecycleHandlerDeps,
};
export type { SuspendedPtyCache };

export function createLifecycleHandlers(
  state: AggregateViewState,
  setState: SetStoreFunction<AggregateViewState>,
  deps: LifecycleHandlerDeps
) {
  return createAggregateLifecycleHandlers(state, setState, deps);
}

export async function setupSubscriptions(
  state: AggregateViewState,
  subscriptions: SubscriptionManager,
  subscriptionsEpoch: { value: number },
  refreshPtys: () => Promise<void>,
  handleMetadataChange: (event: MetadataChangeEvent) => void,
  lifecycleHandlers: {
    handlePtyCreated: (ptyId: string) => Promise<void>;
    handlePtyDestroyed: (ptyId: string) => void;
  }
): Promise<void> {
  return setupAggregateSubscriptions(state, {
    subscriptions,
    subscriptionsEpoch,
    refreshPtys,
    handleMetadataChange,
    lifecycleHandlers,
  });
}
