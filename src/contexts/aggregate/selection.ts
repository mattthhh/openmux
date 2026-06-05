/**
 * Selection operations for aggregate view.
 */

import type { AggregateViewState, FlattenedTreeItem } from './types';
import type { SelectionOperationError } from './errors';
import { findNearestSelectableIndex, getSessionIdForItem } from './tree';

export function applySelection(state: AggregateViewState, index: number): void {
  const targetIndex = findNearestSelectableIndex(state.flattenedTree, index);

  if (targetIndex === null) {
    state.selectedIndex = 0;
    state.selectedPtyId = null;
    state.selectedSessionId = null;
    clearPreviewState(state);
    return;
  }

  const item = state.flattenedTree[targetIndex];
  state.selectedIndex = targetIndex;
  state.selectedPtyId = item?.node.type === 'pty' ? item.node.ptyInfo.ptyId : null;
  state.selectedSessionId = getSessionIdForItem(item);

  if (state.selectedPtyId === null) {
    clearPreviewState(state);
  } else {
    state.previewMode = true;
  }
}

export function clearPreviewState(
  state: Pick<AggregateViewState, 'previewMode' | 'previewZoomed'>
): void {
  state.previewMode = false;
  state.previewZoomed = false;
}

export function findNearestSelectable(
  flattenedTree: FlattenedTreeItem[],
  startIndex: number,
  direction: 'up' | 'down'
): { index: number; item: FlattenedTreeItem } | null {
  const delta = direction === 'up' ? -1 : 1;
  let index = startIndex + delta;

  while (index >= 0 && index < flattenedTree.length) {
    const item = flattenedTree[index];
    if (item && item.node.type !== 'spacer') {
      return { index, item };
    }
    index += delta;
  }

  return null;
}

export function findNearestPtyInSessionAbove(
  flattenedTree: FlattenedTreeItem[],
  startIndex: number,
  sessionId: string
): { index: number; item: FlattenedTreeItem } | null {
  for (let index = startIndex - 1; index >= 0; index--) {
    const item = flattenedTree[index];
    if (item?.node.type === 'session') {
      break;
    }
    if (item?.node.type === 'pty' && item.parentSessionId === sessionId) {
      return { index, item };
    }
  }

  return null;
}

export function findSessionHeader(
  flattenedTree: FlattenedTreeItem[],
  startIndex: number,
  sessionId: string
): { index: number; item: FlattenedTreeItem } | null {
  for (let index = startIndex - 1; index >= 0; index--) {
    const item = flattenedTree[index];
    if (item?.node.type === 'session' && item.node.session.id === sessionId) {
      return { index, item };
    }
  }

  return null;
}

/**
 * Find the first PTY on the MRU stack that is still present in the
 * flattened tree (i.e. visible/selectable) and is not the removed PTY.
 * This naturally returns the selection to the previously-used PTY when
 * a newly-created PTY is closed.
 */
function findMruReplacement(
  state: AggregateViewState,
  removedPtyId: string
): { index: number; item: FlattenedTreeItem } | null {
  const mru = state.ptyMru;
  if (!mru || mru.length === 0) return null;
  for (const mruPtyId of mru) {
    if (mruPtyId === removedPtyId) continue;
    const flatIndex = state.flattenedTreeIndex.get(mruPtyId);
    if (flatIndex === undefined) continue;
    const item = state.flattenedTree[flatIndex];
    if (item?.node.type === 'pty') return { index: flatIndex, item };
  }
  return null;
}

export function selectAfterPtyRemoval(
  state: AggregateViewState,
  removedPtyId: string
): SelectionOperationError | null {
  const removedIndex = state.flattenedTreeIndex.get(removedPtyId);

  if (removedIndex === undefined) {
    return null;
  }

  const removedItem = state.flattenedTree[removedIndex];
  const removedSessionId = removedItem?.node.type === 'pty' ? removedItem.parentSessionId : null;

  // Prefer the MRU stack — this returns the selection to the previously-used
  // PTY when closing a newly-created one, instead of jumping to the nearest
  // spatial neighbour (which typically moves down).
  const replacement =
    findMruReplacement(state, removedPtyId) ??
    findNearestSelectable(state.flattenedTree, removedIndex, 'down') ??
    (removedSessionId
      ? findNearestPtyInSessionAbove(state.flattenedTree, removedIndex, removedSessionId)
      : null) ??
    (removedSessionId
      ? findSessionHeader(state.flattenedTree, removedIndex, removedSessionId)
      : null) ??
    findNearestSelectable(state.flattenedTree, removedIndex, 'up');

  if (replacement) {
    applySelection(state, replacement.index);
    return null;
  }

  state.selectedIndex = 0;
  state.selectedPtyId = null;
  state.selectedSessionId = null;
  clearPreviewState(state);
  return null;
}
