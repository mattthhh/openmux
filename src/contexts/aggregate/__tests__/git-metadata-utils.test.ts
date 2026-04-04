/**
 * Focused tests for shared aggregate git metadata helpers.
 *
 * These lock down the invariants that have historically regressed:
 * - partial refreshes must not clear good git state
 * - repo snapshots must override per-PTY placeholders consistently
 * - metadata conversion helpers must preserve stable UI fields
 */

import { describe, expect, it } from 'bun:test';

import type { SessionMetadata } from '../../../effect/models';
import type { PtyInfo } from '../types';
import {
  applyGitMetadataSnapshot,
  hasGitMetadata,
  mergePtyInfoPreservingGitMetadata,
} from '../git/metadata';
import { ptyMetadataToInfo } from '../pty-info';

const sessionMetadata: SessionMetadata = {
  id: 'session-1',
  name: 'Session',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

function createPty(overrides: Partial<PtyInfo> = {}): PtyInfo {
  return {
    ptyId: 'pty-1',
    cwd: '/repo',
    gitBranch: 'main',
    gitDiffStats: { added: 10, removed: 2, binary: 0 },
    gitDirty: true,
    gitStaged: 1,
    gitUnstaged: 2,
    gitUntracked: 0,
    gitConflicted: 0,
    gitAhead: 7,
    gitBehind: 0,
    gitStashCount: 0,
    gitState: undefined,
    gitDetached: false,
    gitRepoKey: '/repo',
    foregroundProcess: 'nvim',
    shell: '/bin/zsh',
    title: 'editor',
    workspaceId: 1,
    paneId: 'pane-1',
    sessionId: 'session-1',
    sessionMetadata,
    ...overrides,
  };
}

describe('aggregate git metadata helpers', () => {
  it('detects whether a PTY already has meaningful git metadata', () => {
    expect(hasGitMetadata(createPty())).toBe(true);
    expect(
      hasGitMetadata(
        createPty({
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
        })
      )
    ).toBe(false);
  });

  it('preserves existing git metadata when a same-cwd refresh is partial', () => {
    const existing = createPty();
    const next = createPty({
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
      foregroundProcess: 'bash',
      title: 'shell',
    });

    const merged = mergePtyInfoPreservingGitMetadata(existing, next);

    expect(merged.foregroundProcess).toBe('bash');
    expect(merged.title).toBe('shell');
    expect(merged.gitBranch).toBe('main');
    expect(merged.gitAhead).toBe(7);
    expect(merged.gitDiffStats).toEqual({ added: 10, removed: 2, binary: 0 });
  });

  it('drops old git metadata when cwd changes', () => {
    const existing = createPty();
    const next = createPty({
      cwd: '/other',
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
    });

    const merged = mergePtyInfoPreservingGitMetadata(existing, next);

    expect(merged.cwd).toBe('/other');
    expect(merged.gitBranch).toBeUndefined();
    expect(merged.gitDiffStats).toBeUndefined();
  });

  it('applies repo snapshots without touching non-git fields', () => {
    const pty = createPty({
      foregroundProcess: 'bash',
      title: 'shell',
      gitAhead: 1,
      gitDiffStats: undefined,
    });

    const hydrated = applyGitMetadataSnapshot(pty, {
      repoKey: '/repo',
      branch: 'feature',
      dirty: true,
      staged: 3,
      unstaged: 4,
      untracked: 1,
      conflicted: 0,
      ahead: 9,
      behind: 2,
      stashCount: 0,
      state: undefined,
      detached: false,
      diffStats: { added: 22, removed: 8, binary: 0 },
      lastUpdated: Date.now(),
    });

    expect(hydrated.foregroundProcess).toBe('bash');
    expect(hydrated.title).toBe('shell');
    expect(hydrated.gitBranch).toBe('feature');
    expect(hydrated.gitAhead).toBe(9);
    expect(hydrated.gitBehind).toBe(2);
    expect(hydrated.gitDiffStats).toEqual({ added: 22, removed: 8, binary: 0 });
  });

  it('converts bridge metadata to PTY info while preserving stable fields from existing rows', () => {
    const existing = createPty({
      ptyId: 'pty-2',
      title: 'kept title',
      sessionId: 'session-2',
      paneId: 'pane-2',
    });

    const info = ptyMetadataToInfo(
      {
        ptyId: 'pty-2',
        cwd: '/repo',
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
        foregroundProcess: 'bash',
        shell: '/bin/zsh',
        title: undefined,
        workspaceId: 1,
        paneId: 'pane-2',
      },
      existing
    );

    expect(info.title).toBe('kept title');
    expect(info.sessionId).toBe('session-2');
    expect(info.gitBranch).toBe('main');
    expect(info.gitDiffStats).toEqual({ added: 10, removed: 2, binary: 0 });
  });
});
