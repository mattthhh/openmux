/**
 * Tests that applySelection does NOT auto-enter preview mode.
 *
 * This was the root cause of click-through bugs: when a PTY was selected
 * (e.g. from tree recomputation, navigation, or showing hidden groups),
 * applySelection would set previewMode = true, making the preview pane
 * interactive. Subsequent mouse events could then be forwarded to the PTY
 * without the user intending it.
 *
 * Preview mode should only activate through explicit user actions:
 * - Clicking a PTY row (selectPty)
 * - Pressing Enter (handleListEnter)
 * - Opening the aggregate view (openAggregateView)
 */

import { describe, it, expect } from 'bun:test';
import { applySelection, clearPreviewState } from '../selection';
import type { AggregateViewState, FlattenedTreeItem, PtyInfo } from '../types';

function createMockPty(overrides: Partial<PtyInfo> = {}): PtyInfo {
  return {
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
    gitIsWorktree: false,
    gitCommonDir: null,
    foregroundProcess: 'vim',
    shell: '/bin/bash',
    title: undefined,
    workspaceId: 1,
    paneId: 'pane-1',
    sessionId: 'session-1',
    sessionMetadata: undefined,
    ...overrides,
  };
}

function makePtyItem(pty: PtyInfo, index: number): FlattenedTreeItem {
  return {
    node: { type: 'pty', ptyInfo: pty, parentSessionId: pty.sessionId },
    depth: 1,
    isLast: true,
    prefix: '',
    index,
    parentSessionId: pty.sessionId,
  };
}

function makeSessionItem(id: string, name: string, index: number): FlattenedTreeItem {
  return {
    node: {
      type: 'session',
      session: { id, name, createdAt: 1, lastSwitchedAt: 1, autoNamed: false },
      ptyCount: 1,
      activePtyCount: 1,
      loadState: { status: 'loaded' },
      isExpanded: true,
    },
    depth: 0,
    isLast: false,
    prefix: '',
    index,
    parentSessionId: undefined,
  };
}

function createState(overrides: Partial<AggregateViewState> = {}): AggregateViewState {
  return {
    showAggregateView: true,
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
    ...overrides,
  };
}

describe('applySelection does not auto-enter preview mode', () => {
  it('does not set previewMode when selecting a PTY', () => {
    const pty = createMockPty({ ptyId: 'pty-1' });
    const state = createState({
      flattenedTree: [makeSessionItem('session-1', 'A', 0), makePtyItem(pty, 1)],
      previewMode: false,
    });

    applySelection(state, 1);

    expect(state.selectedPtyId).toBe('pty-1');
    expect(state.previewMode).toBe(false);
  });

  it('preserves existing previewMode when selecting a PTY', () => {
    const pty = createMockPty({ ptyId: 'pty-1' });
    const state = createState({
      flattenedTree: [makeSessionItem('session-1', 'A', 0), makePtyItem(pty, 1)],
      previewMode: true,
    });

    applySelection(state, 1);

    expect(state.selectedPtyId).toBe('pty-1');
    expect(state.previewMode).toBe(true);
  });

  it('clears previewMode when selecting a non-PTY item', () => {
    const pty = createMockPty({ ptyId: 'pty-1' });
    const state = createState({
      flattenedTree: [makeSessionItem('session-1', 'A', 0), makePtyItem(pty, 1)],
      previewMode: true,
    });

    applySelection(state, 0);

    expect(state.selectedPtyId).toBeNull();
    expect(state.previewMode).toBe(false);
    expect(state.previewZoomed).toBe(false);
  });

  it('does not auto-enter preview when navigation selects a PTY', () => {
    // Simulates keyboard navigation (j/k) landing on a PTY row.
    // The user is browsing the list and didn't intend to preview.
    const pty = createMockPty({ ptyId: 'pty-1' });
    const state = createState({
      flattenedTree: [makeSessionItem('session-1', 'A', 0), makePtyItem(pty, 1)],
      selectedIndex: 0,
      previewMode: false,
    });

    // Navigate down to the PTY row
    applySelection(state, 1);

    expect(state.selectedPtyId).toBe('pty-1');
    expect(state.previewMode).toBe(false);
  });

  it('does not auto-enter preview when tree recomputation selects a PTY', () => {
    // This is the hidden groups scenario: when the tree is recomputed
    // after showing hidden groups, a PTY may become the selected item.
    // previewMode should NOT be auto-activated.
    const pty = createMockPty({ ptyId: 'pty-revealed' });
    const state = createState({
      flattenedTree: [makeSessionItem('session-1', 'A', 0), makePtyItem(pty, 1)],
      selectedIndex: 0,
      previewMode: false,
    });

    // Tree recomputation selects the newly-revealed PTY
    applySelection(state, 1);

    expect(state.selectedPtyId).toBe('pty-revealed');
    expect(state.previewMode).toBe(false);
  });

  it('clears preview state when no PTY is selectable', () => {
    const state = createState({
      flattenedTree: [makeSessionItem('session-1', 'A', 0)],
      previewMode: true,
      previewZoomed: true,
    });

    applySelection(state, 0);

    expect(state.selectedPtyId).toBeNull();
    expect(state.previewMode).toBe(false);
    expect(state.previewZoomed).toBe(false);
  });

  it('clears preview state when tree is empty', () => {
    const state = createState({
      flattenedTree: [],
      previewMode: true,
      previewZoomed: true,
    });

    applySelection(state, 0);

    expect(state.selectedIndex).toBe(0);
    expect(state.selectedPtyId).toBeNull();
    expect(state.previewMode).toBe(false);
  });
});

describe('clearPreviewState', () => {
  it('resets both previewMode and previewZoomed', () => {
    const state = createState({ previewMode: true, previewZoomed: true });
    clearPreviewState(state);
    expect(state.previewMode).toBe(false);
    expect(state.previewZoomed).toBe(false);
  });

  it('is idempotent', () => {
    const state = createState({ previewMode: false, previewZoomed: false });
    clearPreviewState(state);
    expect(state.previewMode).toBe(false);
    expect(state.previewZoomed).toBe(false);
  });
});
