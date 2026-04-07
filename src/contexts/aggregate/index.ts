/**
 * Aggregate View modular architecture.
 */

export {
  TreeOperationError,
  FilterOperationError,
  SelectionOperationError,
  SessionOperationError,
} from './errors';

export {
  normalizeProcessName,
  isActivePty,
  filterActivePtys,
  filterPtysByActivity,
  filterPtys,
  buildPtyIndex,
  groupPtysBySession,
  sortPtysForSession,
  extractSessionIds,
} from './filter';

export {
  getDefaultLoadState,
  createLoadingPlaceholder,
  createErrorPlaceholder,
  createUnloadedPlaceholder,
  buildTreeRoot,
  getSessionIdForItem,
  isSelectableItem,
  buildFlattenedTreeIndex,
  findNearestSelectableIndex,
  flattenTree,
  type SessionLoadState,
  type SessionTreeNode,
  type PtyTreeNode,
  type PlaceholderTreeNode,
  type SpacerTreeNode,
  type TreeNode,
  type FlattenedTreeItem,
  TREE_GLYPHS,
} from './tree';

export {
  applySelection,
  clearPreviewState,
  getSelectedPty,
  getSelectedItem,
  getSelectedSessionId,
  findNearestSelectable,
  findNearestPtyInSessionAbove,
  findSessionHeader,
  selectAfterPtyRemoval,
  createSelectionActions,
} from './selection';

export {
  toggleSessionExpanded,
  getSortedSessions,
  recomputeMatches,
  recomputeTree,
  createSessionActions,
} from './session';

export {
  createSubscriptionManager,
  createRefreshState,
  RefreshGuard,
  createLifecycleHandlers,
  createTitleChangeHandler,
  createProcessChangeHandler,
  setupSubscriptions,
  createGitRepoChangeRefresh,
  createActivityBasedRefresh,
  cleanupSubscriptions,
  type SubscriptionManager,
  type RefreshState,
  type RefreshFlagKey,
  type TitleChangeHandler,
  type LifecycleEvent,
  type LifecycleHandlers,
  type SubscriptionSetupDeps,
  type LifecycleHandlerDeps,
  type TitleChangeEvent,
  type ProcessChangeEvent,
} from './subscriptions';

export {
  ptyMetadataToInfo,
  createAggregateViewRefreshers,
  type AggregatePtyMetadata,
  type RefreshersResult,
} from './refresh';

export {
  extractGitMetadata,
  applyGitMetadataSnapshot,
  areGitDiffStatsEqual,
  hasGitMetadata,
  mergePtyInfoPreservingGitMetadata,
  didPtyInfoChange,
  type GitMetadataFields,
} from './git';

export {
  getCurrentPendingPaneCreation,
  setPendingPaneCreations,
  upsertPendingPaneCreation,
  removePendingPaneCreations,
  findPendingPaneCreation,
  getInsertedPaneOrder,
  getAppendedPaneOrder,
  getNextPendingPaneCreationOrder,
  findPendingPaneCreationForLifecycle,
} from './pending';

export {
  getSessionPaneOrderKey,
  getPaneOrder,
  getSessionPaneOrder,
  hasSessionPaneOrder,
  deleteSessionPaneOrder,
  setSessionPaneOrder,
  mergePaneOrder,
  mergeSessionPaneOrder,
  buildSessionPaneOrderFromAggregateState,
  type SessionPaneOrderIndex,
} from './pane-order';

export type {
  PtyInfo,
  GitDiffStats,
  AggregateViewState,
  PendingPaneCreation,
  AggregateViewContextValue,
} from '../aggregate-view-types';

export { TREE_GLYPHS as TREE_GLYPHS_TYPES, createInitialState } from '../aggregate-view-types';
