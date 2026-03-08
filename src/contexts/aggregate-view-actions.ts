/**
 * Action creators for AggregateViewContext.
 */

import { produce, type SetStoreFunction } from 'solid-js/store';
import type { PtyInfo, AggregateViewState, SessionLoadState, FlattenedTreeItem, SessionTreeNode } from './aggregate-view-types';
import {
  clearPreviewState,
  recomputeMatches,
  recomputeTree,
} from './aggregate-view-helpers';
import { loadSessionPtysOnDemand } from '../effect/bridge/aggregate-bridge';

export interface AggregateViewActionsParams {
  state: AggregateViewState;
  setState: SetStoreFunction<AggregateViewState>;
  refreshPtys: () => Promise<void>;
  /** Optional callback when creating a new pane in a session */
  onCreatePaneInSession?: (sessionId: string) => void;
  /** Persist manual aggregate session order */
  persistSessionOrder?: (order: string[]) => Promise<void>;
}

export function createAggregateViewActions(
  params: AggregateViewActionsParams
) {
  const { state, setState, refreshPtys, onCreatePaneInSession, persistSessionOrder } = params;

  const getSessionIdForItem = (item: FlattenedTreeItem | undefined): string | null => {
    if (!item) return null;
    if (item.node.type === 'session') return item.node.session.id;
    if (item.node.type === 'pty') return item.node.ptyInfo.sessionId;
    if (item.node.type === 'placeholder') return item.node.parentSessionId;
    return null;
  };

  const isSelectableItem = (item: FlattenedTreeItem | undefined): boolean => {
    return !!item && item.node.type !== 'spacer';
  };

  const findNearestSelectableIndex = (items: FlattenedTreeItem[], index: number): number | null => {
    if (items.length === 0) return null;
    if (isSelectableItem(items[index])) return index;

    for (let distance = 1; distance < items.length; distance++) {
      const lower = index - distance;
      if (lower >= 0 && isSelectableItem(items[lower])) return lower;
      const upper = index + distance;
      if (upper < items.length && isSelectableItem(items[upper])) return upper;
    }

    return null;
  };

  const applySelection = (s: AggregateViewState, index: number) => {
    const targetIndex = findNearestSelectableIndex(s.flattenedTree, index);
    if (targetIndex === null) {
      s.selectedIndex = 0;
      s.selectedPtyId = null;
      s.selectedSessionId = null;
      clearPreviewState(s);
      return;
    }

    const item = s.flattenedTree[targetIndex];
    s.selectedIndex = targetIndex;
    s.selectedPtyId = item?.node.type === 'pty' ? item.node.ptyInfo.ptyId : null;
    s.selectedSessionId = getSessionIdForItem(item);
    if (s.selectedPtyId === null) {
      clearPreviewState(s);
    }
  };

  const openAggregateView = () => {
    setState(produce((s) => {
      s.showAggregateView = true;
      s.filterQuery = '';
      clearPreviewState(s);
      recomputeMatches(s);
      recomputeTree(s);
    }));
  };

  const closeAggregateView = () => {
    setState(produce((s) => {
      s.showAggregateView = false;
      s.filterQuery = '';
      s.selectedIndex = 0;
      s.selectedPtyId = null;
      s.selectedSessionId = null;
      clearPreviewState(s);
    }));
  };

  const setFilterQuery = (query: string) => {
    setState(produce((s) => {
      s.filterQuery = query;
      recomputeMatches(s);
      recomputeTree(s);
    }));
  };

  const toggleShowInactive = () => {
    setState(produce((s) => {
      s.showInactive = !s.showInactive;
      recomputeMatches(s);
      recomputeTree(s);
    }));
  };

  // ============================================================================
  // Tree-Aware Navigation
  // ============================================================================

  const navigateUp = () => {
    if (state.flattenedTree.length === 0) return;

    let nextIndex = state.selectedIndex - 1;
    while (nextIndex >= 0 && !isSelectableItem(state.flattenedTree[nextIndex])) {
      nextIndex -= 1;
    }
    if (nextIndex < 0) return;

    setState(produce((s) => {
      applySelection(s, nextIndex);
    }));
  };

  const navigateDown = () => {
    if (state.flattenedTree.length === 0) return;

    let nextIndex = state.selectedIndex + 1;
    while (nextIndex < state.flattenedTree.length && !isSelectableItem(state.flattenedTree[nextIndex])) {
      nextIndex += 1;
    }
    if (nextIndex >= state.flattenedTree.length) return;

    setState(produce((s) => {
      applySelection(s, nextIndex);
    }));
  };

  const setSelectedIndex = (index: number) => {
    if (state.flattenedTree.length === 0) return;
    const maxIndex = Math.max(0, state.flattenedTree.length - 1);
    const clamped = Math.min(maxIndex, Math.max(0, index));

    setState(produce((s) => {
      applySelection(s, clamped);
    }));
  };

  const selectPty = (ptyId: string) => {
    const index = state.flattenedTreeIndex.get(ptyId);
    if (index !== undefined) {
      setState(produce((s) => {
        applySelection(s, index);
      }));
    }
  };

  /**
   * Get the currently selected PTY info.
   * Uses flattened tree for O(1) access.
   */
  const getSelectedPty = (): PtyInfo | null => {
    const item = state.flattenedTree[state.selectedIndex];
    if (item?.node.type === 'pty') {
      return item.node.ptyInfo;
    }
    return null;
  };

  const enterPreviewMode = () => {
    setState('previewMode', true);
  };

  const exitPreviewMode = () => {
    setState(produce((s) => {
      clearPreviewState(s);
    }));
  };

  const togglePreviewZoom = () => {
    setState(produce((s) => {
      if (!s.previewMode || !s.selectedPtyId) return;
      s.previewZoomed = !s.previewZoomed;
    }));
  };

  // ============================================================================
  // Lazy Loading: Session PTY Loading on Demand
  // ============================================================================

  /**
   * Attempt to load session PTYs on demand.
   *
   * This triggers a fresh aggregate refresh using the live PTY→session mapping.
   * If the session has no live PTYs, the placeholder remains visible.
   */
  const loadSessionPtys = async (sessionId: string): Promise<void> => {
    if (state.loadingSessionIds.has(sessionId)) return;

    const previousState = state.sessionLoadStates.get(sessionId);
    const previousPaneCount = previousState?.paneCount;
    const previousWorkspaceId =
      previousState?.status === 'loaded' || previousState?.status === 'unloaded'
        ? previousState.lastActiveWorkspaceId
        : previousState?.lastActiveWorkspaceId;
    const previousFocusedPaneId = previousState?.focusedPaneId;

    setState(produce((s) => {
      s.loadingSessionIds.add(sessionId);
      s.loadAttemptedSessionIds.add(sessionId);
      s.sessionLoadStates.set(sessionId, {
        status: 'loading',
        paneCount: previousPaneCount,
        lastActiveWorkspaceId: previousWorkspaceId,
        focusedPaneId: previousFocusedPaneId,
      });
      recomputeTree(s);
    }));

    const result = await loadSessionPtysOnDemand(sessionId);

    setState(produce((s) => {
      s.loadingSessionIds.delete(sessionId);

      if (result instanceof Error) {
        s.sessionLoadStates.set(sessionId, {
          status: 'error',
          error: result.message,
          lastActiveWorkspaceId: previousWorkspaceId,
          focusedPaneId: previousFocusedPaneId,
          paneCount: previousPaneCount,
        });
        recomputeTree(s);
        return;
      }

      const sessionMetadata = s.allSessions.get(sessionId);
      const existingIndex = new Map(s.allPtys.map((pty, index) => [pty.ptyId, index] as const));

      for (const pty of result.ptys) {
        const nextPty: PtyInfo = {
          ...pty,
          sessionId,
          sessionMetadata,
        };

        const index = existingIndex.get(pty.ptyId);
        if (index === undefined) {
          existingIndex.set(pty.ptyId, s.allPtys.length);
          s.allPtys.push(nextPty);
        } else {
          s.allPtys[index] = {
            ...s.allPtys[index],
            ...nextPty,
          };
        }
      }

      s.allPtysIndex = new Map(s.allPtys.map((pty, index) => [pty.ptyId, index] as const));

      const paneCount = result.ptys.length > 0
        ? result.ptys.length
        : (previousPaneCount ?? s.sessionLoadStates.get(sessionId)?.paneCount);

      if (result.ptys.length > 0) {
        s.sessionLoadStates.set(sessionId, {
          status: 'loaded',
          lastActiveWorkspaceId: result.lastActiveWorkspaceId ?? previousWorkspaceId,
          focusedPaneId: previousFocusedPaneId,
          paneCount,
        });
      } else {
        s.sessionLoadStates.set(sessionId, {
          status: 'unloaded',
          lastActiveWorkspaceId: result.lastActiveWorkspaceId ?? previousWorkspaceId,
          focusedPaneId: previousFocusedPaneId,
          paneCount,
        });
      }

      recomputeMatches(s);
      recomputeTree(s);
    }));
  };

  /** Get the loading state for a session */
  const getSessionLoadState = (sessionId: string): SessionLoadState | undefined => {
    return state.sessionLoadStates.get(sessionId);
  };

  /** Check if a session is currently loading */
  const isSessionLoading = (sessionId: string): boolean => {
    return state.loadingSessionIds.has(sessionId);
  };

  // ============================================================================
  // Session Tree Navigation
  // ============================================================================

  /** Toggle session expansion (collapse/expand PTYs under a session) */
  const toggleSessionExpanded = (sessionId: string) => {
    setState(produce((s) => {
      if (s.expandedSessionIds.has(sessionId)) {
        s.expandedSessionIds.delete(sessionId);
      } else {
        s.expandedSessionIds.add(sessionId);
      }
      recomputeTree(s);
    }));
  };

  /** Expand all sessions */
  const expandAllSessions = () => {
    setState(produce((s) => {
      for (const node of s.treeRoot) {
        if (node.type === 'session' && node.loadState.status === 'loaded') {
          s.expandedSessionIds.add(node.session.id);
        }
      }
      recomputeTree(s);
    }));
  };

  /** Collapse all sessions */
  const collapseAllSessions = () => {
    setState(produce((s) => {
      s.expandedSessionIds.clear();
      recomputeTree(s);
    }));
  };

  /** Get flattened item at index */
  const getFlattenedItem = (index: number): FlattenedTreeItem | undefined => {
    return state.flattenedTree[index];
  };

  /** Get the currently selected flattened item */
  const getSelectedItem = (): FlattenedTreeItem | undefined => {
    return state.flattenedTree[state.selectedIndex];
  };

  // ============================================================================
  // Smart Selection on Close/Kill
  // ============================================================================

  /**
   * Find the nearest PTY in the same session.
   * Priority: below first, then above.
   */
  const findNearestPtyInSession = (
    sessionId: string,
    startIndex: number,
    direction: 'up' | 'down'
  ): { index: number; ptyId: string } | null => {
    const flattened = state.flattenedTree;
    const delta = direction === 'up' ? -1 : 1;
    let index = startIndex + delta;

    while (index >= 0 && index < flattened.length) {
      const item = flattened[index];
      if (item?.node.type === 'pty' && item.parentSessionId === sessionId) {
        return { index, ptyId: item.node.ptyInfo.ptyId };
      }
      // Stop if we hit another session header
      if (item?.node.type === 'session') {
        break;
      }
      index += delta;
    }

    return null;
  };

  /**
   * Smart selection after removing a PTY.
   * Priority:
   * 1. Nearest PTY below in same session
   * 2. Nearest PTY above in same session
   * 3. Nearest adjacent PTY (any session)
   * 4. First available PTY
   * 5. No selection (empty list)
   */
  const selectAfterPtyRemoval = (removedPtyId: string): void => {
    const flattened = state.flattenedTree;
    const removedIndex = state.flattenedTreeIndex.get(removedPtyId);

    if (removedIndex === undefined) {
      // PTY wasn't in the current view, no selection change needed
      return;
    }

    const removedItem = flattened[removedIndex];
    const sessionId =
      removedItem?.node.type === 'pty'
        ? removedItem.parentSessionId
        : null;

    // Try to find replacement in priority order
    let replacement: { index: number; ptyId: string } | null = null;

    if (sessionId) {
      // 1. Try below in same session
      replacement = findNearestPtyInSession(sessionId, removedIndex, 'down');
      // 2. Try above in same session
      if (!replacement) {
        replacement = findNearestPtyInSession(sessionId, removedIndex, 'up');
      }
    }

    // 3. Try any PTY below
    if (!replacement) {
      for (let i = removedIndex + 1; i < flattened.length; i++) {
        const item = flattened[i];
        if (item?.node.type === 'pty') {
          replacement = { index: i, ptyId: item.node.ptyInfo.ptyId };
          break;
        }
      }
    }

    // 4. Try any PTY above
    if (!replacement) {
      for (let i = removedIndex - 1; i >= 0; i--) {
        const item = flattened[i];
        if (item?.node.type === 'pty') {
          replacement = { index: i, ptyId: item.node.ptyInfo.ptyId };
          break;
        }
      }
    }

    // 5. First available PTY anywhere
    if (!replacement) {
      for (let i = 0; i < flattened.length; i++) {
        const item = flattened[i];
        if (item?.node.type === 'pty') {
          replacement = { index: i, ptyId: item.node.ptyInfo.ptyId };
          break;
        }
      }
    }

    setState(
      produce((s) => {
        if (replacement) {
          applySelection(s, replacement.index);
        } else {
          s.selectedIndex = 0;
          s.selectedPtyId = null;
          s.selectedSessionId = null;
          clearPreviewState(s);
        }
      })
    );
  };

  /** Get the session ID for the currently selected item (PTY or session header) */
  const getSelectedSessionId = (): string | null => {
    const item = getSelectedItem();
    if (!item) return null;

    if (item.node.type === 'pty') {
      return item.node.ptyInfo.sessionId;
    } else if (item.node.type === 'session') {
      return item.node.session.id;
    } else if (item.node.type === 'placeholder') {
      return item.node.parentSessionId;
    }
    return null;
  };

  /** Create a new pane in the currently selected session */
  const createNewPaneInSelectedSession = (): boolean => {
    const sessionId = getSelectedSessionId();
    if (!sessionId || !onCreatePaneInSession) return false;

    onCreatePaneInSession(sessionId);
    return true;
  };

  const reorderSessions = async (sourceSessionId: string, targetSessionId: string): Promise<void> => {
    if (sourceSessionId === targetSessionId) return;

    const currentOrder = state.treeRoot
      .filter((node): node is SessionTreeNode => node.type === 'session')
      .map((node) => String(node.session.id));

    const sourceIndex = currentOrder.indexOf(sourceSessionId);
    const targetIndex = currentOrder.indexOf(targetSessionId);
    if (sourceIndex === -1 || targetIndex === -1) return;

    const nextOrder = [...currentOrder];
    const movingDown = sourceIndex < targetIndex;
    const [movedSessionId] = nextOrder.splice(sourceIndex, 1);
    const targetIndexAfterRemoval = nextOrder.indexOf(targetSessionId);
    if (!movedSessionId || targetIndexAfterRemoval === -1) return;
    const insertIndex = movingDown ? targetIndexAfterRemoval + 1 : targetIndexAfterRemoval;
    nextOrder.splice(insertIndex, 0, movedSessionId);

    setState(produce((s) => {
      s.manualSessionOrder = nextOrder;
      recomputeTree(s);
    }));

    await persistSessionOrder?.(nextOrder);
  };

  return {
    openAggregateView,
    closeAggregateView,
    setFilterQuery,
    toggleShowInactive,
    navigateUp,
    navigateDown,
    setSelectedIndex,
    selectPty,
    getSelectedPty,
    getSelectedSessionId,
    createNewPaneInSelectedSession,
    enterPreviewMode,
    exitPreviewMode,
    togglePreviewZoom,
    reorderSessions,
    // Lazy loading
    loadSessionPtys,
    getSessionLoadState,
    isSessionLoading,
    // Session tree
    toggleSessionExpanded,
    expandAllSessions,
    collapseAllSessions,
    getFlattenedItem,
    getSelectedItem,
    // Smart selection on close/kill
    selectAfterPtyRemoval,
  };
}
