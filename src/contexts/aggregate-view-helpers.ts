/**
 * Aggregate view helper compatibility layer.
 */

export { TREE_GLYPHS } from './aggregate-view-types';

export {
  normalizeProcessName,
  isActivePty,
  filterActivePtys,
  filterPtysByActivity,
  getBasePtys,
  filterPtys,
  buildPtyIndex,
  groupPtysBySession,
  sortPtysForSession,
  extractSessionIds,
} from './aggregate/filter';

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
} from './aggregate/tree';

export {
  clearPreviewState,
  applySelection,
  getSelectedPty,
  getSelectedItem,
  getSelectedSessionId,
  findNearestSelectable,
  findNearestPtyInSessionAbove,
  findSessionHeader,
  selectAfterPtyRemoval,
} from './aggregate/selection';

export {
  toggleSessionExpanded,
  getSortedSessions,
  recomputeMatches,
  recomputeTree,
} from './aggregate/session';
