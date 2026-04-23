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
  createCwdChangeHandler,
  createGitRepoChangeRefresh,
  createLifecycleHandlers as createAggregateLifecycleHandlers,
  createProcessChangeHandler,
  createRefreshState,
  createSubscriptionManager,
  createTitleChangeHandler,
  setupSubscriptions as setupAggregateSubscriptions,
  type CwdChangeHandler,
  type CwdChangeEvent,
  type CurrentSessionHints,
  type CurrentSessionPty,
  type LifecycleEvent,
  type LifecycleHandlerDeps,
  type LifecycleHandlers,
  type PtyOwnership,
  type RefreshFlagKey,
  type RefreshState,
  type SubscriptionManager,
  type SubscriptionSetupDeps,
  type TitleChangeEvent,
  type TitleChangeHandler,
} from './aggregate/subscriptions';

export {
  didPtyInfoChange,
  createSubscriptionManager,
  createRefreshState,
  createTitleChangeHandler,
  createProcessChangeHandler,
  createCwdChangeHandler,
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
  TitleChangeHandler,
  CwdChangeHandler,
  LifecycleEvent,
  LifecycleHandlers,
  SubscriptionSetupDeps,
  LifecycleHandlerDeps,
  TitleChangeEvent,
  CwdChangeEvent,
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
  handleTitleChange: (event: { ptyId: string; title: string }) => void,
  handleProcessChange: (event: { ptyId: string; processName: string }) => void,
  handleCwdChange: CwdChangeHandler,
  lifecycleHandlers: {
    handlePtyCreated: (ptyId: string) => Promise<void>;
    handlePtyDestroyed: (ptyId: string) => void;
  }
): Promise<void> {
  return setupAggregateSubscriptions(state, {
    subscriptions,
    subscriptionsEpoch,
    refreshPtys,
    handleTitleChange,
    handleProcessChange,
    handleCwdChange,
    lifecycleHandlers,
  });
}
