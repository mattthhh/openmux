/**
 * Tree building operations for aggregate view.
 */

import type { SessionMetadata } from '../../../effect/models';
import type { PtyInfo, SessionLoadState, TreeNode, SessionTreeNode } from '../types';
import { sortPtysForSession, isActivePty } from '../filter/operations';

/** Get default session load state */
export function getDefaultLoadState(): SessionLoadState {
  return { status: 'unloaded' };
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
