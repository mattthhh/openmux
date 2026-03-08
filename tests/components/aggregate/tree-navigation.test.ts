import { describe, expect, it } from 'bun:test';
import { createStore, produce, type SetStoreFunction } from 'solid-js/store';
import type { AggregateViewState, PtyInfo } from '../../../src/contexts/aggregate-view-types';
import { initialState, TREE_GLYPHS } from '../../../src/contexts/aggregate-view-types';
import type { SessionMetadata } from '../../../src/effect/models';
import {
  buildPtyIndex,
  recomputeMatches,
  recomputeTree,
} from '../../../src/contexts/aggregate-view-helpers';
import { createAggregateViewActions } from '../../../src/contexts/aggregate-view-actions';

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
    cwd: '/home/user/project',
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
  options: { selectedPtyId?: string; selectedSessionId?: string; unloadedSessionIds?: string[]; manualOrder?: string[] } = {}
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
          ? { status: 'unloaded' as const, paneCount: ptys.filter((pty) => pty.sessionId === session.id).length }
          : { status: 'loaded' as const, paneCount: ptys.filter((pty) => pty.sessionId === session.id).length },
      ])
    ),
    sessionPaneOrders: paneOrders(ptys),
    manualSessionOrder: options.manualOrder ?? [],
  });

  setState(
    produce((s) => {
      s.selectedPtyId = options.selectedPtyId ?? null;
      s.selectedSessionId = options.selectedSessionId ?? (options.selectedPtyId ? ptys.find((pty) => pty.ptyId === options.selectedPtyId)?.sessionId ?? null : null);
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

describe('Tree Navigation - current visual order', () => {
  it('flattens sessions in visual order with spacer rows between groups', () => {
    const sessions = [
      createMockSession('session-a', 'Alpha'),
      createMockSession('session-b', 'Beta'),
    ];
    const ptys = [
      createMockPty({ ptyId: 'pty-1', sessionId: 'session-a' }),
      createMockPty({ ptyId: 'pty-2', sessionId: 'session-a' }),
      createMockPty({ ptyId: 'pty-3', sessionId: 'session-b' }),
    ];

    const { state } = seedState(sessions, ptys);

    expect(state.flattenedTree.map((item) => item.node.type)).toEqual([
      'session',
      'pty',
      'pty',
      'spacer',
      'session',
      'pty',
    ]);
    expect(state.flattenedTree[1]?.prefix).toBe(TREE_GLYPHS.BRANCH_MIDDLE);
    expect(state.flattenedTree[2]?.prefix).toBe(TREE_GLYPHS.BRANCH_LAST);
    expect(state.flattenedTree[5]?.prefix).toBe(TREE_GLYPHS.BRANCH_LAST);
  });

  it('respects manual session ordering before alphabetical order', () => {
    const sessions = [
      createMockSession('session-a', 'Alpha'),
      createMockSession('session-b', 'Beta'),
      createMockSession('session-c', 'Gamma'),
    ];
    const ptys = sessions.map((session, index) =>
      createMockPty({ ptyId: `pty-${index + 1}`, sessionId: session.id })
    );

    const { state } = seedState(sessions, ptys, {
      manualOrder: ['session-c', 'session-a'],
    });

    const sessionOrder = state.flattenedTree
      .filter((item) => item.node.type === 'session')
      .map((item) => item.node.session.id);

    expect(sessionOrder).toEqual(['session-c', 'session-a', 'session-b']);
  });

  it('allows navigation to land on placeholder rows while skipping spacer rows', () => {
    const sessions = [
      createMockSession('session-a', 'Alpha'),
      createMockSession('session-b', 'Beta'),
    ];
    const ptys = [createMockPty({ ptyId: 'pty-1', sessionId: 'session-a' })];
    const { state, setState } = seedState(sessions, ptys, {
      selectedSessionId: 'session-a',
      unloadedSessionIds: ['session-b'],
    });
    const actions = createActions(state, setState);

    actions.setSelectedIndex(0); // session-a
    actions.navigateDown();
    expect(state.flattenedTree[state.selectedIndex]?.node.type).toBe('pty');

    actions.navigateDown();
    expect(state.flattenedTree[state.selectedIndex]?.node.type).toBe('session');
    expect(state.selectedSessionId).toBe('session-b');

    actions.navigateDown();
    expect(state.flattenedTree[state.selectedIndex]?.node.type).toBe('placeholder');
  });

  it('navigates upward in reverse visual order', () => {
    const sessions = [
      createMockSession('session-a', 'Alpha'),
      createMockSession('session-b', 'Beta'),
    ];
    const ptys = [
      createMockPty({ ptyId: 'pty-1', sessionId: 'session-a' }),
      createMockPty({ ptyId: 'pty-2', sessionId: 'session-b' }),
    ];
    const { state, setState } = seedState(sessions, ptys, { selectedPtyId: 'pty-2' });
    const actions = createActions(state, setState);

    actions.navigateUp();
    expect(state.flattenedTree[state.selectedIndex]?.node.type).toBe('session');
    expect(state.selectedSessionId).toBe('session-b');

    actions.navigateUp();
    expect(state.flattenedTree[state.selectedIndex]?.node.type).toBe('pty');
    expect(state.selectedPtyId).toBe('pty-1');

    actions.navigateUp();
    expect(state.flattenedTree[state.selectedIndex]?.node.type).toBe('session');
    expect(state.selectedSessionId).toBe('session-a');
  });

  it('collapsing a session hides children and keeps navigation on visible rows only', () => {
    const sessions = [
      createMockSession('session-a', 'Alpha'),
      createMockSession('session-b', 'Beta'),
    ];
    const ptys = [
      createMockPty({ ptyId: 'pty-1', sessionId: 'session-a' }),
      createMockPty({ ptyId: 'pty-2', sessionId: 'session-b' }),
    ];
    const { state, setState } = seedState(sessions, ptys, { selectedPtyId: 'pty-1' });
    const actions = createActions(state, setState);

    actions.toggleSessionExpanded('session-a');

    expect(state.flattenedTree.some((item) => item.node.type === 'pty' && item.node.ptyInfo.ptyId === 'pty-1')).toBe(false);
    expect(state.flattenedTree[state.selectedIndex]?.node.type).toBe('session');

    actions.navigateDown();
    expect(state.selectedSessionId).toBe('session-b');
  });
});
