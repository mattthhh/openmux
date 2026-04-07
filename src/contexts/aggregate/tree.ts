/**
 * Tree operations for aggregate view.
 */

import type { SessionMetadata } from '../../effect/models';

import { TreeOperationError } from './errors';
import { isActivePty, sortPtysForSession } from './filter';
import {
  getSessionPaneOrder,
  hasSessionPaneOrder,
  type LegacySessionPaneOrders,
} from './pane-order';
import type {
  FlattenedTreeItem,
  PlaceholderTreeNode,
  PtyInfo,
  PtyTreeNode,
  SessionLoadState,
  SessionPaneOrderIndex,
  SessionTreeNode,
  SpacerTreeNode,
  TreeNode,
} from './types';
import { TREE_GLYPHS } from './types';

export type {
  FlattenedTreeItem,
  PlaceholderTreeNode,
  PtyTreeNode,
  SessionLoadState,
  SessionTreeNode,
  SpacerTreeNode,
  TreeNode,
};

export { TREE_GLYPHS } from './types';

export function getDefaultLoadState(): SessionLoadState {
  return { status: 'unloaded' };
}

export function createLoadingPlaceholder(parentSessionId: string): TreeNode {
  return {
    type: 'placeholder',
    parentSessionId,
    message: 'Loading...',
    isLoading: true,
  };
}

export function createErrorPlaceholder(parentSessionId: string, error: string): TreeNode {
  return {
    type: 'placeholder',
    parentSessionId,
    message: `Error: ${error}`,
    isLoading: false,
  };
}

export function createUnloadedPlaceholder(
  parentSessionId: string,
  lastActiveWorkspaceId?: number
): TreeNode {
  return {
    type: 'placeholder',
    parentSessionId,
    message: lastActiveWorkspaceId
      ? `Workspace ${lastActiveWorkspaceId} (unloaded)`
      : 'Session (unloaded)',
    isLoading: false,
    lastActiveWorkspaceId,
  };
}

export function buildTreeRoot(
  sessions: SessionMetadata[],
  ptysBySession: Map<string, PtyInfo[]>,
  expandedSessionIds: Set<string>,
  sessionLoadStates: Map<string, SessionLoadState>,
  sessionPaneOrders: LegacySessionPaneOrders,
  sessionPaneOrderIndex?: SessionPaneOrderIndex
): TreeNode[] {
  const root: TreeNode[] = [];

  for (const session of sessions) {
    const loadState = sessionLoadStates.get(session.id) ?? getDefaultLoadState();
    const paneOrderSource =
      sessionPaneOrderIndex && hasSessionPaneOrder(sessionPaneOrderIndex, session.id)
        ? sessionPaneOrderIndex
        : sessionPaneOrders;
    const sessionPtys = sortPtysForSession(
      ptysBySession.get(session.id) ?? [],
      getSessionPaneOrder(paneOrderSource, session.id)
    );

    const activePtyCount = sessionPtys.filter(isActivePty).length;
    const isExpanded = expandedSessionIds.has(session.id);
    const ptyCount = sessionPtys.length > 0 ? sessionPtys.length : (loadState.paneCount ?? 0);

    const sessionNode: SessionTreeNode = {
      type: 'session',
      session,
      ptyCount,
      activePtyCount,
      loadState,
      isExpanded,
    };
    root.push(sessionNode);

    if (loadState.status === 'loading') {
      root.push(createLoadingPlaceholder(session.id));
      continue;
    }

    if (loadState.status === 'error') {
      root.push(createErrorPlaceholder(session.id, loadState.error));
      continue;
    }

    if (loadState.status === 'unloaded') {
      root.push(createUnloadedPlaceholder(session.id, loadState.lastActiveWorkspaceId));
      continue;
    }

    if (isExpanded) {
      for (const pty of sessionPtys) {
        root.push({
          type: 'pty',
          ptyInfo: pty,
          parentSessionId: session.id,
        });
      }
    }
  }

  return root;
}

export function computeTreePrefix(depth: number, isLast: boolean): string {
  if (depth === 0) return '';
  return isLast ? TREE_GLYPHS.BRANCH_LAST : TREE_GLYPHS.BRANCH_MIDDLE;
}

