/**
 * Helper functions for AggregateViewContext.
 */

import type { PtyInfo, AggregateViewState } from './aggregate-view-types';

/** Filter PTYs by search query (matches cwd, git branch, or process) */
export function filterPtys(ptys: PtyInfo[], query: string): PtyInfo[] {
  if (!query.trim()) return ptys;

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return ptys;

  return ptys.filter((pty) => {
    const cwd = pty.cwd.toLowerCase();
    const branch = pty.gitBranch?.toLowerCase() ?? '';
    const process = pty.foregroundProcess?.toLowerCase() ?? '';
    // OR logic: match if ANY term matches ANY field
    return terms.some((term) =>
      cwd.includes(term) || branch.includes(term) || process.includes(term)
    );
  });
}

/** Normalize process names for comparisons (strip paths, lowercase) */
export function normalizeProcessName(name: string | undefined): string {
  if (!name) return '';
  const trimmed = name.trim();
  if (!trimmed) return '';
  const base = trimmed.split('/').pop() ?? trimmed;
  return base.toLowerCase();
}

/** Active PTY = foreground process is not just the shell */
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

/** Apply active/inactive filtering based on scope flag */
export function getBasePtys(ptys: PtyInfo[], showInactive: boolean): PtyInfo[] {
  return showInactive ? ptys : filterActivePtys(ptys);
}

/** Build an index map from ptyId to array index for O(1) lookups */
export function buildPtyIndex(ptys: PtyInfo[]): Map<string, number> {
  return new Map(ptys.map((p, i) => [p.ptyId, i]));
}

/** Recompute matched PTYs and selection after state changes */
export function recomputeMatches(state: AggregateViewState): void {
  const basePtys = getBasePtys(state.allPtys, state.showInactive);
  const matchedPtys = filterPtys(basePtys, state.filterQuery);
  const matchedPtysIndex = buildPtyIndex(matchedPtys);
  const currentSelectedPtyId = state.selectedPtyId;
  const currentPtyIndex = currentSelectedPtyId ? matchedPtysIndex.get(currentSelectedPtyId) : undefined;
  const currentPtyStillExists = currentPtyIndex !== undefined;
  const newSelectedIndex = currentPtyStillExists
    ? currentPtyIndex
    : Math.min(state.selectedIndex, Math.max(0, matchedPtys.length - 1));
  const selectedPtyId = matchedPtys[newSelectedIndex]?.ptyId ?? null;

  state.matchedPtys = matchedPtys;
  state.matchedPtysIndex = matchedPtysIndex;
  state.selectedIndex = newSelectedIndex;
  state.selectedPtyId = selectedPtyId;
  if (!currentPtyStillExists || selectedPtyId === null) {
    state.previewMode = false;
  }
}
