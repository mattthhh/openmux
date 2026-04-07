import type { PtyInfo } from './types';

const AGGREGATE_SAVED_PTY_PREFIX = 'saved:';
const AGGREGATE_PANE_SEPARATOR = '\u0000';

export function isSavedAggregatePtyId(ptyId: string): boolean {
  return ptyId.startsWith(AGGREGATE_SAVED_PTY_PREFIX);
}

export function getSavedAggregatePtyId(sessionId: string, paneId: string): string {
  return `${AGGREGATE_SAVED_PTY_PREFIX}${sessionId}:${paneId}`;
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
