/**
 * Session management operations for aggregate view.
 */

import type { SessionMetadata } from '../../effect/models';
import type { AggregateViewState, SessionTreeNode } from './types';
import { buildPtyIndex, filterPtysByActivity, groupPtysBySession } from './filter';
import { clearPreviewState } from './selection';
import { buildFlattenedTreeIndex, buildTreeRoot, flattenTree } from './tree';
import { buildPendingAggregatePtys, dedupeAggregatePtysByPane } from './rows';

export function toggleSessionExpanded(
  expandedSessionIds: Set<string>,
  sessionId: string
): Set<string> {
  const nextSet = new Set(expandedSessionIds);
  if (nextSet.has(sessionId)) {
    nextSet.delete(sessionId);
  } else {
    nextSet.add(sessionId);
  }
  return nextSet;
}

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

export function recomputeMatches(state: AggregateViewState): void {
  const effectivePtys = dedupeAggregatePtysByPane([
    ...state.allPtys,
    ...buildPendingAggregatePtys(state),
  ]);
  const basePtys = filterPtysByActivity(effectivePtys, state.showInactive);
  state.matchedPtys = basePtys;
  state.matchedPtysIndex = buildPtyIndex(state.matchedPtys);
}

function getSessionIdForItem(
  item:
    | {
        node: {
          type: string;
          session?: { id: string };
          ptyInfo?: { sessionId: string };
          parentSessionId?: string;
        };
      }
    | undefined
): string | null {
  if (!item) return null;
  if (item.node.type === 'session') return item.node.session?.id ?? null;
  if (item.node.type === 'pty') return item.node.ptyInfo?.sessionId ?? null;
  if (item.node.type === 'placeholder') return item.node.parentSessionId ?? null;
  return null;
}

