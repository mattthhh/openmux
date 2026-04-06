/**
 * Regression tests for aggregate-view git metadata preservation.
 *
 * Some refresh paths intentionally fetch partial PTY metadata (for example with
 * skipGitDiffStats: true). Those paths must not clobber existing git metadata
 * for unchanged PTYs, otherwise +/- stats briefly disappear and then come back.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'bun:test';
import { createStore } from 'solid-js/store';

import { createAggregateViewRefreshers } from '../../aggregate-view-subscriptions';
import { createAggregateViewActions } from '../../aggregate-view-actions';
import { initialState, type AggregateViewState, type PtyInfo } from '../../aggregate-view-types';
import { buildPtyIndex } from '../../aggregate-view-helpers';
import type { SessionMetadata } from '../../../effect/models';

vi.mock('../../../effect/bridge/aggregate-bridge', () => ({
  listAllPtyIds: vi.fn(),
  listAllPtysWithMetadata: vi.fn(),
  getPtyMetadata: vi.fn(),
  getAggregateSessionPtyMapping: vi.fn(),
  loadSessionPtysOnDemand: vi.fn(),
}));

vi.mock('../../../effect/bridge/session-bridge', () => ({
  listSessionsResult: vi.fn(),
  getSessionSummaryResult: vi.fn(),
  loadSession: vi.fn(),
}));

vi.mock('../../../effect/services/pty/helpers', () => ({
  getGitInfo: vi.fn(),
  getGitDiffStats: vi.fn(),
}));

vi.mock('../../../contexts/git-metadata-cache', () => ({
  getGlobalGitMetadataCache: vi.fn(() => ({
    getMetadataBatch: vi.fn(() => Promise.resolve(new Map())),
  })),
}));

import {
  listAllPtyIds,
  listAllPtysWithMetadata,
  getPtyMetadata,
  getAggregateSessionPtyMapping,
  loadSessionPtysOnDemand,
} from '../../../effect/bridge/aggregate-bridge';
import {
  listSessionsResult,
  getSessionSummaryResult,
  loadSession,
} from '../../../effect/bridge/session-bridge';
import { getGlobalGitMetadataCache } from '../../../contexts/git-metadata-cache';

const sessionMetadata: SessionMetadata = {
  id: 'session-1',
  name: 'Test Session',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

function createPty(overrides: Partial<PtyInfo> = {}): PtyInfo {
  return {
    ptyId: 'pty-1',
    cwd: '/repo',
    gitBranch: 'main',
    gitDiffStats: { added: 12, removed: 3, binary: 1 },
    gitDirty: true,
    gitStaged: 1,
    gitUnstaged: 4,
    gitUntracked: 2,
    gitConflicted: 0,
    gitAhead: 1,
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

function createAggregateState(existingPtys: PtyInfo | PtyInfo[]): AggregateViewState {
  const ptys = Array.isArray(existingPtys) ? existingPtys : [existingPtys];

  return {
    ...initialState,
    showAggregateView: true,
    allSessions: new Map([['session-1', sessionMetadata]]),
    sessionLoadStates: new Map([['session-1', { status: 'loaded', paneCount: ptys.length }]]),
    expandedSessionIds: new Set(['session-1']),
    allPtys: ptys,
    allPtysIndex: buildPtyIndex(ptys),
  };
}

function mockRefreshDependencies() {
  vi.mocked(listSessionsResult).mockResolvedValue([sessionMetadata]);
  vi.mocked(listAllPtyIds).mockResolvedValue(['pty-1']);
  vi.mocked(listAllPtysWithMetadata).mockResolvedValue([
    {
      ptyId: 'pty-1',
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
      shell: '/bin/bash',
      title: 'bash',
      workspaceId: 1,
      paneId: 'pane-1',
    },
  ]);
  vi.mocked(getAggregateSessionPtyMapping).mockResolvedValue({
    sessionId: 'session-1',
    mapping: new Map([['pane-1', 'pty-1']]),
  });
  vi.mocked(loadSession).mockResolvedValue({
    id: 'session-1',
    name: 'Test Session',
    activeWorkspaceId: 1,
    workspaces: [],
    cwdMap: new Map(),
    paneToPtyMap: new Map(),
  });
  vi.mocked(getSessionSummaryResult).mockResolvedValue({
    workspaceCount: 1,
    paneCount: 1,
  });
}

describe('aggregate view git metadata preservation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(getGlobalGitMetadataCache).mockReturnValue({
      getMetadataBatch: vi.fn(() => Promise.resolve(new Map())),
    } as unknown as ReturnType<typeof getGlobalGitMetadataCache>);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('normalizes same-repo PTYs to a single cached snapshot during full refresh', async () => {
    mockRefreshDependencies();

    vi.mocked(listAllPtyIds).mockResolvedValue(['pty-1', 'pty-2']);
    vi.mocked(listAllPtysWithMetadata).mockResolvedValue([
      {
        ptyId: 'pty-1',
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
        shell: '/bin/bash',
        title: 'bash',
        workspaceId: 1,
        paneId: 'pane-1',
      },
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
        shell: '/bin/bash',
        title: 'bash',
        workspaceId: 1,
        paneId: 'pane-2',
      },
    ]);
    vi.mocked(getAggregateSessionPtyMapping).mockResolvedValue({
      sessionId: 'session-1',
      mapping: new Map([
        ['pane-1', 'pty-1'],
        ['pane-2', 'pty-2'],
      ]),
    });

    const cachedSnapshot = {
      repoKey: '/repo',
      branch: 'main',
      dirty: true,
      staged: 2,
      unstaged: 12,
      untracked: 1,
      conflicted: 0,
      ahead: 7,
      behind: 0,
      stashCount: 0,
      state: undefined,
      detached: false,
      diffStats: { added: 14, removed: 6, binary: 0 },
      lastUpdated: Date.now(),
    };
    const getMetadataBatch = vi.fn(() => Promise.resolve(new Map([['/repo', cachedSnapshot]])));
    vi.mocked(getGlobalGitMetadataCache).mockReturnValue({
      getMetadataBatch,
    } as unknown as ReturnType<typeof getGlobalGitMetadataCache>);

    const existingPtys = [
      createPty({ ptyId: 'pty-1', paneId: 'pane-1', gitAhead: 6 }),
      createPty({
        ptyId: 'pty-2',
        paneId: 'pane-2',
        gitAhead: 3,
        gitDiffStats: { added: 1, removed: 1, binary: 0 },
      }),
    ];
    const [state, setState] = createStore<AggregateViewState>(createAggregateState(existingPtys));
    const refreshState = {
      refreshInProgress: false,
      subsetRefreshInProgress: false,
      pendingFullRefresh: false,
      pendingSubsetPtyIds: new Set<string>(),
    };

    const { refreshPtys } = createAggregateViewRefreshers(
      state,
      setState,
      refreshState,
      (ptyId) => ({
        sessionId: 'session-1',
        paneId: ptyId === 'pty-1' ? 'pane-1' : 'pane-2',
        workspaceId: 1,
      }),
      () => ({
        sessionId: 'session-1' as const,
        lastActiveWorkspaceId: 1,
        focusedPaneId: 'pane-1',
      }),
      () =>
        new Map([
          ['pane-1', 0],
          ['pane-2', 1],
        ])
    );

    await refreshPtys();

    expect(getMetadataBatch).toHaveBeenCalledWith(['/repo'], { forceRefresh: true });
    expect(state.allPtys).toHaveLength(2);
    expect(state.allPtys[0]?.gitAhead).toBe(7);
    expect(state.allPtys[1]?.gitAhead).toBe(7);
    expect(state.allPtys[0]?.gitDiffStats).toEqual({ added: 14, removed: 6, binary: 0 });
    expect(state.allPtys[1]?.gitDiffStats).toEqual({ added: 14, removed: 6, binary: 0 });
  });

  it('keeps git snapshots isolated across different repositories during full refresh', async () => {
    mockRefreshDependencies();

    vi.mocked(listAllPtyIds).mockResolvedValue(['pty-1', 'pty-2']);
    vi.mocked(listAllPtysWithMetadata).mockResolvedValue([
      {
        ptyId: 'pty-1',
        cwd: '/repo-a',
        gitBranch: 'wrong-a',
        gitDiffStats: { added: 999, removed: 999, binary: 0 },
        gitDirty: true,
        gitStaged: 9,
        gitUnstaged: 9,
        gitUntracked: 9,
        gitConflicted: 0,
        gitAhead: 99,
        gitBehind: 0,
        gitStashCount: 0,
        gitState: undefined,
        gitDetached: false,
        gitRepoKey: '/repo-a',
        foregroundProcess: 'bash',
        shell: '/bin/bash',
        title: 'bash',
        workspaceId: 1,
        paneId: 'pane-1',
      },
      {
        ptyId: 'pty-2',
        cwd: '/repo-b',
        gitBranch: 'wrong-b',
        gitDiffStats: { added: 888, removed: 888, binary: 0 },
        gitDirty: true,
        gitStaged: 8,
        gitUnstaged: 8,
        gitUntracked: 8,
        gitConflicted: 0,
        gitAhead: 88,
        gitBehind: 0,
        gitStashCount: 0,
        gitState: undefined,
        gitDetached: false,
        gitRepoKey: '/repo-b',
        foregroundProcess: 'bash',
        shell: '/bin/bash',
        title: 'bash',
        workspaceId: 1,
        paneId: 'pane-2',
      },
    ]);
    vi.mocked(getAggregateSessionPtyMapping).mockResolvedValue({
      sessionId: 'session-1',
      mapping: new Map([
        ['pane-1', 'pty-1'],
        ['pane-2', 'pty-2'],
      ]),
    });

    const snapshotA = {
      repoKey: '/repo-a',
      branch: 'main',
      dirty: true,
      staged: 1,
      unstaged: 2,
      untracked: 0,
      conflicted: 0,
      ahead: 7,
      behind: 0,
      stashCount: 0,
      state: undefined,
      detached: false,
      diffStats: { added: 14, removed: 6, binary: 0 },
      lastUpdated: Date.now(),
    };
    const snapshotB = {
      repoKey: '/repo-b',
      branch: 'feature',
      dirty: true,
      staged: 3,
      unstaged: 4,
      untracked: 1,
      conflicted: 0,
      ahead: 2,
      behind: 1,
      stashCount: 0,
      state: undefined,
      detached: false,
      diffStats: { added: 30, removed: 5, binary: 0 },
      lastUpdated: Date.now(),
    };
    const getMetadataBatch = vi.fn(() =>
      Promise.resolve(
        new Map([
          ['/repo-a', snapshotA],
          ['/repo-b', snapshotB],
        ])
      )
    );
    vi.mocked(getGlobalGitMetadataCache).mockReturnValue({
      getMetadataBatch,
    } as unknown as ReturnType<typeof getGlobalGitMetadataCache>);

    const existingPtys = [
      createPty({ ptyId: 'pty-1', cwd: '/repo-a', paneId: 'pane-1' }),
      createPty({ ptyId: 'pty-2', cwd: '/repo-b', paneId: 'pane-2' }),
    ];
    const [state, setState] = createStore<AggregateViewState>(createAggregateState(existingPtys));
    const refreshState = {
      refreshInProgress: false,
      subsetRefreshInProgress: false,
      pendingFullRefresh: false,
      pendingSubsetPtyIds: new Set<string>(),
    };

    const { refreshPtys } = createAggregateViewRefreshers(
      state,
      setState,
      refreshState,
      (ptyId) => ({
        sessionId: 'session-1',
        paneId: ptyId === 'pty-1' ? 'pane-1' : 'pane-2',
        workspaceId: 1,
      }),
      () => ({
        sessionId: 'session-1' as const,
        lastActiveWorkspaceId: 1,
        focusedPaneId: 'pane-1',
      }),
      () =>
        new Map([
          ['pane-1', 0],
          ['pane-2', 1],
        ])
    );

    await refreshPtys();

    expect(state.allPtys.find((pty) => pty.ptyId === 'pty-1')).toMatchObject({
      gitRepoKey: '/repo-a',
      gitAhead: 7,
      gitDiffStats: { added: 14, removed: 6, binary: 0 },
    });
    expect(state.allPtys.find((pty) => pty.ptyId === 'pty-2')).toMatchObject({
      gitRepoKey: '/repo-b',
      gitAhead: 2,
      gitBehind: 1,
      gitDiffStats: { added: 30, removed: 5, binary: 0 },
    });
  });

  it('normalizes same-repo PTYs during subset refresh from the shared git snapshot', async () => {
    const snapshot = {
      repoKey: '/repo',
      branch: 'main',
      dirty: true,
      staged: 2,
      unstaged: 5,
      untracked: 1,
      conflicted: 0,
      ahead: 7,
      behind: 0,
      stashCount: 0,
      state: undefined,
      detached: false,
      diffStats: { added: 14, removed: 6, binary: 0 },
      lastUpdated: Date.now(),
    };
    const getMetadataBatch = vi.fn(() => Promise.resolve(new Map([['/repo', snapshot]])));
    vi.mocked(getGlobalGitMetadataCache).mockReturnValue({
      getMetadataBatch,
    } as unknown as ReturnType<typeof getGlobalGitMetadataCache>);
    vi.mocked(getPtyMetadata).mockImplementation(async (ptyId: string) => ({
      ptyId,
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
      shell: '/bin/bash',
      title: ptyId,
      workspaceId: 1,
      paneId: ptyId === 'pty-1' ? 'pane-1' : 'pane-2',
    }));

    const [state, setState] = createStore<AggregateViewState>(
      createAggregateState([
        createPty({
          ptyId: 'pty-1',
          paneId: 'pane-1',
          gitAhead: 3,
          gitDiffStats: { added: 3, removed: 1, binary: 0 },
        }),
        createPty({
          ptyId: 'pty-2',
          paneId: 'pane-2',
          gitAhead: 11,
          gitDiffStats: { added: 1, removed: 9, binary: 0 },
        }),
      ])
    );
    const refreshState = {
      refreshInProgress: false,
      subsetRefreshInProgress: false,
      pendingFullRefresh: false,
      pendingSubsetPtyIds: new Set<string>(),
    };

    const { refreshPtysSubset } = createAggregateViewRefreshers(
      state,
      setState,
      refreshState,
      () => ({ sessionId: 'session-1', workspaceId: 1 }),
      () => ({
        sessionId: 'session-1' as const,
        lastActiveWorkspaceId: 1,
        focusedPaneId: 'pane-1',
      }),
      () =>
        new Map([
          ['pane-1', 0],
          ['pane-2', 1],
        ])
    );

    await refreshPtysSubset(['pty-1', 'pty-2']);

    expect(getMetadataBatch).toHaveBeenCalledWith(['/repo'], { forceRefresh: true });
    expect(state.allPtys.find((pty) => pty.ptyId === 'pty-1')).toMatchObject({
      gitAhead: 7,
      gitDiffStats: { added: 14, removed: 6, binary: 0 },
    });
    expect(state.allPtys.find((pty) => pty.ptyId === 'pty-2')).toMatchObject({
      gitAhead: 7,
      gitDiffStats: { added: 14, removed: 6, binary: 0 },
    });
  });

  it('preserves existing git metadata during full refresh when bridge metadata is partial', async () => {
    mockRefreshDependencies();

    const existingPty = createPty();
    const [state, setState] = createStore<AggregateViewState>(createAggregateState(existingPty));
    const refreshState = {
      refreshInProgress: false,
      subsetRefreshInProgress: false,
      pendingFullRefresh: false,
      pendingSubsetPtyIds: new Set<string>(),
    };

    const { refreshPtys } = createAggregateViewRefreshers(
      state,
      setState,
      refreshState,
      () => ({ sessionId: 'session-1', paneId: 'pane-1', workspaceId: 1 }),
      () => ({
        sessionId: 'session-1' as const,
        lastActiveWorkspaceId: 1,
        focusedPaneId: 'pane-1',
      }),
      () => new Map([['pane-1', 0]])
    );

    await refreshPtys();

    expect(state.allPtys).toHaveLength(1);
    expect(state.allPtys[0]?.gitBranch).toBe('main');
    expect(state.allPtys[0]?.gitDiffStats).toEqual({ added: 12, removed: 3, binary: 1 });
    expect(state.allPtys[0]?.gitDirty).toBe(true);
    expect(state.allPtys[0]?.gitStaged).toBe(1);
    expect(state.allPtys[0]?.gitUnstaged).toBe(4);
    expect(state.allPtys[0]?.gitUntracked).toBe(2);
    expect(state.allPtys[0]?.gitAhead).toBe(1);
    expect(state.allPtys[0]?.gitRepoKey).toBe('/repo');
  });

  it('preserves existing git metadata when lazy-loaded session PTYs return partial metadata', async () => {
    const existingPty = createPty();
    const [state, setState] = createStore<AggregateViewState>(createAggregateState(existingPty));
    const refreshPtys = vi.fn(async () => {});

    vi.mocked(loadSessionPtysOnDemand).mockResolvedValue({
      sessionId: 'session-1',
      ptys: [
        {
          ptyId: 'pty-1',
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
          shell: '/bin/bash',
          title: 'bash',
          workspaceId: 1,
          paneId: 'pane-1',
        },
      ],
      lastActiveWorkspaceId: 1,
    });

    const actions = createAggregateViewActions({
      state,
      setState,
      refreshPtys,
    });

    await actions.loadSessionPtys('session-1');

    expect(state.allPtys).toHaveLength(1);
    expect(state.allPtys[0]?.gitBranch).toBe('main');
    expect(state.allPtys[0]?.gitDiffStats).toEqual({ added: 12, removed: 3, binary: 1 });
    expect(state.allPtys[0]?.gitDirty).toBe(true);
    expect(state.allPtys[0]?.gitStaged).toBe(1);
    expect(state.allPtys[0]?.gitUnstaged).toBe(4);
    expect(state.allPtys[0]?.gitUntracked).toBe(2);
    expect(state.allPtys[0]?.gitAhead).toBe(1);
    expect(state.allPtys[0]?.gitRepoKey).toBe('/repo');
    expect(refreshPtys).toHaveBeenCalledTimes(1);
  });
});
