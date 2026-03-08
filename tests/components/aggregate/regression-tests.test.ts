import { describe, expect, it } from 'bun:test';
import { createStore, produce, type SetStoreFunction } from 'solid-js/store';
import type { AggregateViewState, PtyInfo } from '../../../src/contexts/aggregate-view-types';
import { initialState } from '../../../src/contexts/aggregate-view-types';
import type { SessionMetadata } from '../../../src/effect/models';
import {
  buildPtyIndex,
  filterPtys,
  recomputeMatches,
  recomputeTree,
} from '../../../src/contexts/aggregate-view-helpers';
import { createAggregateViewActions } from '../../../src/contexts/aggregate-view-actions';

const BASELINE_PERF = {
  filterMs: 10,
  navigateMs: 1,
  ptyCreationMs: 5,
};

function createMockSession(id: string, name = id): SessionMetadata {
  return {
    id,
    name,
    createdAt: 1,
    lastSwitchedAt: 1,
    autoNamed: false,
  };
}

function createMockPty(overrides: Partial<PtyInfo> & { ptyId: string; sessionId: string }): PtyInfo {
  return {
    ptyId: overrides.ptyId,
    cwd: `/home/user/project-${overrides.ptyId}`,
    gitBranch: 'main',
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
    title: undefined,
    workspaceId: 1,
    paneId: `pane-${overrides.ptyId}`,
    sessionId: overrides.sessionId,
    sessionMetadata: undefined,
    ...overrides,
  };
}

function paneOrders(ptys: PtyInfo[]): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>();
  for (const pty of ptys) {
    const order = result.get(pty.sessionId) ?? new Map<string, number>();
    order.set(pty.paneId ?? pty.ptyId, order.size);
    result.set(pty.sessionId, order);
  }
  return result;
}

function seedState(
  sessions: SessionMetadata[],
  ptys: PtyInfo[],
  options: { selectedPtyId?: string; manualOrder?: string[] } = {}
) {
  const [state, setState] = createStore<AggregateViewState>({
    ...initialState,
    allSessions: new Map(sessions.map((session) => [session.id, session] as const)),
    allPtys: ptys,
    allPtysIndex: buildPtyIndex(ptys),
    matchedPtys: ptys,
    matchedPtysIndex: buildPtyIndex(ptys),
    expandedSessionIds: new Set(sessions.map((session) => session.id)),
    sessionLoadStates: new Map(
      sessions.map((session) => [session.id, { status: 'loaded' as const, paneCount: ptys.filter((pty) => pty.sessionId === session.id).length }])
    ),
    sessionPaneOrders: paneOrders(ptys),
    manualSessionOrder: options.manualOrder ?? [],
  });

  setState(
    produce((s) => {
      s.selectedPtyId = options.selectedPtyId ?? null;
      s.selectedSessionId = options.selectedPtyId
        ? ptys.find((pty) => pty.ptyId === options.selectedPtyId)?.sessionId ?? null
        : null;
      recomputeMatches(s);
      recomputeTree(s);
    })
  );

  return { state, setState };
}

function createActions(state: AggregateViewState, setState: SetStoreFunction<AggregateViewState>) {
  return createAggregateViewActions({
    state,
    setState,
    refreshPtys: async () => {},
  });
}

function measureTime<T>(fn: () => T): { result: T; elapsedMs: number } {
  const start = performance.now();
  const result = fn();
  const elapsedMs = performance.now() - start;
  return { result, elapsedMs };
}

