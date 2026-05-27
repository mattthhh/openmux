/**
 * Test to reproduce the collapsed session disappearance bug.
 *
 * Previously: When a session is collapsed and had no visible PTYs with an active
 * filter, the session header would disappear. Since the query filter was removed,
 * all PTYs are always shown, so this bug can no longer occur.
 */

import { describe, it, expect } from 'bun:test';
import { flattenTree } from '../tree';
import type { TreeNode, SessionMetadata } from '../types';

function createSessionNode(
  id: string,
  name: string,
  isExpanded: boolean,
  loadState: { status: 'loaded' | 'unloaded' | 'loading' | 'error' } = { status: 'loaded' }
): TreeNode {
  return {
    type: 'session',
    session: {
      id,
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as SessionMetadata,
    ptyCount: 2,
    activePtyCount: 1,
    loadState,
    isExpanded,
  };
}

function createPtyNode(
  ptyId: string,
  sessionId: string,
  cwd: string = '/home/user',
  foregroundProcess: string = 'bash'
): TreeNode {
  return {
    type: 'pty',
    ptyInfo: {
      ptyId,
      cwd,
      sessionId,
      foregroundProcess,
      title: 'bash',
    } as any,
    parentSessionId: sessionId,
  };
}

describe('collapsed session with filter bug', () => {
  it('should show all session headers when collapsed', () => {
    // Setup: session-A expanded, session-B collapsed
    const treeRoot: TreeNode[] = [
      createSessionNode('session-A', 'Session A', true),
      createPtyNode('pty-A1', 'session-A', '/home/user/project-a', 'vim'),
      createPtyNode('pty-A2', 'session-A', '/home/user/other', 'bash'),
      createSessionNode('session-B', 'Session B', false), // COLLAPSED
    ];

    const result = flattenTree(treeRoot, true);

    // Both sessions should be visible
    const sessionHeaders = result.filter((i) => i.node.type === 'session');
    expect(sessionHeaders.length).toBe(2);
    expect(
      sessionHeaders.some((h) => h.node.type === 'session' && h.node.session.id === 'session-A')
    ).toBe(true);
    expect(
      sessionHeaders.some((h) => h.node.type === 'session' && h.node.session.id === 'session-B')
    ).toBe(true);
  });

  it('should show collapsed session alongside expanded sessions', () => {
    // Collapsed session with no PTYs visible because collapsed
    const treeRoot: TreeNode[] = [
      createSessionNode('session-A', 'Session A', true),
      createPtyNode('pty-A1', 'session-A', '/home/user/project-a', 'vim'),
      createSessionNode('session-B', 'Session B', false), // COLLAPSED
    ];

    const result = flattenTree(treeRoot, true);

    // Both sessions should be visible
    const sessionHeaders = result.filter((i) => i.node.type === 'session');
    expect(sessionHeaders.length).toBe(2);
  });

  it('should show all PTYs inside expanded session', () => {
    const treeRoot: TreeNode[] = [
      createSessionNode('session-A', 'Session A', true),
      createPtyNode('pty-A1', 'session-A', '/home/user/project-a', 'vim'),
      createPtyNode('pty-A2', 'session-A', '/home/user/other', 'bash'),
    ];

    const result = flattenTree(treeRoot, true);

    // Should show: session header + all PTYs
    const sessionNode = result.find((i) => i.node.type === 'session');
    const ptyNodes = result.filter((i) => i.node.type === 'pty');

    expect(sessionNode).toBeDefined();
    expect(ptyNodes.length).toBe(2);
  });
});
