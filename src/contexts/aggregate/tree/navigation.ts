/**
 * Tree navigation operations for aggregate view.
 */

import type { FlattenedTreeItem } from '../types';
import { isSelectableItem } from './flatten';
import { TreeOperationError } from '../errors';

/** Navigation result */
export interface NavigationResult {
  index: number;
  item: FlattenedTreeItem | undefined;
}

/** Find nearest selectable index from a starting point */
export function findNearestSelectableIndex(
  items: FlattenedTreeItem[],
  index: number
): number | null {
  if (items.length === 0) return null;
  if (isSelectableItem(items[index])) return index;

  for (let distance = 1; distance < items.length; distance++) {
    const lower = index - distance;
    if (lower >= 0 && isSelectableItem(items[lower])) return lower;
    const upper = index + distance;
    if (upper < items.length && isSelectableItem(items[upper])) return upper;
  }

  return null;
}

/** Navigate up in the tree */
export function navigateUp(
  flattenedTree: FlattenedTreeItem[],
  currentIndex: number
): NavigationResult | TreeOperationError {
  if (flattenedTree.length === 0) {
    return new TreeOperationError({
      operation: 'navigateUp',
      reason: 'Tree is empty',
    });
  }

  let nextIndex = currentIndex - 1;
  while (nextIndex >= 0 && !isSelectableItem(flattenedTree[nextIndex])) {
    nextIndex -= 1;
  }

  if (nextIndex < 0) {
    return new TreeOperationError({
      operation: 'navigateUp',
      reason: 'No selectable item above',
    });
  }

  return {
    index: nextIndex,
    item: flattenedTree[nextIndex],
  };
}

/** Navigate down in the tree */
export function navigateDown(
  flattenedTree: FlattenedTreeItem[],
  currentIndex: number
): NavigationResult | TreeOperationError {
  if (flattenedTree.length === 0) {
    return new TreeOperationError({
      operation: 'navigateDown',
      reason: 'Tree is empty',
    });
  }

  let nextIndex = currentIndex + 1;
  while (nextIndex < flattenedTree.length && !isSelectableItem(flattenedTree[nextIndex])) {
    nextIndex += 1;
  }

  if (nextIndex >= flattenedTree.length) {
    return new TreeOperationError({
      operation: 'navigateDown',
      reason: 'No selectable item below',
    });
  }

  return {
    index: nextIndex,
    item: flattenedTree[nextIndex],
  };
}

/** Navigate to specific index with bounds checking */
export function navigateToIndex(
  flattenedTree: FlattenedTreeItem[],
  targetIndex: number
): NavigationResult | TreeOperationError {
  if (flattenedTree.length === 0) {
    return new TreeOperationError({
      operation: 'navigateToIndex',
      reason: 'Tree is empty',
    });
  }

  const maxIndex = Math.max(0, flattenedTree.length - 1);
  const clamped = Math.min(maxIndex, Math.max(0, targetIndex));
  const selectableIndex = findNearestSelectableIndex(flattenedTree, clamped);

  if (selectableIndex === null) {
    return new TreeOperationError({
      operation: 'navigateToIndex',
      reason: 'No selectable items in tree',
    });
  }

  return {
    index: selectableIndex,
    item: flattenedTree[selectableIndex],
  };
}

/** Find index of PTY by ID */
export function findPtyIndex(
  flattenedTree: FlattenedTreeItem[],
  ptyId: string
): number | null {
  const index = flattenedTree.findIndex(
    (item) => item.node.type === 'pty' && item.node.ptyInfo.ptyId === ptyId
  );
  return index >= 0 ? index : null;
}
