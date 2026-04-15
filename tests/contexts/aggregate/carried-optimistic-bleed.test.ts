/**
 * Reproduces the carriedOptimisticPtys pane-key mismatch bleed.
 *
 * When insertPlaceholderRow creates an optimistic entry with a WRONG sessionId
 * (e.g. from a stale ptyToSessionMap or aggregateSessionMappings), and then
 * applySnapshot runs, the pane-key filter uses the WRONG sessionId for the
 * optimistic entry and the CORRECT sessionId for the snapshot entry.
 * Since the keys don't match, the wrong entry is carried forward alongside
 * the correct snapshot entry → DUPLICATE under wrong session group → BLEED.
 *
 * The fix: carriedOptimisticPtys must also check pane ID regardless of sessionId,
 * so that a snapshot entry for the same pane in ANY session blocks the carry.
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

function makePtyInfo(overrides: Partial<PtyInfo> & { ptyId: string; sessionId: string }): PtyInfo {
  return {
    cwd: '/cwd',
    foregroundProcess: 'bash',
    shell: 'bash',
    title: 'title',
    workspaceId: 1,
    sessionMetadata: overrides.sessionId === 'session-a' ? sessionA : sessionB,
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
    paneId: undefined,
    ...overrides,
  };
}

describe('carriedOptimisticPtys bleed: wrong-sessionId placeholder survives applySnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMetadataBatchMock.mockResolvedValue(new Map());
    getPtyMetadataMock.mockImplementation(async (ptyId: string) => {
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
  });

  test('applySnapshot must not carry an optimistic entry whose paneId matches a snapshot entry under a different sessionId (same real ptyId)', async () => {
    /**
     * Setup: allPtys has a live optimistic entry for pty-b1 under session-a
     * (wrong sessionId). The entry is in pendingPtyIds so applySnapshot would
     * consider carrying it.
     *
     * The snapshot has a saved: entry for pane-b1 under session-b (correct).
     * The snapshot's ptyId is 'pty-b1' (same as the wrong entry).
     *
     * Because the ptyId matches, snapshotPtyIds.has('pty-b1') is true,
     * so the wrong entry is NOT carried. This case is already handled.
     */

    const wrongEntry = makePtyInfo({
      ptyId: 'pty-b1',
      sessionId: 'session-a',
      paneId: 'pane-b1',
      title: '...',
    });

    const [state, setState] = createStore<AggregateViewState>({
      ...createFreshState(),
      allPtys: [wrongEntry],
      allPtysIndex: new Map([['pty-b1', 0]]),
      pendingPtyIds: new Set(['pty-b1']),
      recentlyAddedPtyIds: new Set(),
      allSessions: new Map([
        ['session-a', sessionA],
        ['session-b', sessionB],
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
      (ptyId) =>
        ptyId === 'pty-b1' ? { sessionId: 'session-b', paneId: 'pane-b1', workspaceId: 1 } : null,
      () => ({ sessionId: 'session-b', lastActiveWorkspaceId: 1, focusedPaneId: 'pane-b1' }),
      () => new Map([['pane-b1', 0]]),
      () => [
        {
          ptyId: 'pty-b1',
          paneId: 'pane-b1',
          workspaceId: 1,
          title: 'b1',
          cwd: '/b',
          sessionId: 'session-b',
        },
      ]
    );

    vi.mocked(listSessionsResult).mockResolvedValue([sessionA, sessionB]);
    vi.mocked(loadSession).mockImplementation(async (id: string) =>
      id === 'session-a' ? serializedSessionA : serializedSessionB
    );

    await refreshers.refreshPtys();

    // The wrong entry (session-a) must NOT survive
    expect(
      state.allPtys.some((pty) => pty.ptyId === 'pty-b1' && pty.sessionId === 'session-a')
    ).toBe(false);

    // The correct entry (session-b) must exist
    expect(
      state.allPtys.some((pty) => pty.paneId === 'pane-b1' && pty.sessionId === 'session-b')
    ).toBe(true);

    // No duplicates for pane-b1
    expect(state.allPtys.filter((pty) => pty.paneId === 'pane-b1').length).toBe(1);
  });

  test('CRITICAL: applySnapshot must not carry a wrong-session placeholder when snapshot has saved: entry for the same pane under correct session', async () => {
    /**
     * This is the REAL bleed scenario:
     *
     * 1. A lifecycle event fires for pty-b1 while ownership resolution
     *    returns a stale/wrong session (session-a). insertPlaceholderRow
     *    creates a placeholder with ptyId='pty-b1', sessionId='session-a'.
     *
     * 2. Before the next refresh, the PTY is not in getCurrentSessionPtys
     *    (e.g. it's a background session's PTY, not the active session's).
     *    The snapshot only has a saved: entry for pane-b1 under session-b.
     *
     * 3. applySnapshot:
     *    - snapshotPtyIds = { 'saved:session-b:pane-b1', ... }
     *    - 'pty-b1' is NOT in snapshotPtyIds (different ptyId)
     *    - Pane key of wrong entry: (session-a, pane-b1)
     *    - Pane key of snapshot entry: (session-b, pane-b1)
     *    - Keys DON'T match → wrong entry IS carried!
     *
     * Result: pty-b1 appears under BOTH session-a AND session-b → BLEED.
     *
     * The fix: carriedOptimisticPtys must also check if ANY snapshot entry
     * covers the same paneId, regardless of sessionId.
     */

    const wrongPlaceholder = makePtyInfo({
      ptyId: 'pty-b1',
      sessionId: 'session-a', // WRONG
      paneId: 'pane-b1',
      title: '...',
    });

    const [state, setState] = createStore<AggregateViewState>({
      ...createFreshState(),
      allPtys: [wrongPlaceholder],
      allPtysIndex: new Map([['pty-b1', 0]]),
      pendingPtyIds: new Set(['pty-b1']),
      recentlyAddedPtyIds: new Set(),
      allSessions: new Map([
        ['session-a', sessionA],
        ['session-b', sessionB],
      ]),
    });

    const refreshState: RefreshState = {
      refreshInProgress: false,
      pendingFullRefresh: false,
    };

    // pty-b1 is NOT in getCurrentSessionPtys (it's a background session's PTY)
    // so the snapshot only has a saved: entry from disk for session-b.
    const refreshers = createAggregateViewRefreshers(
      state,
      setState,
      refreshState,
      (ptyId) =>
        ptyId === 'pty-b1' ? { sessionId: 'session-b', paneId: 'pane-b1', workspaceId: 1 } : null,
      () => ({ sessionId: 'session-a', lastActiveWorkspaceId: 1, focusedPaneId: 'pane-a1' }),
      () => new Map([['pane-a1', 0]]),
      () => [] // no live PTYs for the active session that include pty-b1
    );

    vi.mocked(listSessionsResult).mockResolvedValue([sessionA, sessionB]);
    vi.mocked(loadSession).mockImplementation(async (id: string) =>
      id === 'session-a' ? serializedSessionA : serializedSessionB
    );

    await refreshers.refreshPtys();

    // The wrong placeholder must NOT survive under session-a
    expect(
      state.allPtys.some((pty) => pty.ptyId === 'pty-b1' && pty.sessionId === 'session-a')
    ).toBe(false);

    // pane-b1 must appear only under session-b
    expect(
      state.allPtys.some((pty) => pty.paneId === 'pane-b1' && pty.sessionId === 'session-b')
    ).toBe(true);
    // No duplicates for pane-b1 across any session
    expect(state.allPtys.filter((pty) => pty.paneId === 'pane-b1').length).toBe(1);
  });

  test('applySnapshot must not carry a wrong-session live entry even when pane keys mismatch', async () => {
    /**
     * Variant: wrong entry is in recentlyAddedPtyIds (not pendingPtyIds).
     * The snapshot has a saved: entry for the same pane under correct session.
     * The pane-key mismatch should NOT protect the wrong entry from being dropped.
     */
    const wrongEntry = makePtyInfo({
      ptyId: 'pty-b1',
      sessionId: 'session-a',
      paneId: 'pane-b1',
      title: 'b1',
      cwd: '/b',
      foregroundProcess: 'vim',
    });

    const [state, setState] = createStore<AggregateViewState>({
      ...createFreshState(),
      allPtys: [wrongEntry],
      allPtysIndex: new Map([['pty-b1', 0]]),
      pendingPtyIds: new Set(),
      recentlyAddedPtyIds: new Set(['pty-b1']),
      allSessions: new Map([
        ['session-a', sessionA],
        ['session-b', sessionB],
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
      (ptyId) =>
        ptyId === 'pty-b1' ? { sessionId: 'session-b', paneId: 'pane-b1', workspaceId: 1 } : null,
      () => ({ sessionId: 'session-b', lastActiveWorkspaceId: 1, focusedPaneId: 'pane-b1' }),
      () => new Map([['pane-b1', 0]]),
      () => [
        {
          ptyId: 'pty-b1',
          paneId: 'pane-b1',
          workspaceId: 1,
          title: 'b1',
          cwd: '/b',
          sessionId: 'session-b',
        },
      ]
    );

    vi.mocked(listSessionsResult).mockResolvedValue([sessionA, sessionB]);
    vi.mocked(loadSession).mockImplementation(async (id: string) =>
      id === 'session-a' ? serializedSessionA : serializedSessionB
    );

    await refreshers.refreshPtys();

    expect(
      state.allPtys.some((pty) => pty.ptyId === 'pty-b1' && pty.sessionId === 'session-a')
    ).toBe(false);

    expect(
      state.allPtys.some((pty) => pty.paneId === 'pane-b1' && pty.sessionId === 'session-b')
    ).toBe(true);

    expect(state.allPtys.filter((pty) => pty.paneId === 'pane-b1').length).toBe(1);
  });

  test("regression: applySnapshot must still carry a legitimate optimistic entry whose paneId coincidentally matches another session's pane", async () => {
    const sessionCOptimistic = makePtyInfo({
      ptyId: 'pty-c1',
      sessionId: 'session-a',
      paneId: 'pane-b1',
      title: '...',
    });

    const [state, setState] = createStore<AggregateViewState>({
      ...createFreshState(),
      allPtys: [sessionCOptimistic],
      allPtysIndex: new Map([['pty-c1', 0]]),
      pendingPtyIds: new Set(['pty-c1']),
      recentlyAddedPtyIds: new Set(),
      allSessions: new Map([
        ['session-a', sessionA],
        ['session-b', sessionB],
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
      (ptyId) =>
        ptyId === 'pty-c1' ? { sessionId: 'session-a', paneId: 'pane-b1', workspaceId: 1 } : null,
      () => ({ sessionId: 'session-a', lastActiveWorkspaceId: 1, focusedPaneId: 'pane-a1' }),
      () => new Map([['pane-a1', 0]]),
      () => []
    );

    vi.mocked(listSessionsResult).mockResolvedValue([sessionA, sessionB]);
    vi.mocked(loadSession).mockImplementation(async (id: string) =>
      id === 'session-a' ? serializedSessionA : serializedSessionB
    );

    await refreshers.refreshPtys();

    expect(
      state.allPtys.some((pty) => pty.ptyId === 'pty-c1' && pty.sessionId === 'session-a')
    ).toBe(true);
  });

  test('cross-session reconciliation in applySnapshot fixes wrong sessionId on live entries', async () => {
    /**
     * Simulates: a live PTY entry was stamped with sessionId 'session-a'
     * (from stale ptyToSessionMap), but authoritative ownership says
     * 'session-b'. The snapshot has a saved: entry for the same pane
     * under 'session-b'. After applySnapshot's dedup step, the live entry
     * still has wrong sessionId. The cross-session reconciliation step
     * must fix it and re-dedup.
     */
    const wrongSessionLive = makePtyInfo({
      ptyId: 'pty-b1',
      sessionId: 'session-a',
      paneId: 'pane-b1',
      title: '...',
    });

    const [state, setState] = createStore<AggregateViewState>({
      ...createFreshState(),
      allPtys: [wrongSessionLive],
      allPtysIndex: new Map([['pty-b1', 0]]),
      pendingPtyIds: new Set(['pty-b1']),
      recentlyAddedPtyIds: new Set(),
      allSessions: new Map([
        ['session-a', sessionA],
        ['session-b', sessionB],
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
      // Ownership says pty-b1 belongs to session-b
      (ptyId) =>
        ptyId === 'pty-b1' ? { sessionId: 'session-b', paneId: 'pane-b1', workspaceId: 1 } : null,
      () => ({ sessionId: 'session-a', lastActiveWorkspaceId: 1, focusedPaneId: 'pane-a1' }),
      () => new Map([['pane-a1', 0]]),
      () => []
    );

    vi.mocked(listSessionsResult).mockResolvedValue([sessionA, sessionB]);
    vi.mocked(loadSession).mockImplementation(async (id: string) =>
      id === 'session-a' ? serializedSessionA : serializedSessionB
    );

    await refreshers.refreshPtys();

    // The live entry must be reassigned to session-b
    expect(
      state.allPtys.some((pty) => pty.ptyId === 'pty-b1' && pty.sessionId === 'session-b')
    ).toBe(true);

    // No entry for pane-b1 under session-a
    expect(
      state.allPtys.some((pty) => pty.paneId === 'pane-b1' && pty.sessionId === 'session-a')
    ).toBe(false);
  });
});
