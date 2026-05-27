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

/** Core PTY identity and ownership data. */
export interface PtyCoreInfo {
  ptyId: string;
  cwd: string;
  foregroundProcess: string | undefined;
  shell: string | undefined;
  /** Workspace ID where this PTY is located (if found in current session) */
  workspaceId: number | undefined;
  /** Pane ID where this PTY is located (if found in current session) */
  paneId: string | undefined;
  /** Session ID where this PTY belongs (for tree structure) */
  sessionId: string;
  /** Session metadata reference */
  sessionMetadata: SessionMetadata | undefined;
}

/** Git metadata tracked for aggregate PTY rows. */
export interface PtyGitMetadata {
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
  gitIsWorktree: boolean;
  gitCommonDir: string | null;
}

/** Display-only PTY metadata used by the aggregate list. */
export interface PtyDisplayMetadata {
  /** Temporary aggregate-list sort key used before a paneId is fully anchored. */
  sortOrderHint?: number;
  /** Terminal title (set via escape sequences), distinct from foregroundProcess */
  title: string | undefined;
}

/**
 * PTY info for the aggregate view.
 *
 * Represents a terminal session (PTY) with its associated metadata including
 * git status, current working directory, process information, and session
 * membership details. Used for displaying and navigating PTYs across all
 * workspaces in the aggregate view overlay.
 */
export interface PtyInfo extends PtyCoreInfo, PtyGitMetadata, PtyDisplayMetadata {}

/** Shared session load metadata across all load states. */
export interface SessionLoadMetadata {
  lastActiveWorkspaceId?: number;
  focusedPaneId?: string;
  paneCount?: number;
}

export interface UnloadedSessionLoadState extends SessionLoadMetadata {
  status: 'unloaded';
}

export interface LoadingSessionLoadState extends SessionLoadMetadata {
  status: 'loading';
}

export interface LoadedSessionLoadState extends SessionLoadMetadata {
  status: 'loaded';
}

export interface ErrorSessionLoadState extends SessionLoadMetadata {
  status: 'error';
  error: string;
}

/** Loading state for a session */
export type SessionLoadState =
  | UnloadedSessionLoadState
  | LoadingSessionLoadState
  | LoadedSessionLoadState
  | ErrorSessionLoadState;

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

/**
 * Union type for all tree node types in the aggregate view hierarchy.
 *
 * TreeNode represents the hierarchical structure of sessions and their PTYs:
 * - SessionTreeNode: A session header with metadata and expansion state
 * - PtyTreeNode: A terminal session belonging to a parent session
 * - PlaceholderTreeNode: Loading or unloaded state indicator
 * - SpacerTreeNode: Visual separator between session groups
 *
 * Used to build the visual tree structure for navigation and rendering.
 */
export type TreeNode = SessionTreeNode | PtyTreeNode | PlaceholderTreeNode | SpacerTreeNode;

/**
 * Flattened tree item for visual navigation and rendering in the aggregate view.
 *
 * Represents a single row in the visual tree display with pre-computed
 * rendering metadata. The flattened structure allows O(1) indexed access
 * for keyboard navigation while preserving the visual hierarchy through
 * depth, prefix, and isLast properties.
 *
 * @see TREE_GLYPHS for the visual prefix characters used in tree rendering
 */
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

export interface PendingPaneCreation {
  /** Stable request identifier so multiple concurrent creations can be tracked independently. */
  id: string;
  /** Session where the new PTY should appear. */
  sessionId: string;
  /** Existing PTY the new one should appear after, if pane creation started from a PTY row. */
  insertAfterPtyId: string | null;
  /** Stable pane anchor captured from the selected PTY before creation starts. */
  insertAfterPaneId: string | null;
  /** PTY created for this request, filled in once createPaneWithPTY returns. */
  pendingPtyId: string | null;
  /** Pane created by the layout for this request, filled in once createPaneWithPTY resolves. */
  pendingPaneId: string | null;
  /** Precomputed aggregate sort hint used for placeholders and final pane anchoring. */
  sortOrderHint?: number;
}

/** Flattened session pane ordering keyed by sessionId + paneId. */
export type SessionPaneOrderIndex = Map<string, number>;

/** Overlay visibility and high-level UI mode state. */
export interface AggregateViewUiSlice {
  /** Whether the aggregate view overlay is shown */
  showAggregateView: boolean;
  /** Whether in interactive preview mode (vs list mode) */
  previewMode: boolean;
  /** Whether preview is zoomed to hide the session list pane */
  previewZoomed: boolean;
  /** Scroll offset for the session/PTY list (0 = top) */
  listScrollOffset: number;
  /** Whether the PTY picker overlay is shown (inside aggregate view) */
  showPtyPicker: boolean;
  /**
   * MRU stack of PTY IDs (most-recently-used).
   * MRU[0] = most recent, MRU[1] = second most recent, etc.
   * Used by the PTY picker for alt-tab selection.
   */
  ptyMru: string[];
}

/** PTY collection state. */
export interface AggregateViewFilterSlice {
  /** Whether to include inactive PTYs in the list/search */
  showInactive: boolean;
  /** All PTYs from all sessions (flat array for backward compat) */
  allPtys: PtyInfo[];
  /** PTYs matching the current filter (flat array for backward compat) */
  matchedPtys: PtyInfo[];
  /** Map from ptyId to index in allPtys for O(1) lookup */
  allPtysIndex: Map<string, number>;
  /** Cached matched-list index used by tree selection and title/activity updates. */
  matchedPtysIndex: Map<string, number>;
}

