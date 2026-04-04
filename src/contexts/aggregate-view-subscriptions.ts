/**
 * Aggregate view subscription and refresh compatibility layer.
 */

import type { SetStoreFunction } from 'solid-js/store';

import type { AggregateViewState } from './aggregate-view-types';
import { didPtyInfoChange } from './aggregate/git';
import { createAggregateViewRefreshers } from './aggregate/refresh';
import {
  cleanupSubscriptions,
  createActivityBasedRefresh,
  createGitRepoChangeRefresh,
  createLifecycleHandlers as createAggregateLifecycleHandlers,
  createRefreshState,
  createSubscriptionManager,
  createTitleChangeHandler,
  setupSubscriptions as setupAggregateSubscriptions,
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
  LifecycleEvent,
  LifecycleHandlers,
  SubscriptionSetupDeps,
  LifecycleHandlerDeps,
  TitleChangeEvent,
};

export type {
  AggregatePtyMetadata,
  ResolvedPty,
  SessionSummary,
  CreateRefreshersParams,
  RefreshersResult,
} from './aggregate/refresh';

export function createLifecycleHandlers(
  state: AggregateViewState,
  setState: SetStoreFunction<AggregateViewState>,
  resolvePtyOwnership: (ptyId: string) => PtyOwnership | null,
  getCurrentSessionHints: () => CurrentSessionHints
) {
  return createAggregateLifecycleHandlers(state, setState, {
    resolvePtyOwnership,
    getCurrentSessionHints,
  });
}

export async function setupSubscriptions(
  state: AggregateViewState,
  subscriptions: SubscriptionManager,
  subscriptionsEpoch: { value: number },
  refreshPtys: () => Promise<void>,
  refreshPtysSubset: (ptyIds: string[]) => Promise<void>,
  handleTitleChange: (event: { ptyId: string; title: string }) => void,
  lifecycleHandlers: {
    handlePtyCreated: (ptyId: string) => Promise<void>;
    handlePtyDestroyed: (ptyId: string) => void;
  }
): Promise<void> {
  return setupAggregateSubscriptions(state, {
    subscriptions,
    subscriptionsEpoch,
    refreshPtys,
    refreshPtysSubset,
    handleTitleChange,
    lifecycleHandlers,
  });
}
