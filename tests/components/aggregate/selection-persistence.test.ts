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
import {
  deleteSessionPaneOrder,
  getSessionPaneOrderKey,
  setSessionPaneOrder,
} from '../../../src/contexts/aggregate/pane-order';
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

function createMockPty(
  overrides: Partial<PtyInfo> & { ptyId: string; sessionId: string }
): PtyInfo {
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

function buildPaneOrderIndex(ptys: PtyInfo[]): Map<string, number> {
  const result = new Map<string, number>();
  const sessionPaneCounts = new Map<string, number>();
  for (const pty of ptys) {
    const paneId = pty.paneId ?? pty.ptyId;
    const count = sessionPaneCounts.get(pty.sessionId) ?? 0;
    result.set(getSessionPaneOrderKey(pty.sessionId, paneId), count);
    sessionPaneCounts.set(pty.sessionId, count + 1);
  }
  return result;
}

function loadStates(sessions: SessionMetadata[], ptys: PtyInfo[], unloadedIds: string[] = []) {
  const unloaded = new Set(unloadedIds);
  return new Map(
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
  );
}

function createAggregateState(params: {
  sessions: SessionMetadata[];
  ptys: PtyInfo[];
  selectedPtyId?: string;
  selectedSessionId?: string;
  unloadedSessionIds?: string[];
}) {
  const { sessions, ptys, selectedPtyId, selectedSessionId, unloadedSessionIds = [] } = params;

  const [state, setState] = createStore<AggregateViewState>({
    ...initialState,
    allSessions: new Map(sessions.map((session) => [session.id, session] as const)),
    allPtys: ptys,
    allPtysIndex: buildPtyIndex(ptys),
    matchedPtys: ptys,
    matchedPtysIndex: buildPtyIndex(ptys),
    expandedSessionIds: new Set(sessions.map((session) => session.id)),
    sessionLoadStates: loadStates(sessions, ptys, unloadedSessionIds),
    sessionPaneOrderIndex: buildPaneOrderIndex(ptys),
  });

  setState(
    produce((s) => {
      s.selectedPtyId = selectedPtyId ?? null;
      s.selectedSessionId =
        selectedSessionId ??
        (selectedPtyId
          ? (ptys.find((pty) => pty.ptyId === selectedPtyId)?.sessionId ?? null)
          : null);
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

describe('Selection Persistence - current tree behavior', () => {
  it('preserves selected PTY when a new session is added', () => {
    const sessionA = createMockSession('session-a', 'A');
    const pty1 = createMockPty({ ptyId: 'pty-1', sessionId: 'session-a' });
    const { state, setState } = createAggregateState({
      sessions: [sessionA],
      ptys: [pty1],
      selectedPtyId: 'pty-1',
    });

    const sessionB = createMockSession('session-b', 'B');
    const pty2 = createMockPty({ ptyId: 'pty-2', sessionId: 'session-b' });

    setState(
      produce((s) => {
        s.allSessions.set(sessionB.id, sessionB);
        s.allPtys = [...s.allPtys, pty2];
        s.allPtysIndex = buildPtyIndex(s.allPtys);
        s.sessionLoadStates.set(sessionB.id, { status: 'loaded', paneCount: 1 });
        s.sessionPaneOrderIndex = buildPaneOrderIndex(s.allPtys);
        recomputeMatches(s);
        recomputeTree(s);
      })
    );

    expect(state.selectedPtyId).toBe('pty-1');
    expect(state.selectedIndex).toBe(state.flattenedTreeIndex.get('pty-1'));
  });

  it('preserves selected PTY when an unrelated session is removed', () => {
    const sessions = [createMockSession('session-a', 'A'), createMockSession('session-b', 'B')];
    const ptys = [
      createMockPty({ ptyId: 'pty-1', sessionId: 'session-a' }),
      createMockPty({ ptyId: 'pty-2', sessionId: 'session-b' }),
    ];
    const { state, setState } = createAggregateState({
      sessions,
      ptys,
      selectedPtyId: 'pty-2',
    });

    setState(
      produce((s) => {
        s.allSessions.delete('session-a');
        s.allPtys = s.allPtys.filter((pty) => pty.sessionId !== 'session-a');
        s.allPtysIndex = buildPtyIndex(s.allPtys);
        s.sessionLoadStates.delete('session-a');
        deleteSessionPaneOrder(s.sessionPaneOrderIndex, 'session-a');
        s.expandedSessionIds.delete('session-a');
        recomputeMatches(s);
        recomputeTree(s);
      })
    );

    expect(state.selectedPtyId).toBe('pty-2');
    expect(state.selectedIndex).toBe(state.flattenedTreeIndex.get('pty-2'));
  });

  it('keeps selection on the same pane when a saved row is replaced by a live PTY', () => {
    const sessionA = createMockSession('session-a', 'A');
    const savedPty = createMockPty({
      ptyId: 'saved:session-a:pane-1',
      sessionId: 'session-a',
      paneId: 'pane-1',
      title: 'saved-shell',
    });
    const { state, setState } = createAggregateState({
      sessions: [sessionA],
      ptys: [savedPty],
      selectedPtyId: savedPty.ptyId,
    });

    setState(
      produce((s) => {
        s.previewMode = true;
        s.previewZoomed = true;
      })
    );

    const livePty = createMockPty({
      ptyId: 'pty-live',
      sessionId: 'session-a',
      paneId: 'pane-1',
      title: 'live-shell',
    });

    setState(
      produce((s) => {
        s.allPtys = [livePty];
        s.allPtysIndex = buildPtyIndex(s.allPtys);
        s.matchedPtys = [livePty];
        s.matchedPtysIndex = buildPtyIndex(s.matchedPtys);
        s.sessionPaneOrderIndex = buildPaneOrderIndex(s.allPtys);
        recomputeMatches(s);
        recomputeTree(s);
      })
    );

    expect(state.selectedPtyId).toBe('pty-live');
    expect(state.selectedSessionId).toBe('session-a');
    expect(state.flattenedTree[state.selectedIndex]?.node.type).toBe('pty');
    expect(state.previewMode).toBe(true);
    expect(state.previewZoomed).toBe(true);
  });

  it('keeps the cursor in place by selecting the next PTY after removal', () => {
    const sessions = [createMockSession('session-a', 'A')];
    const ptys = [
      createMockPty({ ptyId: 'pty-1', sessionId: 'session-a' }),
      createMockPty({ ptyId: 'pty-2', sessionId: 'session-a' }),
      createMockPty({ ptyId: 'pty-3', sessionId: 'session-a' }),
    ];
    const { state, setState } = createAggregateState({
      sessions,
      ptys,
      selectedPtyId: 'pty-2',
    });
    const actions = createActions(state, setState);

    actions.selectAfterPtyRemoval('pty-2');

    expect(state.selectedPtyId).toBe('pty-3');
    expect(actions.getSelectedPty()?.ptyId).toBe('pty-3');
  });

  it('skips the session header and moves to the next PTY when the first PTY is removed', () => {
    const sessions = [createMockSession('session-a', 'A')];
    const ptys = [
      createMockPty({ ptyId: 'pty-1', sessionId: 'session-a' }),
      createMockPty({ ptyId: 'pty-2', sessionId: 'session-a' }),
    ];
    const { state, setState } = createAggregateState({
      sessions,
      ptys,
      selectedPtyId: 'pty-1',
    });
    const actions = createActions(state, setState);

    actions.selectAfterPtyRemoval('pty-1');

    expect(state.selectedPtyId).toBe('pty-2');
    expect(actions.getSelectedPty()?.ptyId).toBe('pty-2');
  });

  it('falls back to the current session header instead of moving up into another session group', () => {
    const sessions = [createMockSession('session-a', 'A'), createMockSession('session-b', 'B')];
    const ptys = [
      createMockPty({ ptyId: 'pty-a1', sessionId: 'session-a' }),
      createMockPty({ ptyId: 'pty-b1', sessionId: 'session-b' }),
    ];
    const { state, setState } = createAggregateState({
      sessions,
      ptys,
      selectedPtyId: 'pty-b1',
    });
    const actions = createActions(state, setState);

    actions.selectAfterPtyRemoval('pty-b1');

    expect(state.selectedPtyId).toBeNull();
    expect(state.selectedSessionId).toBe('session-b');
    expect(state.flattenedTree[state.selectedIndex]?.node.type).toBe('session');
  });

  it('moves to the previous PTY when removing the last PTY in a session', () => {
    const sessions = [createMockSession('session-a', 'A')];
    const ptys = [
      createMockPty({ ptyId: 'pty-1', sessionId: 'session-a' }),
      createMockPty({ ptyId: 'pty-2', sessionId: 'session-a' }),
    ];
    const { state, setState } = createAggregateState({
      sessions,
      ptys,
      selectedPtyId: 'pty-2',
    });
    const actions = createActions(state, setState);

    actions.selectAfterPtyRemoval('pty-2');

    expect(state.selectedPtyId).toBe('pty-1');
    expect(actions.getSelectedPty()?.ptyId).toBe('pty-1');
  });

  it('falls back to the session header when the only PTY is removed from view', () => {
    const sessions = [createMockSession('session-a', 'A')];
    const ptys = [createMockPty({ ptyId: 'pty-1', sessionId: 'session-a' })];
    const { state, setState } = createAggregateState({
      sessions,
      ptys,
      selectedPtyId: 'pty-1',
    });

    setState(
      produce((s) => {
        s.previewMode = true;
        s.previewZoomed = true;
        s.allPtys = [];
        s.allPtysIndex = new Map();
        s.sessionPaneOrderIndex = new Map();
        recomputeMatches(s);
        recomputeTree(s);
      })
    );

    expect(state.selectedPtyId).toBeNull();
    expect(state.selectedSessionId).toBe('session-a');
    expect(state.flattenedTree[state.selectedIndex]?.node.type).toBe('session');
    expect(state.previewMode).toBe(false);
    expect(state.previewZoomed).toBe(false);
  });

  it('moves to the remaining PTY when the selected PTY is filtered out', () => {
    const sessions = [createMockSession('session-a', 'A')];
    const ptys = [
      createMockPty({ ptyId: 'pty-1', sessionId: 'session-a', foregroundProcess: 'nvim' }),
      createMockPty({ ptyId: 'pty-2', sessionId: 'session-a', foregroundProcess: 'bash' }),
    ];
    const { state, setState } = createAggregateState({
      sessions,
      ptys,
      selectedPtyId: 'pty-1',
    });
    const actions = createActions(state, setState);

    setState(
      produce((s) => {
        s.previewMode = true;
        s.previewZoomed = true;
      })
    );

    actions.setFilterQuery('bash');

    expect(state.selectedPtyId).toBe('pty-2');
    expect(state.selectedSessionId).toBe('session-a');
    expect(state.flattenedTree[state.selectedIndex]?.node.type).toBe('pty');
    expect(state.previewMode).toBe(false);
    expect(state.previewZoomed).toBe(false);
  });

  it('falls back to the session header when a selected PTY becomes hidden by collapse', () => {
    const sessions = [createMockSession('session-a', 'A')];
    const ptys = [
      createMockPty({ ptyId: 'pty-1', sessionId: 'session-a' }),
      createMockPty({ ptyId: 'pty-2', sessionId: 'session-a' }),
    ];
    const { state, setState } = createAggregateState({
      sessions,
      ptys,
      selectedPtyId: 'pty-2',
    });
    const actions = createActions(state, setState);

    actions.toggleSessionExpanded('session-a');

    expect(state.selectedPtyId).toBeNull();
    expect(state.selectedSessionId).toBe('session-a');
    expect(state.flattenedTree[state.selectedIndex]?.node.type).toBe('session');
  });

  it('returns null from getSelectedPty when the selected row is a session header', () => {
    const sessions = [createMockSession('session-a', 'A')];
    const ptys = [createMockPty({ ptyId: 'pty-1', sessionId: 'session-a' })];
    const { state, setState } = createAggregateState({
      sessions,
      ptys,
      selectedSessionId: 'session-a',
    });
    const actions = createActions(state, setState);

    actions.setSelectedIndex(0);

    expect(state.flattenedTree[state.selectedIndex]?.node.type).toBe('session');
    expect(actions.getSelectedPty()).toBeNull();
  });
});