/** Selection and cursor state for the flattened tree. */
export interface AggregateViewSelectionSlice {
  /** Index of selected item in the flattened tree */
  selectedIndex: number;
  /** PTY ID currently selected for viewing */
  selectedPtyId: string | null;
  /** Currently selected session ID (for operations on sessions) */
  selectedSessionId: string | null;
}

/** Tree structure and session ordering state. */
export interface AggregateViewTreeSlice {
  /** Hierarchical tree structure: sessions with their PTYs */
  treeRoot: TreeNode[];
  /** Flattened tree for visual navigation */
  flattenedTree: FlattenedTreeItem[];
  /** Map from ptyId to FlattenedTreeItem index for O(1) lookup */
  flattenedTreeIndex: Map<string, number>;
  /** Expanded session IDs (collapsed sessions hide their PTYs) */
  expandedSessionIds: Set<string>;
  /** Per-session pane ordering kept alongside the flattened index for tests and tree helpers. */
  sessionPaneOrders: Map<string, Map<string, number>>;
  /** Aggregate-list ordering per session, stored as a flattened pane-order index. */
  sessionPaneOrderIndex: SessionPaneOrderIndex;
  /** Persisted manual session ordering for aggregate view */
  manualSessionOrder: string[];
  /**
   * All unresolved aggregate pane creation requests.
   * Multiple create commands can overlap, so lifecycle matching must track each request separately.
   */
  pendingPaneCreations: PendingPaneCreation[];
}

/** Loading, metadata hydration, and tombstone bookkeeping state. */
export interface AggregateViewLoadingSlice {
  /** Whether a query is in progress */
  isLoading: boolean;
  /** Map of session IDs to their loading states */
  sessionLoadStates: Map<string, SessionLoadState>;
  /** Set of sessions currently loading (for spinner display) */
  loadingSessionIds: Set<string>;
  /** Sessions already auto-attempted for hover/select loading */
  loadAttemptedSessionIds: Set<string>;
  /** Map of ALL session IDs to their metadata (including unloaded sessions) */
  allSessions: Map<string, SessionMetadata>;
  /** Set of PTY IDs currently being created (to prevent flickering during creation) */
  pendingPtyIds: Set<string>;
  /**
   * Short-lived keepalive for PTYs introduced by initial load, bootstrap, or lifecycle.
   * These rows are preserved while the next full refresh catches up with the live service.
   */
  recentlyAddedPtyIds: Set<string>;
  /**
   * Tombstones for PTYs the user deleted.
   * These must survive until the raw PTY service no longer reports the PTY, otherwise
   * deleted rows can be revived by initial load, bootstrap, or refresh.
   */
  deletedPtyIds: Set<string>;
}

/** Aggregate view state with feature-oriented slices. */
export interface AggregateViewState
  extends
    AggregateViewUiSlice,
    AggregateViewFilterSlice,
    AggregateViewSelectionSlice,
    AggregateViewTreeSlice,
    AggregateViewLoadingSlice {}

export function createAggregateViewUiSlice(): AggregateViewUiSlice {
  return {
    showAggregateView: false,
    previewMode: false,
    previewZoomed: false,
    listScrollOffset: 0,
    showPtyPicker: false,
    ptyMru: [],
  };
}

export function createAggregateViewFilterSlice(): AggregateViewFilterSlice {
  return {
    showInactive: true,
    allPtys: [],
    matchedPtys: [],
    allPtysIndex: new Map(),
    matchedPtysIndex: new Map(),
  };
}

export function createAggregateViewSelectionSlice(): AggregateViewSelectionSlice {
  return {
    selectedIndex: 0,
    selectedPtyId: null,
    selectedSessionId: null,
  };
}

export function createAggregateViewTreeSlice(): AggregateViewTreeSlice {
  return {
    treeRoot: [],
    flattenedTree: [],
    flattenedTreeIndex: new Map(),
    expandedSessionIds: new Set(),
    sessionPaneOrders: new Map(),
    sessionPaneOrderIndex: new Map(),
    manualSessionOrder: [],
    pendingPaneCreations: [],
  };
}

export function createAggregateViewLoadingSlice(): AggregateViewLoadingSlice {
  return {
    isLoading: false,
    sessionLoadStates: new Map(),
    loadingSessionIds: new Set(),
    loadAttemptedSessionIds: new Set(),
    allSessions: new Map(),
    pendingPtyIds: new Set(),
    recentlyAddedPtyIds: new Set(),
    deletedPtyIds: new Set(),
  };
}

export function createInitialState(): AggregateViewState {
  return {
    ...createAggregateViewUiSlice(),
    ...createAggregateViewFilterSlice(),
    ...createAggregateViewSelectionSlice(),
    ...createAggregateViewTreeSlice(),
    ...createAggregateViewLoadingSlice(),
  };
}

export const initialState: AggregateViewState = createInitialState();

export interface AggregateViewContextValue {
  state: AggregateViewState;
  openAggregateView: () => void;
  closeAggregateView: () => void;
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
  upsertPendingPaneCreation: (insertion: PendingPaneCreation) => void;
  /** Remove a specific pending aggregate pane insertion request */
  removePendingPaneCreation: (id: string) => void;
  /** Clear all pending aggregate pane insertion requests */
  clearPendingPaneCreations: () => void;
  /** Open the PTY picker overlay */
  openPtyPicker: () => void;
  /** Close the PTY picker overlay */
  closePtyPicker: () => void;
  /** Push a PTY ID onto the MRU stack (dedup + reorder) */
  pushPtyMru: (ptyId: string) => void;
}
