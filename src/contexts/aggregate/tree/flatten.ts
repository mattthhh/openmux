/**
 * Tree flattening operations for aggregate view.
 */

import type { TreeNode, FlattenedTreeItem } from '../types';
import { isActivePty } from '../filter/operations';
import { TREE_GLYPHS } from '../types';

/** Compute tree prefix for a node at given depth and position */
export function computeTreePrefix(depth: number, isLast: boolean): string {
  if (depth === 0) return '';
  return isLast ? TREE_GLYPHS.BRANCH_LAST : TREE_GLYPHS.BRANCH_MIDDLE;
}

/** Compute full indent prefix including ancestor vertical lines */
export function computeIndentPrefix(ancestorIsLast: boolean[]): string {
  if (ancestorIsLast.length === 0) return '';

  let prefix = '';
  for (let i = 0; i < ancestorIsLast.length - 1; i++) {
    prefix += ancestorIsLast[i] ? TREE_GLYPHS.EMPTY : TREE_GLYPHS.VERTICAL;
  }
  prefix += ancestorIsLast[ancestorIsLast.length - 1]
    ? TREE_GLYPHS.BRANCH_LAST
    : TREE_GLYPHS.BRANCH_MIDDLE;

  return prefix;
}

/** Get session ID from a flattened item */
export function getSessionIdForItem(item: FlattenedTreeItem | undefined): string | null {
  if (!item) return null;
  if (item.node.type === 'session') return item.node.session.id;
  if (item.node.type === 'pty') return item.node.ptyInfo.sessionId;
  if (item.node.type === 'placeholder') return item.node.parentSessionId;
  return null;
}

/** Check if item is selectable (not a spacer) */
export function isSelectableItem(item: FlattenedTreeItem | undefined): boolean {
  return !!item && item.node.type !== 'spacer';
}

/** Build index map from ptyId to flattened tree index */
export function buildFlattenedTreeIndex(
  flattenedTree: FlattenedTreeItem[]
): Map<string, number> {
  const index = new Map<string, number>();
  for (const item of flattenedTree) {
    if (item.node.type === 'pty') {
      index.set(item.node.ptyInfo.ptyId, item.index);
    }
  }
  return index;
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

/** Flatten tree nodes for visual navigation with computed prefixes */
export function flattenTree(
  treeRoot: TreeNode[],
  filterQuery: string,
  showInactive: boolean
): FlattenedTreeItem[] {
  const flattened: FlattenedTreeItem[] = [];
  const query = filterQuery.trim().toLowerCase();
  const hasFilter = query.length > 0;

  const sessionGroups = new Map<
    string,
    { sessionNode: TreeNode; childNodes: TreeNode[] }
  >();

  let currentSessionId: string | null = null;

  for (const node of treeRoot) {
    if (node.type === 'session') {
      currentSessionId = node.session.id;
      sessionGroups.set(currentSessionId, { sessionNode: node, childNodes: [] });
    } else if (currentSessionId) {
      const group = sessionGroups.get(currentSessionId);
      if (group) {
        group.childNodes.push(node);
      }
    }
  }

  const groups = [...sessionGroups.values()];
  let index = 0;

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const group = groups[groupIndex];
    const sessionNode = group.sessionNode;
    if (sessionNode.type !== 'session') continue;

    let visibleChildren = group.childNodes;

    if (!showInactive) {
      visibleChildren = visibleChildren.filter((n) =>
        n.type === 'pty' ? isActivePty(n.ptyInfo) : true
      );
    }

    if (hasFilter) {
      visibleChildren = visibleChildren.filter((n) => {
        if (n.type !== 'pty') return true;
        const pty = n.ptyInfo;
        const cwd = pty.cwd.toLowerCase();
        const branch = pty.gitBranch?.toLowerCase() ?? '';
        const process = pty.foregroundProcess?.toLowerCase() ?? '';
        return (
          cwd.includes(query) || branch.includes(query) || process.includes(query)
        );
      });
    }

    const visiblePtyCount = visibleChildren.filter((n) => n.type === 'pty').length;
    if (hasFilter && visiblePtyCount === 0) {
      continue;
    }

    flattened.push({
      node: sessionNode,
      depth: 0,
      isLast: false,
      prefix: '',
      index: index++,
      parentSessionId: undefined,
    });

    for (let i = 0; i < visibleChildren.length; i++) {
      const childNode = visibleChildren[i];
      const isLastChild = i === visibleChildren.length - 1;
      const parentSessionId =
        childNode.type === 'session'
          ? undefined
          : 'parentSessionId' in childNode
            ? childNode.parentSessionId
            : undefined;

      flattened.push({
        node: childNode,
        depth: 1,
        isLast: isLastChild,
        prefix: isLastChild ? TREE_GLYPHS.BRANCH_LAST : TREE_GLYPHS.BRANCH_MIDDLE,
        index: index++,
        parentSessionId,
      });
    }

    if (groupIndex < groups.length - 1) {
      flattened.push({
        node: { type: 'spacer' },
        depth: 0,
        isLast: false,
        prefix: '',
        index: index++,
        parentSessionId: undefined,
      });
    }
  }

  for (let i = 0; i < flattened.length; i++) {
    const item = flattened[i];
    if (item.node.type === 'session') {
      let nextSessionIndex = -1;
      for (let j = i + 1; j < flattened.length; j++) {
        if (flattened[j].node.type === 'session') {
          nextSessionIndex = j;
          break;
        }
      }
      item.isLast = nextSessionIndex === -1;
      item.prefix = item.isLast
        ? TREE_GLYPHS.BRANCH_LAST
        : TREE_GLYPHS.BRANCH_MIDDLE;
    }
  }

  return flattened;
}
