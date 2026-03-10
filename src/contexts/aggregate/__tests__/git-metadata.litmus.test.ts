/**
 * Litmus tests for git metadata - fast, single concept tests.
 */

import { describe, it, expect } from 'vitest';
import { extractGitMetadata, areGitDiffStatsEqual, didPtyInfoChange } from '../git/metadata';
import type { GitRepoMetadata } from '../../git-metadata-cache';
import type { PtyInfo } from '../../aggregate-view-types';

describe('git metadata (litmus)', () => {
  describe('extractGitMetadata', () => {
    it('returns default values for undefined metadata', () => {
      const result = extractGitMetadata(undefined);
      
      expect(result.gitBranch).toBeUndefined();
      expect(result.gitDirty).toBe(false);
      expect(result.gitStaged).toBe(0);
      expect(result.gitUnstaged).toBe(0);
      expect(result.gitUntracked).toBe(0);
      expect(result.gitConflicted).toBe(0);
      expect(result.gitAhead).toBeUndefined();
      expect(result.gitBehind).toBeUndefined();
      expect(result.gitStashCount).toBeUndefined();
      expect(result.gitState).toBeUndefined();
      expect(result.gitDetached).toBe(false);
      expect(result.gitRepoKey).toBeUndefined();
      expect(result.gitDiffStats).toBeUndefined();
    });

    it('extracts all fields from metadata', () => {
      const metadata: GitRepoMetadata = {
        branch: 'main',
        dirty: true,
        staged: 2,
        unstaged: 3,
        untracked: 1,
        conflicted: 0,
        ahead: 5,
        behind: 2,
        stashCount: 1,
        state: 'clean',
        detached: false,
        repoKey: '/repo/key',
        diffStats: { added: 10, removed: 5, binary: 0 },
      };
      
      const result = extractGitMetadata(metadata);
      
      expect(result.gitBranch).toBe('main');
      expect(result.gitDirty).toBe(true);
      expect(result.gitStaged).toBe(2);
      expect(result.gitUnstaged).toBe(3);
      expect(result.gitUntracked).toBe(1);
      expect(result.gitConflicted).toBe(0);
      expect(result.gitAhead).toBe(5);
      expect(result.gitBehind).toBe(2);
      expect(result.gitStashCount).toBe(1);
      expect(result.gitState).toBe('clean');
      expect(result.gitDetached).toBe(false);
      expect(result.gitRepoKey).toBe('/repo/key');
      expect(result.gitDiffStats).toEqual({ added: 10, removed: 5, binary: 0 });
    });

    it('creates shallow copy of diffStats', () => {
      const diffStats = { added: 10, removed: 5, binary: 0 };
      const metadata: GitRepoMetadata = {
        branch: 'main',
        dirty: true,
        staged: 0,
        unstaged: 0,
        untracked: 0,
        conflicted: 0,
        ahead: undefined,
        behind: undefined,
        stashCount: undefined,
        state: 'clean',
        detached: false,
        repoKey: '/repo',
        diffStats,
      };
      
      const result = extractGitMetadata(metadata);
      
      // Modifying original should not affect result
      diffStats.added = 999;
      expect(result.gitDiffStats?.added).toBe(10);
    });
  });

  describe('areGitDiffStatsEqual', () => {
    it('returns true when both are undefined', () => {
      expect(areGitDiffStatsEqual(undefined, undefined)).toBe(true);
    });

    it('returns false when one is undefined', () => {
      expect(areGitDiffStatsEqual(undefined, { added: 1, removed: 0, binary: 0 })).toBe(false);
      expect(areGitDiffStatsEqual({ added: 1, removed: 0, binary: 0 }, undefined)).toBe(false);
    });

    it('returns true for equal stats', () => {
      const a = { added: 10, removed: 5, binary: 0 };
      const b = { added: 10, removed: 5, binary: 0 };
      expect(areGitDiffStatsEqual(a, b)).toBe(true);
    });

    it('returns false for different stats', () => {
      expect(areGitDiffStatsEqual(
        { added: 10, removed: 5, binary: 0 },
        { added: 11, removed: 5, binary: 0 }
      )).toBe(false);
      expect(areGitDiffStatsEqual(
        { added: 10, removed: 5, binary: 0 },
        { added: 10, removed: 6, binary: 0 }
      )).toBe(false);
      expect(areGitDiffStatsEqual(
        { added: 10, removed: 5, binary: 0 },
        { added: 10, removed: 5, binary: 1 }
      )).toBe(false);
    });
  });

  describe('didPtyInfoChange', () => {
    it('returns false for identical PTY info', () => {
      const pty: PtyInfo = {
        ptyId: 'pty-1',
        cwd: '/home',
        gitBranch: 'main',
        gitDiffStats: undefined,
        gitDirty: false,
        gitStaged: 0,
        gitUnstaged: 0,
        gitUntracked: 0,
        gitConflicted: 0,
        gitAhead: undefined,
        gitBehind: undefined,
        gitStashCount: undefined,
        gitState: 'clean',
        gitDetached: false,
        gitRepoKey: undefined,
        foregroundProcess: 'bash',
        shell: '/bin/bash',
        title: 'bash',
        workspaceId: 1,
        paneId: 'pane-1',
        sessionId: 'session-1',
        sessionMetadata: undefined,
      };
      
      expect(didPtyInfoChange(pty, { ...pty })).toBe(false);
    });

    it('returns true when cwd changes', () => {
      const pty = createMockPty();
      const next = { ...pty, cwd: '/different' };
      
      expect(didPtyInfoChange(pty, next)).toBe(true);
    });

    it('returns true when gitBranch changes', () => {
      const pty = createMockPty();
      const next = { ...pty, gitBranch: 'feature' };
      
      expect(didPtyInfoChange(pty, next)).toBe(true);
    });
  });
});

function createMockPty(): PtyInfo {
  return {
    ptyId: 'pty-1',
    cwd: '/home',
    gitBranch: 'main',
    gitDiffStats: undefined,
    gitDirty: false,
    gitStaged: 0,
    gitUnstaged: 0,
    gitUntracked: 0,
    gitConflicted: 0,
    gitAhead: undefined,
    gitBehind: undefined,
    gitStashCount: undefined,
    gitState: 'clean',
    gitDetached: false,
    gitRepoKey: undefined,
    foregroundProcess: 'bash',
    shell: '/bin/bash',
    title: 'bash',
    workspaceId: 1,
    paneId: 'pane-1',
    sessionId: 'session-1',
    sessionMetadata: undefined,
  };
}
