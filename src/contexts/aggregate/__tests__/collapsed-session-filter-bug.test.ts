/**
 * Test to reproduce the collapsed session disappearance bug.
 * 
 * Bug: When a session is collapsed and has visiblePtyCount === 0 with an active filter,
 * the entire session (including its header) disappears from the flattened tree.
 * 
 * Expected: The session header should always be visible regardless of whether
 * its children match the filter when collapsed.
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
  it('should show session header even when collapsed with filter active', () => {
    // Setup: session-A expanded, session-B collapsed
    // Both have PTYs with cwd='/home/user/project-a'
    // Filter is 'project-a' which matches the PTYs
    
    const treeRoot: TreeNode[] = [
      createSessionNode('session-A', 'Session A', true),
      createPtyNode('pty-A1', 'session-A', '/home/user/project-a', 'vim'),
      createPtyNode('pty-A2', 'session-A', '/home/user/other', 'bash'),
      createSessionNode('session-B', 'Session B', false), // COLLAPSED
      // session-B's PTYs are NOT in treeRoot because it's collapsed
    ];

    const result = flattenTree(treeRoot, 'project-a', true);

    // Expected: Both sessions should be visible
    // session-A header + matching PTY + spacer + session-B header
    const sessionHeaders = result.filter(i => i.node.type === 'session');
    
    // BUG: Currently session-B disappears because visiblePtyCount === 0
    expect(sessionHeaders.length).toBe(2);
    expect(sessionHeaders.some(h => h.node.type === 'session' && h.node.session.id === 'session-A')).toBe(true);
    expect(sessionHeaders.some(h => h.node.type === 'session' && h.node.session.id === 'session-B')).toBe(true);
  });

  it('should keep session when collapsed with no matching children', () => {
    // Another case: collapsed session with filter that wouldn't match its children anyway
    const treeRoot: TreeNode[] = [
      createSessionNode('session-A', 'Session A', true),
      createPtyNode('pty-A1', 'session-A', '/home/user/project-a', 'vim'),
      createSessionNode('session-B', 'Session B', false), // COLLAPSED
      // No PTYs for session-B because it's collapsed
    ];

    const result = flattenTree(treeRoot, 'project-a', true);

    // session-A should be visible (has matching PTY)
    // session-B should ALSO be visible (it's a session header)
    const sessionHeaders = result.filter(i => i.node.type === 'session');
    
    // BUG: session-B disappears
    expect(sessionHeaders.length).toBe(2);
  });

  it('should show matching PTYs inside expanded session with filter', () => {
    const treeRoot: TreeNode[] = [
      createSessionNode('session-A', 'Session A', true),
      createPtyNode('pty-A1', 'session-A', '/home/user/project-a', 'vim'), // matches
      createPtyNode('pty-A2', 'session-A', '/home/user/other', 'bash'),    // no match
    ];

    const result = flattenTree(treeRoot, 'project-a', true);

    // Should show: session header + matching PTY only
    const sessionNode = result.find(i => i.node.type === 'session');
    const ptyNodes = result.filter(i => i.node.type === 'pty');
    
    expect(sessionNode).toBeDefined();
    expect(ptyNodes.length).toBe(1);
    expect(ptyNodes[0].node.type === 'pty' && ptyNodes[0].node.ptyInfo.ptyId).toBe('pty-A1');
  });
});
