/**
 * Tests for event-driven git refresh wiring.
 */

import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { createStore } from 'solid-js/store';

const subscribeToGitRepoChangesMock = vi.fn();

vi.mock('../../../effect/services/pty/helpers', () => ({
  getGitInfo: vi.fn(),
  getGitDiffStats: vi.fn(),
  subscribeToGitRepoChanges: subscribeToGitRepoChangesMock,
}));

import { createGitRepoChangeRefresh } from '../subscriptions';
import { buildPtyIndex } from '../filter';
import { initialState, type AggregateViewState, type PtyInfo } from '../../aggregate-view-types';
import type { SessionMetadata } from '../../../effect/models';

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
    gitDiffStats: { added: 1, removed: 1, binary: 0 },
    gitDirty: true,
    gitStaged: 1,
    gitUnstaged: 1,
    gitUntracked: 0,
    gitConflicted: 0,
    gitAhead: 7,
    gitBehind: 0,
    gitStashCount: 0,
    gitState: undefined,
    gitDetached: false,
    gitRepoKey: '/repo',
    foregroundProcess: 'bash',
    shell: '/bin/bash',
    title: 'bash',
    workspaceId: 1,
    paneId: 'pane-1',
    sessionId: 'session-1',
    sessionMetadata,
    ...overrides,
  };
}

describe('createGitRepoChangeRefresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('triggers a full refresh when a repo matching aggregate PTYs changes', async () => {
    let onGitRepoChange:
      | ((event: { repoKey: string; gitDir: string; workDir: string | null }) => void)
      | undefined;
    subscribeToGitRepoChangesMock.mockImplementation((callback) => {
      onGitRepoChange = callback;
      return () => {};
    });

    const ptys = [
      createPty({ ptyId: 'pty-1', paneId: 'pane-1', gitRepoKey: '/repo' }),
      createPty({ ptyId: 'pty-2', paneId: 'pane-2', gitRepoKey: '/repo' }),
      createPty({ ptyId: 'pty-3', cwd: '/other', paneId: 'pane-3', gitRepoKey: '/other' }),
    ];
    const [state] = createStore<AggregateViewState>({
      ...initialState,
      showAggregateView: true,
      allPtys: ptys,
      allPtysIndex: buildPtyIndex(ptys),
    });
    const refreshPtys = vi.fn(async () => {});

    const unsubscribe = createGitRepoChangeRefresh(state, { value: 1 }, 1, refreshPtys);

    onGitRepoChange?.({ repoKey: '/repo', gitDir: '/repo/.git', workDir: '/repo' });

    expect(refreshPtys).toHaveBeenCalled();
    unsubscribe();
  });

  it('ignores repo events when the aggregate view is hidden or stale', async () => {
    let onGitRepoChange:
      | ((event: { repoKey: string; gitDir: string; workDir: string | null }) => void)
      | undefined;
    subscribeToGitRepoChangesMock.mockImplementation((callback) => {
      onGitRepoChange = callback;
      return () => {};
    });

    const ptys = [createPty({ ptyId: 'pty-1', gitRepoKey: '/repo' })];
    const [state] = createStore<AggregateViewState>({
      ...initialState,
      showAggregateView: false,
      allPtys: ptys,
      allPtysIndex: buildPtyIndex(ptys),
    });
    const refreshPtys = vi.fn(async () => {});
    const subscriptionsEpoch = { value: 2 };

    const unsubscribe = createGitRepoChangeRefresh(state, subscriptionsEpoch, 1, refreshPtys);

    onGitRepoChange?.({ repoKey: '/repo', gitDir: '/repo/.git', workDir: '/repo' });

    expect(refreshPtys).not.toHaveBeenCalled();
    unsubscribe();
  });
});
