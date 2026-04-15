import type { PtyInfo } from '../../contexts/aggregate-view-types';

export interface PendingAggregatePaneFocus {
  sessionId: string;
  paneId: string;
}

export type PendingAggregatePaneFocusResolution =
  | { type: 'wait' }
  | { type: 'clear-filter' }
  | { type: 'expand-session'; sessionId: string }
  | { type: 'select-pty'; ptyId: string };

function findPendingPanePty(
  ptys: PtyInfo[],
  pending: PendingAggregatePaneFocus
): PtyInfo | undefined {
  return ptys.find((pty) => pty.sessionId === pending.sessionId && pty.paneId === pending.paneId);
}

export function resolvePendingAggregatePaneFocus(params: {
  pending: PendingAggregatePaneFocus | null;
  /** matchedPtys includes placeholders from buildPendingAggregatePtys,
   * allowing immediate selection of newly created PTYs that haven't
   * appeared in allPtys yet. */
  matchedPtys: PtyInfo[];
  flattenedTreeIndex: Map<string, number>;
  expandedSessionIds: Set<string>;
  filterQuery: string;
}): PendingAggregatePaneFocusResolution {
  const { pending, matchedPtys, flattenedTreeIndex, expandedSessionIds, filterQuery } = params;
  if (!pending) {
    return { type: 'wait' };
  }

  const matchingPty = findPendingPanePty(matchedPtys, pending);
  if (!matchingPty) {
    return { type: 'wait' };
  }

  if (!expandedSessionIds.has(pending.sessionId)) {
    return { type: 'expand-session', sessionId: pending.sessionId };
  }

  const isVisibleInTree = flattenedTreeIndex.has(matchingPty.ptyId);
  if (filterQuery && !isVisibleInTree) {
    return { type: 'clear-filter' };
  }

  if (!flattenedTreeIndex.has(matchingPty.ptyId)) {
    return { type: 'wait' };
  }

  return { type: 'select-pty', ptyId: matchingPty.ptyId };
}
