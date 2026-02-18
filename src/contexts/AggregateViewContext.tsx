/**
 * AggregateViewContext - manages state for the aggregate view overlay.
 * Allows filtering and viewing PTYs across all workspaces.
 */

import {
  createContext,
  useContext,
  createEffect,
  onCleanup,
  type ParentProps,
} from 'solid-js';
import { createStore } from 'solid-js/store';

export type {
  GitDiffStats,
  PtyInfo,
  AggregateViewState,
  AggregateViewContextValue,
} from './aggregate-view-types';
import {
  type AggregateViewState,
  type AggregateViewContextValue,
  initialState,
} from './aggregate-view-types';

import {
  createSubscriptionManager,
  createRefreshState,
  createAggregateViewRefreshers,
  createTitleChangeHandler,
  setupSubscriptions,
  cleanupSubscriptions,
} from './aggregate-view-subscriptions';

import { createAggregateViewActions } from './aggregate-view-actions';

const AggregateViewContext = createContext<AggregateViewContextValue | null>(null);

interface AggregateViewProviderProps extends ParentProps {}

  export function AggregateViewProvider(props: AggregateViewProviderProps) {
  const [state, setState] = createStore<AggregateViewState>(initialState);

  const subscriptions = createSubscriptionManager();
  const subscriptionsEpoch = { value: 0 };
  const refreshState = createRefreshState();

  const { refreshPtys, refreshPtysSubset, refreshSelectedDiffStats } =
    createAggregateViewRefreshers(state, setState, refreshState);

  const handleTitleChange = createTitleChangeHandler(setState);

  const actions = createAggregateViewActions(state, setState);

  createEffect(() => {
    if (state.showAggregateView) {
      refreshPtys();
      setupSubscriptions(
        state,
        subscriptions,
        subscriptionsEpoch,
        refreshPtys,
        refreshPtysSubset,
        handleTitleChange
      );
    } else {
      cleanupSubscriptions(subscriptions, subscriptionsEpoch);
    }
  });

  createEffect(() => {
    if (!state.showAggregateView) return;
    const selectedPtyId = state.selectedPtyId;
    if (!selectedPtyId) return;
    refreshSelectedDiffStats(selectedPtyId);
  });

  onCleanup(() => {
    cleanupSubscriptions(subscriptions, subscriptionsEpoch);
  });

  const value: AggregateViewContextValue = {
    state,
    ...actions,
    refreshPtys,
  };

  return (
    <AggregateViewContext.Provider value={value}>
      {props.children}
    </AggregateViewContext.Provider>
  );
}

export function useAggregateView(): AggregateViewContextValue {
  const context = useContext(AggregateViewContext);
  if (!context) {
    throw new Error('useAggregateView must be used within AggregateViewProvider');
  }
  return context;
}
