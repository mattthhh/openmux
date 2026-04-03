/**
 * Core types for aggregate view.
 */

import type { GitInfo } from '../../effect/services/pty/helpers';
import type { SessionMetadata } from '../../effect/models';

/** Git diff statistics */
export interface GitDiffStats {
  added: number;
  removed: number;
  binary: number;
}

/** PTY info for the aggregate view */
export interface PtyInfo {
  ptyId: string;
  /** Temporary aggregate-list sort key used before pane ordering is fully anchored. */
  sortOrderHint?: number;
  cwd: string;
  gitBranch: string | undefined;
  gitDiffStats: GitDiffStats | undefined;
  gitDirty: boolean;
  gitStaged: number;
  gitUnstaged: number;
  gitUntracked: number;
  gitConflicted: number;
  gitAhead: number | undefined;
  gitBehind: number | undefined;
  gitStashCount: number | undefined;
  gitState: GitInfo['state'] | undefined;
  gitDetached: boolean;
  gitRepoKey: string | undefined;
  foregroundProcess: string | undefined;
  shell: string | undefined;
  title: string | undefined;
  workspaceId: number | undefined;
  paneId: string | undefined;
  sessionId: string;
  sessionMetadata: SessionMetadata | undefined;
}

/** Loading state for a session */
export type SessionLoadState =
  | {
      status: 'unloaded';
      lastActiveWorkspaceId?: number;
      focusedPaneId?: string;
      paneCount?: number;
    }
  | {
      status: 'loading';
      lastActiveWorkspaceId?: number;
      focusedPaneId?: string;
      paneCount?: number;
    }
  | { status: 'loaded'; lastActiveWorkspaceId?: number; focusedPaneId?: string; paneCount?: number }
  | {
      status: 'error';
      error: string;
      lastActiveWorkspaceId?: number;
      focusedPaneId?: string;
      paneCount?: number;
    };

/** Session node in the tree */
export interface SessionTreeNode {
  type: 'session';
  session: SessionMetadata;
  ptyCount: number;
  activePtyCount: number;
  loadState: SessionLoadState;
  isExpanded: boolean;
}

/** PTY node in the tree */
export interface PtyTreeNode {
  type: 'pty';
  ptyInfo: PtyInfo;
  parentSessionId: string;
}

/** Placeholder node for loading/unloaded/error sessions */
export interface PlaceholderTreeNode {
  type: 'placeholder';
  parentSessionId: string;
  message: string;
  isLoading: boolean;
  lastActiveWorkspaceId?: number;
}

/** Spacer row between session groups */
export interface SpacerTreeNode {
  type: 'spacer';
}

/** Tree node union type */
export type TreeNode = SessionTreeNode | PtyTreeNode | PlaceholderTreeNode | SpacerTreeNode;

/** Tree glyph characters for visual hierarchy */
export const TREE_GLYPHS = {
  BRANCH_MIDDLE: '├─',
  BRANCH_LAST: '└─',
  VERTICAL: '│  ',
  EMPTY: '   ',
  INDENT: '   ',
} as const;

/** Flattened tree item for visual navigation */
export interface FlattenedTreeItem {
  node: TreeNode;
  depth: number;
  isLast: boolean;
  prefix: string;
  index: number;
  parentSessionId: string | undefined;
}

/** Aggregate view state */
export interface AggregateViewState {
  showAggregateView: boolean;
  filterQuery: string;
  showInactive: boolean;
  allPtys: PtyInfo[];
  matchedPtys: PtyInfo[];
  selectedIndex: number;
  selectedPtyId: string | null;
  isLoading: boolean;
  previewMode: boolean;
  previewZoomed: boolean;
  allPtysIndex: Map<string, number>;
  matchedPtysIndex: Map<string, number>;
  treeRoot: TreeNode[];
  flattenedTree: FlattenedTreeItem[];
  flattenedTreeIndex: Map<string, number>;
  expandedSessionIds: Set<string>;
  selectedSessionId: string | null;
  sessionLoadStates: Map<string, SessionLoadState>;
  sessionPaneOrders: Map<string, Map<string, number>>;
  manualSessionOrder: string[];
  loadingSessionIds: Set<string>;
  loadAttemptedSessionIds: Set<string>;
  allSessions: Map<string, SessionMetadata>;
  pendingPtyIds: Set<string>;
  recentlyAddedPtyIds: Set<string>;
  deletedPtyIds: Set<string>;
  listScrollOffset: number;
  /** Pending PTY insertions for optimistic UI during session restore */
  pendingPtyInsertions: PendingPtyInsertion[];
}

/** Pending PTY insertion for optimistic UI updates */
export interface PendingPtyInsertion {
  id: string;
  sessionId: string;
  pendingPaneId?: string;
  pendingPtyId?: string;
  insertAfterPaneId: string | null;
  sortOrderHint?: number;
  workspaceId?: number;
}

/** Aggregate view context value interface */
export interface AggregateViewContextValue {
  state: AggregateViewState;
  openAggregateView: () => void;
  closeAggregateView: () => void;
  setFilterQuery: (query: string) => void;
  toggleShowInactive: () => void;
  navigateUp: () => void;
  navigateDown: () => void;
  /** Navigate to previous PTY only (skips session headers, for preview mode) */
  navigateToPrevPty: () => void;
  /** Navigate to next PTY only (skips session headers, for preview mode) */
  navigateToNextPty: () => void;
  setSelectedIndex: (index: number) => void;
  selectPty: (ptyId: string) => void;
  getSelectedPty: () => PtyInfo | null;
  refreshPtys: () => Promise<void>;
  enterPreviewMode: () => void;
  exitPreviewMode: () => void;
  togglePreviewZoom: () => void;
  /** Toggle session expansion (collapse/expand PTYs under a session) */
  toggleSessionExpanded: (sessionId: string) => void;
  /** Expand all sessions */
  expandAllSessions: () => void;
  /** Collapse all sessions */
  collapseAllSessions: () => void;
  /** Get flattened item at index */
  getFlattenedItem: (index: number) => FlattenedTreeItem | undefined;
  /** Get the currently selected flattened item */
  getSelectedItem: () => FlattenedTreeItem | undefined;
  /** Load a session's PTYs on demand (lazy loading) */
  loadSessionPtys: (sessionId: string) => Promise<void>;
  /** Get the loading state for a session */
  getSessionLoadState: (sessionId: string) => SessionLoadState | undefined;
  /** Check if a session is currently loading */
  isSessionLoading: (sessionId: string) => boolean;
  /** Reorder sessions for aggregate view */
  reorderSessions: (sourceSessionId: string, targetSessionId: string) => Promise<void>;
  /** Scroll the list up by one page/screen */
  scrollListUp: (pageSize?: number) => void;
  /** Scroll the list down by one page/screen */
  scrollListDown: (pageSize?: number) => void;
  /** Scroll the list to a specific offset */
  setListScrollOffset: (offset: number) => void;
  /** Add or update a pending aggregate pane insertion request */
  upsertPendingPtyInsertion: (insertion: PendingPtyInsertion) => void;
  /** Remove a specific pending aggregate pane insertion request */
  removePendingPtyInsertion: (id: string) => void;
  /** Clear all pending aggregate pane insertion requests */
  clearPendingPtyInsertions: () => void;
}

/** Initial state factory */
export function createInitialState(): AggregateViewState {
  return {
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
    pendingPtyInsertions: [],
  };
}
