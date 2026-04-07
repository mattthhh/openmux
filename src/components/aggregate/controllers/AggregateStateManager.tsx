/**
 * AggregateStateManager - Handles session loading, pane creation, and auto-focus effects
 * Encapsulates all async state management side effects for AggregateView
 */

import { createEffect, onCleanup, createSignal } from 'solid-js';
import { loadSessionData } from '../../../effect/bridge';
import { useLayout } from '../../../contexts/LayoutContext';
import { useSession } from '../../../contexts/SessionContext';
import { useTerminal } from '../../../contexts/TerminalContext';
import { useKeyboard } from '../../../contexts/KeyboardContext';
import { useCopyMode } from '../../../contexts/copy-mode';
import { collectPanes } from '../../../core/layout-tree';
import type { Workspace, WorkspaceId } from '../../../core/types';
import type {
  PendingPaneCreation,
  FlattenedTreeItem,
  AggregateViewState,
} from '../../../contexts/aggregate-view-types';
import type { PendingAggregatePaneFocus } from '../pending-pane-focus';
import { getNextPendingPaneCreationOrder } from '../../../contexts/aggregate-view-pending-insertions';
import { resolvePendingAggregatePaneFocus } from '../pending-pane-focus';
import { findPtyLocation, findPaneLocation } from '../utils';

export interface AggregateStateManagerProps {
  /** Whether aggregate view is active */
  isActive: () => boolean;
  /** Current aggregate view state from context */
  state: AggregateViewState;
  /** Selected PTY ID getter */
  selectedPtyId: () => string | null;
  /** Selected session ID getter */
  selectedSessionId: () => string | null;
  /** Whether in preview mode */
  previewMode: () => boolean;
  /** Current selected index */
  selectedIndex: () => number;
  /** Flattened tree items */
  flattenedTree: () => FlattenedTreeItem[];
  /** Currently expanded session IDs */
  expandedSessionIds: () => Set<string>;
  /** Current filter query */
  filterQuery: () => string;
  /** Pending pane creations (array in state) */
  pendingPaneCreations: () => PendingPaneCreation[];
  /** Full aggregate state for order calculations */
  aggregateState: () => Pick<
    AggregateViewState,
    'allPtys' | 'sessionPaneOrders' | 'sessionPaneOrderIndex' | 'pendingPaneCreations'
  >;
  /** Session IDs that have been attempted to load */
  loadAttemptedSessionIds: () => Set<string>;
  /** Load PTYs for a session */
  loadSessionPtys: (sessionId: string) => void;
  /** Set filter query */
  setFilterQuery: (query: string) => void;
  /** Toggle session expansion */
  toggleSessionExpanded: (sessionId: string) => void;
  /** Select a PTY */
  selectPty: (ptyId: string) => void;
  /** Add/update pending pane creation */
  upsertPendingPaneCreation: (creation: PendingPaneCreation) => void;
  /** Remove pending pane creation */
  removePendingPaneCreation: (id: string) => void;
  /** Clear all pending pane creations */
  clearPendingPaneCreations: () => void;
  /** Close aggregate view */
  closeAggregateView: () => void;
  /** Exit aggregate keyboard mode */
  exitAggregateMode: () => void;
  /** Enter aggregate keyboard mode */
  enterAggregateMode: () => void;
}

/**
 * Controller component that manages all async state effects for AggregateView.
 * Handles session auto-loading, pending pane focus resolution, and pane creation.
 * Returns an object with methods that can be passed to keyboard controller.
 */
const AUTO_SWITCH_DEBOUNCE_MS = 90;

