/**
 * Git metadata extraction and comparison utilities.
 */

import type { GitRepoMetadata } from '../../git-metadata-cache';
import type { GitDiffStats, PtyInfo } from '../types';
import type { GitMetadataFields } from './types';

/**
 * Extract git metadata fields from GitRepoMetadata.
 * Returns default empty values if metadata is undefined.
 */
export function extractGitMetadata(metadata: GitRepoMetadata | undefined): GitMetadataFields {
  if (!metadata) {
    return {
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

  return {
    gitBranch: metadata.branch,
    gitDirty: metadata.dirty,
    gitStaged: metadata.staged,
    gitUnstaged: metadata.unstaged,
    gitUntracked: metadata.untracked,
    gitConflicted: metadata.conflicted,
    gitAhead: metadata.ahead,
    gitBehind: metadata.behind,
    gitStashCount: metadata.stashCount,
    gitState: metadata.state,
    gitDetached: metadata.detached,
    gitRepoKey: metadata.repoKey,
    gitDiffStats: metadata.diffStats ? { ...metadata.diffStats } : undefined,
  };
}

/**
 * Apply a repo snapshot to a PTY.
 * If the snapshot is missing, the incoming PTY metadata is preserved as-is.
 */
export function applyGitMetadataSnapshot(
  pty: PtyInfo,
  metadata: GitRepoMetadata | undefined
): PtyInfo {
  if (!metadata) {
    return pty;
  }

  return {
    ...pty,
    ...extractGitMetadata(metadata),
  };
}

/**
 * Compare two GitDiffStats for equality.
 */
export function areGitDiffStatsEqual(
  a: GitDiffStats | undefined,
  b: GitDiffStats | undefined
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.added === b.added && a.removed === b.removed && a.binary === b.binary;
}

/**
 * Whether a PTY already carries meaningful git metadata.
 */
export function hasGitMetadata(pty: PtyInfo): boolean {
  return (
    pty.gitBranch !== undefined ||
    pty.gitDiffStats !== undefined ||
    pty.gitDirty ||
    pty.gitStaged > 0 ||
    pty.gitUnstaged > 0 ||
    pty.gitUntracked > 0 ||
    pty.gitConflicted > 0 ||
    pty.gitAhead !== undefined ||
    pty.gitBehind !== undefined ||
    pty.gitStashCount !== undefined ||
    pty.gitState !== undefined ||
    pty.gitDetached ||
    pty.gitRepoKey !== undefined
  );
}

/**
 * Preserve existing git metadata when a refresh path only returns partial PTY
 * data. This keeps cwd/process updates cheap without clearing stable git state.
 */
export function mergePtyInfoPreservingGitMetadata(
  existing: PtyInfo | undefined,
  next: PtyInfo
): PtyInfo {
  if (!existing || existing.cwd !== next.cwd) {
    return next;
  }

  const incomingHasGitMetadata = hasGitMetadata(next);
  const nextWithPreservedDiffStats =
    next.gitDiffStats === undefined && existing.gitDiffStats !== undefined
      ? { ...next, gitDiffStats: existing.gitDiffStats }
      : next;

  if (incomingHasGitMetadata || !hasGitMetadata(existing)) {
    return nextWithPreservedDiffStats;
  }

  return {
    ...nextWithPreservedDiffStats,
    gitBranch: existing.gitBranch,
    gitDiffStats: existing.gitDiffStats,
    gitDirty: existing.gitDirty,
    gitStaged: existing.gitStaged,
    gitUnstaged: existing.gitUnstaged,
    gitUntracked: existing.gitUntracked,
    gitConflicted: existing.gitConflicted,
    gitAhead: existing.gitAhead,
    gitBehind: existing.gitBehind,
    gitStashCount: existing.gitStashCount,
    gitState: existing.gitState,
    gitDetached: existing.gitDetached,
    gitRepoKey: existing.gitRepoKey,
  };
}

/**
 * Check if PtyInfo has changed between two versions.
 * Compares all fields including git metadata.
 */
export function didPtyInfoChange(prev: PtyInfo, next: PtyInfo): boolean {
  return (
    prev.cwd !== next.cwd ||
    prev.foregroundProcess !== next.foregroundProcess ||
    prev.shell !== next.shell ||
    prev.title !== next.title ||
    prev.workspaceId !== next.workspaceId ||
    prev.paneId !== next.paneId ||
    prev.gitBranch !== next.gitBranch ||
    prev.gitDirty !== next.gitDirty ||
    prev.gitStaged !== next.gitStaged ||
    prev.gitUnstaged !== next.gitUnstaged ||
    prev.gitUntracked !== next.gitUntracked ||
    prev.gitConflicted !== next.gitConflicted ||
    prev.gitAhead !== next.gitAhead ||
    prev.gitBehind !== next.gitBehind ||
    prev.gitStashCount !== next.gitStashCount ||
    prev.gitState !== next.gitState ||
    prev.gitDetached !== next.gitDetached ||
    prev.gitRepoKey !== next.gitRepoKey ||
    !areGitDiffStatsEqual(prev.gitDiffStats, next.gitDiffStats)
  );
}
