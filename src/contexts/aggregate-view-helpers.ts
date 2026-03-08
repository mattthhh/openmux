/**
 * Helper functions for AggregateViewContext.
 */

import type {
  PtyInfo,
  AggregateViewState,
  FlattenedTreeItem,
  TreeNode,
  SessionTreeNode,
  SessionLoadState,
} from './aggregate-view-types';
import { TREE_GLYPHS } from './aggregate-view-types';
import type { SessionMetadata } from '../effect/models';

export { TREE_GLYPHS };

/** Filter PTYs by search query (matches cwd, git branch, or process) */
export function filterPtys(ptys: PtyInfo[], query: string): PtyInfo[] {
  if (!query.trim()) return ptys;

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return ptys;

  return ptys.filter((pty) => {
    const cwd = pty.cwd.toLowerCase();
    const branch = pty.gitBranch?.toLowerCase() ?? '';
    const process = pty.foregroundProcess?.toLowerCase() ?? '';
    // OR logic: match if ANY term matches ANY field
    return terms.some((term) =>
      cwd.includes(term) || branch.includes(term) || process.includes(term)
    );
  });
}

/** Normalize process names for comparisons (strip paths, lowercase) */
export function normalizeProcessName(name: string | undefined): string {
  if (!name) return '';
  const trimmed = name.trim();
  if (!trimmed) return '';
  const base = trimmed.split('/').pop() ?? trimmed;
  return base.toLowerCase();
}

/** Active PTY = foreground process is not just the shell */
export function isActivePty(pty: PtyInfo): boolean {
  const processName = normalizeProcessName(pty.foregroundProcess);
  if (!processName) return false;
  const shellName = normalizeProcessName(pty.shell);
  if (!shellName) return true;
  return processName !== shellName;
}

/** Filter PTYs to only those with active foreground processes */
export function filterActivePtys(ptys: PtyInfo[]): PtyInfo[] {
  return ptys.filter(isActivePty);
}

/** Apply active/inactive filtering based on scope flag */
export function getBasePtys(ptys: PtyInfo[], showInactive: boolean): PtyInfo[] {
  return showInactive ? ptys : filterActivePtys(ptys);
}

/** Build an index map from ptyId to array index for O(1) lookups */
export function buildPtyIndex(ptys: PtyInfo[]): Map<string, number> {
  return new Map(ptys.map((p, i) => [p.ptyId, i]));
}

/** Group PTYs by session ID */
export function groupPtysBySession(ptys: PtyInfo[]): Map<string, PtyInfo[]> {
  const groups = new Map<string, PtyInfo[]>();
  for (const pty of ptys) {
    const sessionId = pty.sessionId;
    const existing = groups.get(sessionId);
    if (existing) {
      existing.push(pty);
    } else {
      groups.set(sessionId, [pty]);
    }
  }
  return groups;
}

/** Get default session load state */
export function getDefaultLoadState(): SessionLoadState {
  return { status: 'unloaded' };
}

function sortPtysForSession(
  ptys: PtyInfo[],
  paneOrder: Map<string, number> | undefined
): PtyInfo[] {
  return [...ptys].sort((a, b) => {
    const aOrder = a.paneId ? paneOrder?.get(a.paneId) : undefined;
    const bOrder = b.paneId ? paneOrder?.get(b.paneId) : undefined;

    const aHasOrder = aOrder !== undefined ? 1 : 0;
    const bHasOrder = bOrder !== undefined ? 1 : 0;
    if (aHasOrder !== bHasOrder) return bHasOrder - aHasOrder;
    if (aOrder !== undefined && bOrder !== undefined && aOrder !== bOrder) {
      return aOrder - bOrder;
    }

    const workspaceCompare =
      (a.workspaceId ?? Number.MAX_SAFE_INTEGER) -
      (b.workspaceId ?? Number.MAX_SAFE_INTEGER);
    if (workspaceCompare !== 0) return workspaceCompare;

    return (a.paneId ?? a.ptyId).localeCompare(b.paneId ?? b.ptyId);
  });
}

