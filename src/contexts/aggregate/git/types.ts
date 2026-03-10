/**
 * Git metadata types for Aggregate View.
 */

import type { GitInfo } from '../../../effect/services/pty/helpers';
import type { GitDiffStats } from '../types';

/** Git metadata fields that can be applied to a PtyInfo */
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
  gitState: GitInfo["state"] | undefined;
  gitDetached: boolean;
  gitRepoKey: string | undefined;
}

/** Comparison result for PTY info changes */
export interface PtyChangeResult {
  changed: boolean;
  fields: (keyof GitMetadataFields)[];
}