export function AggregateStateManager(props: AggregateStateManagerProps) {
  const layout = useLayout();
  const session = useSession();
  const terminal = useTerminal();
  const keyboard = useKeyboard();
  const copyMode = useCopyMode();

  const { state: layoutState, switchWorkspace, focusPane, setLayoutMode } = layout;
  const { state: sessionState, switchSession } = session;
  const { findSessionForPty, getSessionCwd, createPaneWithPTY } = terminal;
  const { state: keyboardState, enterAggregateMode } = keyboard;

  // Local pending focus signal (managed internally)
  const [pendingPaneFocus, setPendingPaneFocus] = createSignal<PendingAggregatePaneFocus | null>(
    null
  );

  // Copy mode tracking
  const [aggregateCopyModeActive, setAggregateCopyModeActive] = createSignal(false);

  // Helpers
  const getLastPaneIdForWorkspace = (workspace: Workspace | undefined): string | null => {
    if (!workspace) return null;

    const paneIds: string[] = [];
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

    return paneIds[paneIds.length - 1] ?? workspace.focusedPaneId ?? null;
  };

  const getPreferredPaneIdForWorkspace = (workspace: Workspace | undefined): string | null => {
    if (!workspace) return null;
    return workspace.focusedPaneId ?? getLastPaneIdForWorkspace(workspace);
  };

  const toWorkspaceId = (workspaceId: number | undefined): WorkspaceId | undefined => {
    if (
      workspaceId === 1 ||
      workspaceId === 2 ||
      workspaceId === 3 ||
      workspaceId === 4 ||
      workspaceId === 5 ||
      workspaceId === 6 ||
      workspaceId === 7 ||
      workspaceId === 8 ||
      workspaceId === 9
    ) {
      return workspaceId;
    }
    return undefined;
  };

  const switchToSessionWithData = async (
    sessionId: string,
    preloadedData?: Awaited<ReturnType<typeof loadSessionData>>,
    target?: { workspaceId?: WorkspaceId; paneId?: string }
  ): Promise<boolean> => {
    if (preloadedData instanceof Error) {
      console.error('Failed to load session:', preloadedData.message);
      return false;
    }

    const adjustedPreloadedData =
      preloadedData && !(preloadedData instanceof Error) && target?.workspaceId
        ? (() => {
            const workspace = preloadedData.workspaces[target.workspaceId];
            return {
              ...preloadedData,
              activeWorkspaceId: target.workspaceId,
              workspaces: {
                ...preloadedData.workspaces,
                [target.workspaceId]: workspace
                  ? {
                      ...workspace,
                      focusedPaneId: target.paneId ?? workspace.focusedPaneId,
                    }
                  : workspace,
              },
            };
          })()
        : preloadedData;

    await switchSession(
      sessionId,
      adjustedPreloadedData ? { preloadedData: adjustedPreloadedData } : undefined
    );
    return true;
  };

  // Copy mode tracking effects
  createEffect(() => {
    if (
      props.isActive() &&
      props.previewMode() &&
      keyboardState.mode === 'copy' &&
      props.selectedPtyId() &&
      copyMode.isActive(props.selectedPtyId()!)
    ) {
      setAggregateCopyModeActive(true);
    }
  });

  createEffect(() => {
    if (!aggregateCopyModeActive()) return;

    const activeCopyPtyId = copyMode.getActivePtyId();
    const shouldKeepCopyMode =
      props.isActive() &&
      props.previewMode() &&
      !!activeCopyPtyId &&
      activeCopyPtyId === props.selectedPtyId();

    if (shouldKeepCopyMode) return;

    // Exit copy mode
    copyMode.exitCopyMode();
    setAggregateCopyModeActive(false);
    if (keyboardState.mode === 'copy') {
      keyboard.exitCopyMode();
      if (props.isActive()) {
        enterAggregateMode();
      }
    }
  });

  // Resolve pending pane focus (for newly created panes)
  createEffect(() => {
    if (!props.isActive()) {
      setPendingPaneFocus(null);
      props.clearPendingPaneCreations();
      return;
    }

    const resolution = resolvePendingAggregatePaneFocus({
      pending: pendingPaneFocus(),
      allPtys: props.state.allPtys,
      flattenedTreeIndex: props.state.flattenedTreeIndex,
      expandedSessionIds: props.expandedSessionIds(),
      filterQuery: props.filterQuery(),
    });

    if (resolution.type === 'wait') return;

    if (resolution.type === 'clear-filter') {
      if (props.filterQuery()) {
        props.setFilterQuery('');
      }
      return;
    }

    if (resolution.type === 'expand-session') {
      props.toggleSessionExpanded(resolution.sessionId);
      return;
    }

    props.selectPty(resolution.ptyId);
    setPendingPaneFocus(null);
  });

  createEffect(() => {
    if (!props.isActive()) return;
    if (sessionState.switching) return;
    if (props.pendingPaneCreations().length > 0) return;
    if (pendingPaneFocus()) return;

    const selectedItem = props.flattenedTree()[props.selectedIndex()];
    if (selectedItem?.node.type !== 'pty') return;

    const selectedSessionId = selectedItem.node.ptyInfo.sessionId;
    if (!selectedSessionId) return;
    if (selectedSessionId === sessionState.activeSessionId) return;

    const targetWorkspaceId = toWorkspaceId(selectedItem.node.ptyInfo.workspaceId);
    const targetPaneId = selectedItem.node.ptyInfo.paneId;

    let cancelled = false;
    const timeout = setTimeout(() => {
      void (async () => {
        const sessionData = await loadSessionData(selectedSessionId);
        if (cancelled) return;
        await switchToSessionWithData(selectedSessionId, sessionData, {
          workspaceId: targetWorkspaceId,
          paneId: targetPaneId ?? undefined,
        });
      })();
    }, AUTO_SWITCH_DEBOUNCE_MS);

    onCleanup(() => {
      cancelled = true;
      clearTimeout(timeout);
    });
  });

  // Cleanup
  onCleanup(() => {
    setPendingPaneFocus(null);
    props.clearPendingPaneCreations();
  });

  // Public API for jump to PTY
  const handleJumpToPty = async (): Promise<boolean> => {
    const selectedPtyId = props.selectedPtyId();
    const selectedSessionId = props.selectedSessionId();

    if (selectedPtyId) {
      const location = findPtyLocation(selectedPtyId, layoutState.workspaces);
      if (location) {
        props.closeAggregateView();
        props.exitAggregateMode();
        if (layoutState.activeWorkspaceId !== location.workspaceId) {
          switchWorkspace(location.workspaceId);
        }
        focusPane(location.paneId);
        return true;
      }

      const sessionLocation = findSessionForPty(selectedPtyId);
      if (sessionLocation && sessionLocation.sessionId !== sessionState.activeSessionId) {
        const sessionData = await loadSessionData(sessionLocation.sessionId);
        if (sessionData instanceof Error) {
          console.error('Failed to load session:', sessionData.message);
          return false;
        }

        const nextLocation = findPaneLocation(sessionLocation.paneId, sessionData.workspaces);

        props.closeAggregateView();
        props.exitAggregateMode();
        const switched = await switchToSessionWithData(sessionLocation.sessionId, sessionData);
        if (!switched) {
          return false;
        }
        if (nextLocation) {
          switchWorkspace(nextLocation.workspaceId);
          focusPane(sessionLocation.paneId);
          return true;
        }
        const fallbackPaneId = getPreferredPaneIdForWorkspace(
          sessionData.workspaces[sessionData.activeWorkspaceId]
        );
        if (fallbackPaneId) {
          switchWorkspace(sessionData.activeWorkspaceId);
          focusPane(fallbackPaneId);
        }
        return true;
      }
    }

    if (!selectedSessionId) return false;

    if (selectedSessionId === sessionState.activeSessionId) {
      const workspaceId = layoutState.activeWorkspaceId;
      const paneId = getPreferredPaneIdForWorkspace(layoutState.workspaces[workspaceId]);
      props.closeAggregateView();
      props.exitAggregateMode();
      if (paneId) {
        switchWorkspace(workspaceId);
        focusPane(paneId);
      }
      return true;
    }

    // Load session and jump to it
    const sessionData = await loadSessionData(selectedSessionId);
    if (sessionData instanceof Error) {
      console.error('Failed to load session:', sessionData.message);
      return false;
    }

    const workspaceId = sessionData.activeWorkspaceId;
    const paneId = getPreferredPaneIdForWorkspace(sessionData.workspaces[workspaceId]);

    props.closeAggregateView();
    props.exitAggregateMode();
    const switched = await switchToSessionWithData(selectedSessionId, sessionData);
    if (!switched) {
      return false;
    }
    switchWorkspace(workspaceId);
    if (paneId) {
      focusPane(paneId);
    }
    return true;
  };

  // Public API for new pane in session
  const handleNewPaneInSession = async (): Promise<void> => {
    const selectedSessionId = props.selectedSessionId();
    const selectedPtyId = props.selectedPtyId();

    if (!selectedSessionId && !selectedPtyId) return;

    const selectedPty = selectedPtyId
      ? (props.state.allPtys[props.state.allPtysIndex.get(selectedPtyId) ?? -1] ?? null)
      : null;

    const targetSessionId =
      selectedSessionId ??
      findSessionForPty(selectedPtyId!)?.sessionId ??
      sessionState.activeSessionId;
    if (!targetSessionId) return;

    const pendingInsertionId = crypto.randomUUID();
    const pendingInsertion: PendingPaneCreation = {
      id: pendingInsertionId,
      sessionId: targetSessionId,
      insertAfterPtyId: selectedPtyId,
      insertAfterPaneId: selectedPty?.paneId ?? null,
      pendingPtyId: null,
      pendingPaneId: null,
      sortOrderHint: getNextPendingPaneCreationOrder(props.aggregateState(), {
        sessionId: targetSessionId,
        insertAfterPaneId: selectedPty?.paneId ?? null,
      }),
    };
    props.upsertPendingPaneCreation(pendingInsertion);

    setPendingPaneFocus(null);

    let targetWorkspaceId = layoutState.activeWorkspaceId;
    let targetCwd: string | undefined;

    // Get CWD from selected PTY if available
    if (selectedPtyId) {
      targetCwd = await getSessionCwd(selectedPtyId).catch(() => undefined);
    }

    if (targetSessionId === sessionState.activeSessionId) {
      // Current session
      if (!targetCwd) {
        const workspace = layoutState.workspaces[layoutState.activeWorkspaceId];
        if (workspace) {
          const livePanes: Array<{ id: string; ptyId?: string }> = [];
          if (workspace.mainPane) {
            livePanes.push(...collectPanes(workspace.mainPane));
          }
          for (const stackPane of workspace.stackPanes) {
            livePanes.push(...collectPanes(stackPane));
          }
          const candidatePane =
            livePanes.find((p) => p.id === workspace.focusedPaneId && !!p.ptyId) ??
            [...livePanes].reverse().find((p) => !!p.ptyId) ??
            null;
          if (candidatePane?.ptyId) {
            targetCwd = await getSessionCwd(candidatePane.ptyId).catch(() => undefined);
          }
        }
      }

      if (selectedPtyId) {
        const location = findPtyLocation(selectedPtyId, layoutState.workspaces);
        if (location) {
          targetWorkspaceId = location.workspaceId;
        }
      }
    } else {
      // Other session - load and switch
      const sessionData = await loadSessionData(targetSessionId);
      if (sessionData instanceof Error) {
        props.removePendingPaneCreation(pendingInsertionId);
        console.error('Failed to load session:', sessionData.message);
        return;
      }

      targetWorkspaceId = sessionData.activeWorkspaceId;
      if (!targetCwd) {
        const activeWorkspace = sessionData.workspaces[sessionData.activeWorkspaceId];
        const lastPaneId = getLastPaneIdForWorkspace(activeWorkspace);
        if (lastPaneId) {
          targetCwd = sessionData.cwdMap.get(lastPaneId);
        }
      }

      const switched = await switchToSessionWithData(targetSessionId, sessionData);
      if (!switched) {
        props.removePendingPaneCreation(pendingInsertionId);
        return;
      }
    }

    switchWorkspace(targetWorkspaceId);
    setLayoutMode('stacked');
    const createdPane = await createPaneWithPTY(targetCwd, 'shell', {
      onCreated: (created) => {
        props.upsertPendingPaneCreation({
          ...pendingInsertion,
          pendingPtyId: created.ptyId,
          pendingPaneId: created.paneId,
        });
      },
    });
    if (!createdPane) {
      props.removePendingPaneCreation(pendingInsertionId);
      console.error('Failed to create pane in aggregate view');
      return;
    }

    props.upsertPendingPaneCreation({
      ...pendingInsertion,
      pendingPtyId: createdPane.ptyId,
      pendingPaneId: createdPane.paneId,
    });

    setPendingPaneFocus({ sessionId: targetSessionId, paneId: createdPane.paneId });
  };

  // Return public API for use by other controllers
  return {
    handleJumpToPty,
    handleNewPaneInSession,
    pendingPaneFocus,
    setPendingPaneFocus,
    aggregateCopyModeActive,
    setAggregateCopyModeActive,
  };
}
