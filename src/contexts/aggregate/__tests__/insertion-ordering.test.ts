/**
 * Executable spec for aggregate PTY ordering.
 *
 * The important invariants are:
 * - once a PTY is inserted adjacent to a selected PTY, later refreshes must preserve that order
 * - tombstoned PTYs must be filtered in every load path, including the first aggregate load
 * - sortOrderHint from pending pane creations is preserved through applySnapshot
 * - handlePtyCreated triggers refreshPtys (single-writer principle)
 */
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { createStore, produce } from 'solid-js/store';

import {
  createAggregateViewRefreshers,
  createLifecycleHandlers,
} from '../../aggregate-view-subscriptions';
import { getSessionPaneOrder, recomputeMatches, recomputeTree } from '../../aggregate';
import { initialState, type AggregateViewState } from '../../aggregate-view-types';

vi.mock('../../../effect/bridge/aggregate-bridge', () => ({
  listAllPtyIds: vi.fn(),
  listAllPtysWithMetadata: vi.fn(),
  getPtyMetadata: vi.fn(),
  getAggregateSessionPtyMapping: vi.fn(),
  removeAggregateSessionMappingForPty: vi.fn(),
}));

vi.mock('../../../effect/bridge/session-bridge', () => ({
  listSessionsResult: vi.fn(),
  getSessionSummaryResult: vi.fn(),
  loadSession: vi.fn(),
}));

