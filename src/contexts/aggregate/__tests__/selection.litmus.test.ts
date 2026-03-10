/**
 * Selection operations litmus tests - fast, single concept tests.
 */

import { describe, it, expect } from 'vitest';
import {
  clearPreviewState,
  getSelectedPty,
  getSelectedItem,
  getSelectedSessionId,
  findNearestPtyInSession,
} from '../selection/operations';
import type { FlattenedTreeItem, PtyInfo, AggregateViewState } from '../types';

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
  title: undefined,
  workspaceId: 1,
  paneId: 'pane-1',
  sessionId: 'session-1',
  sessionMetadata: undefined,
  ...overrides,
});

const createMockState = (overrides: Partial<AggregateViewState> = {}): AggregateViewState => ({
  showAggregateView: false,
  filterQuery: '',
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
  manualSessionOrder: [],
  loadingSessionIds: new Set(),
  loadAttemptedSessionIds: new Set(),
  allSessions: new Map(),
  pendingPtyIds: new Set(),
  recentlyAddedPtyIds: new Set(),
  deletedPtyIds: new Set(),
  listScrollOffset: 0,
  ...overrides,
});

describe('clearPreviewState', () => {
  it('clears preview flags', () => {
    const state = createMockState({ previewMode: true, previewZoomed: true });
    clearPreviewState(state);
    expect(state.previewMode).toBe(false);
    expect(state.previewZoomed).toBe(false);
  });
});

describe('getSelectedPty', () => {
  it('returns PTY info when selected item is PTY', () => {
    const pty = createMockPty({ ptyId: 'pty-1' });
    const flattenedTree: FlattenedTreeItem[] = [
      {
        node: { type: 'pty', ptyInfo: pty, parentSessionId: 'session-1' },
        depth: 1,
        isLast: true,
        prefix: '',
        index: 0,
        parentSessionId: 'session-1',
      },
    ];
    const result = getSelectedPty(flattenedTree, 0);
    expect(result?.ptyId).toBe('pty-1');
  });

  it('returns null when selected item is not PTY', () => {
    const flattenedTree: FlattenedTreeItem[] = [
      {
        node: {
          type: 'session',
          session: { id: 's1', name: 'Test', createdAt: Date.now(), updatedAt: Date.now() },
          ptyCount: 0,
          activePtyCount: 0,
          loadState: { status: 'loaded' },
          isExpanded: false,
        },
        depth: 0,
        isLast: true,
        prefix: '',
        index: 0,
        parentSessionId: undefined,
      },
    ];
    const result = getSelectedPty(flattenedTree, 0);
    expect(result).toBeNull();
  });
});

describe('getSelectedItem', () => {
  it('returns item at selected index', () => {
    const flattenedTree: FlattenedTreeItem[] = [
      {
        node: { type: 'spacer' },
        depth: 0,
        isLast: false,
        prefix: '',
        index: 0,
        parentSessionId: undefined,
      },
    ];
    const result = getSelectedItem(flattenedTree, 0);
    expect(result?.node.type).toBe('spacer');
  });

  it('returns undefined for out of bounds', () => {
    const flattenedTree: FlattenedTreeItem[] = [];
    const result = getSelectedItem(flattenedTree, 0);
    expect(result).toBeUndefined();
  });
});

describe('getSelectedSessionId', () => {
  it('returns session ID for PTY item', () => {
    const flattenedTree: FlattenedTreeItem[] = [
      {
        node: { type: 'pty', ptyInfo: createMockPty({ sessionId: 'session-a' }), parentSessionId: 'session-a' },
        depth: 1,
        isLast: true,
        prefix: '',
        index: 0,
        parentSessionId: 'session-a',
      },
    ];
    const result = getSelectedSessionId(flattenedTree, 0);
    expect(result).toBe('session-a');
  });

  it('returns session ID for session node', () => {
    const flattenedTree: FlattenedTreeItem[] = [
      {
        node: {
          type: 'session',
          session: { id: 'session-b', name: 'Test', createdAt: Date.now(), updatedAt: Date.now() },
          ptyCount: 0,
          activePtyCount: 0,
          loadState: { status: 'loaded' },
          isExpanded: false,
        },
        depth: 0,
        isLast: true,
        prefix: '',
        index: 0,
        parentSessionId: undefined,
      },
    ];
    const result = getSelectedSessionId(flattenedTree, 0);
    expect(result).toBe('session-b');
  });
});

describe('findNearestPtyInSession', () => {
  it('finds PTY below in same session', () => {
    const flattenedTree: FlattenedTreeItem[] = [
      { node: { type: 'spacer' }, depth: 0, isLast: false, prefix: '', index: 0, parentSessionId: undefined },
      {
        node: { type: 'pty', ptyInfo: createMockPty({ ptyId: 'pty-1' }), parentSessionId: 'session-1' },
        depth: 1,
        isLast: false,
        prefix: '',
        index: 1,
        parentSessionId: 'session-1',
      },
      {
        node: { type: 'pty', ptyInfo: createMockPty({ ptyId: 'pty-2' }), parentSessionId: 'session-1' },
        depth: 1,
        isLast: true,
        prefix: '',
        index: 2,
        parentSessionId: 'session-1',
      },
    ];
    const result = findNearestPtyInSession(flattenedTree, 'session-1', 0, 'down');
    expect(result?.ptyId).toBe('pty-1');
  });

  it('stops at session boundary', () => {
    const flattenedTree: FlattenedTreeItem[] = [
      {
        node: {
          type: 'session',
          session: { id: 'session-1', name: 'S1', createdAt: Date.now(), updatedAt: Date.now() },
          ptyCount: 0,
          activePtyCount: 0,
          loadState: { status: 'loaded' },
          isExpanded: false,
        },
        depth: 0,
        isLast: false,
        prefix: '',
        index: 0,
        parentSessionId: undefined,
      },
      {
        node: { type: 'pty', ptyInfo: createMockPty({ ptyId: 'pty-1', sessionId: 'session-2' }), parentSessionId: 'session-2' },
        depth: 1,
        isLast: true,
        prefix: '',
        index: 1,
        parentSessionId: 'session-2',
      },
    ];
    const result = findNearestPtyInSession(flattenedTree, 'session-1', 0, 'down');
    expect(result).toBeNull();
  });
});
