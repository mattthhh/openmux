/**
 * Session utilities for refresh operations.
 * 
 * Helper functions for working with serialized session data,
 * pane ordering, and workspace/pane relationships.
 */

import type { SerializedSession, SerializedLayoutNode } from '../../../effect/models';

/**
 * Recursively collect pane IDs from a serialized layout node.
 */
export function collectSerializedPaneIds(
  node: SerializedLayoutNode | null | undefined, 
  result: string[]
): void {
  if (!node) return;
  if ('type' in node && node.type === 'split') {
    collectSerializedPaneIds(node.first, result);
    collectSerializedPaneIds(node.second, result);
    return;
  }
  result.push(node.id);
}

/**
 * Build a map of pane IDs to their order index within a session.
 * This creates a stable ordering based on the serialized session layout.
 */
export function buildSessionPaneOrder(session: SerializedSession): Map<string, number> {
  const paneIds: string[] = [];

  for (const workspace of session.workspaces) {
    collectSerializedPaneIds(workspace.mainPane, paneIds);
    for (const pane of workspace.stackPanes) {
      collectSerializedPaneIds(pane, paneIds);
    }
  }

  return new Map(paneIds.map((paneId, index) => [paneId, index] as const));
}

/**
 * Check if a layout node contains a specific pane ID.
 */
function containsPane(node: SerializedLayoutNode | null | undefined, paneId: string): boolean {
  if (!node) return false;
  if ('type' in node && node.type === 'split') {
    return containsPane(node.first, paneId) || containsPane(node.second, paneId);
  }
  return node.id === paneId;
}

/**
 * Find the workspace ID that contains a given pane ID.
 */
export function findWorkspaceIdForPane(session: SerializedSession, paneId: string): number | undefined {
  for (const workspace of session.workspaces) {
    if (containsPane(workspace.mainPane, paneId)) {
      return workspace.id;
    }
    for (const pane of workspace.stackPanes) {
      if (containsPane(pane, paneId)) {
        return workspace.id;
      }
    }
  }

  return undefined;
}
