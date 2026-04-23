/**
 * Regression tests for the fast refresh merge mode used by handlePtyCreated.
 *
 * The fast refresh (refreshActiveSession) loads only the active session
 * without git metadata, then schedules a full background refresh.
 * The mergeWithExisting flag in applySnapshot must preserve other sessions'
 * loaded data — it must NOT:
 * - Drop PTYs from non-active sessions
 * - Overwrite loaded session states with "unloaded"
 * - Clear session pane orders for non-active sessions
 */

import { describe, expect, it, vi, beforeEach } from 'bun:test';
import { createStore, produce } from 'solid-js/store';
import {
  createAggregateViewRefreshers,
  createLifecycleHandlers,
} from '../../../src/contexts/aggregate-view-subscriptions';
import type { AggregateViewState } from '../../../src/contexts/aggregate-view-types';
import { initialState as initialAggregateState } from '../../../src/contexts/aggregate-view-types';
import { getSessionPaneOrder } from '../../../src/contexts/aggregate/pane-order';
import {
  listAllPtyIds,
  listAllPtysWithMetadata,
  getPtyMetadata,
  getAggregateSessionPtyMapping,
  removeAggregateSessionMappingForPty,
} from '../../../src/effect/bridge/aggregate-bridge';
import {
  listSessionsResult,
  getSessionSummaryResult,
  loadSession,
} from '../../../src/effect/bridge/session-bridge';

// --- Mocks ---

vi.mock('../../../src/effect/bridge/aggregate-bridge', () => ({
  listAllPtyIds: vi.fn(),
  listAllPtysWithMetadata: vi.fn(async () => []),
  getPtyMetadata: vi.fn(),
  getAggregateSessionPtyMapping: vi.fn(async () => ({
    sessionId: 'session-A',
    mapping: new Map(),
    stalePaneIds: [],
  })),
  removeAggregateSessionMappingForPty: vi.fn(),
}));

vi.mock('../../../src/effect/bridge/session-bridge', () => ({
  listSessionsResult: vi.fn(),
  getSessionSummaryResult: vi.fn(),
  loadSession: vi.fn(),
}));

vi.mock('../../../src/effect/bridge/pty-bridge', () => ({
  subscribeToPtyLifecycle: vi.fn(() => () => {}),
  subscribeToAllPtyActivity: vi.fn(() => () => {}),
  subscribeToMetadataChanges: vi.fn(() => () => {}),
}));

vi.mock('../../../src/effect/services/pty/helpers', () => ({
  getGitInfo: vi.fn(async () => null),
  getGitDiffStats: vi.fn(async () => null),
  subscribeToGitRepoChanges: vi.fn(() => () => {}),
}));

vi.mock('../../../src/core/shimmer', () => ({
  clonePtyStdoutActivity: vi.fn(),
}));

vi.mock('../../../src/contexts/git-metadata-cache', () => ({
  getGlobalGitMetadataCache: vi.fn(() => ({
    getMetadata: vi.fn(async () => undefined),
    getMetadataBatch: vi.fn(async () => new Map()),
  })),
}));

const sessionA = {
  id: 'session-A',
  name: 'Session A',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  autoNamed: false,
  lastSwitchedAt: 0,
};

const sessionB = {
  id: 'session-B',
  name: 'Session B',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  autoNamed: false,
  lastSwitchedAt: 0,
};

const serializedSessionA = {
  id: 'session-A',
  name: 'Session A',
  activeWorkspaceId: 1 as const,
  workspaces: [
    {
      id: 1,
      layoutMode: 'stacked' as const,
      focusedPaneId: 'pane-a1',
      mainPane: { id: 'pane-a1', cwd: '/a', title: 'A1' },
      stackPanes: [{ id: 'pane-a2', cwd: '/a', title: 'A2' }],
      activeStackIndex: 0,
    },
  ],
  cwdMap: new Map([
    ['pane-a1', '/a'],
    ['pane-a2', '/a'],
  ]),
};

const serializedSessionB = {
  id: 'session-B',
  name: 'Session B',
  activeWorkspaceId: 1 as const,
  workspaces: [
    {
      id: 1,
      layoutMode: 'stacked' as const,
      focusedPaneId: 'pane-b1',
      mainPane: { id: 'pane-b1', cwd: '/b', title: 'B1' },
      stackPanes: [],
      activeStackIndex: 0,
    },
  ],
  cwdMap: new Map([['pane-b1', '/b']]),
};

