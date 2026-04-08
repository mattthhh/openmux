/**
 * Shared PTY info conversion helpers for aggregate view.
 *
 * These helpers intentionally live outside the legacy aggregate-view files so
 * both the old and modular code paths use the exact same git-preservation
 * semantics.
 */

import type { SessionMetadata } from '../../effect/models';
import type { GitInfo } from '../../effect/services/pty/helpers';
import type { GitDiffStats, PtyInfo } from './types';
import { mergePtyInfoPreservingGitMetadata } from './git';

export interface EnrichedPtyMetadataLike {
  ptyId: string;
  cwd: string;
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
  gitIsWorktree: boolean;
  gitCommonDir: string | null;
  foregroundProcess: string | undefined;
  shell: string | undefined;
  title: string | undefined;
  workspaceId: number | undefined;
  paneId: string | undefined;
  sessionId?: string;
  sessionMetadata?: SessionMetadata;
}

export function ptyMetadataToInfo(metadata: EnrichedPtyMetadataLike, existing?: PtyInfo): PtyInfo {
  return mergePtyInfoPreservingGitMetadata(existing, {
    ptyId: metadata.ptyId,
    sortOrderHint: existing?.sortOrderHint,
    cwd: metadata.cwd,
    gitBranch: metadata.gitBranch,
    gitDiffStats: metadata.gitDiffStats,
    gitDirty: metadata.gitDirty,
    gitStaged: metadata.gitStaged,
    gitUnstaged: metadata.gitUnstaged,
    gitUntracked: metadata.gitUntracked,
    gitConflicted: metadata.gitConflicted,
    gitAhead: metadata.gitAhead,
    gitBehind: metadata.gitBehind,
    gitStashCount: metadata.gitStashCount,
    gitState: metadata.gitState,
    gitDetached: metadata.gitDetached,
    gitRepoKey: metadata.gitRepoKey,
    gitIsWorktree: metadata.gitIsWorktree,
    gitCommonDir: metadata.gitCommonDir,
    foregroundProcess: metadata.foregroundProcess,
    shell: metadata.shell,
    title: metadata.title ?? existing?.title,
    workspaceId: metadata.workspaceId,
    paneId: metadata.paneId,
    sessionId: metadata.sessionId ?? existing?.sessionId ?? 'unknown',
    sessionMetadata: metadata.sessionMetadata ?? existing?.sessionMetadata,
  });
}
