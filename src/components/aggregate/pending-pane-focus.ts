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
  /** allPtys — only real (refreshed) PTYs, not placeholders.
   * Waiting for the real PTY naturally serializes rapid creations:
   * the cursor stays on the current PTY until the new one is confirmed
   * in allPtys via refreshActiveSession, preventing the user from
   * anchoring a second creation off a transient placeholder. */
  allPtys: PtyInfo[];
  flattenedTreeIndex: Map<string, number>;
  expandedSessionIds: Set<string>;
  filterQuery: string;
}): PendingAggregatePaneFocusResolution {
  const { pending, allPtys, flattenedTreeIndex, expandedSessionIds, filterQuery } = params;
  if (!pending) {
    return { type: 'wait' };
  }

  const matchingPty = findPendingPanePty(allPtys, pending);
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
