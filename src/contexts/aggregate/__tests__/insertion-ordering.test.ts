/**
 * Executable spec for aggregate PTY ordering.
 *
 * The important invariants are:
 * - once a PTY is inserted adjacent to a selected PTY, later refreshes must preserve that order
 * - tombstoned PTYs must be filtered in every load path, including the first aggregate load
 */
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { createStore, produce } from 'solid-js/store';

import {
  createAggregateViewRefreshers,
  createLifecycleHandlers,
} from '../../aggregate-view-subscriptions';
import { getSessionPaneOrder } from '../../aggregate';
import { initialState, type AggregateViewState, type PtyInfo } from '../../aggregate-view-types';

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
  sessionPaneOrders: new Map(),
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
    subsetRefreshInProgress: false,
    pendingFullRefresh: false,
    pendingSubsetPtyIds: new Set<string>(),
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

  const lifecycleHandlers = createLifecycleHandlers(
    state,
    setState,
    resolvePtyOwnership,
    getCurrentSessionHints
  );

  return {
    state,
    setState,
    refreshers,
    lifecycleHandlers,
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

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

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
        gitBehind: undefined,
        gitStashCount: undefined,
        gitState: undefined,
        gitDetached: false,
        gitRepoKey: undefined,
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
      },
    ]);
  });

  it('shows the placeholder adjacent before metadata resolves', async () => {
    const { state, setState, refreshers, lifecycleHandlers } = createHarness();
    const metadataDeferred = createDeferred<Awaited<ReturnType<typeof getPtyMetadata>>>();

    vi.mocked(getPtyMetadata).mockImplementation((ptyId: string) => {
      if (ptyId !== 'pty-new') {
        return Promise.resolve(null);
      }
      return metadataDeferred.promise;
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
            pendingPtyId: null,
            pendingPaneId: null,
          },
        ];
      })
    );

    const createPromise = lifecycleHandlers.handlePtyCreated('pty-new');

    expect(getVisiblePtyIds(state)).toEqual(['pty-1', 'pty-new', 'pty-2']);
    expect(state.allPtys.find((pty) => pty.ptyId === 'pty-new')?.title).toBe('...');

    metadataDeferred.resolve({
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
    });

    await createPromise;
  });

  it('keeps a pending placeholder adjacent during refresh before metadata resolves', async () => {
    const { state, setState, refreshers, lifecycleHandlers } = createHarness();
    const metadataDeferred = createDeferred<Awaited<ReturnType<typeof getPtyMetadata>>>();

    vi.mocked(getPtyMetadata).mockImplementation((ptyId: string) => {
      if (ptyId !== 'pty-new') {
        return Promise.resolve(null);
      }
      return metadataDeferred.promise;
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
        gitBehind: undefined,
        gitStashCount: undefined,
        gitState: undefined,
        gitDetached: false,
        gitRepoKey: undefined,
      },
    ]);

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
          },
        ];
      })
    );

    const createPromise = lifecycleHandlers.handlePtyCreated('pty-new');

    expect(getVisiblePtyIds(state)).toEqual(['pty-1', 'pty-new', 'pty-2']);

    await refreshers.refreshPtys();

    expect(getVisiblePtyIds(state)).toEqual(['pty-1', 'pty-new', 'pty-2']);
    expect(state.allPtys.find((pty) => pty.ptyId === 'pty-new')?.title).toBe('...');

    metadataDeferred.resolve({
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
    });

    await createPromise;
  });

  it('keeps the first created PTY adjacent after the selected PTY across refreshes', async () => {
    const { state, setState, refreshers, lifecycleHandlers, setCurrentSessionPaneOrder } =
      createHarness();

    await refreshers.initialLoad();

    expect(getSessionPaneOrder(state.sessionPaneOrders, 'session-1')).toEqual(
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
          },
        ];
      })
    );

    await lifecycleHandlers.handlePtyCreated('pty-new');

    expect(getMetadataMock).toHaveBeenCalledWith('/tmp');
    expect(getSessionPaneOrder(state.sessionPaneOrders, 'session-1').get('pane-3')).toBe(0.5);
    expect(getVisiblePtyIds(state)).toEqual(['pty-1', 'pty-new', 'pty-2']);

    setCurrentSessionPaneOrder(
      new Map([
        ['pane-1', 0],
        ['pane-2', 1],
        ['pane-3', 2],
      ])
    );

    await refreshers.refreshPtys();

    expect(getVisiblePtyIds(state)).toEqual(['pty-1', 'pty-new', 'pty-2']);
  });

  it('keeps the created PTY adjacent after optimistic keepalive expires', async () => {
    vi.useFakeTimers();

    try {
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
            },
          ];
        })
      );

      await lifecycleHandlers.handlePtyCreated('pty-new');
      expect(getVisiblePtyIds(state)).toEqual(['pty-1', 'pty-new', 'pty-2']);

      vi.advanceTimersByTime(5000);
      await Promise.resolve();

      expect(state.recentlyAddedPtyIds.has('pty-new')).toBe(false);

      setCurrentSessionPaneOrder(
        new Map([
          ['pane-1', 0],
          ['pane-2', 1],
          ['pane-3', 2],
        ])
      );
      setCurrentSessionPtys([
        { ptyId: 'pty-1', paneId: 'pane-1', workspaceId: 1, title: 'one', cwd: '/tmp' },
        { ptyId: 'pty-new', paneId: 'pane-3', workspaceId: 1, title: 'new', cwd: '/tmp' },
        { ptyId: 'pty-2', paneId: 'pane-2', workspaceId: 1, title: 'two', cwd: '/tmp' },
      ]);

      await refreshers.refreshPtys();

      expect(getSessionPaneOrder(state.sessionPaneOrders, 'session-1').get('pane-3')).toBe(0.5);
      expect(getVisiblePtyIds(state)).toEqual(['pty-1', 'pty-new', 'pty-2']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves adjacency for overlapping pane creations in the same session', async () => {
    const { state, setState, refreshers, lifecycleHandlers } = createHarness();

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

    await lifecycleHandlers.handlePtyCreated('pty-new-2');
    await lifecycleHandlers.handlePtyCreated('pty-new');

    expect(getSessionPaneOrder(state.sessionPaneOrders, 'session-1').get('pane-3')).toBe(0.5);
    expect(getSessionPaneOrder(state.sessionPaneOrders, 'session-1').get('pane-4')).toBe(0.75);
    expect(getVisiblePtyIds(state)).toEqual(['pty-1', 'pty-new', 'pty-new-2', 'pty-2']);
    expect(state.pendingPaneCreations).toEqual([]);
  });

  it('does not re-add tombstoned PTYs during initial load', async () => {
    const { state, setState, refreshers } = createHarness();

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
      subsetRefreshInProgress: false,
      pendingFullRefresh: false,
      pendingSubsetPtyIds: new Set<string>(),
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
});
