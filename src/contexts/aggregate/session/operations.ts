/**
 * Session management operations for aggregate view.
 */

import type { AggregateViewState, SessionLoadState, SessionTreeNode } from '../types';
import type { SessionMetadata } from '../../../effect/models';
import type { SetStoreFunction } from 'solid-js/store';
import { produce } from 'solid-js/store';
import { buildTreeRoot, flattenTree, getDefaultLoadState } from '../tree';
import { groupPtysBySession, buildPtyIndex, getBasePtys, filterPtys } from '../filter/operations';
import { applySelection, clearPreviewState } from '../selection/operations';
import { SessionOperationError } from '../errors';

/** Toggle session expansion */
export function toggleSessionExpanded(
  expandedSessionIds: Set<string>,
  sessionId: string
): Set<string> {
  const newSet = new Set(expandedSessionIds);
  if (newSet.has(sessionId)) {
    newSet.delete(sessionId);
  } else {
    newSet.add(sessionId);
  }
  return newSet;
}

/** Get sorted sessions based on manual order */
export function getSortedSessions(
  allSessions: Map<string, SessionMetadata>,
  manualSessionOrder: string[]
): SessionMetadata[] {
  const manualOrderIndex = new Map(
    manualSessionOrder.map((sessionId, index) => [sessionId, index] as const)
  );

  return [...allSessions.values()].sort((a, b) => {
    const aManual = manualOrderIndex.get(a.id);
    const bManual = manualOrderIndex.get(b.id);

    if (aManual !== undefined && bManual !== undefined) {
      return aManual - bManual;
    }
    if (aManual !== undefined) return -1;
    if (bManual !== undefined) return 1;

    return a.name.localeCompare(b.name);
  });
}

/** Recompute matched PTYs after state changes */
export function recomputeMatches(state: AggregateViewState): void {
  const basePtys = getBasePtys(state.allPtys, state.showInactive);
  const matchedPtysResult = filterPtys(basePtys, state.filterQuery);

  if (matchedPtysResult instanceof Error) {
    console.warn('Failed to recompute matches:', matchedPtysResult.message);
    state.matchedPtys = basePtys;
  } else {
    state.matchedPtys = matchedPtysResult;
  }

  state.matchedPtysIndex = buildPtyIndex(state.matchedPtys);

  if (state.selectedPtyId && !state.matchedPtysIndex.has(state.selectedPtyId)) {
    state.selectedPtyId = null;
    clearPreviewState(state);
  }
}

/** Get session ID from flattened item */
function getSessionIdForItem(item: { node: { type: string; session?: { id: string }; ptyInfo?: { sessionId: string }; parentSessionId?: string } } | undefined): string | null {
  if (!item) return null;
  if (item.node.type === 'session') return item.node.session?.id ?? null;
  if (item.node.type === 'pty') return item.node.ptyInfo?.sessionId ?? null;
  if (item.node.type === 'placeholder') return item.node.parentSessionId ?? null;
  return null;
}