/** Build tree root from sessions and grouped PTYs */
export function buildTreeRoot(
  sessions: SessionMetadata[],
  ptysBySession: Map<string, PtyInfo[]>,
  expandedSessionIds: Set<string>,
  sessionLoadStates: Map<string, SessionLoadState>,
  sessionPaneOrders: Map<string, Map<string, number>>
): TreeNode[] {
  const root: TreeNode[] = [];

  for (const session of sessions) {
    const loadState = sessionLoadStates.get(session.id) ?? getDefaultLoadState();
    const sessionPtys = sortPtysForSession(
      ptysBySession.get(session.id) ?? [],
      sessionPaneOrders.get(session.id)
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
      root.push({
        type: 'placeholder',
        parentSessionId: session.id,
        message: 'Loading...',
        isLoading: true,
      });
      continue;
    }

    if (loadState.status === 'error') {
      root.push({
        type: 'placeholder',
        parentSessionId: session.id,
        message: `Error: ${loadState.error}`,
        isLoading: false,
        lastActiveWorkspaceId: loadState.lastActiveWorkspaceId,
      });
      continue;
    }

    if (loadState.status === 'unloaded') {
      root.push({
        type: 'placeholder',
        parentSessionId: session.id,
        message: '...',
        isLoading: false,
        lastActiveWorkspaceId: loadState.lastActiveWorkspaceId,
      });
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

/** Compute tree prefix for a node at given depth and position */
export function computeTreePrefix(depth: number, isLast: boolean): string {
  if (depth === 0) {
    return '';
  }

  // For depth > 0, we need to build the prefix from ancestor states
  // This simplified version assumes single-level nesting (sessions -> PTYs)
  // For deeper trees, we'd need to track isLast for each ancestor
  return isLast ? TREE_GLYPHS.BRANCH_LAST : TREE_GLYPHS.BRANCH_MIDDLE;
}

/** Compute full indent prefix including ancestor vertical lines */
export function computeIndentPrefix(ancestorIsLast: boolean[]): string {
  if (ancestorIsLast.length === 0) {
    return '';
  }

  let prefix = '';
  for (let i = 0; i < ancestorIsLast.length - 1; i++) {
    prefix += ancestorIsLast[i] ? TREE_GLYPHS.EMPTY : TREE_GLYPHS.VERTICAL;
  }
  prefix += ancestorIsLast[ancestorIsLast.length - 1]
    ? TREE_GLYPHS.BRANCH_LAST
    : TREE_GLYPHS.BRANCH_MIDDLE;

  return prefix;
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

/** Recompute matched PTYs after state changes */
export function recomputeMatches(state: AggregateViewState): void {
  const basePtys = getBasePtys(state.allPtys, state.showInactive);
  const matchedPtys = filterPtys(basePtys, state.filterQuery);
  const matchedPtysIndex = buildPtyIndex(matchedPtys);

  state.matchedPtys = matchedPtys;
  state.matchedPtysIndex = matchedPtysIndex;

  if (state.selectedPtyId && !matchedPtysIndex.has(state.selectedPtyId)) {
    state.selectedPtyId = null;
    state.previewMode = false;
  }
}

function getSessionIdForItem(item: FlattenedTreeItem | undefined): string | null {
  if (!item) return null;
  if (item.node.type === 'session') return item.node.session.id;
  if (item.node.type === 'pty') return item.node.ptyInfo.sessionId;
  if (item.node.type === 'placeholder') return item.node.parentSessionId;
  return null;
}

/** Recompute tree structure and flattened navigation */
export function recomputeTree(state: AggregateViewState): void {
  const previousTree = state.flattenedTree;
  const previousSelectedIndex = state.selectedIndex;
  const previousSelectedItem = previousTree[previousSelectedIndex];
  const previousSelectedType = previousSelectedItem?.node.type;
  const previousSelectedSessionId =
    state.selectedSessionId ?? getSessionIdForItem(previousSelectedItem);
  const previousSessionIds = new Set(
    state.treeRoot
      .filter((node): node is SessionTreeNode => node.type === 'session')
      .map((node) => node.session.id)
  );

  const ptysBySession = groupPtysBySession(state.matchedPtys);
  const manualOrderIndex = new Map(
    state.manualSessionOrder.map((sessionId, index) => [sessionId, index] as const)
  );
  const sessions = [...state.allSessions.values()].sort((a, b) => {
    const aManual = manualOrderIndex.get(a.id);
    const bManual = manualOrderIndex.get(b.id);

    if (aManual !== undefined && bManual !== undefined) {
      return aManual - bManual;
    }
    if (aManual !== undefined) return -1;
    if (bManual !== undefined) return 1;

    return a.name.localeCompare(b.name);
  });

  for (const session of sessions) {
    if (!previousSessionIds.has(session.id) && !state.expandedSessionIds.has(session.id)) {
      state.expandedSessionIds.add(session.id);
    }
  }

  state.treeRoot = buildTreeRoot(
    sessions,
    ptysBySession,
    state.expandedSessionIds,
    state.sessionLoadStates,
    state.sessionPaneOrders
  );

  state.flattenedTree = flattenTree(
    state.treeRoot,
    state.filterQuery,
    state.showInactive
  );
  state.flattenedTreeIndex = buildFlattenedTreeIndex(state.flattenedTree);

  if (state.flattenedTree.length === 0) {
    state.selectedIndex = 0;
    state.selectedPtyId = null;
    state.selectedSessionId = null;
    state.previewMode = false;
    return;
  }

  if (state.selectedPtyId) {
    const ptyIndex = state.flattenedTreeIndex.get(state.selectedPtyId);
    if (ptyIndex !== undefined) {
      state.selectedIndex = ptyIndex;
      state.selectedSessionId = getSessionIdForItem(state.flattenedTree[ptyIndex]);
      return;
    }

    state.selectedPtyId = null;
    state.previewMode = false;
  }

  if (previousSelectedSessionId) {
    if (previousSelectedType === 'placeholder') {
      const sameRowItem = state.flattenedTree[previousSelectedIndex];
      if (
        sameRowItem &&
        sameRowItem.node.type !== 'spacer' &&
        getSessionIdForItem(sameRowItem) === previousSelectedSessionId
      ) {
        state.selectedIndex = previousSelectedIndex;
        state.selectedSessionId = previousSelectedSessionId;
        state.selectedPtyId = sameRowItem.node.type === 'pty' ? sameRowItem.node.ptyInfo.ptyId : null;
        return;
      }
    }

    const preferredIndex = state.flattenedTree.findIndex((item) => {
      const sessionId = getSessionIdForItem(item);
      if (sessionId !== previousSelectedSessionId) return false;
      if (previousSelectedType === 'placeholder') return item.node.type === 'placeholder';
      if (previousSelectedType === 'session') return item.node.type === 'session';
      return item.node.type !== 'spacer';
    });

    if (preferredIndex !== -1) {
      state.selectedIndex = preferredIndex;
      state.selectedSessionId = getSessionIdForItem(state.flattenedTree[preferredIndex]);
      state.selectedPtyId = state.flattenedTree[preferredIndex]?.node.type === 'pty'
        ? state.flattenedTree[preferredIndex].node.ptyInfo.ptyId
        : null;
      return;
    }

    const sameSessionHeaderIndex = state.flattenedTree.findIndex(
      (item) => item.node.type === 'session' && item.node.session.id === previousSelectedSessionId
    );
    if (sameSessionHeaderIndex !== -1) {
      state.selectedIndex = sameSessionHeaderIndex;
      state.selectedSessionId = previousSelectedSessionId;
      state.selectedPtyId = null;
      return;
    }
  }

  const clampedIndex = Math.min(state.selectedIndex, state.flattenedTree.length - 1);
  const fallbackIndex = Math.max(0, clampedIndex);
  const fallbackItem = state.flattenedTree[fallbackIndex];
  if (fallbackItem?.node.type === 'spacer') {
    const nextSelectableIndex = state.flattenedTree.findIndex((item) => item.node.type !== 'spacer');
    state.selectedIndex = nextSelectableIndex === -1 ? 0 : nextSelectableIndex;
  } else {
    state.selectedIndex = fallbackIndex;
  }
  const selectedItem = state.flattenedTree[state.selectedIndex];
  state.selectedSessionId = getSessionIdForItem(selectedItem);
  state.selectedPtyId = selectedItem?.node.type === 'pty' ? selectedItem.node.ptyInfo.ptyId : null;
}

/** Toggle session expansion state */
export function toggleSessionExpanded(
  expandedSessionIds: Set<string>,
  sessionId: string
): Set<string> {
  const newSet = new Set(expandedSessionIds);
  if (newSet.has(sessionId)) {
    newSet.delete(sessionId);
  } else {
    newSet.add(sessionId);
  }
  return newSet;
}

/** Get all session IDs from PTYs */
export function extractSessionIds(ptys: PtyInfo[]): string[] {
  return [...new Set(ptys.map((p) => p.sessionId))];
}

/** Create a loading placeholder node */
export function createLoadingPlaceholder(parentSessionId: string): TreeNode {
  return {
    type: 'placeholder',
    parentSessionId,
    message: 'Loading...',
    isLoading: true,
  };
}

/** Create an error placeholder node */
export function createErrorPlaceholder(
  parentSessionId: string,
  error: string
): TreeNode {
  return {
    type: 'placeholder',
    parentSessionId,
    message: `Error: ${error}`,
    isLoading: false,
  };
}

/** Create an unloaded placeholder node */
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
