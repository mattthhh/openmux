/**
 * Aggregate View modular architecture.
 *
 * Unified refactor of aggregate-view-helpers.ts and aggregate-view-actions.ts
 * into a clean, modular structure with errore patterns and atomic state updates.
 *
 * Structure:
 * - errors/: Error definitions using errore patterns (RedKnight)
 * - types/: Core types (PtyInfo, AggregateViewState, TreeNode, etc.) (RedKnight)
 * - filter/: Filter operations (filterPtys, isActivePty, sorting) (RedKnight)
 * - tree/: Tree operations (buildTreeRoot, flattenTree, navigation) (RedKnight)
 * - selection/: Selection logic (applySelection, restore after removal) (RedKnight)
 * - session/: Session management (expand/collapse, reordering) (RedKnight)
 * - subscriptions/: Lifecycle handlers, title changes, polling (SwiftGrove)
 * - refresh/: Full refresh, subset refresh, initial load (SwiftGrove)
 * - git/: Git metadata extraction and comparison (SwiftGrove)
 */

/** SwiftGrove's modules */
export * from './subscriptions';
export * from './refresh';
export * from './git';

/** Types */
export type {
  PtyInfo,
  GitDiffStats,
  AggregateViewState,
  SessionLoadState,
  SessionTreeNode,
  PtyTreeNode,
  PlaceholderTreeNode,
  SpacerTreeNode,
  TreeNode,
  FlattenedTreeItem,
} from './types';

export { TREE_GLYPHS, createInitialState } from './types';

/** Error definitions */
export {
  TreeOperationError,
  FilterOperationError,
  SelectionOperationError,
  SessionOperationError,
  type AggregateViewError,
} from './errors';

/** Filter operations */
export {
  normalizeProcessName,
  isActivePty,
  filterActivePtys,
  getBasePtys,
  filterPtys,
  buildPtyIndex,
  groupPtysBySession,
  sortPtysForSession,
  extractSessionIds,
} from './filter';

/** Tree operations */
export {
  getDefaultLoadState,
  createLoadingPlaceholder,
  createErrorPlaceholder,
  createUnloadedPlaceholder,
  buildTreeRoot,
  computeTreePrefix,
  computeIndentPrefix,
  getSessionIdForItem,
  isSelectableItem,
  buildFlattenedTreeIndex,
  flattenTree,
  findNearestSelectableIndex,
  navigateUp,
  navigateDown,
  navigateToIndex,
  findPtyIndex,
  type NavigationResult,
} from './tree';

/** Selection operations */
export {
  applySelection,
  clearPreviewState,
  getSelectedPty,
  getSelectedItem,
  getSelectedSessionId,
  findNearestSelectable,
  selectAfterPtyRemoval,
  createSelectionActions,
} from './selection';

/** Session operations */
export {
  toggleSessionExpanded,
  getSortedSessions,
  recomputeMatches,
  recomputeTree,
  createSessionActions,
} from './session';
