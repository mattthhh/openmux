/**
 * Utility functions for AggregateView
 */

import type { WorkspaceId } from '../../core/types';
import type { Workspaces } from '../../core/operations/layout-actions';
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
