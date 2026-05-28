/**
 * Litmus tests for CWD change handler - fast, single concept tests.
 */

import { describe, it, expect } from 'bun:test';
import { createMetadataChangeHandler } from '../subscriptions';
import type { AggregateViewState } from '../../aggregate-view-types';
import { createStore } from 'solid-js/store';

function makePty(overrides: Partial<{ ptyId: string; cwd: string }> = {}) {
  return {
    ptyId: overrides.ptyId ?? 'pty-1',
    cwd: overrides.cwd ?? '/home/user/project',
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
    foregroundProcess: 'zsh',
    shell: '/bin/zsh',
    title: 'project',
    workspaceId: 1,
    paneId: 'pane-1',
    sessionId: 'session-1',
    sessionMetadata: undefined,
  };
}

function makeState(ptys: ReturnType<typeof makePty>[] = [makePty()]) {
  const allPtysIndex = new Map(ptys.map((p, i) => [p.ptyId, i]));
  const matchedPtysIndex = new Map(ptys.map((p, i) => [p.ptyId, i]));
  return createStore<AggregateViewState>({
    showAggregateView: false,
    showInactive: true,
    allPtys: ptys,
    matchedPtys: [...ptys],
    selectedIndex: 0,
    selectedPtyId: null,
    isLoading: false,
    previewMode: false,
    previewZoomed: false,
    allPtysIndex,
    matchedPtysIndex,
    treeRoot: [],
    flattenedTree: [],
    flattenedTreeIndex: new Map(),
    expandedSessionIds: new Set(),
    selectedSessionId: null,
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
    pendingPaneCreations: [],
    listScrollOffset: 0,
  });
}

describe('CWD handler (litmus)', () => {
  it('creates a function', () => {
    const [_state_, setState] = makeState();
    const handler = createMetadataChangeHandler(setState, () => _state_);
    expect(typeof handler).toBe('function');
  });

  it('updates cwd in allPtys and matchedPtys when ptyId matches', () => {
    const [state, setState] = makeState();
    const handler = createMetadataChangeHandler(setState, () => state);

    handler({ ptyId: 'pty-1', cwd: '/home/user/other-project' });

    expect(state.allPtys[0].cwd).toBe('/home/user/other-project');
    expect(state.matchedPtys[0].cwd).toBe('/home/user/other-project');
  });

  it('does not update when ptyId is not in the index', () => {
    const [state, setState] = makeState();
    const handler = createMetadataChangeHandler(setState, () => state);

    handler({ ptyId: 'unknown-pty', cwd: '/somewhere' });

    expect(state.allPtys[0].cwd).toBe('/home/user/project');
    expect(state.matchedPtys[0].cwd).toBe('/home/user/project');
  });

  it('does not replace the entry when cwd is unchanged', () => {
    const [state, setState] = makeState();
    const handler = createMetadataChangeHandler(setState, () => state);
    const before = state.allPtys[0];

    handler({ ptyId: 'pty-1', cwd: '/home/user/project' });

    // Same cwd — the entry should be unchanged (no unnecessary reactive trigger)
    expect(state.allPtys[0]).toBe(before);
  });

  it('updates only the matching pty when multiple ptys exist', () => {
    const pty1 = makePty({ ptyId: 'pty-1', cwd: '/a' });
    const pty2 = makePty({ ptyId: 'pty-2', cwd: '/b' });
    const [state, setState] = makeState([pty1, pty2]);
    const handler = createMetadataChangeHandler(setState, () => state);

    handler({ ptyId: 'pty-2', cwd: '/b/updated' });

    expect(state.allPtys[0].cwd).toBe('/a');
    expect(state.allPtys[1].cwd).toBe('/b/updated');
    expect(state.matchedPtys[0].cwd).toBe('/a');
    expect(state.matchedPtys[1].cwd).toBe('/b/updated');
  });

  it('updates flattenedTree references when cwd changes', () => {
    const pty = makePty({ ptyId: 'pty-1', cwd: '/home/user/project' });
    const [state, setState] = makeState([pty]);

    // Provide session metadata so recomputeTree can build the tree
    setState(
      'allSessions',
      new Map([
        [
          'session-1',
          {
            id: 'session-1',
            name: 'session-1',
            createdAt: 0,
            updatedAt: 0,
            autoNamed: false,
            lastSwitchedAt: 0,
          },
        ],
      ])
    );
    setState('expandedSessionIds', new Set(['session-1']));

    const handler = createMetadataChangeHandler(setState, () => state);
    handler({ ptyId: 'pty-1', cwd: '/home/user/other' });

    // The flattenedTree entry should reflect the new cwd
    const treeNode = state.flattenedTree[0];
    expect(treeNode).toBeDefined();
    if (treeNode?.node.type === 'pty') {
      expect(treeNode.node.ptyInfo.cwd).toBe('/home/user/other');
    }
  });
});
