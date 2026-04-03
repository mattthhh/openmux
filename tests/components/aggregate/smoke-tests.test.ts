import { describe, expect, it } from 'bun:test';
import { createStore, produce, type SetStoreFunction } from 'solid-js/store';
import type { AggregateViewState, PtyInfo } from '../../../src/contexts/aggregate-view-types';
import { initialState } from '../../../src/contexts/aggregate-view-types';
import type { SessionMetadata } from '../../../src/effect/models';
import {
  buildPtyIndex,
  recomputeMatches,
  recomputeTree,
} from '../../../src/contexts/aggregate-view-helpers';
import { createAggregateViewActions } from '../../../src/contexts/aggregate-view-actions';

const PERF_THRESHOLD_MS = 100;

function createMockSession(id: string, name = id): SessionMetadata {
  return {
    id,
    name,
    createdAt: 1,
    lastSwitchedAt: 1,
    autoNamed: false,
  };
}

function createMockPty(
  overrides: Partial<PtyInfo> & { ptyId: string; sessionId: string }
): PtyInfo {
  return {
    ptyId: overrides.ptyId,
    cwd: `/home/user/${overrides.ptyId}`,
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

function paneOrders(ptys: PtyInfo[]) {
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
  options: { selectedPtyId?: string; unloadedSessionIds?: string[] } = {}
) {
  const unloaded = new Set(options.unloadedSessionIds ?? []);
  const [state, setState] = createStore<AggregateViewState>({
    ...initialState,
    allSessions: new Map(sessions.map((session) => [session.id, session] as const)),
    allPtys: ptys,
    allPtysIndex: buildPtyIndex(ptys),
    matchedPtys: ptys,
    matchedPtysIndex: buildPtyIndex(ptys),
    expandedSessionIds: new Set(sessions.map((session) => session.id)),
    sessionLoadStates: new Map(
      sessions.map((session) => [
        session.id,
        unloaded.has(session.id)
          ? {
              status: 'unloaded' as const,
              paneCount: ptys.filter((pty) => pty.sessionId === session.id).length,
            }
          : {
              status: 'loaded' as const,
              paneCount: ptys.filter((pty) => pty.sessionId === session.id).length,
            },
      ])
    ),
    sessionPaneOrders: paneOrders(ptys),
  });

  setState(
    produce((s) => {
      s.selectedPtyId = options.selectedPtyId ?? null;
      s.selectedSessionId = options.selectedPtyId
        ? (ptys.find((pty) => pty.ptyId === options.selectedPtyId)?.sessionId ?? null)
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

describe('Smoke Tests - Aggregate View current behavior', () => {
  it(`recomputes a large session tree in under ${PERF_THRESHOLD_MS}ms`, () => {
    const sessions = Array.from({ length: 50 }, (_, index) =>
      createMockSession(`session-${index}`)
    );
    const ptys = sessions.flatMap((session, sessionIndex) =>
      Array.from({ length: 4 }, (_, index) =>
        createMockPty({ ptyId: `pty-${sessionIndex}-${index}`, sessionId: session.id })
      )
    );

    const { elapsedMs } = measureTime(() => seedState(sessions, ptys));

    expect(elapsedMs).toBeLessThan(PERF_THRESHOLD_MS);
    expect(ptys.length).toBe(200);
  });

  it('renders unloaded sessions with a selectable placeholder row', () => {
    const sessions = [
      createMockSession('session-a', 'Alpha'),
      createMockSession('session-b', 'Beta'),
    ];
    const ptys = [createMockPty({ ptyId: 'pty-1', sessionId: 'session-a' })];
    const { state } = seedState(sessions, ptys, { unloadedSessionIds: ['session-b'] });

    const placeholder = state.flattenedTree.find(
      (item) => item.node.type === 'placeholder' && item.node.parentSessionId === 'session-b'
    );

    expect(placeholder).toBeDefined();
    expect(placeholder?.node.type).toBe('placeholder');
    if (placeholder?.node.type === 'placeholder') {
      expect(placeholder.node.message).toBe('...');
    }
  });

  it('keeps PTYs grouped under the correct session when a new pane is added', () => {
    const sessions = [
      createMockSession('session-a', 'Alpha'),
      createMockSession('session-b', 'Beta'),
    ];
    const ptys = [
      createMockPty({ ptyId: 'pty-1', sessionId: 'session-a' }),
      createMockPty({ ptyId: 'pty-2', sessionId: 'session-b' }),
    ];
    const { state, setState } = seedState(sessions, ptys);

    setState(
      produce((s) => {
        s.allPtys.push(createMockPty({ ptyId: 'pty-new', sessionId: 'session-a' }));
        s.allPtysIndex = buildPtyIndex(s.allPtys);
        s.sessionPaneOrders = paneOrders(s.allPtys);
        recomputeMatches(s);
        recomputeTree(s);
      })
    );

    const sessionAItems = state.flattenedTree.filter((item) => {
      if (item.node.type === 'session') return item.node.session.id === 'session-a';
      if (item.node.type === 'pty') return item.node.ptyInfo.sessionId === 'session-a';
      return false;
    });
    const sessionBHeaderIndex = state.flattenedTree.findIndex(
      (item) => item.node.type === 'session' && item.node.session.id === 'session-b'
    );
    const newPtyIndex = state.flattenedTreeIndex.get('pty-new');

    expect(sessionAItems.map((item) => item.node.type)).toEqual(['session', 'pty', 'pty']);
    expect(newPtyIndex).toBeDefined();
    expect((newPtyIndex ?? -1) < sessionBHeaderIndex).toBe(true);
  });

  it('keeps the cursor in place after a middle PTY removal', () => {
    const sessions = [createMockSession('session-a', 'Alpha')];
    const ptys = [
      createMockPty({ ptyId: 'pty-1', sessionId: 'session-a' }),
      createMockPty({ ptyId: 'pty-2', sessionId: 'session-a' }),
      createMockPty({ ptyId: 'pty-3', sessionId: 'session-a' }),
    ];
    const { state, setState } = seedState(sessions, ptys, { selectedPtyId: 'pty-2' });
    const actions = createActions(state, setState);

    actions.selectAfterPtyRemoval('pty-2');

    expect(actions.getSelectedPty()?.ptyId).toBe('pty-3');
  });

  it('keeps stable relative order for existing PTYs when adding another PTY', () => {
    const sessions = [createMockSession('session-a', 'Alpha')];
    const ptys = [
      createMockPty({ ptyId: 'pty-a', sessionId: 'session-a', paneId: 'pane-a' }),
      createMockPty({ ptyId: 'pty-b', sessionId: 'session-a', paneId: 'pane-b' }),
      createMockPty({ ptyId: 'pty-c', sessionId: 'session-a', paneId: 'pane-c' }),
    ];
    const { state, setState } = seedState(sessions, ptys);

    setState(
      produce((s) => {
        s.allPtys.push(createMockPty({ ptyId: 'pty-d', sessionId: 'session-a', paneId: 'pane-d' }));
        s.allPtysIndex = buildPtyIndex(s.allPtys);
        s.sessionPaneOrders = paneOrders(s.allPtys);
        recomputeMatches(s);
        recomputeTree(s);
      })
    );

    const visiblePtyIds = state.flattenedTree
      .filter((item) => item.node.type === 'pty')
      .map((item) => item.node.ptyInfo.ptyId);

    expect(visiblePtyIds.slice(0, 3)).toEqual(['pty-a', 'pty-b', 'pty-c']);
  });
});
