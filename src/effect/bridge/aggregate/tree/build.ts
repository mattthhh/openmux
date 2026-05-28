/**
 * Tree Building
 * Functions for building visual tree representations for navigation
 */

import type { SessionWithPtys, VisualTreeNode } from '../types';

/**
 * Build a flattened tree representation for navigation.
 * Creates visual tree structure with proper prefixes.
 *
 * @param sessions - Sessions with PTYs from listSessionsWithPtys
 * @returns Flattened array of tree nodes in visual order
 */
export function buildSessionTreeNodes(sessions: SessionWithPtys[]): VisualTreeNode[] {
  const nodes: VisualTreeNode[] = [];
  const sessionCount = sessions.length;

  for (let sessionIndex = 0; sessionIndex < sessionCount; sessionIndex++) {
    const sessionItem = sessions[sessionIndex];
    const isLastSession = sessionIndex === sessionCount - 1;

    // Add session node
    nodes.push({
      type: 'session',
      sessionId: sessionItem.session.id,
      isLast: isLastSession,
      isActive: sessionItem.isActive,
    });

    // Add PTY nodes or placeholder
    if (sessionItem.ptys === 'unloaded') {
      nodes.push({
        type: 'placeholder',
        sessionId: sessionItem.session.id,
        isLast: true,
        count: sessionItem.ptyCount,
      });
    } else {
      const ptyCount = sessionItem.ptys.length;
      for (let ptyIndex = 0; ptyIndex < ptyCount; ptyIndex++) {
        const ptyMeta = sessionItem.ptys[ptyIndex];
        const isLastPty = ptyIndex === ptyCount - 1;

        nodes.push({
          type: 'pty',
          ptyId: ptyMeta.ptyId,
          sessionId: sessionItem.session.id,
          isLast: isLastPty,
          ptyInfo: ptyMeta,
        });
      }
    }
  }

  return nodes;
}

/**
 * Count total visible nodes in a tree (including sessions and PTYs).
 * Placeholders count as 1 node each.
 */
export function countTreeNodes(nodes: VisualTreeNode[]): number {
  return nodes.length;
}

/**
 * Count total PTYs across all sessions (excluding unloaded placeholders).
 */
export function countTotalPtys(sessions: SessionWithPtys[]): number {
  return sessions.reduce((total, session) => {
    if (session.ptys === 'unloaded') {
      return total;
    }
    return total + session.ptys.length;
  }, 0);
}

/**
 * Find a specific PTY node in the tree by ID.
 */
export function findPtyNode(
  nodes: VisualTreeNode[],
  ptyId: string
): Extract<VisualTreeNode, { type: 'pty' }> | undefined {
  return nodes.find(
    (node): node is Extract<VisualTreeNode, { type: 'pty' }> =>
      node.type === 'pty' && node.ptyId === ptyId
  );
}

/**
 * Find a specific session node in the tree by ID.
 */
export function findSessionNode(
  nodes: VisualTreeNode[],
  sessionId: string
): Extract<VisualTreeNode, { type: 'session' }> | undefined {
  return nodes.find(
    (node): node is Extract<VisualTreeNode, { type: 'session' }> =>
      node.type === 'session' && node.sessionId === sessionId
  );
}
