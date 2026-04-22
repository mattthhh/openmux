/**
 * AggregateViewContext - manages state for the aggregate view overlay.
 * Allows filtering and viewing PTYs across all workspaces.
 */

import { createContext, useContext, createEffect, on, onCleanup, type ParentProps } from 'solid-js';
import { createStore, produce } from 'solid-js/store';

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
  createProcessChangeHandler,
  createLifecycleHandlers,
  setupSubscriptions,
  cleanupSubscriptions,
} from './aggregate-view-subscriptions';

import { createAggregateViewActions } from './aggregate-view-actions';
import { recomputeTree } from './aggregate-view-helpers';
import { useLayout } from './LayoutContext';
import { useSession } from './SessionContext';
import { getActiveSessionIdForShim } from '../effect/bridge/app-coordinator-bridge';
import { useTerminal } from './TerminalContext';
import {
  resolveAggregatePtyOwnership,
  resolveCurrentAggregatePtySessionId,
} from '../components/aggregate/utils';
import { collectPanes } from '../core/layout-tree';
import {
  getAggregateSessionOrderResult,
  setAggregateSessionOrder,
} from '../effect/bridge/session-bridge';
import { getSessionCwd as getStoredSessionCwd } from '../effect/bridge';
import { getAggregateSessionForPty } from '../effect/bridge/aggregate/cache/session-pty-cache';

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

  const resolvePtyOwnership = (ptyId: string) =>
    resolveAggregatePtyOwnership({
      ptyId,
      workspaces: layout.state.workspaces,
      activeSessionId: session.state.activeSessionId,
      trackedOwner: terminal.findSessionForPty(ptyId),
      aggregateOwner: getAggregateSessionForPty(ptyId),
    });

  const getEffectiveCurrentSessionId = () =>
    getActiveSessionIdForShim() ?? session.state.activeSessionId;

  const getCurrentSessionHints = () => ({
    sessionId: getEffectiveCurrentSessionId(),
    lastActiveWorkspaceId: layout.state.activeWorkspaceId,
    focusedPaneId: layout.activeWorkspace?.focusedPaneId ?? undefined,
  });

  const getCurrentSessionPaneOrder = () => {
    const sessionId = getEffectiveCurrentSessionId();
    if (!sessionId || session.state.switching) return null;

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

  /**
   * Get PTYs from current session layout for instant aggregate view population.
   * This avoids waiting for the expensive full refresh.
   */
  const getCurrentSessionPtys = () => {
    const sessionId = getEffectiveCurrentSessionId();
    if (!sessionId) return [];

    const ptys: Array<{
      ptyId: string;
      paneId: string;
      workspaceId: number;
      title?: string;
      cwd?: string;
      sessionId?: string;
    }> = [];

    for (const [wsId, workspace] of Object.entries(layout.state.workspaces)) {
      if (!workspace) continue;

      const workspaceId = Number(wsId);
      const collectPtys = (node: unknown) => {
        if (!node) return;
        const n = node as {
          type?: string;
          id?: string;
          ptyId?: string;
          title?: string;
          first?: unknown;
          second?: unknown;
        };
        if (n.type === 'split') {
          collectPtys(n.first);
          collectPtys(n.second);
        } else if (n.id && n.ptyId && terminal.isPtyActive(n.ptyId)) {
          const trackedSession = terminal.findSessionForPty(n.ptyId);
          const aggregateOwner = getAggregateSessionForPty(n.ptyId);
          const effectiveSessionId = sessionId;
          const resolvedSessionId = resolveCurrentAggregatePtySessionId({
            effectiveSessionId,
            switching: session.state.switching,
            trackedOwner: trackedSession,
            aggregateOwner,
          });
          if (!resolvedSessionId) {
            return;
          }

          ptys.push({
            ptyId: n.ptyId,
            paneId: n.id,
            workspaceId,
            title: n.title,
            cwd: getStoredSessionCwd(n.id),
            sessionId: resolvedSessionId,
          });
        }
      };

      if (workspace.mainPane) {
        collectPtys(workspace.mainPane);
      }
      for (const stackPane of workspace.stackPanes) {
        collectPtys(stackPane);
      }
    }

    return ptys;
  };

  const { refreshPtys, refreshActiveSession, initialLoad, suspendedPtyCache } =
    createAggregateViewRefreshers(
      state,
      setState,
      refreshState,
      resolvePtyOwnership,
      getCurrentSessionHints,
      getCurrentSessionPaneOrder,
      getCurrentSessionPtys
    );

  const titleHandler = createTitleChangeHandler(setState);
  const processHandler = createProcessChangeHandler(setState);
  const handleTitleChange = (event: { ptyId: string; title: string }) => {
    suspendedPtyCache.invalidateByPtyId(event.ptyId);
    titleHandler(event);
  };
  const handleProcessChange = (event: { ptyId: string; processName: string }) => {
    suspendedPtyCache.invalidateByPtyId(event.ptyId);
    processHandler(event);
  };

  const lifecycleHandlers = createLifecycleHandlers(state, setState, {
    resolvePtyOwnership,
    getCurrentSessionHints,
    refreshPtys,
    refreshActiveSession,
    onPtyDestroyed: (ptyId) => {
      suspendedPtyCache.invalidateByPtyId(ptyId);
    },
  });

  const loadPersistedSessionOrder = async (): Promise<void> => {
    const persistedOrder = await getAggregateSessionOrderResult();
    if (persistedOrder instanceof Error) {
      console.error('Failed to load aggregate session order:', persistedOrder.message);
      return;
    }

    setState(
      produce((s) => {
        s.manualSessionOrder = persistedOrder;
        recomputeTree(s);
      })
    );
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

  createEffect(
    on(
      () => state.showAggregateView,
      (showAggregateView) => {
        if (showAggregateView) {
          void loadPersistedSessionOrder();

          // Initial load: instant with current session PTYs, then background full refresh
          void (async () => {
            // First, do instant initial load (shows current session immediately)
            await initialLoad();

            // Then set up subscriptions for live updates (before full refresh)
            // This ensures lifecycle events are captured during the full refresh
            await setupSubscriptions(
              state,
              subscriptions,
              subscriptionsEpoch,
              refreshPtys,
              handleTitleChange,
              handleProcessChange,
              lifecycleHandlers
            );

            // Hydrate live metadata in the background.
            void refreshPtys();
          })();
        } else {
          suspendedPtyCache.clear();
          cleanupSubscriptions(subscriptions, subscriptionsEpoch);
        }
      }
    )
  );

  createEffect(() => {
    if (!state.showAggregateView) return;

    const switching = session.state.switching;
    const activeSessionId = session.state.activeSessionId;
    const sessionSignature = session.state.sessions
      .map(
        (sessionMetadata) =>
          `${sessionMetadata.id}:${sessionMetadata.name}:${sessionMetadata.lastSwitchedAt}`
      )
      .join('|');

    void activeSessionId;
    void sessionSignature;
    if (switching) return;
    void refreshPtys();
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
    <AggregateViewContext.Provider value={value}>{props.children}</AggregateViewContext.Provider>
  );
}

export function useAggregateView(): AggregateViewContextValue {
  const context = useContext(AggregateViewContext);
  if (!context) {
    throw new Error('useAggregateView must be used within AggregateViewProvider');
  }
  return context;
}
