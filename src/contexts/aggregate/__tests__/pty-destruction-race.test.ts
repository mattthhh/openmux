/**
 * PTY destruction race condition test
 *
 * This test reproduces the bug where:
 * 1. User kills a PTY in aggregate view
 * 2. PTY appears deleted (removed from UI via handlePtyDestroyed)
 * 3. User creates a new pane before deferred destroy completes
 * 4. Polling refresh sees the old PTY still in pty.listAll() and re-adds it
 * 5. After 5s, deletedPtyIds clears → old PTY "respawns" in the UI
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { createStore } from 'solid-js/store';
import {
  createAggregateViewRefreshers,
  createLifecycleHandlers,
} from '../../aggregate-view-subscriptions';
import { initialState, type AggregateViewState, type PtyInfo } from '../../aggregate-view-types';
import { buildPtyIndex } from '../../aggregate-view-helpers';
import type { SessionMetadata } from '../../../effect/models';

// Mock the bridge functions
vi.mock('../../../effect/bridge/aggregate-bridge', () => ({
  listAllPtysWithMetadata: vi.fn(),
  getAggregateSessionPtyMapping: vi.fn(),
}));

vi.mock('../../../effect/bridge/session-bridge', () => ({
  listSessionsResult: vi.fn(),
  getSessionSummaryResult: vi.fn(),
  loadSession: vi.fn(),
}));

vi.mock('../../../effect/bridge/pty-bridge', () => ({
  subscribeToPtyLifecycle: vi.fn(() => Promise.resolve(() => {})),
  subscribeToAllTitleChanges: vi.fn(() => Promise.resolve(() => {})),
  getPtyMetadata: vi.fn(),
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
  listAllPtysWithMetadata,
  getAggregateSessionPtyMapping,
} from '../../../effect/bridge/aggregate-bridge';
import {
  listSessionsResult,
  getSessionSummaryResult,
  loadSession,
} from '../../../effect/bridge/session-bridge';

describe('PTY destruction race condition', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const createMockPty = (overrides: Partial<PtyInfo> = {}): PtyInfo => ({
    ptyId: 'pty-1',
    cwd: '/home/user',
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
    sessionId: 'session-1',
    sessionMetadata: undefined,
    ...overrides,
  });

  const createMockSession = (overrides: Partial<SessionMetadata> = {}): SessionMetadata => ({
    id: 'session-1',
    name: 'Test Session',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  });

  /**
   * Create a test harness that simulates the aggregate view state
   */
  const createTestHarness = () => {
    const [state, setState] = createStore<AggregateViewState>({
      ...initialState,
      showAggregateView: true,
      allSessions: new Map([['session-1', createMockSession()]]),
      sessionLoadStates: new Map([['session-1', { status: 'loaded', paneCount: 1 }]]),
      expandedSessionIds: new Set(['session-1']),
    });

    const refreshState = {
      refreshInProgress: false,
      subsetRefreshInProgress: false,
      pendingFullRefresh: false,
      pendingSubsetPtyIds: new Set<string>(),
    };

    // Mock PTY ownership resolution
    const resolvePtyOwnership = (ptyId: string) => ({
      sessionId: 'session-1',
      paneId: `pane-${ptyId}`,
      workspaceId: 1,
    });

    const getCurrentSessionHints = () => ({
      sessionId: 'session-1' as const,
      lastActiveWorkspaceId: 1,
      focusedPaneId: 'pane-1',
    });

    const getCurrentSessionPaneOrder = () =>
      new Map([
        ['pane-1', 0],
        ['pane-2', 1],
      ]);

    const { refreshPtys, bootstrapPtys } = createAggregateViewRefreshers(
      state,
      setState,
      refreshState,
      resolvePtyOwnership,
      getCurrentSessionHints,
      getCurrentSessionPaneOrder
    );

    const lifecycleHandlers = createLifecycleHandlers(
      state,
      setState,
      resolvePtyOwnership,
      getCurrentSessionHints
    );

    return { state, setState, refreshPtys, bootstrapPtys, lifecycleHandlers, refreshState };
  };

  it('should NOT re-add a destroyed PTY during refresh (race condition fix)', async () => {
    const { state, refreshPtys, lifecycleHandlers } = createTestHarness();

    // Setup: Add a PTY to the state
    const existingPty = createMockPty({ ptyId: 'pty-to-destroy', paneId: 'pane-1' });
    state.allPtys.push(existingPty);
    state.allPtysIndex = buildPtyIndex(state.allPtys);

    // Mock the services to return the PTY (simulating deferred destruction)
    vi.mocked(listSessionsResult).mockResolvedValue([createMockSession()]);
    vi.mocked(listAllPtysWithMetadata).mockResolvedValue([
      {
        ptyId: 'pty-to-destroy',
        cwd: '/home/user',
        foregroundProcess: 'bash',
        shell: '/bin/bash',
        title: 'bash',
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
    ]);
    vi.mocked(getAggregateSessionPtyMapping).mockResolvedValue({
      sessionId: 'session-1',
      mapping: new Map([['pane-1', 'pty-to-destroy']]),
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

    // Step 1: User destroys the PTY
    lifecycleHandlers.handlePtyDestroyed('pty-to-destroy');

    // Verify: PTY is removed from the list and added to deletedPtyIds
    expect(state.allPtys.find((p) => p.ptyId === 'pty-to-destroy')).toBeUndefined();
    expect(state.deletedPtyIds.has('pty-to-destroy')).toBe(true);

    // Step 2: Before the deferred macrotask completes, a refresh happens
    // (simulating user creating a new pane)
    await refreshPtys();

    // Verify: The destroyed PTY should NOT be re-added because it's in deletedPtyIds
    const readdedPty = state.allPtys.find((p) => p.ptyId === 'pty-to-destroy');
    expect(readdedPty).toBeUndefined();
    expect(state.deletedPtyIds.has('pty-to-destroy')).toBe(true);

    // Step 3: Advance time past the 5s cleanup window
    vi.advanceTimersByTime(5000);

    // Step 4: Another refresh happens
    // The mock still returns the PTY (simulating it still exists in service)
    await refreshPtys();

    // BEFORE FIX: This would re-add the PTY because deletedPtyIds cleared
    // AFTER FIX: The PTY should remain deleted because it still exists in service
    // (we only clear deletedPtyIds when the service confirms the PTY is gone)
    const stillThere = state.allPtys.find((p) => p.ptyId === 'pty-to-destroy');
    expect(stillThere).toBeUndefined();
  });

  it('should keep deleted PTY tombstones until the raw service list is clear', async () => {
    const { state, refreshPtys, lifecycleHandlers } = createTestHarness();

    state.allPtys.push(createMockPty({ ptyId: 'pty-orphaned-live', paneId: 'pane-1' }));
    state.allPtysIndex = buildPtyIndex(state.allPtys);

    vi.mocked(listSessionsResult).mockResolvedValue([createMockSession()]);
    vi.mocked(listAllPtysWithMetadata).mockResolvedValue([
      {
        ptyId: 'pty-orphaned-live',
        cwd: '/home/user',
        foregroundProcess: 'bash',
        shell: '/bin/bash',
        title: 'bash',
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
    ]);
    vi.mocked(getAggregateSessionPtyMapping).mockResolvedValue(undefined);
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

    lifecycleHandlers.handlePtyDestroyed('pty-orphaned-live');
    expect(state.deletedPtyIds.has('pty-orphaned-live')).toBe(true);

    await refreshPtys();

    expect(state.deletedPtyIds.has('pty-orphaned-live')).toBe(true);
    expect(state.allPtys.find((pty) => pty.ptyId === 'pty-orphaned-live')).toBeUndefined();

    vi.mocked(listAllPtysWithMetadata).mockResolvedValue([]);
    await refreshPtys();

    expect(state.deletedPtyIds.has('pty-orphaned-live')).toBe(false);
  });

  it('should not bootstrap deleted PTYs back into the list from saved mappings', async () => {
    const { state, bootstrapPtys } = createTestHarness();

    state.deletedPtyIds.add('pty-deleted');

    vi.mocked(listSessionsResult).mockResolvedValue([createMockSession()]);
    vi.mocked(loadSession).mockResolvedValue({
      id: 'session-1',
      name: 'Test Session',
      activeWorkspaceId: 1,
      workspaces: [
        {
          id: 1,
          layoutMode: 'vertical',
          focusedPaneId: 'pane-1',
          mainPane: { id: 'pane-1', title: 'shell' },
          stackPanes: [],
          activeStackIndex: 0,
        },
      ],
      cwdMap: new Map(),
      paneToPtyMap: new Map([['pane-1', 'pty-deleted']]),
    });
    vi.mocked(getAggregateSessionPtyMapping).mockResolvedValue({
      sessionId: 'session-1',
      mapping: new Map([['pane-1', 'pty-deleted']]),
      stalePaneIds: [],
    });

    await bootstrapPtys();

    expect(state.allPtys.find((pty) => pty.ptyId === 'pty-deleted')).toBeUndefined();
  });

  it('should allow legitimate PTY re-creation with same ID after confirmed deletion', async () => {
    const { state, refreshPtys, lifecycleHandlers } = createTestHarness();

    // Setup: Add a PTY to the state
    const existingPty = createMockPty({ ptyId: 'pty-recreate', paneId: 'pane-1' });
    state.allPtys.push(existingPty);
    state.allPtysIndex = buildPtyIndex(state.allPtys);

    // First mock: PTY exists
    vi.mocked(listSessionsResult).mockResolvedValue([createMockSession()]);
    vi.mocked(listAllPtysWithMetadata).mockResolvedValue([
      {
        ptyId: 'pty-recreate',
        cwd: '/home/user',
        foregroundProcess: 'bash',
        shell: '/bin/bash',
        title: 'bash',
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
    ]);
    vi.mocked(getAggregateSessionPtyMapping).mockResolvedValue({
      sessionId: 'session-1',
      mapping: new Map([['pane-1', 'pty-recreate']]),
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

    // Step 1: User destroys the PTY
    lifecycleHandlers.handlePtyDestroyed('pty-recreate');
    expect(state.deletedPtyIds.has('pty-recreate')).toBe(true);

    // Step 2: Service confirms PTY is actually gone (empty list)
    vi.mocked(listAllPtysWithMetadata).mockResolvedValue([]);

    // Step 3: Refresh - PTY should stay deleted, deletedPtyIds should clear
    await refreshPtys();
    expect(state.allPtys.find((p) => p.ptyId === 'pty-recreate')).toBeUndefined();

    // Step 4: Advance time past cleanup window
    vi.advanceTimersByTime(5000);

    // Step 5: A new PTY with same ID is created (edge case)
    // This is rare but possible with ID reuse - should be allowed
    vi.mocked(listAllPtysWithMetadata).mockResolvedValue([
      {
        ptyId: 'pty-recreate', // Same ID, but this is a NEW PTY
        cwd: '/new/path',
        foregroundProcess: 'zsh',
        shell: '/bin/zsh',
        title: 'zsh',
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

    await refreshPtys();

    // The new PTY with same ID should be allowed
    const newPty = state.allPtys.find((p) => p.ptyId === 'pty-recreate');
    expect(newPty).toBeDefined();
    expect(newPty?.shell).toBe('/bin/zsh'); // Verify it's the new one
  });

  it('should clean up placeholder when PTY is destroyed during creation', async () => {
    const { state, lifecycleHandlers } = createTestHarness();

    // Setup: Add a placeholder PTY (simulating handlePtyCreated start)
    const placeholderPty: PtyInfo = {
      ptyId: 'orphaned-pty',
      cwd: '',
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
      foregroundProcess: undefined,
      shell: undefined,
      title: '...', // Placeholder loading indicator
      workspaceId: undefined,
      paneId: undefined,
      sessionId: '', // Not yet resolved
      sessionMetadata: undefined,
    };

    state.allPtys.push(placeholderPty);
    state.allPtysIndex = buildPtyIndex(state.allPtys);
    state.pendingPtyIds.add('orphaned-pty');

    // Verify placeholder is there
    expect(state.allPtys.find((p) => p.ptyId === 'orphaned-pty')).toBeDefined();
    expect(state.allPtys.find((p) => p.ptyId === 'orphaned-pty')?.title).toBe('...');

    // Step 1: PTY is destroyed before metadata fetch completes
    lifecycleHandlers.handlePtyDestroyed('orphaned-pty');

    // Verify: Placeholder should be removed, not left orphaned
    expect(state.allPtys.find((p) => p.ptyId === 'orphaned-pty')).toBeUndefined();
    expect(state.pendingPtyIds.has('orphaned-pty')).toBe(false);
    expect(state.deletedPtyIds.has('orphaned-pty')).toBe(true);

    // Step 2: Advance time to clear deletedPtyIds
    vi.advanceTimersByTime(5000);

    // After deletedPtyIds clears, the PTY should stay gone
    expect(state.allPtys.find((p) => p.ptyId === 'orphaned-pty')).toBeUndefined();
  });

  it('should not leave shell-titled orphaned PTYs when creation fails', async () => {
    const { state, setState, lifecycleHandlers } = createTestHarness();

    // Setup: Simulate a PTY that was partially created with shell title
    // This can happen if metadata fetch fails halfway
    const partialPty: PtyInfo = {
      ptyId: 'partial-pty',
      cwd: '/tmp',
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
      title: 'shell', // Partial creation may leave this title
      workspaceId: 1,
      paneId: 'pane-1',
      sessionId: 'session-1',
      sessionMetadata: createMockSession(),
    };

    state.allPtys.push(partialPty);
    state.allPtysIndex = buildPtyIndex(state.allPtys);
    state.pendingPtyIds.add('partial-pty');

    // Step 1: Destroy the partial PTY
    lifecycleHandlers.handlePtyDestroyed('partial-pty');

    // Verify: Should be completely removed
    expect(state.allPtys.find((p) => p.ptyId === 'partial-pty')).toBeUndefined();
    expect(state.pendingPtyIds.has('partial-pty')).toBe(false);
  });
});
