/**
 * End-to-end simulation of the cold-start aggregate view bleed.
 *
 * Tests the full refresh cycle: initialLoad → refreshPtys with various
 * initial states representing what could happen during cold start.
 *
 * Asserts that at NO point does any PTY appear under the wrong session
 * group, and no pane appears more than once.
 */

import { beforeEach, describe, expect, test, vi } from 'bun:test';
import { createStore } from 'solid-js/store';

import type { SerializedSession, SessionMetadata } from '../../../src/effect/models';
import {
  createAggregateViewRefreshers,
  type RefreshState,
} from '../../../src/contexts/aggregate/refresh';
import type { PtyOwnership } from '../../../src/contexts/aggregate/subscriptions';
import {
  initialState,
  type AggregateViewState,
  type PtyInfo,
} from '../../../src/contexts/aggregate-view-types';

const getMetadataBatchMock = vi.fn();

vi.mock('../../../src/effect/bridge/aggregate', () => ({
  getPtyMetadata: vi.fn(),
}));

vi.mock('../../../src/effect/bridge/session-bridge', () => ({
  listSessionsResult: vi.fn(),
  loadSession: vi.fn(),
}));

vi.mock('../../../src/contexts/git-metadata-cache', () => ({
  getGlobalGitMetadataCache: vi.fn(() => ({
    getMetadataBatch: getMetadataBatchMock,
  })),
}));

vi.mock('../../../src/effect/services/pty/helpers', () => ({
  getGitInfo: vi.fn(),
  getGitDiffStats: vi.fn(),
}));

import { listSessionsResult, loadSession } from '../../../src/effect/bridge/session-bridge';

const sessionA: SessionMetadata = {
  id: 'session-a',
  name: 'Session A',
  createdAt: 1,
  updatedAt: 1,
  autoNamed: false,
  lastSwitchedAt: 1,
};

const sessionB: SessionMetadata = {
  id: 'session-b',
  name: 'Session B',
  createdAt: 2,
  updatedAt: 2,
  autoNamed: false,
  lastSwitchedAt: 2,
};

const serializedSessionA: SerializedSession = {
  id: 'session-a',
  name: 'Session A',
  activeWorkspaceId: 1,
  workspaces: [
    {
      id: 1,
      layoutMode: 'stacked',
      focusedPaneId: 'pane-a1',
      mainPane: { id: 'pane-a1', cwd: '/a', title: 'a1' },
      stackPanes: [],
      activeStackIndex: 0,
    },
  ],
  cwdMap: new Map([['pane-a1', '/a']]),
  paneToPtyMap: new Map([['pane-a1', 'pty-a1']]),
};

const serializedSessionB: SerializedSession = {
  id: 'session-b',
  name: 'Session B',
  activeWorkspaceId: 1,
  workspaces: [
    {
      id: 1,
      layoutMode: 'stacked',
      focusedPaneId: 'pane-b1',
      mainPane: { id: 'pane-b1', cwd: '/b', title: 'b1' },
      stackPanes: [],
      activeStackIndex: 0,
    },
  ],
  cwdMap: new Map([['pane-b1', '/b']]),
  paneToPtyMap: new Map([['pane-b1', 'pty-b1']]),
};

const createFreshState = (): AggregateViewState => ({
  ...initialState,
  showAggregateView: true,
  allPtys: [],
  allPtysIndex: new Map(),
  matchedPtys: [],
  matchedPtysIndex: new Map(),
  treeRoot: [],
  flattenedTree: [],
  flattenedTreeIndex: new Map(),
  expandedSessionIds: new Set(),
  allSessions: new Map(),
  sessionLoadStates: new Map(),
  loadingSessionIds: new Set(),
  loadAttemptedSessionIds: new Set(),
  pendingPtyIds: new Set(),
  recentlyAddedPtyIds: new Set(),
  deletedPtyIds: new Set(),
  sessionPaneOrders: new Map(),
  sessionPaneOrderIndex: new Map(),
  manualSessionOrder: [],
});

