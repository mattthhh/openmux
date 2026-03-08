import { describe, expect, it } from 'bun:test';
import type { PtyInfo } from '../../src/contexts/aggregate-view-types';
import { didPtyInfoChange } from '../../src/contexts/aggregate-view-subscriptions';

function createMockPty(overrides: Partial<PtyInfo> = {}): PtyInfo {
  return {
    ptyId: 'pty-1',
    cwd: '/home/user/project',
    gitBranch: 'main',
    gitDiffStats: { added: 1, removed: 0, binary: 0 },
    gitDirty: false,
    gitStaged: 0,
    gitUnstaged: 0,
    gitUntracked: 0,
    gitConflicted: 0,
    gitAhead: 0,
    gitBehind: 0,
    gitStashCount: 0,
    gitState: undefined,
    gitDetached: false,
    gitRepoKey: '/home/user/project',
    foregroundProcess: 'nvim',
    shell: '/bin/zsh',
    title: 'editor',
    workspaceId: 1,
    paneId: 'pane-1',
    sessionId: 'session-1',
    sessionMetadata: undefined,
    ...overrides,
  };
}

describe('aggregate-view-subscriptions', () => {
  it('detects git ahead/behind changes during subset refreshes', () => {
    const prev = createMockPty({ gitAhead: 0, gitBehind: 0 });
    const next = createMockPty({ gitAhead: 2, gitBehind: 1 });

    expect(didPtyInfoChange(prev, next)).toBe(true);
  });

  it('detects git stash/state/detached changes during subset refreshes', () => {
    const prev = createMockPty({ gitStashCount: 0, gitState: undefined, gitDetached: false });
    const next = createMockPty({ gitStashCount: 3, gitState: 'merge', gitDetached: true });

    expect(didPtyInfoChange(prev, next)).toBe(true);
  });

  it('detects pane and workspace movement during subset refreshes', () => {
    const prev = createMockPty({ workspaceId: 1, paneId: 'pane-1' });
    const next = createMockPty({ workspaceId: 3, paneId: 'pane-9' });

    expect(didPtyInfoChange(prev, next)).toBe(true);
  });

  it('treats value-equal diff stats as unchanged', () => {
    const prev = createMockPty({ gitDiffStats: { added: 5, removed: 2, binary: 1 } });
    const next = createMockPty({ gitDiffStats: { added: 5, removed: 2, binary: 1 } });

    expect(didPtyInfoChange(prev, next)).toBe(false);
  });
});
