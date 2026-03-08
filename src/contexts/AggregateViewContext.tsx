/**
 * AggregateViewContext - manages state for the aggregate view overlay.
 * Allows filtering and viewing PTYs across all workspaces.
 */

import {
  createContext,
  useContext,
  createEffect,
  on,
  onCleanup,
  type ParentProps,
} from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { setShimmerEnabled } from '../core/shimmer';

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
import { recomputeTree } from './aggregate-view-helpers';
import { useLayout } from './LayoutContext';
import { useSession } from './SessionContext';
import { useTerminal } from './TerminalContext';
import { findPaneLocation, findPtyLocation } from '../components/aggregate/utils';
import { collectPanes } from '../core/layout-tree';
import { getAggregateSessionOrderResult, setAggregateSessionOrder } from '../effect/bridge/session-bridge';

const AggregateViewContext = createContext<AggregateViewContextValue | null>(null);

interface AggregateViewProviderProps extends ParentProps {}

  export function AggregateViewProvider(props: AggregateViewProviderProps) {
  const [state, setState] = createStore<AggregateViewState>(initialState);
  const layout = useLayout();
  const session = useSession();
  const terminal = useTerminal();

  const subscriptions = createSubscriptionManager();
  const subscriptionsEpoch = { value: 0 };
  const refreshState = createRefreshState();

  const resolvePtyOwnership = (ptyId: string) => {
    const tracked = terminal.findSessionForPty(ptyId);
    if (tracked) {
      const workspaceId = findPaneLocation(tracked.paneId, layout.state.workspaces)?.workspaceId;
      return {
        sessionId: tracked.sessionId,
        paneId: tracked.paneId,
        workspaceId,
      };
    }

    const activeSessionId = session.state.activeSessionId;
    if (!activeSessionId) return null;

    const location = findPtyLocation(ptyId, layout.state.workspaces);
    if (!location) return null;

    return {
      sessionId: activeSessionId,
      paneId: location.paneId,
      workspaceId: location.workspaceId,
    };
  };

  const getCurrentSessionHints = () => ({
    sessionId: session.state.activeSessionId,
    lastActiveWorkspaceId: layout.state.activeWorkspaceId,
    focusedPaneId: layout.activeWorkspace?.focusedPaneId ?? undefined,
  });

  const getCurrentSessionPaneOrder = () => {
    const sessionId = session.state.activeSessionId;
    if (!sessionId) return null;

    const paneIds: string[] = [];
    for (const workspace of Object.values(layout.state.workspaces)) {
      if (!workspace) continue;
      if (workspace.mainPane) {
        for (const pane of collectPanes(workspace.mainPane)) {
          paneIds.push(pane.id);
        }
      }
      for (const stackPane of workspace.stackPanes) {
        for (const pane of collectPanes(stackPane)) {
          paneIds.push(pane.id);
        }
      }
    }

    return new Map(paneIds.map((paneId, index) => [paneId, index] as const));
  };

  const { refreshPtys, refreshPtysSubset } =
    createAggregateViewRefreshers(
      state,
      setState,
      refreshState,
      resolvePtyOwnership,
      getCurrentSessionHints,
      getCurrentSessionPaneOrder
    );

  const handleTitleChange = createTitleChangeHandler(setState);

  const loadPersistedSessionOrder = async (): Promise<void> => {
    const persistedOrder = await getAggregateSessionOrderResult();
    if (persistedOrder instanceof Error) {
      console.error('Failed to load aggregate session order:', persistedOrder.message);
      return;
    }

    setState(produce((s) => {
      s.manualSessionOrder = persistedOrder;
      recomputeTree(s);
    }));
  };

  const persistSessionOrder = async (order: string[]): Promise<void> => {
    const result = await setAggregateSessionOrder(order);
    if (result instanceof Error) {
      console.error('Failed to persist aggregate session order:', result.message);
    }
  };

  // Handle creating a new pane in a specific session
  const handleCreatePaneInSession = (_sessionId: string) => {
    actions.closeAggregateView();
  };

  const actions = createAggregateViewActions({
    state,
    setState,
    refreshPtys,
    onCreatePaneInSession: handleCreatePaneInSession,
    persistSessionOrder,
  });

  createEffect(on(() => state.showAggregateView, (showAggregateView) => {
    if (showAggregateView) {
      void loadPersistedSessionOrder();
      void refreshPtys();
      void setupSubscriptions(
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
  }));

  createEffect(() => {
    if (!state.showAggregateView) return;

    const activeSessionId = session.state.activeSessionId;
    const sessionSignature = session.state.sessions
      .map((sessionMetadata) => `${sessionMetadata.id}:${sessionMetadata.name}:${sessionMetadata.lastSwitchedAt}`)
      .join('|');

    void activeSessionId;
    void sessionSignature;
    void refreshPtys();
  });

  // Enable shimmer when aggregate view is open, disable when closed
  createEffect(() => {
    setShimmerEnabled(state.showAggregateView);
  });

  onCleanup(() => {
    cleanupSubscriptions(subscriptions, subscriptionsEpoch);
    setShimmerEnabled(false);
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