export function recomputeTree(state: AggregateViewState): void {
  const previousTree = state.flattenedTree;
  const previousSelectedIndex = state.selectedIndex;
  const previousSelectedItem = previousTree[previousSelectedIndex];
  const previousSelectedType = previousSelectedItem?.node.type;
  const previousSelectedSessionId =
    state.selectedSessionId ?? getSessionIdForItem(previousSelectedItem);
  const previousSelectedPaneId =
    previousSelectedItem?.node.type === 'pty' ? previousSelectedItem.node.ptyInfo.paneId : null;
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
    state.sessionPaneOrderIndex
  );

  state.flattenedTree = flattenTree(
    state.treeRoot,
    state.showInactive,
    state.hiddenSessionGroupIds
  );
  state.flattenedTreeIndex = buildFlattenedTreeIndex(state.flattenedTree);

  if (state.flattenedTree.length === 0) {
    state.selectedIndex = 0;
    state.selectedPtyId = null;
    state.selectedSessionId = null;
    clearPreviewState(state);
    return;
  }

  let lostSelectedPty = false;
  let preservedPreviewByPaneReplacement = false;

  if (state.selectedPtyId) {
    const ptyIndex = state.flattenedTreeIndex.get(state.selectedPtyId);
    if (ptyIndex !== undefined) {
      state.selectedIndex = ptyIndex;
      state.selectedSessionId = getSessionIdForItem(state.flattenedTree[ptyIndex]);
      return;
    }
    state.selectedPtyId = null;
    lostSelectedPty = true;
  }

  if (previousSelectedSessionId) {
    if (previousSelectedPaneId) {
      const matchingPaneIndex = state.flattenedTree.findIndex(
        (item) =>
          item.node.type === 'pty' &&
          item.node.ptyInfo.sessionId === previousSelectedSessionId &&
          item.node.ptyInfo.paneId === previousSelectedPaneId
      );

      if (matchingPaneIndex !== -1) {
        const matchingPaneItem = state.flattenedTree[matchingPaneIndex];
        if (matchingPaneItem?.node.type === 'pty') {
          state.selectedIndex = matchingPaneIndex;
          state.selectedSessionId = previousSelectedSessionId;
          state.selectedPtyId = matchingPaneItem.node.ptyInfo.ptyId;
          preservedPreviewByPaneReplacement = true;
          return;
        }
      }
    }

    if (previousSelectedType === 'placeholder') {
      const sameRowItem = state.flattenedTree[previousSelectedIndex];
      if (
        sameRowItem &&
        sameRowItem.node.type !== 'spacer' &&
        getSessionIdForItem(sameRowItem) === previousSelectedSessionId
      ) {
        state.selectedIndex = previousSelectedIndex;
        state.selectedSessionId = previousSelectedSessionId;
        state.selectedPtyId =
          sameRowItem.node.type === 'pty' ? sameRowItem.node.ptyInfo.ptyId : null;
        return;
      }
    }

    const preferredIndex = state.flattenedTree.findIndex((item) => {
      const sessionId = getSessionIdForItem(item);
      if (sessionId !== previousSelectedSessionId) return false;
      if (previousSelectedType === 'placeholder') return item.node.type === 'placeholder';
      if (previousSelectedType === 'session') return item.node.type === 'session';
      if (previousSelectedType === 'pty') return item.node.type === 'pty';
      return item.node.type !== 'spacer';
    });

    if (preferredIndex !== -1) {
      state.selectedIndex = preferredIndex;
      state.selectedSessionId = getSessionIdForItem(state.flattenedTree[preferredIndex]);
      state.selectedPtyId =
        state.flattenedTree[preferredIndex]?.node.type === 'pty'
          ? state.flattenedTree[preferredIndex].node.ptyInfo.ptyId
          : null;
      if (lostSelectedPty && !preservedPreviewByPaneReplacement) {
        clearPreviewState(state);
      }
      return;
    }

    const sameSessionHeaderIndex = state.flattenedTree.findIndex(
      (item) => item.node.type === 'session' && item.node.session.id === previousSelectedSessionId
    );
    if (sameSessionHeaderIndex !== -1) {
      state.selectedIndex = sameSessionHeaderIndex;
      state.selectedSessionId = previousSelectedSessionId;
      state.selectedPtyId = null;
      if (lostSelectedPty && !preservedPreviewByPaneReplacement) {
        clearPreviewState(state);
      }
      return;
    }
  }

  // When the previously selected item was not a session or PTY (e.g.
  // hidden-groups, placeholder), it disappeared from the tree.
  // Select the nearest session header as a cursor anchor rather than
  // a PTY — the user's intent was to reveal hidden groups, not to
  // select a specific PTY. Setting selectedPtyId would trigger the
  // autoswitch effect, which is the wrong action.
  const wasStructuralItem =
    previousSelectedType !== 'session' &&
    previousSelectedType !== 'pty' &&
    previousSelectedType !== 'placeholder';

  if (wasStructuralItem) {
    // Find the nearest session header to anchor the cursor
    const sessionHeaderIndex = state.flattenedTree.findIndex(
      (item) => item.node.type === 'session'
    );
    if (sessionHeaderIndex !== -1) {
      state.selectedIndex = sessionHeaderIndex;
      state.selectedSessionId = getSessionIdForItem(state.flattenedTree[sessionHeaderIndex]);
      state.selectedPtyId = null;
      clearPreviewState(state);
      return;
    }
    // No session headers — just clear selection
    state.selectedIndex = 0;
    state.selectedPtyId = null;
    state.selectedSessionId = null;
    clearPreviewState(state);
    return;
  }

  const clampedIndex = Math.min(state.selectedIndex, state.flattenedTree.length - 1);
  const fallbackIndex = Math.max(0, clampedIndex);
  const fallbackItem = state.flattenedTree[fallbackIndex];
  if (fallbackItem?.node.type === 'spacer') {
    const nextSelectableIndex = state.flattenedTree.findIndex(
      (item) => item.node.type !== 'spacer'
    );
    state.selectedIndex = nextSelectableIndex === -1 ? 0 : nextSelectableIndex;
  } else {
    state.selectedIndex = fallbackIndex;
  }
  const selectedItem = state.flattenedTree[state.selectedIndex];
  state.selectedSessionId = getSessionIdForItem(selectedItem);
  state.selectedPtyId = selectedItem?.node.type === 'pty' ? selectedItem.node.ptyInfo.ptyId : null;
  if (lostSelectedPty && !preservedPreviewByPaneReplacement && selectedItem?.node.type !== 'pty') {
    clearPreviewState(state);
  }
}