vi.mock('../../../effect/bridge/pty-bridge', () => ({
  subscribeToPtyLifecycle: vi.fn(() => Promise.resolve(() => {})),
  subscribeToAllTitleChanges: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock('../../../effect/services/pty/helpers', () => ({
  getGitInfo: vi.fn(),
  getGitDiffStats: vi.fn(),
}));

const getMetadataMock = vi.fn(() => Promise.resolve(undefined));
const getMetadataBatchMock = vi.fn(() => Promise.resolve(new Map()));

vi.mock('../../git-metadata-cache', () => ({
  getGlobalGitMetadataCache: vi.fn(() => ({
    getMetadata: getMetadataMock,
    getMetadataBatch: getMetadataBatchMock,
  })),
}));

import {
  getAggregateSessionPtyMapping,
  getPtyMetadata,
  listAllPtyIds,
  listAllPtysWithMetadata,
} from '../../../effect/bridge/aggregate-bridge';
import {
  getSessionSummaryResult,
  listSessionsResult,
  loadSession,
} from '../../../effect/bridge/session-bridge';

const session = {
  id: 'session-1',
  name: 'Session 1',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const serializedSession = {
  id: 'session-1',
  name: 'Session 1',
  activeWorkspaceId: 1,
  workspaces: [
    {
      id: 1,
      layoutMode: 'stacked' as const,
      focusedPaneId: 'pane-1',
      mainPane: { id: 'pane-1', cwd: '/tmp', title: 'one' },
      stackPanes: [{ id: 'pane-2', cwd: '/tmp', title: 'two' }],
      activeStackIndex: 0,
    },
  ],
  cwdMap: new Map([
    ['pane-1', '/tmp'],
    ['pane-2', '/tmp'],
  ]),
  paneToPtyMap: new Map([
    ['pane-1', 'pty-1'],
    ['pane-2', 'pty-2'],
  ]),
};

const createFreshState = (): AggregateViewState => ({
  ...initialState,
  showAggregateView: true,
  allPtys: [],
  matchedPtys: [],
  allPtysIndex: new Map(),
  treeRoot: [],
  flattenedTree: [],
  flattenedTreeIndex: new Map(),
  expandedSessionIds: new Set(),
  sessionLoadStates: new Map(),
  sessionPaneOrderIndex: new Map(),
  manualSessionOrder: [],
  loadingSessionIds: new Set(),
  loadAttemptedSessionIds: new Set(),
  allSessions: new Map(),
  pendingPtyIds: new Set(),
  recentlyAddedPtyIds: new Set(),
  deletedPtyIds: new Set(),
});

const createHarness = () => {
  const [state, setState] = createStore<AggregateViewState>(createFreshState());

  const refreshState = {
    refreshInProgress: false,
    pendingFullRefresh: false,
  };

  const ownershipByPtyId = new Map([
    ['pty-1', { sessionId: 'session-1', paneId: 'pane-1', workspaceId: 1 }],
    ['pty-2', { sessionId: 'session-1', paneId: 'pane-2', workspaceId: 1 }],
    ['pty-new', { sessionId: 'session-1', paneId: 'pane-3', workspaceId: 1 }],
    ['pty-new-2', { sessionId: 'session-1', paneId: 'pane-4', workspaceId: 1 }],
    ['pty-deleted', { sessionId: 'session-1', paneId: 'pane-deleted', workspaceId: 1 }],
  ]);

  let currentSessionPaneOrder = new Map<string, number>([
    ['pane-1', 0],
    ['pane-2', 1],
  ]);
  let currentSessionPtys = [
    { ptyId: 'pty-1', paneId: 'pane-1', workspaceId: 1, title: 'one', cwd: '/tmp' },
    { ptyId: 'pty-2', paneId: 'pane-2', workspaceId: 1, title: 'two', cwd: '/tmp' },
  ];

  const resolvePtyOwnership = (ptyId: string) => ownershipByPtyId.get(ptyId) ?? null;
  const getCurrentSessionHints = () => ({
    sessionId: 'session-1',
    lastActiveWorkspaceId: 1,
    focusedPaneId: 'pane-1',
  });
  const getCurrentSessionPaneOrder = () => currentSessionPaneOrder;
  const getCurrentSessionPtys = () => currentSessionPtys;

  const refreshers = createAggregateViewRefreshers(
    state,
    setState,
    refreshState,
    resolvePtyOwnership,
    getCurrentSessionHints,
    getCurrentSessionPaneOrder,
    getCurrentSessionPtys
  );

  const lifecycleHandlers = createLifecycleHandlers(state, setState, {
    resolvePtyOwnership,
    getCurrentSessionHints,
    refreshPtys: refreshers.refreshPtys,
    refreshActiveSession: refreshers.refreshActiveSession,
  });

  return {
    state,
    setState,
    refreshers,
    lifecycleHandlers,
    setOwnership: (
      ptyId: string,
      ownership: { sessionId: string; paneId: string; workspaceId: number } | null
    ) => {
      if (!ownership) {
        ownershipByPtyId.delete(ptyId);
        return;
      }
      ownershipByPtyId.set(ptyId, ownership);
    },
    setCurrentSessionPaneOrder: (next: Map<string, number>) => {
      currentSessionPaneOrder = next;
    },
    setCurrentSessionPtys: (
      next: Array<{
        ptyId: string;
        paneId: string;
        workspaceId: number;
        title?: string;
        cwd?: string;
      }>
    ) => {
      currentSessionPtys = next;
    },
  };
};

/** Visible PTY rows in tree order. */
const getVisiblePtyIds = (state: AggregateViewState) =>
  state.flattenedTree
    .filter((item) => item.node.type === 'pty')
    .map((item) => item.node.ptyInfo.ptyId);

describe('aggregate insertion ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMetadataMock.mockClear();
    getMetadataBatchMock.mockClear();

    vi.mocked(listSessionsResult).mockResolvedValue([session]);
    vi.mocked(getSessionSummaryResult).mockResolvedValue({
      workspaceCount: 1,
      paneCount: 2,
    });
    vi.mocked(loadSession).mockResolvedValue(serializedSession);
    vi.mocked(getAggregateSessionPtyMapping).mockResolvedValue({
      sessionId: 'session-1',
      mapping: new Map([
        ['pane-1', 'pty-1'],
        ['pane-2', 'pty-2'],
      ]),
      stalePaneIds: [],
    });
    vi.mocked(listAllPtyIds).mockResolvedValue(['pty-1', 'pty-2', 'pty-new']);
    vi.mocked(getPtyMetadata).mockImplementation(async (ptyId: string) => {
      if (ptyId !== 'pty-new') {
        return null;
      }

      return {
        ptyId: 'pty-new',
        cwd: '/tmp',
        foregroundProcess: 'bash',
        shell: '/bin/bash',
        title: 'new',
        workspaceId: 1,
        paneId: 'pane-3',
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
    vi.mocked(listAllPtysWithMetadata).mockResolvedValue([
      {
        ptyId: 'pty-1',
        cwd: '/tmp',
        foregroundProcess: 'bash',
        shell: '/bin/bash',
        title: 'one',
        workspaceId: 1,
        paneId: 'pane-1',
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
      },
      {
        ptyId: 'pty-2',
        cwd: '/tmp',
        foregroundProcess: 'bash',
        shell: '/bin/bash',
        title: 'two',
        workspaceId: 1,
        paneId: 'pane-2',
        gitBranch: undefined,
        gitDiffStats: undefined,
        gitDirty: false,
        gitStaged: 0,
        gitUnstaged: 0,
        gitUntracked: 0,
        gitConflicted: 0,
        gitAhead: undefined,
        gitBelow: undefined,
        gitStashCount: undefined,
        gitState: undefined,
        gitDetached: false,
        gitRepoKey: undefined,
        gitIsWorktree: false,
        gitCommonDir: null,
      },
      {
        ptyId: 'pty-new',
        cwd: '/tmp',
        foregroundProcess: 'bash',
        shell: '/bin/bash',
        title: 'new',
        workspaceId: 1,
        paneId: 'pane-3',
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
      },
    ]);
  });

  it('new PTY appears via refreshPtys after handlePtyCreated, with correct title', async () => {
    /**
     * Single-writer: handlePtyCreated triggers refreshPtys, which rebuilds
     * the snapshot from getCurrentSessionPtys. The PTY appears with its
     * live metadata (title 'new'), not a '...' placeholder.
     */
    const { state, setState, refreshers, lifecycleHandlers, setCurrentSessionPtys } =
      createHarness();

    await refreshers.initialLoad();

    setState(
      produce((s) => {
        s.pendingPaneCreations = [
          {
            id: 'pending-1',
            sessionId: 'session-1',
            insertAfterPtyId: 'pty-1',
            insertAfterPaneId: 'pane-1',
            pendingPtyId: 'pty-new',
            pendingPaneId: 'pane-3',
            sortOrderHint: 0.5,
          },
        ];
      })
    );

    // Before the PTY is in currentSessionPtys, handlePtyCreated triggers
    // a refresh that won't include the new PTY yet. Update the harness
    // to include the new PTY in the current session PTYs (simulating
    // setPanePty having already run before the lifecycle microtask).
    setCurrentSessionPtys([
      { ptyId: 'pty-1', paneId: 'pane-1', workspaceId: 1, title: 'one', cwd: '/tmp' },
      { ptyId: 'pty-new', paneId: 'pane-3', workspaceId: 1, title: 'new', cwd: '/tmp' },
      { ptyId: 'pty-2', paneId: 'pane-2', workspaceId: 1, title: 'two', cwd: '/tmp' },
    ]);

    await lifecycleHandlers.handlePtyCreated('pty-new');

    // The PTY appears in allPtys with its live metadata (not '...')
    const newPty = state.allPtys.find((pty) => pty.ptyId === 'pty-new');
    expect(newPty).toBeDefined();
    expect(newPty?.title).toBe('new');

    // The pending pane creation was cleaned up
    expect(state.pendingPaneCreations).toHaveLength(0);
  });

  it('pending pane creation sortOrderHint is preserved through refresh', async () => {
    /**
     * When a pending pane creation has a sortOrderHint, applySnapshot
     * preserves it so the pane appears in the correct position.
     */
    const {
      state,
      setState,
      refreshers,
      lifecycleHandlers,
      setCurrentSessionPaneOrder,
      setCurrentSessionPtys,
    } = createHarness();

    await refreshers.initialLoad();

    setState(
      produce((s) => {
        s.pendingPaneCreations = [
          {
            id: 'pending-1',
            sessionId: 'session-1',
            insertAfterPtyId: 'pty-1',
            insertAfterPaneId: 'pane-1',
            pendingPtyId: 'pty-new',
            pendingPaneId: 'pane-3',
            sortOrderHint: 0.5,
          },
        ];
      })
    );

    setCurrentSessionPtys([
      { ptyId: 'pty-1', paneId: 'pane-1', workspaceId: 1, title: 'one', cwd: '/tmp' },
      { ptyId: 'pty-new', paneId: 'pane-3', workspaceId: 1, title: 'new', cwd: '/tmp' },
      { ptyId: 'pty-2', paneId: 'pane-2', workspaceId: 1, title: 'two', cwd: '/tmp' },
    ]);
    setCurrentSessionPaneOrder(
      new Map([
        ['pane-1', 0],
        ['pane-2', 1],
        ['pane-3', 2], // layout reports end position
      ])
    );

    await lifecycleHandlers.handlePtyCreated('pty-new');

    // sortOrderHint (0.5) should be in sessionPaneOrderIndex, placing the pane
    // between pane-1 (0) and pane-2 (1) instead of at the end (2)
    const paneOrder = getSessionPaneOrder(state.sessionPaneOrderIndex, 'session-1');
    expect(paneOrder.get('pane-3')).toBe(0.5);
  });

  it('snapshot dedupes saved and live entries for the same pane', async () => {
    /**
     * When a saved: entry and a live PTY share the same pane, dedup
     * keeps only the live entry.
     */
    const { state, setState, refreshers, lifecycleHandlers, setCurrentSessionPtys } =
      createHarness();

    await refreshers.initialLoad();

    // Manually add a saved entry for pane-3 (simulating pre-existing state)
    setState(
      produce((s) => {
        s.allPtys.push({
          ptyId: 'saved:session-1:pane-3',
          cwd: '/tmp',
          foregroundProcess: 'htop',
          shell: '/bin/bash',
          workspaceId: 1,
          paneId: 'pane-3',
          sessionId: 'session-1',
          sessionMetadata: session,
          title: 'saved-shell',
          sortOrderHint: 0.5,
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
        s.allPtysIndex = new Map(s.allPtys.map((pty, index) => [pty.ptyId, index] as const));
        recomputeMatches(s);
        recomputeTree(s);
      })
    );

    // Now the live PTY appears in currentSessionPtys
    setCurrentSessionPtys([
      { ptyId: 'pty-1', paneId: 'pane-1', workspaceId: 1, title: 'one', cwd: '/tmp' },
      { ptyId: 'pty-new', paneId: 'pane-3', workspaceId: 1, title: 'new', cwd: '/tmp' },
      { ptyId: 'pty-2', paneId: 'pane-2', workspaceId: 1, title: 'two', cwd: '/tmp' },
    ]);

    setState(
      produce((s) => {
        s.pendingPaneCreations = [
          {
            id: 'pending-1',
            sessionId: 'session-1',
            insertAfterPtyId: 'pty-1',
            insertAfterPaneId: 'pane-1',
            pendingPtyId: 'pty-new',
            pendingPaneId: 'pane-3',
            sortOrderHint: 0.5,
          },
        ];
      })
    );

    await lifecycleHandlers.handlePtyCreated('pty-new');

    // After refresh, there should be only one entry for pane-3
    expect(state.allPtys.filter((pty) => pty.paneId === 'pane-3')).toHaveLength(1);
    // And it should be the live entry, not the saved entry
    expect(state.allPtys.find((pty) => pty.paneId === 'pane-3')?.ptyId).toBe('pty-new');
  });

  it('keeps PTY adjacent after the selected PTY across refreshes', async () => {
    /**
     * After handlePtyCreated + refreshPtys, the new PTY appears adjacent
     * to the selected PTY. A subsequent refresh preserves the position.
     */
    const {
      state,
      setState,
      refreshers,
      lifecycleHandlers,
      setCurrentSessionPaneOrder,
      setCurrentSessionPtys,
    } = createHarness();

    await refreshers.initialLoad();

    expect(getSessionPaneOrder(state.sessionPaneOrderIndex, 'session-1')).toEqual(
      new Map([
        ['pane-1', 0],
        ['pane-2', 1],
      ])
    );

    setState(
      produce((s) => {
        s.pendingPaneCreations = [
          {
            id: 'pending-1',
            sessionId: 'session-1',
            insertAfterPtyId: 'pty-1',
            insertAfterPaneId: 'pane-1',
            pendingPtyId: 'pty-new',
            pendingPaneId: 'pane-3',
            sortOrderHint: 0.5,
          },
        ];
      })
    );

    setCurrentSessionPtys([
      { ptyId: 'pty-1', paneId: 'pane-1', workspaceId: 1, title: 'one', cwd: '/tmp' },
      { ptyId: 'pty-new', paneId: 'pane-3', workspaceId: 1, title: 'new', cwd: '/tmp' },
      { ptyId: 'pty-2', paneId: 'pane-2', workspaceId: 1, title: 'two', cwd: '/tmp' },
    ]);

    await lifecycleHandlers.handlePtyCreated('pty-new');

    // The sortOrderHint is persisted in sessionPaneOrderIndex
    expect(getSessionPaneOrder(state.sessionPaneOrderIndex, 'session-1').get('pane-3')).toBe(0.5);
    expect(getVisiblePtyIds(state)).toEqual(['pty-1', 'pty-new', 'pty-2']);

    // Layout now reports pane-3 at end position
    setCurrentSessionPaneOrder(
      new Map([
        ['pane-1', 0],
        ['pane-2', 1],
        ['pane-3', 2],
      ])
    );

    await refreshers.refreshPtys();

    // Pane should still be adjacent — sortOrderHint (0.5) persists
    expect(getVisiblePtyIds(state)).toEqual(['pty-1', 'pty-new', 'pty-2']);
  });

  it('preserves adjacency for overlapping pane creations', async () => {
    /**
     * Two pending pane creations with different sortOrderHints:
     * after handlePtyCreated for both, each appears at its
     * intended position.
     */
    const { state, setState, refreshers, lifecycleHandlers, setCurrentSessionPtys } =
      createHarness();

    vi.mocked(getPtyMetadata).mockImplementation(async (ptyId: string) => {
      if (ptyId === 'pty-new') {
        return {
          ptyId: 'pty-new',
          cwd: '/tmp',
          foregroundProcess: 'bash',
          shell: '/bin/bash',
          title: 'new',
          workspaceId: 1,
          paneId: 'pane-3',
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
      }

      if (ptyId === 'pty-new-2') {
        return {
          ptyId: 'pty-new-2',
          cwd: '/tmp',
          foregroundProcess: 'bash',
          shell: '/bin/bash',
          title: 'new-2',
          workspaceId: 1,
          paneId: 'pane-4',
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
      }

      return null;
    });

    await refreshers.initialLoad();

    setState(
      produce((s) => {
        s.pendingPaneCreations = [
          {
            id: 'pending-1',
            sessionId: 'session-1',
            insertAfterPtyId: 'pty-1',
            insertAfterPaneId: 'pane-1',
            pendingPtyId: 'pty-new',
            pendingPaneId: 'pane-3',
            sortOrderHint: 0.5,
          },
          {
            id: 'pending-2',
            sessionId: 'session-1',
            insertAfterPtyId: 'pty-1',
            insertAfterPaneId: 'pane-1',
            pendingPtyId: 'pty-new-2',
            pendingPaneId: 'pane-4',
            sortOrderHint: 0.75,
          },
        ];
      })
    );

    setCurrentSessionPtys([
      { ptyId: 'pty-1', paneId: 'pane-1', workspaceId: 1, title: 'one', cwd: '/tmp' },
      { ptyId: 'pty-new', paneId: 'pane-3', workspaceId: 1, title: 'new', cwd: '/tmp' },
      { ptyId: 'pty-new-2', paneId: 'pane-4', workspaceId: 1, title: 'new-2', cwd: '/tmp' },
      { ptyId: 'pty-2', paneId: 'pane-2', workspaceId: 1, title: 'two', cwd: '/tmp' },
    ]);

    await lifecycleHandlers.handlePtyCreated('pty-new-2');
    await lifecycleHandlers.handlePtyCreated('pty-new');

    expect(getSessionPaneOrder(state.sessionPaneOrderIndex, 'session-1').get('pane-3')).toBe(0.5);
    expect(getSessionPaneOrder(state.sessionPaneOrderIndex, 'session-1').get('pane-4')).toBe(0.75);
    expect(getVisiblePtyIds(state)).toEqual(['pty-1', 'pty-new', 'pty-new-2', 'pty-2']);
    expect(state.pendingPaneCreations).toEqual([]);
  });

  it('keeps burst panes adjacent across refreshes', async () => {
    /**
     * Multiple pending pane creations with sortOrderHints:
     * after a refresh that includes them in getCurrentSessionPtys,
     * they maintain their positions.
     */
    const { state, setState, refreshers, setCurrentSessionPaneOrder, setCurrentSessionPtys } =
      createHarness();

    vi.mocked(getPtyMetadata).mockImplementation(async (ptyId: string) => {
      if (!ptyId.startsWith('pty-burst-')) {
        return null;
      }

      const index = Number(ptyId.replace('pty-burst-', ''));
      return {
        ptyId,
        cwd: `/repo-${index}`,
        foregroundProcess: 'bash',
        shell: '/bin/bash',
        title: `burst-${index}`,
        workspaceId: 1,
        paneId: `pane-${index + 2}`,
        gitBranch: undefined,
        gitDiffStats: undefined,
        gitDirty: false,
        gitStaged: 0,
        gitUnstaged: 0,
        gitUntracked: 0,
        gitConflicted: 0,
        gitAhead: undefined,
        gitBelow: undefined,
        gitStashCount: undefined,
        gitState: undefined,
        gitDetached: false,
        gitRepoKey: undefined,
        gitIsWorktree: false,
        gitCommonDir: null,
      };
    });

    await refreshers.initialLoad();

    // Set up pending pane creations with sortOrderHints
    const burstCount = 5;
    const pendingCreations = Array.from({ length: burstCount }, (_, index) => ({
      id: `pending-burst-${index + 1}`,
      sessionId: 'session-1',
      insertAfterPtyId: 'pty-1',
      insertAfterPaneId: 'pane-1',
      pendingPtyId: `pty-burst-${index + 1}`,
      pendingPaneId: `pane-${index + 3}`,
      sortOrderHint: 0.5 + index * 0.1,
    }));

    setState(
      produce((s) => {
        s.pendingPaneCreations = pendingCreations;
      })
    );

    // Layout reports the burst PTYs in order
    setCurrentSessionPaneOrder(
      new Map([
        ['pane-1', 0],
        ['pane-2', 1],
        ['pane-3', 2],
        ['pane-4', 3],
        ['pane-5', 4],
        ['pane-6', 5],
        ['pane-7', 6],
      ])
    );
    setCurrentSessionPtys([
      { ptyId: 'pty-1', paneId: 'pane-1', workspaceId: 1, title: 'one', cwd: '/tmp' },
      ...Array.from({ length: burstCount }, (_, index) => ({
        ptyId: `pty-burst-${index + 1}`,
        paneId: `pane-${index + 3}`,
        workspaceId: 1,
        title: `burst-${index + 1}`,
        cwd: `/repo-${index + 1}`,
      })),
      { ptyId: 'pty-2', paneId: 'pane-2', workspaceId: 1, title: 'two', cwd: '/tmp' },
    ]);

    await refreshers.refreshPtys();

    // sortOrderHints from pendingPaneCreations should be applied to the
    // session pane order, keeping the burst panes adjacent
    expect(getVisiblePtyIds(state)).toEqual([
      'pty-1',
      'pty-burst-1',
      'pty-burst-2',
      'pty-burst-3',
      'pty-burst-4',
      'pty-burst-5',
      'pty-2',
    ]);
  });

  it('ignores early lifecycle events when ownership is unknown', async () => {
    /**
     * If resolvePtyOwnership returns null for a PTY, handlePtyCreated
     * should not create any entry. The PTY will appear when the next
     * refresh includes it via getCurrentSessionPtys.
     */
    const { state, setState, refreshers, lifecycleHandlers, setOwnership } = createHarness();

    await refreshers.initialLoad();

    setState(
      produce((s) => {
        s.pendingPaneCreations = [
          {
            id: 'pending-1',
            sessionId: 'session-1',
            insertAfterPtyId: 'pty-1',
            insertAfterPaneId: 'pane-1',
            pendingPtyId: null,
            pendingPaneId: null,
            sortOrderHint: 0.5,
          },
          {
            id: 'pending-2',
            sessionId: 'session-1',
            insertAfterPtyId: 'pty-1',
            insertAfterPaneId: 'pane-1',
            pendingPtyId: null,
            pendingPaneId: null,
            sortOrderHint: 0.75,
          },
        ];
      })
    );

    setOwnership('pty-race', null);
    await lifecycleHandlers.handlePtyCreated('pty-race');

    // No spurious entries added
    expect(state.allPtys.map((pty) => pty.ptyId)).not.toContain('pty-race');
    // Pending pane creations are NOT removed (no matching ptyId)
    expect(state.pendingPaneCreations.map((insertion) => insertion.pendingPtyId)).toEqual([
      null,
      null,
    ]);
  });

  it('git metadata is applied via refresh, not lifecycle path', async () => {
    /**
     * With the single-writer model, git metadata comes from the refresh
     * snapshot (gitCache.getMetadataBatch), not from hydratePlaceholderRow.
     * The PTY appears with correct git metadata immediately after refreshPtys.
     */
    const { state, setState, refreshers, lifecycleHandlers, setCurrentSessionPtys } =
      createHarness();

    // Mock git metadata batch to return correct data
    getMetadataBatchMock.mockImplementation(async (cwds: string[], _opts: any) => {
      const map = new Map();
      for (const cwd of cwds) {
        if (cwd === '/tmp') {
          map.set(cwd, {
            repoKey: '/correct-repo',
            branch: 'correct-branch',
            dirty: false,
            staged: 0,
            unstaged: 0,
            untracked: 0,
            conflicted: 0,
            ahead: 0,
            behind: 0,
            stashCount: 0,
            state: undefined,
            detached: false,
            isWorktree: false,
            commonDir: null,
            diffStats: undefined,
            lastUpdated: Date.now(),
          });
        }
      }
      return map;
    });

    await refreshers.initialLoad();

    setState(
      produce((s) => {
        s.pendingPaneCreations = [
          {
            id: 'pending-1',
            sessionId: 'session-1',
            insertAfterPtyId: 'pty-1',
            insertAfterPaneId: 'pane-1',
            pendingPtyId: 'pty-new',
            pendingPaneId: 'pane-3',
            sortOrderHint: 0.5,
          },
        ];
      })
    );

    setCurrentSessionPtys([
      { ptyId: 'pty-1', paneId: 'pane-1', workspaceId: 1, title: 'one', cwd: '/tmp' },
      { ptyId: 'pty-new', paneId: 'pane-3', workspaceId: 1, title: 'new', cwd: '/tmp' },
      { ptyId: 'pty-2', paneId: 'pane-2', workspaceId: 1, title: 'two', cwd: '/tmp' },
    ]);

    await lifecycleHandlers.handlePtyCreated('pty-new');

    // handlePtyCreated uses the fast refresh (activeSessionOnly + skipGitMetadata),
    // so git metadata is not yet applied. The background full refresh hydrates it.
    await refreshers.refreshPtys();

    // After the full refresh, the PTY should have git metadata
    const newPty = state.allPtys.find((pty) => pty.ptyId === 'pty-new');
    expect(newPty).toBeDefined();
    expect(newPty?.gitBranch).toBe('correct-branch');
    expect(newPty?.gitRepoKey).toBe('/correct-repo');
  });

  it('does not re-add tombstoned PTYs during initial load', async () => {
    const { state, setState } = createHarness();

    setState(
      produce((s) => {
        s.deletedPtyIds.add('pty-deleted');
      })
    );

    const currentSessionPtys = [
      { ptyId: 'pty-deleted', paneId: 'pane-deleted', workspaceId: 1, title: 'gone', cwd: '/tmp' },
      { ptyId: 'pty-1', paneId: 'pane-1', workspaceId: 1, title: 'one', cwd: '/tmp' },
    ];

    const refreshState = {
      refreshInProgress: false,
      pendingFullRefresh: false,
    };

    const refreshersWithDeletedQuickPty = createAggregateViewRefreshers(
      state,
      setState,
      refreshState,
      (ptyId: string) => ({ sessionId: 'session-1', paneId: `pane-${ptyId}`, workspaceId: 1 }),
      () => ({ sessionId: 'session-1', lastActiveWorkspaceId: 1, focusedPaneId: 'pane-1' }),
      () => new Map([['pane-1', 0]]),
      () => currentSessionPtys
    );

    await refreshersWithDeletedQuickPty.initialLoad();

    expect(state.allPtys.map((pty) => pty.ptyId)).toEqual(['pty-1']);
    expect(state.recentlyAddedPtyIds.has('pty-deleted')).toBe(false);
  });

  it('handlePtyCreated uses fast refresh (active session only, no git), then full refresh in background', async () => {
    /**
     * handlePtyCreated should use refreshActiveSession (fast: activeSessionOnly + skipGitMetadata)
     * instead of the full refreshPtys. This makes new PTYs appear instantly.
     * The full refresh is scheduled in the background to hydrate git metadata and other sessions.
     */
    const {
      state,
      setState,
      refreshers,
      lifecycleHandlers,
      setCurrentSessionPtys,
      getCurrentSessionPtys: _,
    } = createHarness();

    await refreshers.initialLoad();

    setState(
      produce((s) => {
        s.pendingPaneCreations = [
          {
            id: 'pending-1',
            sessionId: 'session-1',
            insertAfterPtyId: 'pty-1',
            insertAfterPaneId: 'pane-1',
            pendingPtyId: 'pty-new',
            pendingPaneId: 'pane-3',
            sortOrderHint: 0.5,
          },
        ];
      })
    );

    setCurrentSessionPtys([
      { ptyId: 'pty-1', paneId: 'pane-1', workspaceId: 1, title: 'one', cwd: '/tmp' },
      { ptyId: 'pty-new', paneId: 'pane-3', workspaceId: 1, title: 'new', cwd: '/tmp' },
      { ptyId: 'pty-2', paneId: 'pane-2', workspaceId: 1, title: 'two', cwd: '/tmp' },
    ]);

    // After handlePtyCreated, the PTY should appear in allPtys immediately
    // (via the fast refresh), even though git metadata is not yet hydrated.
    await lifecycleHandlers.handlePtyCreated('pty-new');

    const newPty = state.allPtys.find((pty) => pty.ptyId === 'pty-new');
    expect(newPty).toBeDefined();
    expect(newPty?.title).toBe('new');
    // Git metadata is NOT yet applied (fast refresh skips it)
    expect(newPty?.gitBranch).toBeUndefined();

    // After the full refresh, git metadata is hydrated
    await refreshers.refreshPtys();
    const newPtyAfterFullRefresh = state.allPtys.find((pty) => pty.ptyId === 'pty-new');
    expect(newPtyAfterFullRefresh).toBeDefined();
    // Git metadata would now be populated if the git mock returned data
  });

  it('preserves sort order for rapid sequential PTY creations before paneId is known', async () => {
    /**
     * When multiple PTYs are created rapidly, the second PTY is queued
     * before the first one has resolved its real paneId. Previously,
     * the pending creation's sortOrderHint was only preserved in
     * sessionPaneOrderIndex if pendingPaneId was set — so the second
     * PTY's intended position was lost when applySnapshot rebuilt
     * the pane order. The fix uses a synthetic key (__pending_<id>)
     * so the sort position survives across applySnapshot calls even
     * before the real paneId is known.
     */
    const harness = createHarness();
    const {
      state,
      setState,
      refreshers,
      lifecycleHandlers,
      setCurrentSessionPtys,
      setCurrentSessionPaneOrder,
    } = harness;

    await refreshers.initialLoad();
    expect(getVisiblePtyIds(state)).toEqual(['pty-1', 'pty-2']);

    // First PTY creation: sortOrderHint = 0.5 (between pane-1 at 0 and pane-2 at 1)
    const insertion1Id = 'pending-1';
    setState(
      produce((s) => {
        s.pendingPaneCreations = [
          {
            id: insertion1Id,
            sessionId: 'session-1',
            insertAfterPtyId: 'pty-1',
            insertAfterPaneId: 'pane-1',
            pendingPtyId: null,
            pendingPaneId: null,
            sortOrderHint: 0.5,
          },
        ];
        // Stamp into sessionPaneOrderIndex (like upsertAggregatePendingPaneCreation does)
        const sessionPaneOrder = getSessionPaneOrder(s.sessionPaneOrderIndex, 'session-1');
        sessionPaneOrder.set('__pending_' + insertion1Id, 0.5);
        recomputeMatches(s);
        recomputeTree(s);
      })
    );

    // Second PTY creation: also after pane-1, but PTY1 is still pending.
    // sortOrderHint should be between pane-1 and PTY1.
    const insertion2Id = 'pending-2';
    const sortOrderHint2 = 0.75; // between pane-1 (0) and pane-2 (1), after PTY1 (0.5)
    setState(
      produce((s) => {
        s.pendingPaneCreations = [
          ...s.pendingPaneCreations,
          {
            id: insertion2Id,
            sessionId: 'session-1',
            insertAfterPtyId: 'pty-1',
            insertAfterPaneId: 'pane-1',
            pendingPtyId: null,
            pendingPaneId: null,
            sortOrderHint: sortOrderHint2,
          },
        ];
        const sessionPaneOrder = getSessionPaneOrder(s.sessionPaneOrderIndex, 'session-1');
        sessionPaneOrder.set('__pending_' + insertion2Id, sortOrderHint2);
        recomputeMatches(s);
        recomputeTree(s);
      })
    );

    // Now the first PTY's onCreated fires: real ptyId and paneId are known
    setState(
      produce((s) => {
        s.pendingPaneCreations = s.pendingPaneCreations.map((i) =>
          i.id === insertion1Id ? { ...i, pendingPtyId: 'pty-new', pendingPaneId: 'pane-3' } : i
        );
        // Migrate synthetic key to real paneId (like onCreated -> upsertPendingPaneCreation)
        const sessionPaneOrder = getSessionPaneOrder(s.sessionPaneOrderIndex, 'session-1');
        sessionPaneOrder.set('pane-3', 0.5);
        sessionPaneOrder.delete('__pending_' + insertion1Id);
        recomputeMatches(s);
        recomputeTree(s);
      })
    );

    // handlePtyCreated for PTY1: stamps order, removes pending, triggers fast refresh
    setCurrentSessionPtys([
      { ptyId: 'pty-1', paneId: 'pane-1', workspaceId: 1, title: 'one', cwd: '/tmp' },
      { ptyId: 'pty-new', paneId: 'pane-3', workspaceId: 1, title: 'new', cwd: '/tmp' },
      { ptyId: 'pty-2', paneId: 'pane-2', workspaceId: 1, title: 'two', cwd: '/tmp' },
    ]);
    setCurrentSessionPaneOrder(
      new Map([
        ['pane-1', 0],
        ['pane-3', 2], // layout traversal puts new pane at end
        ['pane-2', 1],
      ])
    );

    await lifecycleHandlers.handlePtyCreated('pty-new');

    // PTY2's pending creation should still exist (not resolved yet)
    const pending2AfterRefresh = state.pendingPaneCreations.find((i) => i.id === insertion2Id);
    expect(pending2AfterRefresh).toBeDefined();

    // PTY2's sortOrderHint should be preserved in sessionPaneOrderIndex
    // (via the synthetic key that survives applySnapshot)
    const paneOrderAfterRefresh = getSessionPaneOrder(state.sessionPaneOrderIndex, 'session-1');
    expect(paneOrderAfterRefresh.has('__pending_' + insertion2Id)).toBe(true);
    expect(paneOrderAfterRefresh.get('__pending_' + insertion2Id)).toBe(sortOrderHint2);

    // Now PTY2 resolves
    setState(
      produce((s) => {
        s.pendingPaneCreations = s.pendingPaneCreations.map((i) =>
          i.id === insertion2Id ? { ...i, pendingPtyId: 'pty-new-2', pendingPaneId: 'pane-4' } : i
        );
        const sessionPaneOrder = getSessionPaneOrder(s.sessionPaneOrderIndex, 'session-1');
        sessionPaneOrder.set('pane-4', sortOrderHint2);
        sessionPaneOrder.delete('__pending_' + insertion2Id);
        recomputeMatches(s);
        recomputeTree(s);
      })
    );

    harness.setOwnership('pty-new-2', {
      sessionId: 'session-1',
      paneId: 'pane-4',
      workspaceId: 1,
    });
    setCurrentSessionPtys([
      { ptyId: 'pty-1', paneId: 'pane-1', workspaceId: 1, title: 'one', cwd: '/tmp' },
      { ptyId: 'pty-new', paneId: 'pane-3', workspaceId: 1, title: 'new', cwd: '/tmp' },
      { ptyId: 'pty-new-2', paneId: 'pane-4', workspaceId: 1, title: 'new-2', cwd: '/tmp' },
      { ptyId: 'pty-2', paneId: 'pane-2', workspaceId: 1, title: 'two', cwd: '/tmp' },
    ]);

    await lifecycleHandlers.handlePtyCreated('pty-new-2');

    // Both new PTYs should maintain their intended positions
    // (not jump to the bottom of the session group)
    const paneOrder = getSessionPaneOrder(state.sessionPaneOrderIndex, 'session-1');
    expect(paneOrder.get('pane-3')).toBe(0.5);
    expect(paneOrder.get('pane-4')).toBe(sortOrderHint2);
    expect(paneOrder.get('pane-1')).toBe(0);
    expect(paneOrder.get('pane-2')).toBe(1);
  });

  it('serialized handlePtyCreated: each refresh completes before next handler starts', async () => {
    /**
     * When multiple PTYs are created rapidly, handlePtyCreated calls
     * are serialized via a promise chain. Each call stamps its sort order,
     * awaits refreshActiveSession, THEN removes the pending creation.
     * This prevents: (1) interleaved state mutations, (2) blocked refreshes
     * where the second handler's refreshActiveSession returns immediately
     * because the first is still in progress, (3) the PTY becoming invisible
     * (pending creation removed but not in allPtys) during the gap.
     */
    const harness = createHarness();
    const {
      state,
      setState,
      refreshers,
      lifecycleHandlers,
      setCurrentSessionPtys,
      setCurrentSessionPaneOrder,
    } = harness;

    await refreshers.initialLoad();

    // Set up TWO pending pane creations with real IDs (simulating onCreated)
    const insertion1Id = 'pending-1';
    const insertion2Id = 'pending-2';
    setState(
      produce((s) => {
        s.pendingPaneCreations = [
          {
            id: insertion1Id,
            sessionId: 'session-1',
            insertAfterPtyId: 'pty-1',
            insertAfterPaneId: 'pane-1',
            pendingPtyId: 'pty-new',
            pendingPaneId: 'pane-3',
            sortOrderHint: 0.5,
          },
          {
            id: insertion2Id,
            sessionId: 'session-1',
            insertAfterPtyId: 'pty-1',
            insertAfterPaneId: 'pane-1',
            pendingPtyId: 'pty-new-2',
            pendingPaneId: 'pane-4',
            sortOrderHint: 0.75,
          },
        ];
        const sessionPaneOrder = getSessionPaneOrder(s.sessionPaneOrderIndex, 'session-1');
        sessionPaneOrder.set('pane-3', 0.5);
        sessionPaneOrder.set('pane-4', 0.75);
        recomputeMatches(s);
        recomputeTree(s);
      })
    );

    // Set up live PTYs for both new panes
    harness.setOwnership('pty-new-2', { sessionId: 'session-1', paneId: 'pane-4', workspaceId: 1 });
    setCurrentSessionPtys([
      { ptyId: 'pty-1', paneId: 'pane-1', workspaceId: 1, title: 'one', cwd: '/tmp' },
      { ptyId: 'pty-new', paneId: 'pane-3', workspaceId: 1, title: 'new', cwd: '/tmp' },
      { ptyId: 'pty-new-2', paneId: 'pane-4', workspaceId: 1, title: 'new-2', cwd: '/tmp' },
      { ptyId: 'pty-2', paneId: 'pane-2', workspaceId: 1, title: 'two', cwd: '/tmp' },
    ]);
    setCurrentSessionPaneOrder(
      new Map([
        ['pane-1', 0],
        ['pane-3', 2],
        ['pane-4', 3],
        ['pane-2', 1],
      ])
    );

    // Fire BOTH handlePtyCreated calls — they are serialized
    const p1 = lifecycleHandlers.handlePtyCreated('pty-new');
    const p2 = lifecycleHandlers.handlePtyCreated('pty-new-2');
    await Promise.all([p1, p2]);

    // Both pending creations should be removed
    expect(state.pendingPaneCreations).toHaveLength(0);

    // Both new PTYs should be in allPtys with correct sort orders
    const ptyNew = state.allPtys.find((p) => p.ptyId === 'pty-new');
    const ptyNew2 = state.allPtys.find((p) => p.ptyId === 'pty-new-2');
    expect(ptyNew).toBeDefined();
    expect(ptyNew2).toBeDefined();

    // Sort orders preserved (not jumped to bottom)
    const paneOrder = getSessionPaneOrder(state.sessionPaneOrderIndex, 'session-1');
    expect(paneOrder.get('pane-3')).toBe(0.5);
    expect(paneOrder.get('pane-4')).toBe(0.75);
  });

  it('placeholder stays in matchedPtys during handlePtyCreated refresh', async () => {
    /**
     * handlePtyCreated now does: stamp order → refresh → remove pending creation.
     * The placeholder (from buildPendingAggregatePtys) stays in matchedPtys
     * during the refresh, so the autoswitch effect can find it immediately.
     * Only AFTER the refresh puts the real PTY into allPtys/matchedPtys is
     * the pending creation removed (which removes the placeholder from
     * matchedPtys, but by then the real PTY is already there).
     */
    const harness = createHarness();
    const {
      state,
      setState,
      refreshers,
      lifecycleHandlers,
      setCurrentSessionPtys,
      setCurrentSessionPaneOrder,
    } = harness;

    await refreshers.initialLoad();

    // Set up a pending pane creation with real IDs
    setState(
      produce((s) => {
        s.pendingPaneCreations = [
          {
            id: 'pending-1',
            sessionId: 'session-1',
            insertAfterPtyId: 'pty-1',
            insertAfterPaneId: 'pane-1',
            pendingPtyId: 'pty-new',
            pendingPaneId: 'pane-3',
            sortOrderHint: 0.5,
          },
        ];
        const sessionPaneOrder = getSessionPaneOrder(s.sessionPaneOrderIndex, 'session-1');
        sessionPaneOrder.set('pane-3', 0.5);
        recomputeMatches(s);
        recomputeTree(s);
      })
    );

    // The placeholder should be in matchedPtys
    const placeholderBefore = state.matchedPtys.find(
      (p) => p.ptyId === 'pending:pending-1' || p.ptyId === 'pty-new'
    );
    expect(placeholderBefore).toBeDefined();

    setCurrentSessionPtys([
      { ptyId: 'pty-1', paneId: 'pane-1', workspaceId: 1, title: 'one', cwd: '/tmp' },
      { ptyId: 'pty-new', paneId: 'pane-3', workspaceId: 1, title: 'new', cwd: '/tmp' },
      { ptyId: 'pty-2', paneId: 'pane-2', workspaceId: 1, title: 'two', cwd: '/tmp' },
    ]);
    setCurrentSessionPaneOrder(
      new Map([
        ['pane-1', 0],
        ['pane-3', 2],
        ['pane-2', 1],
      ])
    );

    await lifecycleHandlers.handlePtyCreated('pty-new');

    // After handlePtyCreated completes, the pending creation should be removed
    expect(state.pendingPaneCreations).toHaveLength(0);

    // The real PTY should be in allPtys (from the refresh)
    const realPty = state.allPtys.find((p) => p.ptyId === 'pty-new');
    expect(realPty).toBeDefined();
    expect(realPty?.title).toBe('new');

    // Sort order preserved
    const paneOrder = getSessionPaneOrder(state.sessionPaneOrderIndex, 'session-1');
    expect(paneOrder.get('pane-3')).toBe(0.5);
  });
});