describe('fast refresh merge mode', () => {
  let currentSessionPtys: Array<{
    ptyId: string;
    paneId: string;
    workspaceId: number;
    title: string;
    cwd: string;
  }>;
  let currentPaneOrder: Map<string, number>;

  beforeEach(() => {
    vi.clearAllMocks();

    currentSessionPtys = [
      { ptyId: 'pty-a1', paneId: 'pane-a1', workspaceId: 1, title: 'A1', cwd: '/a' },
      { ptyId: 'pty-a2', paneId: 'pane-a2', workspaceId: 1, title: 'A2', cwd: '/a' },
    ];
    currentPaneOrder = new Map([
      ['pane-a1', 0],
      ['pane-a2', 1],
    ]);

    vi.mocked(listSessionsResult).mockResolvedValue([sessionA, sessionB]);
    vi.mocked(getSessionSummaryResult).mockResolvedValue({
      workspaceCount: 1,
      paneCount: 2,
    });
    vi.mocked(loadSession).mockImplementation(async (id: string) => {
      if (id === 'session-A') return serializedSessionA;
      if (id === 'session-B') return serializedSessionB;
      return serializedSessionA;
    });
    vi.mocked(listAllPtyIds).mockResolvedValue(['pty-a1', 'pty-a2', 'pty-b1']);
    vi.mocked(getPtyMetadata).mockImplementation(async (ptyId: string) => {
      const meta: Record<string, any> = {
        'pty-a1': { ptyId: 'pty-a1', title: 'A1', cwd: '/a', shell: '/bin/bash' },
        'pty-a2': { ptyId: 'pty-a2', title: 'A2', cwd: '/a', shell: '/bin/bash' },
        'pty-b1': { ptyId: 'pty-b1', title: 'B1', cwd: '/b', shell: '/bin/bash' },
        'pty-new': { ptyId: 'pty-new', title: 'New', cwd: '/a', shell: '/bin/bash' },
      };
      return meta[ptyId] ?? null;
    });
    vi.mocked(getAggregateSessionPtyMapping).mockResolvedValue({
      sessionId: 'session-A',
      mapping: new Map([
        ['pane-a1', 'pty-a1'],
        ['pane-a2', 'pty-a2'],
      ]),
      stalePaneIds: [],
    });
  });

  function createTestHarness() {
    const [state, setState] = createStore<AggregateViewState>({
      ...initialAggregateState,
      showAggregateView: true,
    });

    const ownershipByPtyId = new Map([
      ['pty-a1', { sessionId: 'session-A', paneId: 'pane-a1', workspaceId: 1 }],
      ['pty-a2', { sessionId: 'session-A', paneId: 'pane-a2', workspaceId: 1 }],
      ['pty-b1', { sessionId: 'session-B', paneId: 'pane-b1', workspaceId: 1 }],
      ['pty-new', { sessionId: 'session-A', paneId: 'pane-a3', workspaceId: 1 }],
    ]);

    const resolvePtyOwnership = (ptyId: string) => ownershipByPtyId.get(ptyId) ?? null;
    const getCurrentSessionHints = () => ({
      sessionId: 'session-A',
      lastActiveWorkspaceId: 1,
      focusedPaneId: 'pane-a1',
    });
    const getCurrentSessionPaneOrder = () => currentPaneOrder;

    const refreshers = createAggregateViewRefreshers(
      state,
      setState,
      { refreshInProgress: false, pendingFullRefresh: false },
      resolvePtyOwnership,
      getCurrentSessionHints,
      getCurrentSessionPaneOrder,
      () => currentSessionPtys
    );

    return { state, setState, refreshers, resolvePtyOwnership, getCurrentSessionHints };
  }

  it('refreshActiveSession preserves other sessions PTYs and load states', async () => {
    const { state, refreshers } = createTestHarness();

    // Full load — both sessions should be loaded
    await refreshers.initialLoad();
    await refreshers.refreshPtys();

    // Verify both sessions are loaded with PTYs
    expect(state.sessionLoadStates.get('session-A')?.status).toBe('loaded');
    expect(state.sessionLoadStates.get('session-B')?.status).toBe('loaded');
    const sessionBPtysBefore = state.allPtys.filter((p) => p.sessionId === 'session-B');
    expect(sessionBPtysBefore.length).toBeGreaterThanOrEqual(1);

    // Simulate a new PTY appearing in session A
    currentSessionPtys.push({
      ptyId: 'pty-new',
      paneId: 'pane-a3',
      workspaceId: 1,
      title: 'New',
      cwd: '/a',
    });
    currentPaneOrder = new Map([
      ['pane-a1', 0],
      ['pane-a2', 1],
      ['pane-a3', 2],
    ]);

    // Fast refresh (what handlePtyCreated uses)
    await refreshers.refreshActiveSession();

    // Session B must STILL be loaded — not overwritten to "unloaded"
    expect(state.sessionLoadStates.get('session-B')?.status).toBe('loaded');

    // Session B PTYs must still be present
    const sessionBPtysAfter = state.allPtys.filter((p) => p.sessionId === 'session-B');
    expect(sessionBPtysAfter.length).toBe(sessionBPtysBefore.length);

    // The new PTY for session A must be present
    const newPty = state.allPtys.find((p) => p.ptyId === 'pty-new');
    expect(newPty).toBeDefined();
    expect(newPty?.sessionId).toBe('session-A');
  });

  it('refreshActiveSession preserves other sessions pane orders', async () => {
    const { state, refreshers } = createTestHarness();

    // Full load
    await refreshers.initialLoad();
    await refreshers.refreshPtys();

    // Session B should have a pane order
    const sessionBPaneOrderBefore = getSessionPaneOrder(state.sessionPaneOrderIndex, 'session-B');
    expect(sessionBPaneOrderBefore.size).toBeGreaterThan(0);

    // Fast refresh
    await refreshers.refreshActiveSession();

    // Session B pane order must still be intact
    const sessionBPaneOrderAfter = getSessionPaneOrder(state.sessionPaneOrderIndex, 'session-B');
    expect(sessionBPaneOrderAfter.size).toBe(sessionBPaneOrderBefore.size);
  });

  it('full refreshPtys still works correctly (no merge mode)', async () => {
    const { state, refreshers } = createTestHarness();

    await refreshers.initialLoad();
    await refreshers.refreshPtys();

    // Both sessions loaded
    expect(state.sessionLoadStates.get('session-A')?.status).toBe('loaded');
    expect(state.sessionLoadStates.get('session-B')?.status).toBe('loaded');

    // Full refresh should preserve all sessions' data
    await refreshers.refreshPtys();
    expect(state.sessionLoadStates.get('session-A')?.status).toBe('loaded');
    expect(state.sessionLoadStates.get('session-B')?.status).toBe('loaded');

    const sessionBPtys = state.allPtys.filter((p) => p.sessionId === 'session-B');
    expect(sessionBPtys.length).toBeGreaterThanOrEqual(1);
  });
});
