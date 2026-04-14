import type { AggregateViewState, PendingPaneCreation, PtyInfo } from './types';
import { hasGitMetadata } from './git';

const AGGREGATE_SAVED_PTY_PREFIX = 'saved:';
const AGGREGATE_PENDING_PTY_PREFIX = 'pending:';
const AGGREGATE_PANE_SEPARATOR = '\u0000';

export function isSavedAggregatePtyId(ptyId: string): boolean {
  return ptyId.startsWith(AGGREGATE_SAVED_PTY_PREFIX);
}

export function getSavedAggregatePtyId(sessionId: string, paneId: string): string {
  return `${AGGREGATE_SAVED_PTY_PREFIX}${sessionId}:${paneId}`;
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

  // Preserve git metadata from the fallback when the preferred pty doesn't have it.
  // This prevents a visible flicker where git metadata clears then redraws when
  // a live pty (with empty git fields) replaces a saved pty (with cached git data)
  // during dedupeAggregatePtysByPane.
  const preferredHasGit = hasGitMetadata(preferred);
  const fallbackHasGit = hasGitMetadata(fallback);
  const shouldPreserveFallbackGit = !preferredHasGit && fallbackHasGit;

  const gitFields = shouldPreserveFallbackGit
    ? {
        gitBranch: fallback.gitBranch,
        gitDiffStats: fallback.gitDiffStats,
        gitDirty: fallback.gitDirty,
        gitStaged: fallback.gitStaged,
        gitUnstaged: fallback.gitUnstaged,
        gitUntracked: fallback.gitUntracked,
        gitConflicted: fallback.gitConflicted,
        gitAhead: fallback.gitAhead,
        gitBehind: fallback.gitBehind,
        gitStashCount: fallback.gitStashCount,
        gitState: fallback.gitState,
        gitDetached: fallback.gitDetached,
        gitRepoKey: fallback.gitRepoKey,
        gitIsWorktree: fallback.gitIsWorktree,
        gitCommonDir: fallback.gitCommonDir,
      }
    : {};

  return {
    ...fallback,
    ...preferred,
    ...gitFields,
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
    gitIsWorktree: false,
    gitCommonDir: null,
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
  const indexByPtyId = new Map<string, number>();

  for (const pty of ptys) {
    const paneKey = getAggregatePaneKey(pty.sessionId, pty.paneId);

    // First check dedupe by (sessionId, paneId) key — this is the primary
    // deduplication strategy that merges saved: and live entries for the
    // same pane.
    if (paneKey) {
      const existingPaneIndex = indexByPaneKey.get(paneKey);
      if (existingPaneIndex !== undefined) {
        deduped[existingPaneIndex] = mergeDuplicatePtys(deduped[existingPaneIndex], pty);
        // Update ptyId index to point to the merged entry's preferred ptyId
        const mergedPtyId = deduped[existingPaneIndex].ptyId;
        if (mergedPtyId) {
          indexByPtyId.set(mergedPtyId, existingPaneIndex);
        }
        continue;
      }
    }

    // Then check dedupe by ptyId — this catches entries where the same
    // real ptyId appears with different or missing paneIds (e.g. loading
    // placeholders that haven't been assigned a paneId yet). Only merge
    // when the ptyId is a real (non-saved) ptyId, since multiple saved:
    // entries can legitimately share a ptyId format.
    if (pty.ptyId && !isSavedAggregatePtyId(pty.ptyId)) {
      const existingPtyIdIndex = indexByPtyId.get(pty.ptyId);
      if (existingPtyIdIndex !== undefined) {
        deduped[existingPtyIdIndex] = mergeDuplicatePtys(deduped[existingPtyIdIndex], pty);
        // Also register the pane key if this entry has one
        if (paneKey) {
          indexByPaneKey.set(paneKey, existingPtyIdIndex);
        }
        continue;
      }
      indexByPtyId.set(pty.ptyId, deduped.length);
    }

    // No duplicate found — add as new entry
    if (paneKey) {
      indexByPaneKey.set(paneKey, deduped.length);
    }
    deduped.push(pty);
  }

  return deduped;
}
