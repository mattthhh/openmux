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
  getAggregateSessionPtyMapping,
  loadSessionPtysOnDemand,
} from '../../../effect/bridge/aggregate-bridge';
import {
  listSessionsResult,
  getSessionSummaryResult,
  loadSession,
} from '../../../effect/bridge/session-bridge';

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

function createAggregateState(existingPty: PtyInfo): AggregateViewState {
  return {
    ...initialState,
    showAggregateView: true,
    allSessions: new Map([['session-1', sessionMetadata]]),
    sessionLoadStates: new Map([['session-1', { status: 'loaded', paneCount: 1 }]]),
    expandedSessionIds: new Set(['session-1']),
    allPtys: [existingPty],
    allPtysIndex: buildPtyIndex([existingPty]),
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
  });

  afterEach(() => {
    vi.useRealTimers();
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
