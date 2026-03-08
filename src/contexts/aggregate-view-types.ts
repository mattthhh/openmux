/**
 * Types for AggregateViewContext.
 */

import type { GitInfo } from '../effect/services/pty/helpers';
import type { SessionMetadata } from '../effect/models';

/** Git diff statistics */
export interface GitDiffStats {
  added: number;
  removed: number;
  binary: number;
}

/** PTY info for the aggregate view */
export interface PtyInfo {
  ptyId: string;
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
  gitState: GitInfo["state"] | undefined;
  gitDetached: boolean;
  gitRepoKey: string | undefined;
  foregroundProcess: string | undefined;
  shell: string | undefined;
  /** Terminal title (set via escape sequences), distinct from foregroundProcess */
  title: string | undefined;
  /** Workspace ID where this PTY is located (if found in current session) */
  workspaceId: number | undefined;
  /** Pane ID where this PTY is located (if found in current session) */
  paneId: string | undefined;
  /** Session ID where this PTY belongs (for tree structure) */
  sessionId: string;
  /** Session metadata reference */
  sessionMetadata: SessionMetadata | undefined;
}

/** Loading state for a session */
export type SessionLoadState = 
  | { status: 'unloaded'; lastActiveWorkspaceId?: number; focusedPaneId?: string; paneCount?: number }
  | { status: 'loading'; lastActiveWorkspaceId?: number; focusedPaneId?: string; paneCount?: number }
  | { status: 'loaded'; lastActiveWorkspaceId?: number; focusedPaneId?: string; paneCount?: number }
  | { status: 'error'; error: string; lastActiveWorkspaceId?: number; focusedPaneId?: string; paneCount?: number };

/** Session node in the tree */
export interface SessionTreeNode {
  type: 'session';
  session: SessionMetadata;
  ptyCount: number;
  activePtyCount: number;
  /** Loading state for lazy loading */
  loadState: SessionLoadState;
  /** Whether session is expanded in the tree */
  isExpanded: boolean;
}

/** PTY node in the tree */
export interface PtyTreeNode {
  type: 'pty';
  ptyInfo: PtyInfo;
  parentSessionId: string;
}

/** Placeholder node for loading/unloaded sessions */
export interface PlaceholderTreeNode {
  type: 'placeholder';
  /** Parent session ID this placeholder belongs to */
  parentSessionId: string;
  /** Message to display (e.g., "..." for loading, "..." for unloaded) */
  message: string;
  /** Whether this is a loading placeholder */
  isLoading: boolean;
  /** Last active workspace info for hover display */
  lastActiveWorkspaceId?: number;
}

/** Spacer row between session groups */
export interface SpacerTreeNode {
  type: 'spacer';
}

/** Tree node types for hierarchical session/PTY display */
export type TreeNode = SessionTreeNode | PtyTreeNode | PlaceholderTreeNode | SpacerTreeNode;

/** Flattened tree item for visual navigation and rendering */
export interface FlattenedTreeItem {
  /** The tree node data */
  node: TreeNode;
  /** Depth in the tree (0 = root session, 1 = PTY under session) */
  depth: number;
  /** Whether this is the last child of its parent (affects tree glyphs) */
  isLast: boolean;
  /** Pre-computed tree prefix for rendering (e.g., "├─ ", "└─ ", "│  ") */
  prefix: string;
  /** Index in the flattened array for navigation */
  index: number;
  /** Parent session ID (for PTY nodes, same as parentSessionId in node) */
  parentSessionId: string | undefined;
}

/** Tree glyph characters for visual hierarchy */
export const TREE_GLYPHS = {
  /** Branch connector for middle items: ├─ */
  BRANCH_MIDDLE: '├─',
  /** Branch connector for last items: └─ */
  BRANCH_LAST: '└─',
  /** Vertical line for parent continuation: │  */
  VERTICAL: '│  ',
  /** Empty indent for last parent's children:    */
  EMPTY: '   ',
  /** Single indent space (3 characters to align with glyphs) */
  INDENT: '   ',
} as const;

/** Aggregate view state with tree structure support */
export interface AggregateViewState {
  /** Whether the aggregate view overlay is shown */
  showAggregateView: boolean;
  /** Current filter query text */
  filterQuery: string;
  /** Whether to include inactive PTYs in the list/search */
  showInactive: boolean;
  /** All PTYs from all sessions (flat array for backward compat) */
  allPtys: PtyInfo[];
  /** PTYs matching the current filter (flat array for backward compat) */
  matchedPtys: PtyInfo[];
  /** Index of selected item in the flattened tree */
  selectedIndex: number;
  /** PTY ID currently selected for viewing */
  selectedPtyId: string | null;
  /** Whether a query is in progress */
  isLoading: boolean;
  /** Whether in interactive preview mode (vs list mode) */
  previewMode: boolean;
  /** Whether preview is zoomed to hide the session list pane */
  previewZoomed: boolean;
  /** Map from ptyId to index in allPtys for O(1) lookup */
  allPtysIndex: Map<string, number>;
  /** Map from ptyId to index in matchedPtys for O(1) lookup */
  matchedPtysIndex: Map<string, number>;
  /** Hierarchical tree structure: sessions with their PTYs */
  treeRoot: TreeNode[];
  /** Flattened tree for visual navigation (respects filtering) */
  flattenedTree: FlattenedTreeItem[];
  /** Map from ptyId to FlattenedTreeItem index for O(1) lookup */
  flattenedTreeIndex: Map<string, number>;
  /** Expanded session IDs (collapsed sessions hide their PTYs) */
  expandedSessionIds: Set<string>;
  /** Currently selected session ID (for operations on sessions) */
  selectedSessionId: string | null;
  /** Map of session IDs to their loading states */
  sessionLoadStates: Map<string, SessionLoadState>;
  /** Stable pane ordering per session (paneId -> order index) */
  sessionPaneOrders: Map<string, Map<string, number>>;
  /** Persisted manual session ordering for aggregate view */
  manualSessionOrder: string[];
  /** Set of sessions currently loading (for spinner display) */
  loadingSessionIds: Set<string>;
  /** Sessions already auto-attempted for hover/select loading */
  loadAttemptedSessionIds: Set<string>;
  /** Map of ALL session IDs to their metadata (including unloaded sessions) */
  allSessions: Map<string, SessionMetadata>;
}

export const initialState: AggregateViewState = {
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
};

export interface AggregateViewContextValue {
  state: AggregateViewState;
  openAggregateView: () => void;
  closeAggregateView: () => void;
  setFilterQuery: (query: string) => void;
  toggleShowInactive: () => void;
  navigateUp: () => void;
  navigateDown: () => void;
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
}
