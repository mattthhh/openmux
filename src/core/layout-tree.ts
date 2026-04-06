/**
 * Layout tree helpers for split panes.
 */

import type { Direction, LayoutNode, PaneData, SplitDirection, SplitNode } from './types';

type TraversedNode = LayoutNode | null;

type TraverseOptions<TResult extends TraversedNode> = {
  onSplit?: (split: SplitNode, children: { first: TResult; second: TResult }) => TResult;
};

function mergeTraversedChildren<TResult extends TraversedNode>(
  split: SplitNode,
  first: TResult,
  second: TResult
): TResult {
  if (!first && !second) return null as TResult;
  if (!first) return second;
  if (!second) return first;
  if (first === split.first && second === split.second) return split as TResult;
  return { ...split, first, second } as TResult;
}

export function isSplitNode(node: LayoutNode): node is SplitNode {
  return (node as SplitNode).type === 'split';
}

/**
 * Traverse a layout tree and rebuild only the ancestor chain whose children changed.
 *
 * By default, split nodes preserve structural sharing and collapse when one child
 * is removed. Callers can override split handling for transforms such as cloning
 * or rectangle clearing.
 */
export function traverse<TResult extends TraversedNode>(
  node: LayoutNode,
  visitPane: (pane: PaneData) => TResult,
  options?: TraverseOptions<TResult>
): TResult {
  if (!isSplitNode(node)) {
    return visitPane(node);
  }

  const first = traverse(node.first, visitPane, options);
  const second = traverse(node.second, visitPane, options);

  if (options?.onSplit) {
    return options.onSplit(node, { first, second });
  }

  return mergeTraversedChildren(node, first, second);
}

export function collectPanes(node: LayoutNode | null, panes: PaneData[] = []): PaneData[] {
  if (!node) return panes;
  if (!isSplitNode(node)) {
    panes.push(node);
    return panes;
  }
  collectPanes(node.first, panes);
  collectPanes(node.second, panes);
  return panes;
}

export function containsPane(node: LayoutNode | null, paneId: string): boolean {
  if (!node) return false;
  if (!isSplitNode(node)) {
    return node.id === paneId;
  }
  return containsPane(node.first, paneId) || containsPane(node.second, paneId);
}

export function findPane(node: LayoutNode | null, paneId: string): PaneData | null {
  if (!node) return null;
  if (!isSplitNode(node)) {
    return node.id === paneId ? node : null;
  }
  return findPane(node.first, paneId) ?? findPane(node.second, paneId);
}

export function updatePaneInNode(
  node: LayoutNode,
  paneId: string,
  update: (pane: PaneData) => PaneData
): LayoutNode {
  return traverse(node, (pane) => {
    if (pane.id !== paneId) return pane;
    const updated = update(pane);
    return updated === pane ? pane : updated;
  });
}

export function replacePaneWithSplit(
  node: LayoutNode,
  paneId: string,
  newPane: PaneData,
  direction: SplitDirection,
  ratio: number,
  splitId: string
): LayoutNode {
  return traverse(node, (pane) => {
    if (pane.id !== paneId) return pane;
    return {
      type: 'split',
      id: splitId,
      direction,
      ratio,
      first: pane,
      second: newPane,
    };
  });
}

export function removePaneFromNode(node: LayoutNode, paneId: string): LayoutNode | null {
  return traverse(node, (pane) => (pane.id === paneId ? null : pane));
}

export function getFirstPane(node: LayoutNode | null): PaneData | null {
  if (!node) return null;
  if (!isSplitNode(node)) return node;
  return getFirstPane(node.first) ?? getFirstPane(node.second);
}

export function findSiblingPane(node: LayoutNode, paneId: string): PaneData | null {
  if (!isSplitNode(node)) return null;

  const search = (current: LayoutNode): PaneData | null => {
    if (!isSplitNode(current)) return null;
    if (containsPane(current.first, paneId)) {
      return search(current.first) ?? getFirstPane(current.second);
    }
    if (containsPane(current.second, paneId)) {
      return search(current.second) ?? getFirstPane(current.first);
    }
    return null;
  };

  return search(node);
}