export function computeIndentPrefix(ancestorIsLast: boolean[]): string {
  if (ancestorIsLast.length === 0) return '';

  let prefix = '';
  for (let index = 0; index < ancestorIsLast.length - 1; index++) {
    prefix += ancestorIsLast[index] ? TREE_GLYPHS.EMPTY : TREE_GLYPHS.VERTICAL;
  }
  prefix += ancestorIsLast[ancestorIsLast.length - 1]
    ? TREE_GLYPHS.BRANCH_LAST
    : TREE_GLYPHS.BRANCH_MIDDLE;

  return prefix;
}

export function getSessionIdForItem(item: FlattenedTreeItem | undefined): string | null {
  if (!item) return null;
  if (item.node.type === 'session') return item.node.session.id;
  if (item.node.type === 'pty') return item.node.ptyInfo.sessionId;
  if (item.node.type === 'placeholder') return item.node.parentSessionId;
  return null;
}

export function isSelectableItem(item: FlattenedTreeItem | undefined): boolean {
  return !!item && item.node.type !== 'spacer';
}

export function buildFlattenedTreeIndex(flattenedTree: FlattenedTreeItem[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const item of flattenedTree) {
    if (item.node.type === 'pty') {
      index.set(item.node.ptyInfo.ptyId, item.index);
    }
  }
  return index;
}

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

export function flattenTree(
  treeRoot: TreeNode[],
  filterQuery: string,
  showInactive: boolean
): FlattenedTreeItem[] {
  const flattened: FlattenedTreeItem[] = [];
  const query = filterQuery.trim().toLowerCase();
  const hasFilter = query.length > 0;

  const sessionGroups = new Map<string, { sessionNode: TreeNode; childNodes: TreeNode[] }>();
  let currentSessionId: string | null = null;

  for (const node of treeRoot) {
    if (node.type === 'session') {
      currentSessionId = node.session.id;
      sessionGroups.set(currentSessionId, { sessionNode: node, childNodes: [] });
      continue;
    }
    if (!currentSessionId) {
      continue;
    }
    const group = sessionGroups.get(currentSessionId);
    if (group) {
      group.childNodes.push(node);
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
      visibleChildren = visibleChildren.filter((node) =>
        node.type === 'pty' ? isActivePty(node.ptyInfo) : true
      );
    }

    if (hasFilter) {
      visibleChildren = visibleChildren.filter((node) => {
        if (node.type !== 'pty') return true;
        const cwd = node.ptyInfo.cwd.toLowerCase();
        const branch = node.ptyInfo.gitBranch?.toLowerCase() ?? '';
        const process = node.ptyInfo.foregroundProcess?.toLowerCase() ?? '';
        return cwd.includes(query) || branch.includes(query) || process.includes(query);
      });
    }

    const visiblePtyCount = visibleChildren.filter((node) => node.type === 'pty').length;
    if (hasFilter && sessionNode.isExpanded && visiblePtyCount === 0) {
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

    for (let childIndex = 0; childIndex < visibleChildren.length; childIndex++) {
      const childNode = visibleChildren[childIndex];
      const isLastChild = childIndex === visibleChildren.length - 1;
      flattened.push({
        node: childNode,
        depth: 1,
        isLast: isLastChild,
        prefix: isLastChild ? TREE_GLYPHS.BRANCH_LAST : TREE_GLYPHS.BRANCH_MIDDLE,
        index: index++,
        parentSessionId:
          childNode.type === 'session'
            ? undefined
            : 'parentSessionId' in childNode
              ? childNode.parentSessionId
              : undefined,
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

  for (let currentIndex = 0; currentIndex < flattened.length; currentIndex++) {
    const item = flattened[currentIndex];
    if (item.node.type !== 'session') {
      continue;
    }

    let nextSessionIndex = -1;
    for (let searchIndex = currentIndex + 1; searchIndex < flattened.length; searchIndex++) {
      if (flattened[searchIndex].node.type === 'session') {
        nextSessionIndex = searchIndex;
        break;
      }
    }
    item.isLast = nextSessionIndex === -1;
    item.prefix = item.isLast ? TREE_GLYPHS.BRANCH_LAST : TREE_GLYPHS.BRANCH_MIDDLE;
  }

  return flattened;
}
