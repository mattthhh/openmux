/**
 * Litmus tests for title change handler - fast, single concept tests.
 */

import { describe, it, expect } from 'bun:test';
import { createMetadataChangeHandler } from '../subscriptions';
import type { AggregateViewState } from '../../aggregate-view-types';
import { createStore } from 'solid-js/store';

describe('title handler (litmus)', () => {
  it('creates a function', () => {
    const [_state, setState] = createStore<AggregateViewState>({
      showAggregateView: false,
      showInactive: true,
      allPtys: [],
      matchedPtys: [],
      selectedIndex: 0,
      selectedPtyId: null,
      isLoading: false,
      previewMode: false,
      previewZoomed: false,
      allPtysIndex: new Map(),
      matchedPtysIndex: new Map(),
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

    const handler = createMetadataChangeHandler(setState);
    expect(typeof handler).toBe('function');
  });

  it('validates ptyId before updating', () => {
    const pty = {
      ptyId: 'pty-1',
      cwd: '/home',
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
      foregroundProcess: 'bash',
      shell: '/bin/bash',
      title: 'old-title',
      workspaceId: 1,
      paneId: 'pane-1',
      sessionId: 'session-1',
      sessionMetadata: undefined,
    };

    const [state, setState] = createStore<AggregateViewState>({
      showAggregateView: false,
      showInactive: true,
      allPtys: [pty],
      matchedPtys: [pty],
      selectedIndex: 0,
      selectedPtyId: null,
      isLoading: false,
      previewMode: false,
      previewZoomed: false,
      allPtysIndex: new Map([['pty-1', 0]]),
      matchedPtysIndex: new Map([['pty-1', 0]]),
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

    const handler = createMetadataChangeHandler(setState);
    handler({ ptyId: 'pty-1', title: 'new-title' });

    expect(state.allPtys[0].title).toBe('new-title');
    expect(state.matchedPtys[0].title).toBe('new-title');
  });
});
