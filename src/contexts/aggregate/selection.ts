/**
 * Selection operations for aggregate view.
 */

import { produce, type SetStoreFunction } from 'solid-js/store';

import type { AggregateViewState, FlattenedTreeItem, PtyInfo } from './types';
import { SelectionOperationError } from './errors';
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
  }
}

export function clearPreviewState(
  state: Pick<AggregateViewState, 'previewMode' | 'previewZoomed'>
): void {
  state.previewMode = false;
  state.previewZoomed = false;
}

export function getSelectedPty(
  flattenedTree: FlattenedTreeItem[],
  selectedIndex: number
): PtyInfo | null {
  const item = flattenedTree[selectedIndex];
  if (item?.node.type === 'pty') {
    return item.node.ptyInfo;
  }
  return null;
}

export function getSelectedItem(
  flattenedTree: FlattenedTreeItem[],
  selectedIndex: number
): FlattenedTreeItem | undefined {
  return flattenedTree[selectedIndex];
}

export function getSelectedSessionId(
  flattenedTree: FlattenedTreeItem[],
  selectedIndex: number
): string | null {
  const item = getSelectedItem(flattenedTree, selectedIndex);
  if (!item) return null;

  if (item.node.type === 'pty') {
    return item.node.ptyInfo.sessionId;
  }
  if (item.node.type === 'session') {
    return item.node.session.id;
  }
  if (item.node.type === 'placeholder') {
    return item.node.parentSessionId;
  }
  return null;
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

  const replacement =
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

export function createSelectionActions(
  state: AggregateViewState,
  setState: SetStoreFunction<AggregateViewState>
) {
  const setSelectedIndex = (index: number) => {
    setState(
      produce((s) => {
        applySelection(s, index);
      })
    );
  };

  const selectPty = (ptyId: string) => {
    const index = state.flattenedTreeIndex.get(ptyId);
    if (index !== undefined) {
      setState(
        produce((s) => {
          applySelection(s, index);
        })
      );
    }
  };

  const enterPreviewMode = () => {
    setState('previewMode', true);
  };

  const exitPreviewMode = () => {
    setState(
      produce((s) => {
        clearPreviewState(s);
      })
    );
  };

  const togglePreviewZoom = () => {
    setState(
      produce((s) => {
        if (!s.previewMode || !s.selectedPtyId) return;
        s.previewZoomed = !s.previewZoomed;
      })
    );
  };

  return {
    setSelectedIndex,
    selectPty,
    enterPreviewMode,
    exitPreviewMode,
    togglePreviewZoom,
  };
}
