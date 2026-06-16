/**
 * Workspace utility functions
 * Centralizes common operations on workspaces to avoid duplication
 */

import type { Workspace, PaneData, LayoutNode } from './types';
import { containsPane, findPane } from './layout-tree';

/**
 * Get the focused pane from a workspace
 * Returns null if no pane is focused or workspace has no panes
 */
export function getFocusedPane(workspace: Workspace): PaneData | null {
  const { focusedPaneId, mainPane, stackPanes } = workspace;
  if (!focusedPaneId) return null;

  if (mainPane) {
    const pane = findPane(mainPane, focusedPaneId);
    if (pane) return pane;
  }

  for (const pane of stackPanes) {
    const found = findPane(pane, focusedPaneId);
    if (found) return found;
  }

  return null;
}

/**
 * Get the PTY ID of the focused pane
 * Returns undefined if no pane is focused or pane has no PTY
 */
export function getFocusedPtyId(workspace: Workspace): string | undefined {
  return getFocusedPane(workspace)?.ptyId;
}

/**
 * Check if the main pane is focused
 */
export function isMainPaneFocused(workspace: Workspace): boolean {
  if (!workspace.mainPane || !workspace.focusedPaneId) return false;
  return containsPane(workspace.mainPane, workspace.focusedPaneId);
}

/**
 * Get every PTY ID attached to panes in a workspace.
 */
export function getWorkspacePtyIds(workspace: Workspace): string[] {
  const ptyIds: string[] = [];
  const appendPty = (pane: PaneData) => {
    if (pane.ptyId) {
      ptyIds.push(pane.ptyId);
    }
  };

  if (workspace.mainPane) {
    collectPanePtys(workspace.mainPane, appendPty);
  }

  for (const pane of workspace.stackPanes) {
    collectPanePtys(pane, appendPty);
  }

  return [...new Set(ptyIds)];
}

function collectPanePtys(node: LayoutNode, appendPty: (pane: PaneData) => void) {
  if (node.type === 'split') {
    collectPanePtys(node.first, appendPty);
    collectPanePtys(node.second, appendPty);
    return;
  }

  appendPty(node);
}