function assertNoBleed(state: AggregateViewState) {
  // No pane should appear more than once
  const paneKeyCounts = new Map<string, number>();
  for (const pty of state.allPtys) {
    if (pty.paneId) {
      const key = `${pty.sessionId}\0${pty.paneId}`;
      paneKeyCounts.set(key, (paneKeyCounts.get(key) ?? 0) + 1);
    }
  }
  for (const [key, count] of paneKeyCounts) {
    expect(count).toBeLessThanOrEqual(1);
  }

  // No live PTY should appear more than once
  const livePtyCounts = new Map<string, number>();
  for (const pty of state.allPtys) {
    if (!pty.ptyId.startsWith('saved:')) {
      livePtyCounts.set(pty.ptyId, (livePtyCounts.get(pty.ptyId) ?? 0) + 1);
    }
  }
  for (const [ptyId, count] of livePtyCounts) {
    expect(count).toBeLessThanOrEqual(1);
  }
}

describe('cold-start e2e: aggregate view bleed prevention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMetadataBatchMock.mockResolvedValue(new Map());
  });

  test('full cold-start: initialLoad → refreshPtys with stale wrong-session placeholders', async () => {
    const [state, setState] = createStore<AggregateViewState>(createFreshState());
    const refreshState: RefreshState = {
      refreshInProgress: false,
      pendingFullRefresh: false,
    };

    const ownershipMap = new Map<string, PtyOwnership>([
      ['pty-a1', { sessionId: 'session-a', paneId: 'pane-a1', workspaceId: 1 }],
      ['pty-b1', { sessionId: 'session-b', paneId: 'pane-b1', workspaceId: 1 }],
    ]);

    const refreshers = createAggregateViewRefreshers(
      state,
      setState,
      refreshState,
      (ptyId) => ownershipMap.get(ptyId) ?? null,
      () => ({ sessionId: 'session-a', lastActiveWorkspaceId: 1, focusedPaneId: 'pane-a1' }),
      () => new Map([['pane-a1', 0]]),
      () => [
        {
          ptyId: 'pty-a1',
          paneId: 'pane-a1',
          workspaceId: 1,
          title: 'a1',
          cwd: '/a',
          sessionId: 'session-a',
        },
      ]
    );

    vi.mocked(listSessionsResult).mockResolvedValue([sessionA, sessionB]);
    vi.mocked(loadSession).mockImplementation(async (id: string) =>
      id === 'session-a' ? serializedSessionA : serializedSessionB
    );

    // Phase 1: initialLoad (active session only)
    await refreshers.initialLoad();
    assertNoBleed(state);

    // Phase 2: Simulate a stale wrong-session placeholder being in allPtys
    // (this would come from handlePtyCreated with stale ownership)
    const stalePlaceholder: PtyInfo = {
      ptyId: 'pty-b1',
      paneId: 'pane-b1',
      sessionId: 'session-a', // WRONG
      cwd: '',
      foregroundProcess: undefined,
      shell: 'shell',
      title: '...',
      workspaceId: 1,
      sessionMetadata: sessionA,
      sortOrderHint: undefined,
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

    setState('allPtys', (ptys) => [...ptys, stalePlaceholder]);
    setState(
      'allPtysIndex',
      new Map([...state.allPtysIndex, ['pty-b1', state.allPtys.length - 1]])
    );
    setState('pendingPtyIds', (s) => new Set([...s, 'pty-b1']));

    // Phase 3: Full refreshPtys — cross-session reconciliation should fix the bleed
    await refreshers.refreshPtys();
    assertNoBleed(state);

    // pty-b1 should appear under session-b, not session-a
    expect(
      state.allPtys.some((pty) => pty.paneId === 'pane-b1' && pty.sessionId === 'session-b')
    ).toBe(true);

    expect(
      state.allPtys.some((pty) => pty.paneId === 'pane-b1' && pty.sessionId === 'session-a')
    ).toBe(false);
  });

  test('multiple stale wrong-session placeholders are all corrected', async () => {
    const [state, setState] = createStore<AggregateViewState>(createFreshState());
    const refreshState: RefreshState = {
      refreshInProgress: false,
      pendingFullRefresh: false,
    };

    const ownershipMap = new Map<string, PtyOwnership>([
      ['pty-a1', { sessionId: 'session-a', paneId: 'pane-a1', workspaceId: 1 }],
      ['pty-b1', { sessionId: 'session-b', paneId: 'pane-b1', workspaceId: 1 }],
      ['pty-b2', { sessionId: 'session-b', paneId: 'pane-b2', workspaceId: 1 }],
    ]);

    const refreshers = createAggregateViewRefreshers(
      state,
      setState,
      refreshState,
      (ptyId) => ownershipMap.get(ptyId) ?? null,
      () => ({ sessionId: 'session-a', lastActiveWorkspaceId: 1, focusedPaneId: 'pane-a1' }),
      () => new Map([['pane-a1', 0]]),
      () => [
        {
          ptyId: 'pty-a1',
          paneId: 'pane-a1',
          workspaceId: 1,
          title: 'a1',
          cwd: '/a',
          sessionId: 'session-a',
        },
      ]
    );

    // Seed multiple wrong-session placeholders
    const makePty = (ptyId: string, paneId: string, sessionId: string): PtyInfo => ({
      ptyId,
      paneId,
      sessionId,
      cwd: '',
      foregroundProcess: undefined,
      shell: 'shell',
      title: '...',
      workspaceId: 1,
      sessionMetadata: sessionId === 'session-a' ? sessionA : sessionB,
      sortOrderHint: undefined,
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
    });

    setState('allPtys', [
      makePty('pty-a1', 'pane-a1', 'session-a'),
      makePty('pty-b1', 'pane-b1', 'session-a'), // WRONG
      makePty('pty-b2', 'pane-b2', 'session-a'), // WRONG
    ]);
    setState(
      'allPtysIndex',
      new Map([
        ['pty-a1', 0],
        ['pty-b1', 1],
        ['pty-b2', 2],
      ])
    );
    setState('pendingPtyIds', new Set(['pty-b1', 'pty-b2']));

    const sessionB2: SerializedSession = {
      id: 'session-b',
      name: 'Session B',
      activeWorkspaceId: 1,
      workspaces: [
        {
          id: 1,
          layoutMode: 'stacked',
          focusedPaneId: 'pane-b1',
          mainPane: { id: 'pane-b1', cwd: '/b', title: 'b1' },
          stackPanes: [
            {
              id: 'pane-b2',
              cwd: '/b2',
              title: 'b2',
              layoutMode: 'stacked',
              focusedPaneId: 'pane-b2',
              activeStackIndex: 0,
            },
          ],
          activeStackIndex: 0,
        },
      ],
      cwdMap: new Map([
        ['pane-b1', '/b'],
        ['pane-b2', '/b2'],
      ]),
      paneToPtyMap: new Map([
        ['pane-b1', 'pty-b1'],
        ['pane-b2', 'pty-b2'],
      ]),
    };

    vi.mocked(listSessionsResult).mockResolvedValue([sessionA, sessionB]);
    vi.mocked(loadSession).mockImplementation(async (id: string) =>
      id === 'session-a' ? serializedSessionA : sessionB2
    );

    await refreshers.refreshPtys();
    assertNoBleed(state);

    // Both PTYs should be under session-b
    expect(
      state.allPtys.some((pty) => pty.ptyId === 'pty-b1' && pty.sessionId === 'session-b')
    ).toBe(true);
    expect(
      state.allPtys.some((pty) => pty.ptyId === 'pty-b2' && pty.sessionId === 'session-b')
    ).toBe(true);

    // None under session-a
    expect(
      state.allPtys.some((pty) => pty.paneId === 'pane-b1' && pty.sessionId === 'session-a')
    ).toBe(false);
    expect(
      state.allPtys.some((pty) => pty.paneId === 'pane-b2' && pty.sessionId === 'session-a')
    ).toBe(false);
  });
});
