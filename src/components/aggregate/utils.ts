/**
 * Utility functions for AggregateView
 */

import type { WorkspaceId } from '../../core/types';
import type { Workspaces } from '../../core/operations/layout-actions';
import type { FlattenedTreeItem } from '../../contexts/aggregate-view-types';
import { isSavedAggregatePtyId } from '../../contexts/aggregate/rows';
import { collectPanes, containsPane } from '../../core/layout-tree';

/**
 * Get the last segment of a path (directory name)
 */
export function getDirectoryName(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * Find which workspace and pane contains a given PTY ID
 */
export function findPtyLocation(
  ptyId: string,
  workspaces: Workspaces
): { workspaceId: WorkspaceId; paneId: string } | null {
  for (const [idStr, workspace] of Object.entries(workspaces)) {
    if (!workspace) continue;
    const workspaceId = Number(idStr) as WorkspaceId;
    const nodes = [];
    if (workspace.mainPane) nodes.push(workspace.mainPane);
    nodes.push(...workspace.stackPanes);
    for (const node of nodes) {
      const panes = collectPanes(node);
      for (const pane of panes) {
        if (pane.ptyId === ptyId) {
          return { workspaceId, paneId: pane.id };
        }
      }
    }
  }
  return null;
}

/**
 * Find which workspace contains a given pane ID
 */
export function findPaneLocation(
  paneId: string,
  workspaces: Workspaces
): { workspaceId: WorkspaceId } | null {
  for (const [idStr, workspace] of Object.entries(workspaces)) {
    if (!workspace) continue;
    const workspaceId = Number(idStr) as WorkspaceId;
    if (workspace.mainPane && containsPane(workspace.mainPane, paneId)) {
      return { workspaceId };
    }
    for (const pane of workspace.stackPanes) {
      if (containsPane(pane, paneId)) {
        return { workspaceId };
      }
    }
  }
  return null;
}

export function findLivePtyIdForPane(paneId: string, workspaces: Workspaces): string | null {
  for (const workspace of Object.values(workspaces)) {
    if (!workspace) continue;
    const nodes = [];
    if (workspace.mainPane) nodes.push(workspace.mainPane);
    nodes.push(...workspace.stackPanes);

    for (const node of nodes) {
      const panes = collectPanes(node);
      for (const pane of panes) {
        if (pane.id === paneId) {
          return pane.ptyId ?? null;
        }
      }
    }
  }

  return null;
}

export function resolveAggregatePtyOwnership(params: {
  ptyId: string;
  workspaces: Workspaces;
  activeSessionId: string | null;
  trackedOwner: { sessionId: string; paneId: string } | null;
  aggregateOwner: { sessionId: string; paneId: string } | null;
}): { sessionId: string; paneId: string; workspaceId: WorkspaceId | undefined } | null {
  if (params.trackedOwner) {
    return {
      sessionId: params.trackedOwner.sessionId,
      paneId: params.trackedOwner.paneId,
      workspaceId: findPaneLocation(params.trackedOwner.paneId, params.workspaces)?.workspaceId,
    };
  }

  if (params.aggregateOwner) {
    return {
      sessionId: params.aggregateOwner.sessionId,
      paneId: params.aggregateOwner.paneId,
      workspaceId: undefined,
    };
  }

  if (!params.activeSessionId) {
    return null;
  }

  const location = findPtyLocation(params.ptyId, params.workspaces);
  if (!location) {
    return null;
  }

  return {
    sessionId: params.activeSessionId,
    paneId: location.paneId,
    workspaceId: location.workspaceId,
  };
}

export function resolveAggregatePreviewPtyId(params: {
  selectedPtyId: string | null;
  selectedIndex: number;
  flattenedTree: FlattenedTreeItem[];
  activeSessionId: string | null;
  workspaces: Workspaces;
}): string | null {
  if (!params.selectedPtyId) {
    return null;
  }

  if (!isSavedAggregatePtyId(params.selectedPtyId)) {
    return params.selectedPtyId;
  }

  const selectedItem = params.flattenedTree[params.selectedIndex];
  if (
    selectedItem?.node.type !== 'pty' ||
    selectedItem.node.ptyInfo.sessionId !== params.activeSessionId
  ) {
    return null;
  }

  const paneId = selectedItem.node.ptyInfo.paneId;
  if (!paneId) {
    return null;
  }

  return findLivePtyIdForPane(paneId, params.workspaces);
}
