/**
 * Selection operations for aggregate view.
 */

import type { AggregateViewState, FlattenedTreeItem, PtyInfo } from '../types';
import type { SetStoreFunction } from 'solid-js/store';
import { produce } from 'solid-js/store';
import { findNearestSelectableIndex, getSessionIdForItem } from '../tree/flatten';
import { SelectionOperationError } from '../errors';

/** Apply selection to state at given index */
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

/** Clear preview state */
export function clearPreviewState(
  state: Pick<AggregateViewState, 'previewMode' | 'previewZoomed'>
): void {
  state.previewMode = false;
  state.previewZoomed = false;
}

/** Get selected PTY info from flattened tree */
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

/** Get selected item from flattened tree */
export function getSelectedItem(
  flattenedTree: FlattenedTreeItem[],
  selectedIndex: number
): FlattenedTreeItem | undefined {
  return flattenedTree[selectedIndex];
}

/** Get session ID for selected item */
export function getSelectedSessionId(
  flattenedTree: FlattenedTreeItem[],
  selectedIndex: number
): string | null {
  const item = getSelectedItem(flattenedTree, selectedIndex);
  if (!item) return null;

  if (item.node.type === 'pty') {
    return item.node.ptyInfo.sessionId;
  } else if (item.node.type === 'session') {
    return item.node.session.id;
  } else if (item.node.type === 'placeholder') {
    return item.node.parentSessionId;
  }
  return null;
}

/** Find nearest PTY in same session */
export function findNearestPtyInSession(
  flattenedTree: FlattenedTreeItem[],
  sessionId: string,
  startIndex: number,
  direction: 'up' | 'down'
): { index: number; ptyId: string } | null {
  const delta = direction === 'up' ? -1 : 1;
  let index = startIndex + delta;

  while (index >= 0 && index < flattenedTree.length) {
    const item = flattenedTree[index];
    if (item?.node.type === 'pty' && item.parentSessionId === sessionId) {
      return { index, ptyId: item.node.ptyInfo.ptyId };
    }
    if (item?.node.type === 'session') {
      break;
    }
    index += delta;
  }

  return null;
}

/** Select PTY after removal with smart fallback logic */
export function selectAfterPtyRemoval(
  state: AggregateViewState,
  removedPtyId: string
): SelectionOperationError | null {
  const flattened = state.flattenedTree;
  const removedIndex = state.flattenedTreeIndex.get(removedPtyId);

  if (removedIndex === undefined) {
    return null;
  }

  const removedItem = flattened[removedIndex];
  const sessionId = removedItem?.node.type === 'pty' ? removedItem.parentSessionId : null;

  let replacement: { index: number; ptyId: string } | null = null;

  if (sessionId) {
    // 1. Try above in same session (up)
    replacement = findNearestPtyInSession(flattened, sessionId, removedIndex, 'up');
    // 2. Try below in same session (down)
    if (!replacement) {
      replacement = findNearestPtyInSession(flattened, sessionId, removedIndex, 'down');
    }
  }

  // 3. Try any PTY above (up)
  if (!replacement) {
    for (let i = removedIndex - 1; i >= 0; i--) {
      const item = flattened[i];
      if (item?.node.type === 'pty') {
        replacement = { index: i, ptyId: item.node.ptyInfo.ptyId };
        break;
      }
    }
  }

  // 4. Try any PTY below (down)
  if (!replacement) {
    for (let i = removedIndex + 1; i < flattened.length; i++) {
      const item = flattened[i];
      if (item?.node.type === 'pty') {
        replacement = { index: i, ptyId: item.node.ptyInfo.ptyId };
        break;
      }
    }
  }

  // 5. First available PTY anywhere
  if (!replacement) {
    for (let i = 0; i < flattened.length; i++) {
      const item = flattened[i];
      if (item?.node.type === 'pty') {
        replacement = { index: i, ptyId: item.node.ptyInfo.ptyId };
        break;
      }
    }
  }

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

/** Create selection action helpers bound to state */
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
