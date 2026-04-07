/**
 * Aggregate View modular architecture.
 */

export {
  TreeOperationError,
  FilterOperationError,
  SelectionOperationError,
  SessionOperationError,
  type AggregateViewError,
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
  computeTreePrefix,
  computeIndentPrefix,
  getSessionIdForItem,
  isSelectableItem,
  buildFlattenedTreeIndex,
  findNearestSelectableIndex,
  flattenTree,
  navigateUp,
  navigateDown,
  navigateToIndex,
  findPtyIndex,
  type NavigationResult,
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
} from './subscriptions';

export type {
  PtyOwnership,
  CurrentSessionMetadata,
  CurrentSessionLayoutPty,
} from './current-session';

export {
  ptyMetadataToInfo,
  collectSerializedPaneIds,
  buildSessionPaneOrder,
  findWorkspaceIdForPane,
  createAggregateViewRefreshers,
  type AggregatePtyMetadata,
  type ResolvedPty,
  type SessionSummary,
  type CreateRefreshersParams,
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
  type PtyChangeResult,
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
