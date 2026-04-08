import { describe, expect, it, vi } from 'bun:test';
import { createStore } from 'solid-js/store';

import { createAggregateViewActions } from '../../src/contexts/aggregate-view-actions';
import {
  initialState,
  type AggregateViewState,
  type PtyInfo,
} from '../../src/contexts/aggregate-view-types';
import { buildPtyIndex } from '../../src/contexts/aggregate-view-helpers';

function createBasePty(): PtyInfo {
  return {
    ptyId: 'pty-1',
    cwd: '/tmp',
    foregroundProcess: 'bash',
    shell: '/bin/bash',
    workspaceId: 1,
    paneId: 'pane-1',
    sessionId: 'session-1',
    sessionMetadata: undefined,
    title: 'shell',
    sortOrderHint: 0,
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

describe('createAggregateViewActions loadSessionPtys', () => {
  it('does not materialize unloaded sessions by creating background PTYs', async () => {
    const [state, setState] = createStore<AggregateViewState>({
      ...initialState,
      allSessions: new Map([
        [
          'session-1',
          {
            id: 'session-1',
            name: 'Session 1',
            createdAt: 1,
            lastSwitchedAt: 1,
            autoNamed: false,
          },
        ],
      ]),
      sessionLoadStates: new Map([
        [
          'session-1',
          {
            status: 'unloaded',
            paneCount: 3,
          },
        ],
      ]),
    });

    const loadSessionPtysOnDemand = vi.fn().mockResolvedValue({
      sessionId: 'session-1',
      ptys: [],
      lastActiveWorkspaceId: 1,
    });

    const actions = createAggregateViewActions({
      state,
      setState,
      refreshPtys: async () => {},
      loadSessionPtysOnDemand,
    });

    await actions.loadSessionPtys('session-1');

    expect(loadSessionPtysOnDemand).toHaveBeenCalledWith('session-1', {
      createIfMissing: false,
    });
  });

  it('shows a queued optimistic placeholder immediately for pending pane creations', () => {
    const sessionMetadata = {
      id: 'session-1',
      name: 'Session 1',
      createdAt: 1,
      lastSwitchedAt: 1,
      autoNamed: false,
    };
    const basePty = createBasePty();
    const [state, setState] = createStore<AggregateViewState>({
      ...initialState,
      allSessions: new Map([['session-1', sessionMetadata]]),
      sessionLoadStates: new Map([['session-1', { status: 'loaded', paneCount: 1 }]]),
      expandedSessionIds: new Set(['session-1']),
      allPtys: [basePty],
      allPtysIndex: buildPtyIndex([basePty]),
      matchedPtys: [basePty],
      matchedPtysIndex: buildPtyIndex([basePty]),
    });

    const actions = createAggregateViewActions({
      state,
      setState,
      refreshPtys: async () => {},
    });

    actions.upsertPendingPaneCreation({
      id: 'pending-1',
      sessionId: 'session-1',
      insertAfterPtyId: 'pty-1',
      insertAfterPaneId: 'pane-1',
      pendingPtyId: null,
      pendingPaneId: null,
      sortOrderHint: 0.5,
    });

    expect(state.matchedPtys.some((pty) => pty.ptyId === 'pending:pending-1')).toBe(true);
    expect(
      state.flattenedTree.some(
        (item) => item.node.type === 'pty' && item.node.ptyInfo.ptyId === 'pending:pending-1'
      )
    ).toBe(true);
  });
});
