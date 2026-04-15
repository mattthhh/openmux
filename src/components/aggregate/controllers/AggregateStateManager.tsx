/**
 * AggregateStateManager - Handles session loading, pane creation, and auto-focus effects.
 *
 * Reads state directly from contexts instead of receiving individual props.
 * This component must be rendered inside the AggregateViewContext provider tree.
 */

import { createEffect, onCleanup, createSignal } from 'solid-js';
import { loadSessionData } from '../../../effect/bridge';
import { useLayout } from '../../../contexts/LayoutContext';
import { useSession } from '../../../contexts/SessionContext';
import { useTerminal } from '../../../contexts/TerminalContext';
import { useKeyboard } from '../../../contexts/KeyboardContext';
import { useCopyMode } from '../../../contexts/copy-mode';
import { useAggregateView } from '../../../contexts/AggregateViewContext';
import { collectPanes } from '../../../core/layout-tree';
import type { Workspace, WorkspaceId } from '../../../core/types';
import type { PendingPaneCreation } from '../../../contexts/aggregate-view-types';
import type { PendingAggregatePaneFocus } from '../pending-pane-focus';
import { getNextPendingPaneCreationOrder } from '../../../contexts/aggregate-view-pending-insertions';
import { resolvePendingAggregatePaneFocus } from '../pending-pane-focus';
import { findPtyLocation, findPaneLocation } from '../utils';

/**
 * Controller component that manages all async state effects for AggregateView.
 * Reads from contexts directly — no prop drilling.
 * Returns an object with methods that can be passed to keyboard controller.
 */
