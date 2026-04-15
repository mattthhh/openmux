/**
 * Reproduces the autoswitch race: rapid j/k navigation triggers multiple
 * session switches while a refreshPtys is in flight. Between switches,
 * applySnapshot from the first refresh may apply a stale snapshot that
 * contains wrong-session entries, and the wrong entries survive because
 * carriedOptimisticPtys doesn't catch them (before the fix).
 *
 * This test simulates the FULL runtime sequence:
 * 1. Open aggregate on session A
 * 2. Navigate to session B PTY → autoswitch fires → switchSession(B)
 * 3. While the switch is in progress, refreshPtys captures stale state
 * 4. Navigate to session C PTY before the first switch completes
 * 5. Second switch starts, first switch completes
 * 6. applySnapshot from step 3 applies stale entries
 * 7. Assert: no PTY ever appears under the wrong session group
 */

import { beforeEach, describe, expect, test, vi } from 'bun:test';
import { createStore } from 'solid-js/store';

import type { SerializedSession, SessionMetadata } from '../../../src/effect/models';
import {
  createAggregateViewRefreshers,
  type RefreshState,
} from '../../../src/contexts/aggregate/refresh';
import {
  initialState,
  type AggregateViewState,
  type PtyInfo,
} from '../../../src/contexts/aggregate-view-types';

const getPtyMetadataMock = vi.fn();
const getMetadataBatchMock = vi.fn();

