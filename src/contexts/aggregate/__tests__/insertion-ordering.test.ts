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
import { initialState, type AggregateViewState, type PtyInfo } from '../../aggregate-view-types';

vi.mock('../../../effect/bridge/aggregate-bridge', () => ({
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

vi.mock('../../git-metadata-cache', () => ({
  getGlobalGitMetadataCache: vi.fn(() => ({
    getMetadata: vi.fn(() => Promise.resolve(undefined)),
    getMetadataBatch: vi.fn(() => Promise.resolve(new Map())),
  })),
}));

import {
  getAggregateSessionPtyMapping,
  getPtyMetadata,
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
  matchedPtysIndex: new Map(),
  treeRoot: [],
  flattenedTree: [],
  flattenedTreeIndex: new Map(),
  expandedSessionIds: new Set(),
  sessionLoadStates: new Map(),
  sessionPaneOrders: new Map(),
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
    ['pty-deleted', { sessionId: 'session-1', paneId: 'pane-deleted', workspaceId: 1 }],
  ]);

  let currentSessionPaneOrder = new Map<string, number>([
    ['pane-1', 0],
    ['pane-2', 1],
  ]);

  const resolvePtyOwnership = (ptyId: string) => ownershipByPtyId.get(ptyId) ?? null;
  const getCurrentSessionHints = () => ({
    sessionId: 'session-1',
    lastActiveWorkspaceId: 1,
    focusedPaneId: 'pane-1',
  });
  const getCurrentSessionPaneOrder = () => currentSessionPaneOrder;
  const getCurrentSessionPtys = () => [
    { ptyId: 'pty-1', paneId: 'pane-1', workspaceId: 1, title: 'one', cwd: '/tmp' },
    { ptyId: 'pty-2', paneId: 'pane-2', workspaceId: 1, title: 'two', cwd: '/tmp' },
  ];

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

  it('keeps the first created PTY adjacent after the selected PTY across refreshes', async () => {
    const { state, setState, refreshers, lifecycleHandlers, setCurrentSessionPaneOrder } =
      createHarness();

    await refreshers.initialLoad();

    expect(state.sessionPaneOrders.get('session-1')).toEqual(
      new Map([
        ['pane-1', 0],
        ['pane-2', 1],
      ])
    );

    setState(
      produce((s) => {
        s.insertAfterPtyId = 'pty-1';
      })
    );

    await lifecycleHandlers.handlePtyCreated('pty-new');

    expect(state.sessionPaneOrders.get('session-1')?.get('pane-3')).toBe(0.5);
    expect(getVisiblePtyIds(state)).toEqual(['pty-1', 'pty-new', 'pty-2']);

    setCurrentSessionPaneOrder(
      new Map([
        ['pane-1', 0],
        ['pane-2', 1],
        ['pane-3', 2],
      ])
    );

    await refreshers.refreshPtys();

    expect(state.sessionPaneOrders.get('session-1')?.get('pane-3')).toBe(0.5);
    expect(getVisiblePtyIds(state)).toEqual(['pty-1', 'pty-new', 'pty-2']);
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
