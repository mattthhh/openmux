/**
 * Regression test: new panes created in aggregate view must appear adjacent
 * to the selected pane, not at the bottom.
 *
 * With the single-writer model, adjacency is preserved through sortOrderHint
 * in pendingPaneCreations → applySnapshot → sessionPaneOrderIndex.
 */

import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { createStore, produce } from 'solid-js/store';

import {
  createAggregateViewRefreshers,
  createLifecycleHandlers,
} from '../../aggregate-view-subscriptions';
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

function createFreshState(): AggregateViewState {
  return {
    ...initialState,
    showAggregateView: true,
    allPtys: [],
    matchedPtys: [],
    allPtysIndex: new Map(),
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
  };
}

function createHarness() {
  const [state, setState] = createStore<AggregateViewState>(createFreshState());

  const refreshState = {
    refreshInProgress: false,
    pendingFullRefresh: false,
  };

  const ownershipByPtyId = new Map([
    ['pty-1', { sessionId: 'session-1', paneId: 'pane-1', workspaceId: 1 }],
    ['pty-2', { sessionId: 'session-1', paneId: 'pane-2', workspaceId: 1 }],
    ['pty-new', { sessionId: 'session-1', paneId: 'pane-3', workspaceId: 1 }],
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

  const lifecycleHandlers = createLifecycleHandlers(
    state,
    setState,
    resolvePtyOwnership,
    getCurrentSessionHints,
    refreshers.refreshPtys
  );

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
}

/** PTY row pane IDs in tree order. */
const getVisiblePaneIds = (state: AggregateViewState) =>
  state.flattenedTree
    .filter((item) => item.node.type === 'pty')
    .map((item) => item.node.ptyInfo.paneId ?? null);

describe('regression: new pane adjacent positioning in aggregate view', () => {
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
      return null;
    });
    vi.mocked(listAllPtysWithMetadata).mockResolvedValue([]);
  });

  it('places new pane adjacent when pending insertion has sortOrderHint', async () => {
    const { state, setState, refreshers, lifecycleHandlers, setCurrentSessionPtys } =
      createHarness();

    await refreshers.initialLoad();

    // Create a pending insertion with sortOrderHint (0.5 = between pane-1 and pane-2)
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

    // Simulate the PTY now being in the layout
    setCurrentSessionPtys([
      { ptyId: 'pty-1', paneId: 'pane-1', workspaceId: 1, title: 'one', cwd: '/tmp' },
      { ptyId: 'pty-new', paneId: 'pane-3', workspaceId: 1, title: 'new', cwd: '/tmp' },
      { ptyId: 'pty-2', paneId: 'pane-2', workspaceId: 1, title: 'two', cwd: '/tmp' },
    ]);

    await lifecycleHandlers.handlePtyCreated('pty-new');

    // The new pane should be between pane-1 and pane-2, not at the bottom
    expect(getVisiblePaneIds(state)).toEqual(['pane-1', 'pane-3', 'pane-2']);
  });

  it('keeps pane adjacent across refreshes after creation', async () => {
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

    await lifecycleHandlers.handlePtyCreated('pty-new');

    expect(getVisiblePaneIds(state)).toEqual(['pane-1', 'pane-3', 'pane-2']);

    // Update the current session pane order to reflect the new pane at the end
    setCurrentSessionPaneOrder(
      new Map([
        ['pane-1', 0],
        ['pane-3', 1],
        ['pane-2', 2],
      ])
    );

    await refreshers.refreshPtys();

    // Pane should still be adjacent after refresh — sortOrderHint persists
    expect(getVisiblePaneIds(state)).toEqual(['pane-1', 'pane-3', 'pane-2']);
  });

  it('ignores lifecycle event when ownership is unknown (no pendingPtyId match)', async () => {
    /**
     * When the lifecycle event fires before onCreated sets pendingPtyId,
     * resolvePtyOwnership still knows about the PTY. handlePtyCreated
     * cleans up the matching pending insertion and triggers refreshPtys.
     *
     * If ownership is null, the event is skipped and the pending insertion
     * remains until a later refresh or lifecycle event resolves it.
     */
    const { state, setState, refreshers, lifecycleHandlers, setOwnership } = createHarness();

    await refreshers.initialLoad();

    // Create a pending insertion WITHOUT pendingPtyId yet
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
        ];
      })
    );

    // Ownership is unknown for the incoming PTY
    setOwnership('pty-new', null);
    await lifecycleHandlers.handlePtyCreated('pty-new');

    // No spurious entries; pending insertion remains
    expect(state.allPtys.map((pty) => pty.paneId)).not.toContain('pane-3');
    expect(state.pendingPaneCreations).toHaveLength(1);
  });

  it('does not sort pane to bottom when sortOrderHint is set but paneOrder is empty', async () => {
    /**
     * When sessionPaneOrderIndex is empty (e.g. during cold start),
     * sortOrderHint from the pending insertion still provides a position.
     */
    const { state, setState, refreshers, lifecycleHandlers, setCurrentSessionPtys } =
      createHarness();

    await refreshers.initialLoad();

    // Clear the session pane order index to simulate cold start
    setState(
      produce((s) => {
        s.sessionPaneOrderIndex.clear();
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

    // With sortOrderHint set, the pane should NOT be at the bottom
    const paneIds = getVisiblePaneIds(state);
    expect(paneIds).toContain('pane-3');
    // pane-3 should not be the last pane
    if (paneIds.length >= 3) {
      expect(paneIds[paneIds.length - 1]).not.toBe('pane-3');
    }
  });

  it('stamps sortOrderHint into sessionPaneOrderIndex when layout reports pane at end', async () => {
    /**
     * When getCurrentSessionPaneOrder puts the new pane at the end (e.g.
     * layout tree traversal appends new panes), the sortOrderHint from
     * pendingPaneCreations overrides this via sessionPaneOrderIndex,
     * keeping the pane adjacent.
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

    await lifecycleHandlers.handlePtyCreated('pty-new');

    // The pane should be between pane-1 and pane-2
    expect(getVisiblePaneIds(state)).toEqual(['pane-1', 'pane-3', 'pane-2']);

    // Simulate the layout reporting pane-3 at the END (wrong!)
    setCurrentSessionPaneOrder(
      new Map([
        ['pane-1', 0],
        ['pane-2', 1],
        ['pane-3', 2], // end position — wrong!
      ])
    );

    await refreshers.refreshPtys();

    // After refresh, the pane should STILL be between pane-1 and pane-2,
    // because sortOrderHint (0.5) was persisted in sessionPaneOrderIndex
    expect(getVisiblePaneIds(state)).toEqual(['pane-1', 'pane-3', 'pane-2']);
  });
});
