/**
 * Git metadata utilities for Aggregate View.
 */

import type { GitRepoMetadata } from '../git-metadata-cache';
import type { GitInfo } from '../../effect/services/pty/helpers';
import type { GitDiffStats, PtyInfo } from './types';

export interface GitMetadataFields {
  gitBranch: string | undefined;
  gitDiffStats: GitDiffStats | undefined;
  gitDirty: boolean;
  gitStaged: number;
  gitUnstaged: number;
  gitUntracked: number;
  gitConflicted: number;
  gitAhead: number | undefined;
  gitBehind: number | undefined;
  gitStashCount: number | undefined;
  gitState: GitInfo['state'] | undefined;
  gitDetached: boolean;
  gitRepoKey: string | undefined;
}

export interface PtyChangeResult {
  changed: boolean;
  fields: Array<keyof GitMetadataFields>;
}

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

export function areGitDiffStatsEqual(
  a: GitDiffStats | undefined,
  b: GitDiffStats | undefined
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.added === b.added && a.removed === b.removed && a.binary === b.binary;
}

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
