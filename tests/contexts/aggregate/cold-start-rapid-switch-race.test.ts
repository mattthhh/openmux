/**
 * Reproduces the cold-start aggregate race the user reports:
 *
 * 1. Open aggregate before all sessions finish loading.
 * 2. Let the background full refresh stay in-flight.
 * 3. While that refresh is in flight, simulate rapid j/k navigation that
 *    switches the live layout/PTYs to another session before the reactive
 *    active-session hint catches up.
 * 4. Queue another refresh and assert that no PTY is ever stamped onto the
 *    wrong session group.
 *
 * The key invariant:
 *   A live PTY from session-B must never appear in session-A's aggregate group,
 *   even transiently, regardless of refresh timing.
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

function getWronglyGroupedPtys(state: AggregateViewState) {
  return state.allPtys.filter(
    (pty) =>
      (pty.ptyId === 'pty-b1' && pty.sessionId !== 'session-b') ||
      (pty.ptyId === 'pty-a1' && pty.sessionId !== 'session-a')
  );
}

describe('cold-start aggregate race: rapid j/k while background refresh is in flight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMetadataBatchMock.mockResolvedValue(new Map());
    getPtyMetadataMock.mockImplementation(async (ptyId: string) => {
      if (ptyId === 'pty-a1') {
        return {
          ptyId: 'pty-a1',
          cwd: '/a',
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
          foregroundProcess: 'bash',
          shell: 'bash',
          title: 'a1',
        };
      }

      if (ptyId === 'pty-b1') {
        return {
          ptyId: 'pty-b1',
          cwd: '/b',
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
          foregroundProcess: 'bash',
          shell: 'bash',
          title: 'b1',
        };
      }

      return null;
    });
    vi.mocked(listSessionsResult).mockResolvedValue([sessionA, sessionB]);
  });

  test('queued refresh during rapid switch must never stamp session-B PTY into session-A group', async () => {
    const [state, setState] = createStore<AggregateViewState>(createFreshState());
    const refreshState: RefreshState = {
      refreshInProgress: false,
      pendingFullRefresh: false,
    };

    let hintedSessionId = 'session-a';
    let hintedWorkspaceId = 1;
    let hintedFocusedPaneId = 'pane-a1';
    let currentPaneOrder = new Map<string, number>([['pane-a1', 0]]);
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
      lastActiveWorkspaceId: hintedWorkspaceId,
      focusedPaneId: hintedFocusedPaneId,
    });

    const refreshers = createAggregateViewRefreshers(
      state,
      setState,
      refreshState,
      (ptyId) => resolvedOwners.get(ptyId) ?? null,
      getCurrentSessionHints,
      () => currentPaneOrder,
      () => currentSessionPtys
    );

    let loadPhase: 'initial' | 'background-1' | 'background-2' = 'initial';
    const background1A = createDeferred<SerializedSession>();
    const background1B = createDeferred<SerializedSession>();

    vi.mocked(loadSession).mockImplementation(async (sessionId: string) => {
      if (loadPhase === 'initial') {
        return sessionId === 'session-a' ? serializedSessionA : serializedSessionB;
      }

      if (loadPhase === 'background-1') {
        return sessionId === 'session-a' ? background1A.promise : background1B.promise;
      }

      return sessionId === 'session-a' ? serializedSessionA : serializedSessionB;
    });

    // Step 1: Open aggregate before live PTYs are ready.
    // initialLoad loads only session-A from disk and leaves session-B unloaded.
    await refreshers.initialLoad();

    expect(state.allPtys).toHaveLength(1);
    expect(state.allPtys[0]?.ptyId).toBe('saved:session-a:pane-a1');
    expect(state.allPtys[0]?.sessionId).toBe('session-a');

    // Step 2: Background full refresh starts and remains in flight.
    loadPhase = 'background-1';
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
    currentPaneOrder = new Map([['pane-a1', 0]]);
    hintedSessionId = 'session-a';
    hintedFocusedPaneId = 'pane-a1';

    const backgroundRefresh = refreshers.refreshPtys();

    // Give refreshPtys() a turn so it enters the in-flight loadSession Promise.all.
    await Promise.resolve();
    await Promise.resolve();

    // Step 3: Rapid j/k navigation while the background refresh is still in flight.
    // The live layout/PTXs have already switched to session-B, but the active
    // session hint still lags behind as session-A.
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
    currentPaneOrder = new Map([['pane-b1', 0]]);
    hintedSessionId = 'session-a'; // stale active-session hint
    hintedFocusedPaneId = 'pane-b1';

    // Queue a second refresh exactly like the real app does when another
    // aggregate refresh request lands while one is already running.
    loadPhase = 'background-2';
    void refreshers.refreshPtys();

    // Finish the first background refresh; the queued second refresh will run next.
    background1A.resolve(serializedSessionA);
    background1B.resolve(serializedSessionB);
    await backgroundRefresh;

    const wrongSessionPtys = getWronglyGroupedPtys(state);

    // This is the invariant the user cares about: no live PTY may ever be
    // attributed to the wrong session group, even transiently.
    expect(wrongSessionPtys).toEqual([]);

    const liveSessionBPty = state.allPtys.find((pty) => pty.ptyId === 'pty-b1');
    expect(liveSessionBPty?.sessionId).toBe('session-b');

    const sessionAEntries = state.allPtys.filter((pty) => pty.sessionId === 'session-a');
    expect(sessionAEntries.every((pty) => pty.ptyId !== 'pty-b1')).toBe(true);
  });

  test('authoritative ownership must override stale sessionId stamped onto currentSessionPtys', async () => {
    const [state, setState] = createStore<AggregateViewState>(createFreshState());
    const refreshState: RefreshState = {
      refreshInProgress: false,
      pendingFullRefresh: false,
    };

    let hintedSessionId = 'session-a';
    let currentPaneOrder = new Map<string, number>([['pane-a1', 0]]);
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

    const refreshers = createAggregateViewRefreshers(
      state,
      setState,
      refreshState,
      (ptyId) => resolvedOwners.get(ptyId) ?? null,
      () => ({ sessionId: hintedSessionId, lastActiveWorkspaceId: 1, focusedPaneId: 'pane-a1' }),
      () => currentPaneOrder,
      () => currentSessionPtys
    );

    vi.mocked(loadSession).mockResolvedValueOnce(serializedSessionA);
    await refreshers.initialLoad();

    const backgroundA = createDeferred<SerializedSession>();
    const backgroundB = createDeferred<SerializedSession>();
    vi.mocked(loadSession).mockImplementation(async (sessionId: string) => {
      return sessionId === 'session-a' ? backgroundA.promise : backgroundB.promise;
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

    const backgroundRefresh = refreshers.refreshPtys();
    await Promise.resolve();
    await Promise.resolve();

    // Simulate the actual stale-stamp race:
    // getCurrentSessionPtys has already stamped this PTY with the stale active
    // session (session-a), but authoritative ownership resolution already knows
    // it belongs to session-b.
    currentSessionPtys = [
      {
        ptyId: 'pty-b1',
        paneId: 'pane-b1',
        workspaceId: 1,
        title: 'b1',
        cwd: '/b',
        sessionId: 'session-a',
      },
    ];
    resolvedOwners = new Map([
      ['pty-b1', { sessionId: 'session-b', paneId: 'pane-b1', workspaceId: 1 }],
    ]);

    void refreshers.refreshPtys();

    backgroundA.resolve(serializedSessionA);
    backgroundB.resolve(serializedSessionB);
    await backgroundRefresh;

    const liveSessionBPty = state.allPtys.find((pty) => pty.ptyId === 'pty-b1');
    expect(liveSessionBPty?.sessionId).toBe('session-b');
    expect(
      state.allPtys.some((pty) => pty.ptyId === 'pty-b1' && pty.sessionId === 'session-a')
    ).toBe(false);
  });

  test('existingCurrentSessionPtys must not preserve a contaminated wrong-session live entry', async () => {
    const wrongLiveEntry: PtyInfo = {
      ptyId: 'pty-b1',
      paneId: 'pane-b1',
      sessionId: 'session-a',
      cwd: '/b',
      foregroundProcess: 'bash',
      shell: 'bash',
      title: 'b1',
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
      allPtys: [wrongLiveEntry],
      allPtysIndex: new Map([['pty-b1', 0]]),
      allSessions: new Map([
        ['session-a', sessionA],
        ['session-b', sessionB],
      ]),
    });

    const refreshState: RefreshState = {
      refreshInProgress: false,
      pendingFullRefresh: false,
    };

    let currentSessionPtys: Array<{
      ptyId: string;
      paneId: string;
      workspaceId: number;
      title?: string;
      cwd?: string;
      sessionId?: string;
    }> = [];

    const refreshers = createAggregateViewRefreshers(
      state,
      setState,
      refreshState,
      (ptyId) =>
        ptyId === 'pty-b1' ? { sessionId: 'session-b', paneId: 'pane-b1', workspaceId: 1 } : null,
      () => ({ sessionId: 'session-a', lastActiveWorkspaceId: 1, focusedPaneId: 'pane-a1' }),
      () => new Map<string, number>(),
      () => currentSessionPtys
    );

    vi.mocked(loadSession).mockImplementation(async (sessionId: string) => {
      return sessionId === 'session-a' ? serializedSessionA : serializedSessionB;
    });

    await refreshers.refreshPtys();

    expect(
      state.allPtys.some((pty) => pty.ptyId === 'pty-b1' && pty.sessionId === 'session-a')
    ).toBe(false);
    expect(
      state.allPtys.some((pty) => pty.sessionId === 'session-b' && pty.paneId === 'pane-b1')
    ).toBe(true);
  });
});