describe('Regression Tests - Aggregate view current behavior', () => {
  it('maintains OR semantics in filterPtys', () => {
    const ptys = [
      createMockPty({ ptyId: 'pty-1', sessionId: 'session-a', foregroundProcess: 'nvim', cwd: '/project/a' }),
      createMockPty({ ptyId: 'pty-2', sessionId: 'session-a', foregroundProcess: 'bash', cwd: '/project/b' }),
      createMockPty({ ptyId: 'pty-3', sessionId: 'session-b', foregroundProcess: 'node', cwd: '/project/c' }),
    ];

    expect(filterPtys(ptys, 'nvim').map((pty) => pty.ptyId)).toEqual(['pty-1']);
    expect(filterPtys(ptys, 'project bash').map((pty) => pty.ptyId)).toEqual([
      'pty-1',
      'pty-2',
      'pty-3',
    ]);
  });

  it('exposes the current aggregate action surface', () => {
    const sessions = [createMockSession('session-a', 'A')];
    const ptys = [createMockPty({ ptyId: 'pty-1', sessionId: 'session-a' })];
    const { state, setState } = seedState(sessions, ptys);
    const actions = createActions(state, setState);

    expect(typeof actions.openAggregateView).toBe('function');
    expect(typeof actions.closeAggregateView).toBe('function');
    expect(typeof actions.setFilterQuery).toBe('function');
    expect(typeof actions.toggleShowInactive).toBe('function');
    expect(typeof actions.navigateUp).toBe('function');
    expect(typeof actions.navigateDown).toBe('function');
    expect(typeof actions.setSelectedIndex).toBe('function');
    expect(typeof actions.selectPty).toBe('function');
    expect(typeof actions.getSelectedPty).toBe('function');
    expect(typeof actions.reorderSessions).toBe('function');
  });

  it('applies manual session ordering before alphabetical order', async () => {
    const sessions = [
      createMockSession('session-a', 'Alpha'),
      createMockSession('session-b', 'Beta'),
      createMockSession('session-c', 'Gamma'),
    ];
    const ptys = sessions.map((session, index) =>
      createMockPty({ ptyId: `pty-${index + 1}`, sessionId: session.id })
    );
    const { state, setState } = seedState(sessions, ptys, {
      manualOrder: ['session-c', 'session-a'],
    });

    const sessionOrder = state.flattenedTree
      .filter((item) => item.node.type === 'session')
      .map((item) => item.node.session.id);

    expect(sessionOrder).toEqual(['session-c', 'session-a', 'session-b']);

    const actions = createActions(state, setState);
    await actions.reorderSessions('session-b', 'session-c');

    const reordered = state.flattenedTree
      .filter((item) => item.node.type === 'session')
      .map((item) => item.node.session.id);

    expect(reordered).toEqual(['session-b', 'session-c', 'session-a']);
  });

  it('keeps O(1) PTY lookups via allPtysIndex', () => {
    const ptys = Array.from({ length: 1000 }, (_, index) =>
      createMockPty({ ptyId: `pty-${index}`, sessionId: `session-${Math.floor(index / 10)}` })
    );
    const sessions = Array.from({ length: 100 }, (_, index) =>
      createMockSession(`session-${index}`)
    );
    const { state } = seedState(sessions, ptys);

    const { elapsedMs } = measureTime(() => {
      for (let index = 0; index < 1000; index++) {
        state.allPtysIndex.get(`pty-${index}`);
      }
    });

    expect(elapsedMs).toBeLessThan(10);
  });

  it('keeps filter performance within the expected tolerance', () => {
    const sessions = Array.from({ length: 50 }, (_, index) => createMockSession(`session-${index}`));
    const ptys = sessions.flatMap((session, sessionIndex) =>
      Array.from({ length: 4 }, (_, index) =>
        createMockPty({
          ptyId: `pty-${sessionIndex}-${index}`,
          sessionId: session.id,
          foregroundProcess: index % 2 === 0 ? 'nvim' : 'bash',
        })
      )
    );
    const { state, setState } = seedState(sessions, ptys);
    const actions = createActions(state, setState);

    const { elapsedMs } = measureTime(() => {
      actions.setFilterQuery('nvim');
    });

    expect(elapsedMs).toBeLessThan(BASELINE_PERF.filterMs * 2);
    expect(state.matchedPtys.every((pty) => pty.foregroundProcess?.includes('nvim'))).toBe(true);
  });

  it('keeps tree navigation performance within tolerance', () => {
    const sessions = Array.from({ length: 50 }, (_, index) => createMockSession(`session-${index}`));
    const ptys = sessions.flatMap((session, sessionIndex) =>
      Array.from({ length: 4 }, (_, index) =>
        createMockPty({ ptyId: `pty-${sessionIndex}-${index}`, sessionId: session.id })
      )
    );
    const { state, setState } = seedState(sessions, ptys);
    const actions = createActions(state, setState);

    const { elapsedMs } = measureTime(() => {
      for (let index = 0; index < 50; index++) {
        actions.navigateDown();
      }
    });

    expect(elapsedMs).toBeLessThan(BASELINE_PERF.navigateMs * 10);
    expect(state.selectedIndex).toBeGreaterThan(0);
  });

  it('navigates safely in an empty tree', () => {
    const { state, setState } = seedState([], []);
    const actions = createActions(state, setState);

    const { elapsedMs } = measureTime(() => {
      for (let index = 0; index < 100; index++) {
        actions.navigateDown();
        actions.navigateUp();
      }
    });

    expect(elapsedMs).toBeLessThan(50);
    expect(state.selectedPtyId).toBeNull();
  });

  it('rebuilds PTY indexes consistently after repeated state updates', () => {
    const sessions = [createMockSession('session-a', 'A')];
    const [state, setState] = createStore<AggregateViewState>({
      ...initialState,
      allSessions: new Map([[sessions[0].id, sessions[0]]]),
      expandedSessionIds: new Set(['session-a']),
      sessionLoadStates: new Map([['session-a', { status: 'loaded' as const, paneCount: 0 }]]),
      sessionPaneOrders: new Map(),
    });

    for (let index = 0; index < 20; index++) {
      setState(
        produce((s) => {
          s.allPtys.push(createMockPty({ ptyId: `pty-${index}`, sessionId: 'session-a' }));
          s.allPtysIndex = buildPtyIndex(s.allPtys);
          s.sessionPaneOrders = paneOrders(s.allPtys);
          recomputeMatches(s);
          recomputeTree(s);
        })
      );
    }

    for (const [ptyId, index] of state.allPtysIndex.entries()) {
      expect(state.allPtys[index]?.ptyId).toBe(ptyId);
    }
  });

  it('keeps mock PTY creation cost within baseline tolerance', () => {
    const { elapsedMs } = measureTime(() => {
      for (let index = 0; index < 100; index++) {
        createMockPty({ ptyId: `new-pty-${index}`, sessionId: 'session-a' });
      }
    });

    expect(elapsedMs / 100).toBeLessThan(BASELINE_PERF.ptyCreationMs);
  });
});