export function AggregateStateManager() {
  const aggregate = useAggregateView();
  const layout = useLayout();
  const session = useSession();
  const terminal = useTerminal();
  const keyboard = useKeyboard();
  const copyMode = useCopyMode();

  // Derived getters from aggregate context
  const isActive = () => aggregate.state.showAggregateView;
  const selectedPtyId = () => aggregate.state.selectedPtyId;
  const selectedSessionId = () => aggregate.state.selectedSessionId;
  const previewMode = () => aggregate.state.previewMode;
  const selectedIndex = () => aggregate.state.selectedIndex;
  const flattenedTree = () => aggregate.state.flattenedTree;
  const expandedSessionIds = () => aggregate.state.expandedSessionIds;
  const filterQuery = () => aggregate.state.filterQuery;
  const pendingPaneCreations = () => aggregate.state.pendingPaneCreations;

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
      isActive() &&
      previewMode() &&
      keyboardState.mode === 'copy' &&
      selectedPtyId() &&
      copyMode.isActive(selectedPtyId()!)
    ) {
      setAggregateCopyModeActive(true);
    }
  });

  createEffect(() => {
    if (!aggregateCopyModeActive()) return;

    const activeCopyPtyId = copyMode.getActivePtyId();
    const shouldKeepCopyMode =
      isActive() && previewMode() && !!activeCopyPtyId && activeCopyPtyId === selectedPtyId();

    if (shouldKeepCopyMode) return;

    // Exit copy mode
    copyMode.exitCopyMode();
    setAggregateCopyModeActive(false);
    if (keyboardState.mode === 'copy') {
      keyboard.exitCopyMode();
      if (isActive()) {
        enterAggregateMode();
      }
    }
  });

  // Resolve pending pane focus (for newly created panes)
  createEffect(() => {
    if (!isActive()) {
      setPendingPaneFocus(null);
      aggregate.clearPendingPaneCreations();
      return;
    }

    const resolution = resolvePendingAggregatePaneFocus({
      pending: pendingPaneFocus(),
      allPtys: aggregate.state.allPtys,
      flattenedTreeIndex: aggregate.state.flattenedTreeIndex,
      expandedSessionIds: expandedSessionIds(),
      filterQuery: filterQuery(),
    });

    if (resolution.type === 'wait') return;

    if (resolution.type === 'clear-filter') {
      if (filterQuery()) {
        aggregate.setFilterQuery('');
      }
      return;
    }

    if (resolution.type === 'expand-session') {
      aggregate.toggleSessionExpanded(resolution.sessionId);
      return;
    }

    aggregate.selectPty(resolution.ptyId);
    setPendingPaneFocus(null);
  });

  // AUTOSWITCH: Automatically switch sessions when navigating to a pane from a different session
  createEffect(() => {
    if (!isActive()) return;
    if (sessionState.switching) return;
    if (pendingPaneCreations().length > 0) return;
    if (pendingPaneFocus()) return;

    const selectedItem = flattenedTree()[selectedIndex()];
    if (selectedItem?.node.type !== 'pty') return;

    const itemSessionId = selectedItem.node.ptyInfo.sessionId;
    if (!itemSessionId) return;
    if (itemSessionId === sessionState.activeSessionId) return;

    const targetWorkspaceId = toWorkspaceId(selectedItem.node.ptyInfo.workspaceId);
    const targetPaneId = selectedItem.node.ptyInfo.paneId;

    let cancelled = false;

    void (async () => {
      const sessionData = await loadSessionData(itemSessionId);
      if (cancelled) return;
      await switchToSessionWithData(itemSessionId, sessionData, {
        workspaceId: targetWorkspaceId,
        paneId: targetPaneId ?? undefined,
      });
    })();

    onCleanup(() => {
      cancelled = true;
    });
  });

  // Cleanup
  onCleanup(() => {
    setPendingPaneFocus(null);
    aggregate.clearPendingPaneCreations();
  });

  // Public API for jump to PTY (Tab key)
  const handleJumpToPty = async (): Promise<boolean> => {
    const currentPtyId = selectedPtyId();
    const currentSessionId = selectedSessionId();

    if (currentPtyId) {
      const location = findPtyLocation(currentPtyId, layoutState.workspaces);
      if (location) {
        aggregate.closeAggregateView();
        keyboard.exitAggregateMode();
        if (layoutState.activeWorkspaceId !== location.workspaceId) {
          switchWorkspace(location.workspaceId);
        }
        focusPane(location.paneId);
        return true;
      }

      const sessionLocation = findSessionForPty(currentPtyId);
      if (sessionLocation && sessionLocation.sessionId !== sessionState.activeSessionId) {
        const sessionData = await loadSessionData(sessionLocation.sessionId);
        if (sessionData instanceof Error) {
          console.error('Failed to load session:', sessionData.message);
          return false;
        }

        const nextLocation = findPaneLocation(sessionLocation.paneId, sessionData.workspaces);

        aggregate.closeAggregateView();
        keyboard.exitAggregateMode();
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

    if (!currentSessionId) return false;

    if (currentSessionId === sessionState.activeSessionId) {
      const workspaceId = layoutState.activeWorkspaceId;
      const paneId = getPreferredPaneIdForWorkspace(layoutState.workspaces[workspaceId]);
      aggregate.closeAggregateView();
      keyboard.exitAggregateMode();
      if (paneId) {
        switchWorkspace(workspaceId);
        focusPane(paneId);
      }
      return true;
    }

    // Load session and jump to it
    const sessionData = await loadSessionData(currentSessionId);
    if (sessionData instanceof Error) {
      console.error('Failed to load session:', sessionData.message);
      return false;
    }

    const workspaceId = sessionData.activeWorkspaceId;
    const paneId = getPreferredPaneIdForWorkspace(sessionData.workspaces[workspaceId]);

    aggregate.closeAggregateView();
    keyboard.exitAggregateMode();
    const switched = await switchToSessionWithData(currentSessionId, sessionData);
    if (!switched) {
      return false;
    }
    switchWorkspace(workspaceId);
    if (paneId) {
      focusPane(paneId);
    }
    return true;
  };

  // Public API for new pane in session (option+n / alt+n)
  const handleNewPaneInSession = async (): Promise<void> => {
    const currentSessionId = selectedSessionId();
    const currentPtyId = selectedPtyId();

    if (!currentSessionId && !currentPtyId) return;

    const selectedPty = currentPtyId
      ? (aggregate.state.allPtys[aggregate.state.allPtysIndex.get(currentPtyId) ?? -1] ?? null)
      : null;

    const targetSessionId =
      currentSessionId ??
      findSessionForPty(currentPtyId!)?.sessionId ??
      sessionState.activeSessionId;
    if (!targetSessionId) return;

    const pendingInsertionId = crypto.randomUUID();
    const pendingInsertion: PendingPaneCreation = {
      id: pendingInsertionId,
      sessionId: targetSessionId,
      insertAfterPtyId: currentPtyId,
      insertAfterPaneId: selectedPty?.paneId ?? null,
      pendingPtyId: null,
      pendingPaneId: null,
      sortOrderHint: getNextPendingPaneCreationOrder(
        {
          allPtys: aggregate.state.allPtys,
          sessionPaneOrderIndex: aggregate.state.sessionPaneOrderIndex,
          pendingPaneCreations: aggregate.state.pendingPaneCreations,
        },
        {
          sessionId: targetSessionId,
          insertAfterPaneId: selectedPty?.paneId ?? null,
        }
      ),
    };
    aggregate.upsertPendingPaneCreation(pendingInsertion);

    // NOTE: do NOT set pendingPaneFocus(null) here. Rapid sequential
    // creations would wipe a previous creation's unresolved focus,
    // breaking autoswitch. The new focus is set below after
    // createPaneWithPTY resolves, which overwrites any stale one.

    let targetWorkspaceId = layoutState.activeWorkspaceId;
    let targetCwd: string | undefined;

    // Get CWD from selected PTY if available
    if (currentPtyId) {
      targetCwd = await getSessionCwd(currentPtyId).catch((e) => {
        console.warn(
          `[AggregateStateManager] Failed to get CWD for selected PTY ${currentPtyId}:`,
          e
        );
        return undefined;
      });
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
            targetCwd = await getSessionCwd(candidatePane.ptyId).catch((e) => {
              console.warn(
                `[AggregateStateManager] Failed to get CWD for candidate PTY ${candidatePane.ptyId}:`,
                e
              );
              return undefined;
            });
          }
        }
      }

      if (currentPtyId) {
        const location = findPtyLocation(currentPtyId, layoutState.workspaces);
        if (location) {
          targetWorkspaceId = location.workspaceId;
        }
      }
    } else {
      // Other session - load and switch
      const sessionData = await loadSessionData(targetSessionId);
      if (sessionData instanceof Error) {
        aggregate.removePendingPaneCreation(pendingInsertionId);
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
        aggregate.removePendingPaneCreation(pendingInsertionId);
        return;
      }
    }

    switchWorkspace(targetWorkspaceId);
    setLayoutMode('stacked');
    const createdPane = await createPaneWithPTY(targetCwd, 'shell', {
      onCreated: (created) => {
        aggregate.upsertPendingPaneCreation({
          ...pendingInsertion,
          pendingPtyId: created.ptyId,
          pendingPaneId: created.paneId,
        });
      },
    });
    if (!createdPane) {
      aggregate.removePendingPaneCreation(pendingInsertionId);
      console.error('Failed to create pane in aggregate view');
      return;
    }

    aggregate.upsertPendingPaneCreation({
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
