/**
 * Test helpers for aggregate context tests.
 * These were previously exported from refresh.ts but are only used in tests.
 */

import type { SerializedLayoutNode, SerializedSession } from '../../../effect/models';

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

export function findWorkspaceIdForPane(
  session: SerializedSession,
  paneId: string
): number | undefined {
  const containsPane = (node: SerializedLayoutNode | null | undefined): boolean => {
    if (!node) return false;
    if ('type' in node && node.type === 'split') {
      return containsPane(node.first) || containsPane(node.second);
    }
    return node.id === paneId;
  };

  for (const workspace of session.workspaces) {
    if (containsPane(workspace.mainPane)) {
      return workspace.id;
    }
    for (const pane of workspace.stackPanes) {
      if (containsPane(pane)) {
        return workspace.id;
      }
    }
  }

  return undefined;
}

function countSerializedPanes(node: SerializedLayoutNode | null | undefined): number {
  if (!node) return 0;
  if ('type' in node && node.type === 'split') {
    return countSerializedPanes(node.first) + countSerializedPanes(node.second);
  }
  return 1;
}

export function getSessionSummaryFromDetails(session: SerializedSession): {
  workspaceCount: number;
  paneCount: number;
} {
  let workspaceCount = 0;
  let paneCount = 0;

  for (const workspace of session.workspaces) {
    if (!workspace.mainPane && workspace.stackPanes.length === 0) {
      continue;
    }

    workspaceCount += 1;
    paneCount += countSerializedPanes(workspace.mainPane);
    for (const pane of workspace.stackPanes) {
      paneCount += countSerializedPanes(pane);
    }
  }

  return { workspaceCount, paneCount };
}

export function collectSessionPaneRecords(session: SerializedSession): Array<{
  paneId: string;
  cwd: string;
  title: string | undefined;
  workspaceId: number;
}> {
  const result: Array<{
    paneId: string;
    cwd: string;
    title: string | undefined;
    workspaceId: number;
  }> = [];

  const collect = (node: SerializedLayoutNode | null | undefined, workspaceId: number): void => {
    if (!node) return;
    if ('type' in node && node.type === 'split') {
      collect(node.first, workspaceId);
      collect(node.second, workspaceId);
      return;
    }

    const pane = node as { id: string; cwd: string; title?: string };
    result.push({
      paneId: pane.id,
      cwd: pane.cwd,
      title: pane.title,
      workspaceId,
    });
  };

  for (const workspace of session.workspaces) {
    collect(workspace.mainPane, workspace.id);
    for (const pane of workspace.stackPanes) {
      collect(pane, workspace.id);
    }
  }

  return result;
}