function getSiblingForDirection(
  split: SplitNode,
  side: 'first' | 'second',
  direction: Direction
): LayoutNode | null {
  if (split.direction === 'vertical') {
    if (direction === 'west' && side === 'second') return split.first;
    if (direction === 'east' && side === 'first') return split.second;
    return null;
  }

  if (direction === 'north' && side === 'second') return split.first;
  if (direction === 'south' && side === 'first') return split.second;
  return null;
}

export function findSiblingInDirection(
  node: LayoutNode,
  paneId: string,
  direction: Direction
): LayoutNode | null {
  if (!isSplitNode(node)) return null;

  if (containsPane(node.first, paneId)) {
    const nested = findSiblingInDirection(node.first, paneId, direction);
    if (nested) return nested;
    return getSiblingForDirection(node, 'first', direction);
  }

  if (containsPane(node.second, paneId)) {
    const nested = findSiblingInDirection(node.second, paneId, direction);
    if (nested) return nested;
    return getSiblingForDirection(node, 'second', direction);
  }

  return null;
}

export function swapPaneInDirection(
  node: LayoutNode,
  paneId: string,
  direction: Direction
): { node: LayoutNode; swapped: boolean } {
  if (!isSplitNode(node)) return { node, swapped: false };

  if (containsPane(node.first, paneId)) {
    const result = swapPaneInDirection(node.first, paneId, direction);
    if (result.swapped) {
      const nextNode = result.node === node.first ? node : { ...node, first: result.node };
      return { node: nextNode, swapped: true };
    }
    // Only swap if both siblings are simple panes (not splits)
    // Otherwise, fall through to geometry-based swap which swaps individual pane data
    if (
      getSiblingForDirection(node, 'first', direction) &&
      !isSplitNode(node.first) &&
      !isSplitNode(node.second)
    ) {
      return { node: { ...node, first: node.second, second: node.first }, swapped: true };
    }
    return { node, swapped: false };
  }

  if (containsPane(node.second, paneId)) {
    const result = swapPaneInDirection(node.second, paneId, direction);
    if (result.swapped) {
      const nextNode = result.node === node.second ? node : { ...node, second: result.node };
      return { node: nextNode, swapped: true };
    }
    // Only swap if both siblings are simple panes (not splits)
    if (
      getSiblingForDirection(node, 'second', direction) &&
      !isSplitNode(node.first) &&
      !isSplitNode(node.second)
    ) {
      return { node: { ...node, first: node.second, second: node.first }, swapped: true };
    }
    return { node, swapped: false };
  }

  return { node, swapped: false };
}

/**
 * Swap two panes by ID in a single pass (handles both panes being in the same tree).
 * pane1Data replaces pane with paneId2, pane2Data replaces pane with paneId1.
 */
export function swapTwoPanesById(
  node: LayoutNode,
  paneId1: string,
  pane1Data: PaneData,
  paneId2: string,
  pane2Data: PaneData
): LayoutNode {
  return traverse(node, (pane) => {
    if (pane.id === paneId1) {
      return { ...pane2Data, rectangle: pane.rectangle };
    }
    if (pane.id === paneId2) {
      return { ...pane1Data, rectangle: pane.rectangle };
    }
    return pane;
  });
}

/**
 * Clear all rectangles from a layout node (and its children)
 * Useful when swapping nodes to ensure fresh rectangle calculation
 */
export function clearNodeRectangles(node: LayoutNode | null): LayoutNode | null {
  if (!node) return null;

  return traverse(
    node,
    (pane) => {
      if (!pane.rectangle) return pane;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { rectangle, ...rest } = pane;
      return rest as PaneData;
    },
    {
      onSplit: (split, { first, second }) => {
        if (!split.rectangle && first === split.first && second === split.second) {
          return split;
        }
        return {
          ...split,
          rectangle: undefined,
          first,
          second,
        };
      },
    }
  );
}

/**
 * Deep clone a layout node (and its children)
 * Used when swapping entire trees to ensure complete independence
 */
export function cloneLayoutNode(node: LayoutNode | null): LayoutNode | null {
  if (!node) return null;

  return traverse(node, (pane) => ({ ...pane }), {
    onSplit: (split, { first, second }) => ({
      ...split,
      first,
      second,
    }),
  });
}
