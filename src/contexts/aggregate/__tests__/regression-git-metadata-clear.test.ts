/**
 * Regression test: git metadata must not clear then redraw during refresh.
 *
 * When a live PTY replaces a saved PTY for the same pane (e.g. during
 * dedupeAggregatePtysByPane in applySnapshot), the live PTY's empty git
 * fields must not override the saved PTY's known git metadata.
 *
 * Similarly, stampOwnershipOnPlaceholder must not wipe existing git metadata
 * when stamping ownership onto a placeholder that already has git data.
 */

import { describe, expect, it } from 'bun:test';

import type { SessionMetadata } from '../../../effect/models';
import type { PtyInfo } from '../types';
import { dedupeAggregatePtysByPane, isSavedAggregatePtyId } from '../rows';
import { mergePtyInfoPreservingGitMetadata } from '../git';

const sessionMetadata: SessionMetadata = {
  id: 'session-1',
  name: 'Session',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const emptyGitFields = {
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

function createSavedPty(overrides: Partial<PtyInfo> = {}): PtyInfo {
  return {
    ptyId: 'saved:session-1:pane-3',
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
    gitIsWorktree: false,
    gitCommonDir: null,
    foregroundProcess: 'nvim',
    shell: '/bin/zsh',
    title: 'editor',
    workspaceId: 1,
    paneId: 'pane-3',
    sessionId: 'session-1',
    sessionMetadata,
    sortOrderHint: 2,
    ...overrides,
  };
}

function createLivePty(overrides: Partial<PtyInfo> = {}): PtyInfo {
  return {
    ptyId: 'pty-live',
    cwd: '/repo',
    ...emptyGitFields,
    foregroundProcess: undefined,
    shell: 'shell',
    title: '...',
    workspaceId: 1,
    paneId: 'pane-3',
    sessionId: 'session-1',
    sessionMetadata,
    sortOrderHint: 2,
    ...overrides,
  };
}

describe('regression: git metadata must not clear then redraw', () => {
  it('dedupeAggregatePtysByPane preserves git metadata from saved fallback when live pty has empty git fields', () => {
    const saved = createSavedPty();
    const live = createLivePty();

    expect(isSavedAggregatePtyId(saved.ptyId)).toBe(true);
    expect(isSavedAggregatePtyId(live.ptyId)).toBe(false);

    const deduped = dedupeAggregatePtysByPane([saved, live]);

    // Live pty is preferred (not saved), but its empty git metadata must not
    // override the saved pty's known git metadata.
    expect(deduped).toHaveLength(1);
    expect(deduped[0]!.ptyId).toBe('pty-live');
    expect(deduped[0]!.title).toBe('...');
    expect(deduped[0]!.gitBranch).toBe('main');
    expect(deduped[0]!.gitDiffStats).toEqual({ added: 10, removed: 2, binary: 0 });
    expect(deduped[0]!.gitDirty).toBe(true);
    expect(deduped[0]!.gitStaged).toBe(1);
    expect(deduped[0]!.gitUnstaged).toBe(2);
    expect(deduped[0]!.gitAhead).toBe(7);
    expect(deduped[0]!.gitRepoKey).toBe('/repo');
  });

  it('dedupeAggregatePtysByPane preserves git metadata from live pty when it has git data', () => {
    const live = createLivePty({
      ptyId: 'pty-existing',
      gitBranch: 'feature',
      gitDiffStats: { added: 5, removed: 1, binary: 0 },
      gitDirty: true,
      gitStaged: 0,
      gitUnstaged: 3,
      gitAhead: 2,
      gitRepoKey: '/repo',
      title: 'working',
    });
    const saved = createSavedPty({
      ptyId: 'saved:session-1:pane-3',
      ...emptyGitFields,
    });

    const deduped = dedupeAggregatePtysByPane([live, saved]);

    // Live pty is preferred, its git metadata is used
    expect(deduped).toHaveLength(1);
    expect(deduped[0]!.ptyId).toBe('pty-existing');
    expect(deduped[0]!.gitBranch).toBe('feature');
    expect(deduped[0]!.gitDiffStats).toEqual({ added: 5, removed: 1, binary: 0 });
  });

  it('dedupeAggregatePtysByPane prefers live pty git metadata when both have git data', () => {
    const saved = createSavedPty({
      gitBranch: 'old-branch',
      gitAhead: 1,
    });
    const live = createLivePty({
      gitBranch: 'new-branch',
      gitAhead: 5,
      gitRepoKey: '/repo',
    });

    const deduped = dedupeAggregatePtysByPane([saved, live]);

    // Live pty is preferred and has git data, so its data wins
    expect(deduped).toHaveLength(1);
    expect(deduped[0]!.ptyId).toBe('pty-live');
    expect(deduped[0]!.gitBranch).toBe('new-branch');
    expect(deduped[0]!.gitAhead).toBe(5);
    expect(deduped[0]!.gitRepoKey).toBe('/repo');
  });

  it('dedupeAggregatePtysByPane preserves git metadata when live replaces saved for same pane', () => {
    const saved = createSavedPty();
    const live = createLivePty();

    // Both ptys are for the same pane (session-1, pane-3)
    const deduped = dedupeAggregatePtysByPane([saved, live]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]!.ptyId).toBe('pty-live');
    expect(deduped[0]!.gitBranch).toBe('main');
    expect(deduped[0]!.gitDiffStats).toEqual({ added: 10, removed: 2, binary: 0 });
    expect(deduped[0]!.gitDirty).toBe(true);
    expect(deduped[0]!.gitAhead).toBe(7);
    expect(deduped[0]!.gitRepoKey).toBe('/repo');
  });

  it('dedupeAggregatePtysByPane preserves git metadata across multiple pane dedupes', () => {
    const saved1 = createSavedPty({ paneId: 'pane-a', sortOrderHint: 0 });
    const live1 = createLivePty({ paneId: 'pane-a', sortOrderHint: 0 });
    const saved2 = createSavedPty({
      ptyId: 'saved:session-1:pane-b',
      paneId: 'pane-b',
      gitBranch: 'develop',
      gitAhead: 3,
      gitDiffStats: { added: 20, removed: 5, binary: 1 },
      sortOrderHint: 1,
    });
    const live2 = createLivePty({ paneId: 'pane-b', sortOrderHint: 1 });

    const deduped = dedupeAggregatePtysByPane([saved1, live1, saved2, live2]);

    expect(deduped).toHaveLength(2);
    expect(deduped.find((p) => p.paneId === 'pane-a')).toMatchObject({
      ptyId: 'pty-live',
      gitBranch: 'main',
      gitAhead: 7,
    });
    expect(deduped.find((p) => p.paneId === 'pane-b')).toMatchObject({
      ptyId: 'pty-live',
      gitBranch: 'develop',
      gitAhead: 3,
      gitDiffStats: { added: 20, removed: 5, binary: 1 },
    });
  });

  it('dedupeAggregatePtysByPane preserves git metadata from existing live PTY when snapshot PTY has empty git fields (merge-mode applySnapshot)', () => {
    // Simulates the applySnapshot merge-mode scenario:
    // 1. Existing PTYs in allPtys have git metadata (from a prior full refresh)
    // 2. Snapshot PTYs (from refreshActiveSession with skipGitMetadata:true) have empty git fields
    // 3. Both sets are passed to dedupeAggregatePtysByPane
    // 4. The deduplication must preserve git metadata from the existing PTYs

    const existingLivePty: PtyInfo = {
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
      gitIsWorktree: false,
      gitCommonDir: null,
      foregroundProcess: 'nvim',
      shell: '/bin/zsh',
      title: 'editor',
      workspaceId: 1,
      paneId: 'pane-1',
      sessionId: 'session-1',
      sessionMetadata,
      sortOrderHint: 0,
    };

    const newPanePty: PtyInfo = {
      ptyId: 'pty-2',
      cwd: '/repo',
      ...emptyGitFields,
      foregroundProcess: undefined,
      shell: 'shell',
      title: '...',
      workspaceId: 1,
      paneId: 'pane-2',
      sessionId: 'session-1',
      sessionMetadata,
      sortOrderHint: 1,
    };

    // Snapshot PTYs: same panes as existing but with empty git fields
    const snapshotPty1: PtyInfo = {
      ...existingLivePty,
      ...emptyGitFields,
      title: 'editor',
    };
    const snapshotPty2 = { ...newPanePty };

    // This is what applySnapshot now passes: existing PTYs first, then snapshot PTYs
    const deduped = dedupeAggregatePtysByPane([existingLivePty, snapshotPty1, snapshotPty2]);

    expect(deduped).toHaveLength(2);

    // pane-1: snapshot version preferred (same ptyId), git metadata preserved from existing
    const pane1 = deduped.find((p) => p.paneId === 'pane-1');
    expect(pane1).toBeDefined();
    expect(pane1!.ptyId).toBe('pty-1');
    expect(pane1!.gitBranch).toBe('main');
    expect(pane1!.gitDiffStats).toEqual({ added: 10, removed: 2, binary: 0 });
    expect(pane1!.gitDirty).toBe(true);
    expect(pane1!.gitStaged).toBe(1);
    expect(pane1!.gitUnstaged).toBe(2);
    expect(pane1!.gitAhead).toBe(7);
    expect(pane1!.gitRepoKey).toBe('/repo');

    // pane-2: only the new pane, no git metadata (no existing to inherit from)
    const pane2 = deduped.find((p) => p.paneId === 'pane-2');
    expect(pane2).toBeDefined();
    expect(pane2!.ptyId).toBe('pty-2');
    expect(pane2!.gitBranch).toBeUndefined();
    expect(pane2!.gitRepoKey).toBeUndefined();
  });

  it('mergePtyInfoPreservingGitMetadata preserves git metadata when next has empty fields', () => {
    // This is the core invariant: when transitioning from one git state to
    // the next, if the next state has empty git fields (partial refresh),
    // the existing git metadata must be preserved.
    const existing = createSavedPty({
      ptyId: 'pty-1',
      gitBranch: 'main',
      gitAhead: 7,
    });
    const next: PtyInfo = {
      ...existing,
      ...emptyGitFields,
      foregroundProcess: 'bash',
      title: 'shell',
    };

    const merged = mergePtyInfoPreservingGitMetadata(existing, next);

    expect(merged.foregroundProcess).toBe('bash');
    expect(merged.title).toBe('shell');
    expect(merged.gitBranch).toBe('main');
    expect(merged.gitAhead).toBe(7);
    expect(merged.gitDiffStats).toEqual({ added: 10, removed: 2, binary: 0 });
  });
});