vi.mock('../../../src/effect/bridge/aggregate', () => ({
  getPtyMetadata: getPtyMetadataMock,
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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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

const sessionC: SessionMetadata = {
  id: 'session-c',
  name: 'Session C',
  createdAt: 3,
  updatedAt: 3,
  autoNamed: false,
  lastSwitchedAt: 3,
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

const serializedSessionC: SerializedSession = {
  id: 'session-c',
  name: 'Session C',
  activeWorkspaceId: 1,
  workspaces: [
    {
      id: 1,
      layoutMode: 'stacked',
      focusedPaneId: 'pane-c1',
      mainPane: { id: 'pane-c1', cwd: '/c', title: 'c1' },
      stackPanes: [],
      activeStackIndex: 0,
    },
  ],
  cwdMap: new Map([['pane-c1', '/c']]),
  paneToPtyMap: new Map([['pane-c1', 'pty-c1']]),
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

describe('autoswitch race: rapid j/k switches with in-flight refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMetadataBatchMock.mockResolvedValue(new Map());
    getPtyMetadataMock.mockImplementation(async (ptyId: string) => {
      const map: Record<
        string,
        { ptyId: string; cwd: string; foregroundProcess: string; shell: string; title: string }
      > = {
        'pty-a1': {
          ptyId: 'pty-a1',
          cwd: '/a',
          foregroundProcess: 'bash',
          shell: 'bash',
          title: 'a1',
        },
        'pty-b1': {
          ptyId: 'pty-b1',
          cwd: '/b',
          foregroundProcess: 'bash',
          shell: 'bash',
          title: 'b1',
        },
        'pty-c1': {
          ptyId: 'pty-c1',
          cwd: '/c',
          foregroundProcess: 'bash',
          shell: 'bash',
          title: 'c1',
        },
      };
      const base = map[ptyId];
      if (!base) return null;
      return {
        ...base,
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
    });
  });

  test('rapid A→B→C switch with in-flight refresh must not bleed PTYs into wrong sessions', async () => {
    const [state, setState] = createStore<AggregateViewState>(createFreshState());
    const refreshState: RefreshState = {
      refreshInProgress: false,
      pendingFullRefresh: false,
    };

    // Simulate the layout/ownership state at each point
    let hintedSessionId: string | null = 'session-a';
    let currentSessionPtys: Array<{
      ptyId: string;
      paneId: string;
      workspaceId: number;
      title?: string;
      cwd?: string;
      sessionId?: string;
    }> = [];
    let resolvedOwners = new Map<
      string,
      { sessionId: string; paneId: string; workspaceId: number }
    >();

    const getCurrentSessionHints = () => ({
      sessionId: hintedSessionId,
      lastActiveWorkspaceId: 1,
      focusedPaneId: 'pane-a1',
    });

    const refreshers = createAggregateViewRefreshers(
      state,
      setState,
      refreshState,
      (ptyId) => resolvedOwners.get(ptyId) ?? null,
      getCurrentSessionHints,
      () => new Map<string, number>(),
      () => currentSessionPtys
    );

    // Phase 1: initial load on session A
    vi.mocked(listSessionsResult).mockResolvedValue([sessionA, sessionB, sessionC]);
    vi.mocked(loadSession).mockImplementation(async (id: string) => {
      if (id === 'session-a') return serializedSessionA;
      if (id === 'session-b') return serializedSessionB;
      return serializedSessionC;
    });

    currentSessionPtys = [
      {
        ptyId: 'pty-a1',
        paneId: 'pane-a1',
        workspaceId: 1,
        title: 'a1',
        cwd: '/a',
        sessionId: 'session-a',
      },
    ];
    resolvedOwners = new Map([
      ['pty-a1', { sessionId: 'session-a', paneId: 'pane-a1', workspaceId: 1 }],
    ]);

    await refreshers.initialLoad();

    // Phase 2: Start background refresh with deferred loadSession calls
    const deferredA = createDeferred<SerializedSession>();
    const deferredB = createDeferred<SerializedSession>();
    const deferredC = createDeferred<SerializedSession>();

    let loadPhase: 'initial' | 'background' = 'background';
    vi.mocked(loadSession).mockImplementation(async (id: string) => {
      if (loadPhase === 'background') {
        if (id === 'session-a') return deferredA.promise;
        if (id === 'session-b') return deferredB.promise;
        return deferredC.promise;
      }
      if (id === 'session-a') return serializedSessionA;
      if (id === 'session-b') return serializedSessionB;
      return serializedSessionC;
    });

    // Simulate switch to session B (user navigated to session B's PTY in aggregate)
    currentSessionPtys = [
      {
        ptyId: 'pty-b1',
        paneId: 'pane-b1',
        workspaceId: 1,
        title: 'b1',
        cwd: '/b',
        sessionId: 'session-b',
      },
    ];
    resolvedOwners = new Map([
      ['pty-b1', { sessionId: 'session-b', paneId: 'pane-b1', workspaceId: 1 }],
    ]);
    hintedSessionId = 'session-b';

    const refresh1 = refreshers.refreshPtys();
    await Promise.resolve();
    await Promise.resolve();

    // Phase 3: Before the first refresh completes, user switches to session C
    // This simulates the autoswitch effect firing for session C
    currentSessionPtys = [
      {
        ptyId: 'pty-c1',
        paneId: 'pane-c1',
        workspaceId: 1,
        title: 'c1',
        cwd: '/c',
        sessionId: 'session-c',
      },
    ];
    resolvedOwners = new Map([
      ['pty-c1', { sessionId: 'session-c', paneId: 'pane-c1', workspaceId: 1 }],
    ]);
    hintedSessionId = 'session-c';

    // Queue a second refresh (the aggregate effect fires when activeSessionId changes)
    loadPhase = 'initial';
    void refreshers.refreshPtys();

    // Complete the first refresh's deferred loads
    deferredA.resolve(serializedSessionA);
    deferredB.resolve(serializedSessionB);
    deferredC.resolve(serializedSessionC);
    await refresh1;

    // Check: no PTY should appear under the wrong session group
    const wrongSessionPtys = state.allPtys.filter((pty) => {
      if (pty.ptyId === 'pty-a1' && pty.sessionId !== 'session-a') return true;
      if (pty.ptyId === 'pty-b1' && pty.sessionId !== 'session-b') return true;
      if (pty.ptyId === 'pty-c1' && pty.sessionId !== 'session-c') return true;
      return false;
    });

    expect(wrongSessionPtys).toEqual([]);

    // Each PTY should appear exactly once (no duplicates)
    const ptyIdCounts = new Map<string, number>();
    for (const pty of state.allPtys) {
      if (!pty.ptyId.startsWith('saved:')) {
        ptyIdCounts.set(pty.ptyId, (ptyIdCounts.get(pty.ptyId) ?? 0) + 1);
      }
    }
    for (const [ptyId, count] of ptyIdCounts) {
      expect(count).toBeLessThanOrEqual(1);
    }

    // Each pane should appear exactly once across all sessions
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
  });

  test('wrong-session placeholder from lifecycle event must be corrected by subsequent refresh', async () => {
    /**
     * Simulates: handlePtyCreated creates a placeholder for pty-b1 under session-a
     * (wrong sessionId from stale ptyToSessionMap). Then refreshPtys runs and
     * the snapshot has the correct saved: entry for pty-b1 under session-b.
     * The carriedOptimisticPtys fix must drop the wrong placeholder.
     */
    const wrongPlaceholder: PtyInfo = {
      ptyId: 'pty-b1',
      paneId: 'pane-b1',
      sessionId: 'session-a',
      cwd: '/b',
      foregroundProcess: undefined,
      shell: 'shell',
      title: '...',
      workspaceId: 1,
      sessionMetadata: sessionA,
      sortOrderHint: 0,
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

    const [state, setState] = createStore<AggregateViewState>({
      ...createFreshState(),
      allPtys: [wrongPlaceholder],
      allPtysIndex: new Map([['pty-b1', 0]]),
      pendingPtyIds: new Set(['pty-b1']),
      recentlyAddedPtyIds: new Set(),
      allSessions: new Map([
        ['session-a', sessionA],
        ['session-b', sessionB],
        ['session-c', sessionC],
      ]),
    });

    const refreshState: RefreshState = {
      refreshInProgress: false,
      pendingFullRefresh: false,
    };

    const refreshers = createAggregateViewRefreshers(
      state,
      setState,
      refreshState,
      // Ownership now correctly says session-b
      (ptyId) =>
        ptyId === 'pty-b1' ? { sessionId: 'session-b', paneId: 'pane-b1', workspaceId: 1 } : null,
      () => ({ sessionId: 'session-a', lastActiveWorkspaceId: 1, focusedPaneId: 'pane-a1' }),
      () => new Map<string, number>(),
      // pty-b1 is NOT in the active session (it's in background session-b)
      () => []
    );

    vi.mocked(listSessionsResult).mockResolvedValue([sessionA, sessionB, sessionC]);
    vi.mocked(loadSession).mockImplementation(async (id: string) => {
      if (id === 'session-a') return serializedSessionA;
      if (id === 'session-b') return serializedSessionB;
      return serializedSessionC;
    });

    await refreshers.refreshPtys();

    // The wrong placeholder must be gone
    expect(
      state.allPtys.some((pty) => pty.ptyId === 'pty-b1' && pty.sessionId === 'session-a')
    ).toBe(false);

    // pane-b1 must appear under session-b only
    const paneB1Entries = state.allPtys.filter((pty) => pty.paneId === 'pane-b1');
    expect(paneB1Entries.length).toBe(1);
    expect(paneB1Entries[0]?.sessionId).toBe('session-b');
  });
});