/** Recompute tree structure and flattened navigation */
export function recomputeTree(state: AggregateViewState): void {
  const previousTree = state.flattenedTree;
  const previousSelectedIndex = state.selectedIndex;
  const previousSelectedItem = previousTree[previousSelectedIndex];
  const previousSelectedType = previousSelectedItem?.node.type;
  const previousSelectedSessionId =
    state.selectedSessionId ?? getSessionIdForItem(previousSelectedItem);
  const previousSessionIds = new Set(
    state.treeRoot
      .filter((node): node is SessionTreeNode => node.type === 'session')
      .map((node) => node.session.id)
  );

  const ptysBySession = groupPtysBySession(state.matchedPtys);
  const sessions = getSortedSessions(state.allSessions, state.manualSessionOrder);

  for (const session of sessions) {
    if (!previousSessionIds.has(session.id) && !state.expandedSessionIds.has(session.id)) {
      state.expandedSessionIds.add(session.id);
    }
  }

  state.treeRoot = buildTreeRoot(
    sessions,
    ptysBySession,
    state.expandedSessionIds,
    state.sessionLoadStates,
    state.sessionPaneOrders
  );

  state.flattenedTree = flattenTree(
    state.treeRoot,
    state.filterQuery,
    state.showInactive
  );
  state.flattenedTreeIndex = new Map();
  for (let i = 0; i < state.flattenedTree.length; i++) {
    const item = state.flattenedTree[i];
    if (item.node.type === 'pty') {
      state.flattenedTreeIndex.set(item.node.ptyInfo.ptyId, i);
    }
  }

  if (state.flattenedTree.length === 0) {
    state.selectedIndex = 0;
    state.selectedPtyId = null;
    state.selectedSessionId = null;
    clearPreviewState(state);
    return;
  }

  if (state.selectedPtyId) {
    const ptyIndex = state.flattenedTreeIndex.get(state.selectedPtyId);
    if (ptyIndex !== undefined) {
      state.selectedIndex = ptyIndex;
      state.selectedSessionId = getSessionIdForItem(state.flattenedTree[ptyIndex]);
      return;
    }
    state.selectedPtyId = null;
    clearPreviewState(state);
  }

  if (previousSelectedSessionId) {
    if (previousSelectedType === 'placeholder') {
      const sameRowItem = state.flattenedTree[previousSelectedIndex];
      if (
        sameRowItem &&
        sameRowItem.node.type !== 'spacer' &&
        getSessionIdForItem(sameRowItem) === previousSelectedSessionId
      ) {
        state.selectedIndex = previousSelectedIndex;
        state.selectedSessionId = previousSelectedSessionId;
        state.selectedPtyId = sameRowItem.node.type === 'pty' ? sameRowItem.node.ptyInfo.ptyId : null;
        return;
      }
    }

    const preferredIndex = state.flattenedTree.findIndex((item) => {
      const sessionId = getSessionIdForItem(item);
      if (sessionId !== previousSelectedSessionId) return false;
      if (previousSelectedType === 'placeholder') return item.node.type === 'placeholder';
      if (previousSelectedType === 'session') return item.node.type === 'session';
      return item.node.type !== 'spacer';
    });

    if (preferredIndex !== -1) {
      state.selectedIndex = preferredIndex;
      state.selectedSessionId = getSessionIdForItem(state.flattenedTree[preferredIndex]);
      state.selectedPtyId = state.flattenedTree[preferredIndex]?.node.type === 'pty'
        ? state.flattenedTree[preferredIndex].node.ptyInfo.ptyId
        : null;
      return;
    }

    const sameSessionHeaderIndex = state.flattenedTree.findIndex(
      (item) => item.node.type === 'session' && item.node.session.id === previousSelectedSessionId
    );
    if (sameSessionHeaderIndex !== -1) {
      state.selectedIndex = sameSessionHeaderIndex;
      state.selectedSessionId = previousSelectedSessionId;
      state.selectedPtyId = null;
      return;
    }
  }

  const clampedIndex = Math.min(state.selectedIndex, state.flattenedTree.length - 1);
  const fallbackIndex = Math.max(0, clampedIndex);
  const fallbackItem = state.flattenedTree[fallbackIndex];
  if (fallbackItem?.node.type === 'spacer') {
    const nextSelectableIndex = state.flattenedTree.findIndex((item) => item.node.type !== 'spacer');
    state.selectedIndex = nextSelectableIndex === -1 ? 0 : nextSelectableIndex;
  } else {
    state.selectedIndex = fallbackIndex;
  }
  const selectedItem = state.flattenedTree[state.selectedIndex];
  state.selectedSessionId = getSessionIdForItem(selectedItem);
  state.selectedPtyId = selectedItem?.node.type === 'pty' ? selectedItem.node.ptyInfo.ptyId : null;
}

/** Create session action helpers */
export function createSessionActions(
  state: AggregateViewState,
  setState: SetStoreFunction<AggregateViewState>,
  options: {
    persistSessionOrder?: (order: string[]) => Promise<void>;
  } = {}
) {
  const { persistSessionOrder } = options;

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

  const collapseAllSessions = () => {
    setState(produce((s) => {
      s.expandedSessionIds.clear();
      recomputeTree(s);
    }));
  };

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

  const reorderSessions = async (sourceSessionId: string, targetSessionId: string): Promise<SessionOperationError | void> => {
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

    if (persistSessionOrder) {
      const result = await persistSessionOrder(nextOrder).catch((cause) => {
        return new SessionOperationError({
          operation: 'persistSessionOrder',
          reason: String(cause),
          cause,
        });
      });
      if (result instanceof SessionOperationError) {
        console.warn('Failed to persist session order:', result.message);
      }
    }
  };

  const scrollListUp = (amount: number = 3) => {
    setState('listScrollOffset', (current) => Math.max(0, current - amount));
  };

  const scrollListDown = (amount: number = 3) => {
    setState('listScrollOffset', (current) => {
      const maxOffset = Math.max(0, state.flattenedTree.length - 1);
      return Math.min(maxOffset, current + amount);
    });
  };

  const setListScrollOffset = (offset: number) => {
    const maxOffset = Math.max(0, state.flattenedTree.length - 1);
    setState('listScrollOffset', Math.max(0, Math.min(maxOffset, offset)));
  };

  return {
    expandAllSessions,
    collapseAllSessions,
    toggleSessionExpanded,
    reorderSessions,
    scrollListUp,
    scrollListDown,
    setListScrollOffset,
  };
}
