/**
 * Aggregate view helper barrel.
 *
 * The aggregate modules are split by concern, but many callers still want a
 * single import surface for tree, selection, filtering, and session helpers.
 */

export { TREE_GLYPHS } from './aggregate-view-types';

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
} from './aggregate/filter';

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
} from './aggregate/tree';

export {
  clearPreviewState,
  applySelection,
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
