import type { AggregateViewState, PendingPaneCreation, PtyInfo } from './types';

const AGGREGATE_SAVED_PTY_PREFIX = 'saved:';
const AGGREGATE_PENDING_PTY_PREFIX = 'pending:';
const AGGREGATE_PANE_SEPARATOR = '\u0000';

export function isSavedAggregatePtyId(ptyId: string): boolean {
  return ptyId.startsWith(AGGREGATE_SAVED_PTY_PREFIX);
}

export function getSavedAggregatePtyId(sessionId: string, paneId: string): string {
  return `${AGGREGATE_SAVED_PTY_PREFIX}${sessionId}:${paneId}`;
}

export function isPendingAggregatePtyId(ptyId: string): boolean {
  return ptyId.startsWith(AGGREGATE_PENDING_PTY_PREFIX);
}

export function getPendingAggregatePtyId(pendingId: string): string {
  return `${AGGREGATE_PENDING_PTY_PREFIX}${pendingId}`;
}

export function getAggregatePaneKey(
  sessionId: string,
  paneId: string | null | undefined
): string | null {
  if (!paneId) {
    return null;
  }

  return `${sessionId}${AGGREGATE_PANE_SEPARATOR}${paneId}`;
}

export function findAggregatePtyIndexByPane(
  ptys: PtyInfo[],
  sessionId: string,
  paneId: string
): number {
  return ptys.findIndex((pty) => pty.sessionId === sessionId && pty.paneId === paneId);
}

function mergeDuplicatePtys(existing: PtyInfo, candidate: PtyInfo): PtyInfo {
  const existingIsSaved = isSavedAggregatePtyId(existing.ptyId);
  const candidateIsSaved = isSavedAggregatePtyId(candidate.ptyId);
  const preferCandidate = existingIsSaved !== candidateIsSaved ? existingIsSaved : true;

  const preferred = preferCandidate ? candidate : existing;
  const fallback = preferCandidate ? existing : candidate;

  return {
    ...fallback,
    ...preferred,
    cwd: preferred.cwd || fallback.cwd,
    foregroundProcess: preferred.foregroundProcess ?? fallback.foregroundProcess,
    shell: preferred.shell ?? fallback.shell,
    title: preferred.title ?? fallback.title,
    workspaceId: preferred.workspaceId ?? fallback.workspaceId,
    paneId: preferred.paneId ?? fallback.paneId,
    sessionMetadata: preferred.sessionMetadata ?? fallback.sessionMetadata,
    sortOrderHint: preferred.sortOrderHint ?? fallback.sortOrderHint,
  };
}

function buildPendingAggregatePty(
  insertion: PendingPaneCreation,
  sessionMetadata: AggregateViewState['allSessions']
): PtyInfo {
  return {
    ptyId: insertion.pendingPtyId ?? getPendingAggregatePtyId(insertion.id),
    cwd: '',
    foregroundProcess: undefined,
    shell: 'shell',
    workspaceId: undefined,
    paneId: insertion.pendingPaneId ?? undefined,
    sessionId: insertion.sessionId,
    sessionMetadata: sessionMetadata.get(insertion.sessionId),
    title: '...',
    sortOrderHint: insertion.sortOrderHint,
    gitBranch: undefined,
    gitDiffStats: undefined,
    gitDirty: false,
    gitStaged: 0,
    gitUnstaged: 0,
    gitUntracked: 0,
    gitConflicted: 0,
    gitAhead: undefined,
    gitBehind: undefined,
    gitStashCount: undefined,
    gitState: undefined,
    gitDetached: false,
    gitRepoKey: undefined,
  };
}

export function buildPendingAggregatePtys(
  state: Pick<AggregateViewState, 'pendingPaneCreations' | 'allPtys' | 'allSessions'>
): PtyInfo[] {
  const allPtyIds = new Set(state.allPtys.map((pty) => pty.ptyId));

  return state.pendingPaneCreations.flatMap((insertion) => {
    const claimedPtyId = insertion.pendingPtyId;
    if (claimedPtyId && allPtyIds.has(claimedPtyId)) {
      return [];
    }

    if (insertion.pendingPaneId) {
      const claimedPaneIndex = findAggregatePtyIndexByPane(
        state.allPtys,
        insertion.sessionId,
        insertion.pendingPaneId
      );
      if (
        claimedPaneIndex !== -1 &&
        !isSavedAggregatePtyId(state.allPtys[claimedPaneIndex].ptyId)
      ) {
        return [];
      }
    }

    return [buildPendingAggregatePty(insertion, state.allSessions)];
  });
}

export function dedupeAggregatePtysByPane(ptys: PtyInfo[]): PtyInfo[] {
  const deduped: PtyInfo[] = [];
  const indexByPaneKey = new Map<string, number>();

  for (const pty of ptys) {
    const paneKey = getAggregatePaneKey(pty.sessionId, pty.paneId);
    if (!paneKey) {
      deduped.push(pty);
      continue;
    }

    const existingIndex = indexByPaneKey.get(paneKey);
    if (existingIndex === undefined) {
      indexByPaneKey.set(paneKey, deduped.length);
      deduped.push(pty);
      continue;
    }

    deduped[existingIndex] = mergeDuplicatePtys(deduped[existingIndex], pty);
  }

  return deduped;
}
