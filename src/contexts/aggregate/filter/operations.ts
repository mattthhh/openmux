/**
 * Filter operations for aggregate view.
 */

import type { PtyInfo } from '../types';
import { FilterOperationError } from '../errors';

/** Normalize process names for comparisons (strip paths, lowercase) */
export function normalizeProcessName(name: string | undefined): string {
  if (!name) return '';
  const trimmed = name.trim();
  if (!trimmed) return '';
  const base = trimmed.split('/').pop() ?? trimmed;
  return base.toLowerCase();
}

/** Check if PTY has active foreground process (not just shell) */
export function isActivePty(pty: PtyInfo): boolean {
  const processName = normalizeProcessName(pty.foregroundProcess);
  if (!processName) return false;
  const shellName = normalizeProcessName(pty.shell);
  if (!shellName) return true;
  return processName !== shellName;
}

/** Filter PTYs to only those with active foreground processes */
export function filterActivePtys(ptys: PtyInfo[]): PtyInfo[] {
  return ptys.filter(isActivePty);
}

/** Get base PTYs with optional inactive filtering */
export function getBasePtys(ptys: PtyInfo[], showInactive: boolean): PtyInfo[] {
  return showInactive ? ptys : filterActivePtys(ptys);
}

/** Filter PTYs by search query (matches cwd, git branch, or process) */
export function filterPtys(ptys: PtyInfo[], query: string): PtyInfo[] | FilterOperationError {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return ptys;

  const terms = trimmedQuery.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return ptys;

  try {
    return ptys.filter((pty) => {
      const cwd = pty.cwd.toLowerCase();
      const branch = pty.gitBranch?.toLowerCase() ?? '';
      const process = pty.foregroundProcess?.toLowerCase() ?? '';
      return terms.some((term) =>
        cwd.includes(term) || branch.includes(term) || process.includes(term)
      );
    });
  } catch (cause) {
    return new FilterOperationError({
      reason: `Failed to filter PTYs: ${String(cause)}`,
      cause,
    });
  }
}

/** Build index map from ptyId to array index for O(1) lookups */
export function buildPtyIndex(ptys: PtyInfo[]): Map<string, number> {
  return new Map(ptys.map((p, i) => [p.ptyId, i]));
}

/** Group PTYs by session ID */
export function groupPtysBySession(ptys: PtyInfo[]): Map<string, PtyInfo[]> {
  const groups = new Map<string, PtyInfo[]>();
  for (const pty of ptys) {
    const existing = groups.get(pty.sessionId);
    if (existing) {
      existing.push(pty);
    } else {
      groups.set(pty.sessionId, [pty]);
    }
  }
  return groups;
}

/** Sort PTYs within a session by pane order, workspace, then ID */
export function sortPtysForSession(
  ptys: PtyInfo[],
  paneOrder: Map<string, number> | undefined
): PtyInfo[] {
  return [...ptys].sort((a, b) => {
    const aOrder = a.paneId ? paneOrder?.get(a.paneId) : undefined;
    const bOrder = b.paneId ? paneOrder?.get(b.paneId) : undefined;

    const aHasOrder = aOrder !== undefined ? 1 : 0;
    const bHasOrder = bOrder !== undefined ? 1 : 0;
    if (aHasOrder !== bHasOrder) return bHasOrder - aHasOrder;
    if (aOrder !== undefined && bOrder !== undefined && aOrder !== bOrder) {
      return aOrder - bOrder;
    }

    const workspaceCompare =
      (a.workspaceId ?? Number.MAX_SAFE_INTEGER) -
      (b.workspaceId ?? Number.MAX_SAFE_INTEGER);
    if (workspaceCompare !== 0) return workspaceCompare;

    return (a.paneId ?? a.ptyId).localeCompare(b.paneId ?? b.ptyId);
  });
}

/** Extract all unique session IDs from PTYs */
export function extractSessionIds(ptys: PtyInfo[]): string[] {
  return [...new Set(ptys.map((p) => p.sessionId))];
}
