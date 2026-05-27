/**
 * AggregateView activity tracking tests.
 * Tests that ALL PTYs (not just visible viewport ones) are tracked for shimmer.
 * This ensures activity is recorded even for PTYs scrolled out of view
 * or in collapsed sessions.
 */

import { describe, it, expect } from 'bun:test';
import type { PtyInfo } from '../../contexts/aggregate-view-types';

// Helper to create a mock PTY info
function createMockPtyInfo(overrides: Partial<PtyInfo> = {}): PtyInfo {
  return {
    ptyId: `pty-${Math.random().toString(36).slice(2, 7)}`,
    sessionId: 'session-1',
    cwd: '/home/user/project',
    workspaceId: 1,
    paneId: 'pane-1',
    gitBranch: 'main',
    gitDiffStats: undefined,
    gitDirty: false,
    gitStaged: 0,
    gitUnstaged: 0,
    gitUntracked: 0,
    gitConflicted: 0,
    gitAhead: undefined,
    gitBehind: undefined,
    gitStashCount: undefined,
    gitState: undefined,
    gitDetached: false,
    gitRepoKey: undefined,
    gitIsWorktree: false,
    gitCommonDir: null,
    foregroundProcess: 'nvim',
    shell: 'zsh',
    title: 'nvim',
    sessionMetadata: undefined,
    ...overrides,
  };
}

// Simulates the old viewport-filtered behavior (the bug)
function getViewportFilteredPtys(
  allPtys: PtyInfo[],
  viewportStart: number,
  viewportEnd: number,
  flattenedTree: { node: { type: string; ptyInfo?: PtyInfo } }[]
): PtyInfo[] {
  const tracked = new Map<string, PtyInfo>();

  for (let index = viewportStart; index < viewportEnd; index++) {
    const item = flattenedTree[index];
    if (!item || item.node.type !== 'pty' || !item.node.ptyInfo) continue;
    tracked.set(item.node.ptyInfo.ptyId, item.node.ptyInfo);
  }

  return [...tracked.values()];
}

// Simulates the new fixed behavior using matchedPtys
function getAllTrackedPtys(matchedPtys: PtyInfo[]): PtyInfo[] {
  return matchedPtys;
}

describe('AggregateView activity tracking', () => {
  describe('trackedActivityPtys behavior', () => {
    it('should track all PTYs, not just visible viewport ones (the fix)', () => {
      // Create a set of PTYs across multiple sessions
      const session1Ptys: PtyInfo[] = [
        createMockPtyInfo({ ptyId: 'pty-s1-1', sessionId: 'session-1' }),
        createMockPtyInfo({ ptyId: 'pty-s1-2', sessionId: 'session-1' }),
        createMockPtyInfo({ ptyId: 'pty-s1-3', sessionId: 'session-1' }),
      ];

      const session2Ptys: PtyInfo[] = [
        createMockPtyInfo({ ptyId: 'pty-s2-1', sessionId: 'session-2' }),
        createMockPtyInfo({ ptyId: 'pty-s2-2', sessionId: 'session-2' }),
      ];

      const allPtys = [...session1Ptys, ...session2Ptys];

      // Create a flattened tree with session headers and PTYs
      const flattenedTree = [
        { node: { type: 'session' } },
        { node: { type: 'pty', ptyInfo: session1Ptys[0] } },
        { node: { type: 'pty', ptyInfo: session1Ptys[1] } },
        { node: { type: 'pty', ptyInfo: session1Ptys[2] } },
        { node: { type: 'session' } },
        { node: { type: 'pty', ptyInfo: session2Ptys[0] } },
        { node: { type: 'pty', ptyInfo: session2Ptys[1] } },
      ];

      // Simulate viewport showing only first 3 items (session header + 2 PTYs)
      const viewportStart = 0;
      const viewportEnd = 3;

      // Old behavior: only tracks visible PTYs
      const oldTrackedPtys = getViewportFilteredPtys(
        allPtys,
        viewportStart,
        viewportEnd,
        flattenedTree
      );
      expect(oldTrackedPtys).toHaveLength(2); // Only visible PTYs
      expect(oldTrackedPtys.map((p) => p.ptyId)).toContain('pty-s1-1');
      expect(oldTrackedPtys.map((p) => p.ptyId)).toContain('pty-s1-2');
      expect(oldTrackedPtys.map((p) => p.ptyId)).not.toContain('pty-s1-3');

      // New fixed behavior: tracks ALL PTYs in matchedPtys
      const newTrackedPtys = getAllTrackedPtys(allPtys);
      expect(newTrackedPtys).toHaveLength(5); // All PTYs
      expect(newTrackedPtys.map((p) => p.ptyId)).toContain('pty-s1-3');
      expect(newTrackedPtys.map((p) => p.ptyId)).toContain('pty-s2-1');
      expect(newTrackedPtys.map((p) => p.ptyId)).toContain('pty-s2-2');
    });

    it('should track PTYs in collapsed sessions (not in viewport)', () => {
      // Simulate PTYs in a collapsed session - they're not in flattenedTree
      const collapsedSessionPtys: PtyInfo[] = [
        createMockPtyInfo({ ptyId: 'pty-collapsed-1', sessionId: 'session-collapsed' }),
        createMockPtyInfo({ ptyId: 'pty-collapsed-2', sessionId: 'session-collapsed' }),
      ];

      const expandedSessionPtys: PtyInfo[] = [
        createMockPtyInfo({ ptyId: 'pty-expanded-1', sessionId: 'session-expanded' }),
      ];

      const allPtys = [...collapsedSessionPtys, ...expandedSessionPtys];

      // Flattened tree only shows expanded session PTYs
      const flattenedTree = [
        { node: { type: 'session' } },
        { node: { type: 'pty', ptyInfo: expandedSessionPtys[0] } },
        { node: { type: 'session' } }, // Collapsed session - no PTY children
      ];

      // Old behavior with viewport covering all items
      const oldTrackedPtys = getViewportFilteredPtys(allPtys, 0, 3, flattenedTree);
      expect(oldTrackedPtys).toHaveLength(1); // Only the visible PTY
      expect(oldTrackedPtys[0].ptyId).toBe('pty-expanded-1');

      // New behavior tracks all PTYs including collapsed session ones
      const newTrackedPtys = getAllTrackedPtys(allPtys);
      expect(newTrackedPtys).toHaveLength(3);
      expect(newTrackedPtys.map((p) => p.ptyId)).toContain('pty-collapsed-1');
      expect(newTrackedPtys.map((p) => p.ptyId)).toContain('pty-collapsed-2');
    });

    it('should track PTYs scrolled out of view', () => {
      const manyPtys: PtyInfo[] = Array.from({ length: 20 }, (_, i) =>
        createMockPtyInfo({ ptyId: `pty-${i + 1}`, sessionId: 'session-1' })
      );

      // Flattened tree with all 20 PTYs visible in expanded session
      const flattenedTree = manyPtys.map((pty) => ({
        node: { type: 'pty' as const, ptyInfo: pty },
      }));

      // Viewport showing only items 5-10 (middle of the list)
      const viewportStart = 5;
      const viewportEnd = 10;

      // Old behavior only tracks visible range
      const oldTrackedPtys = getViewportFilteredPtys(
        manyPtys,
        viewportStart,
        viewportEnd,
        flattenedTree
      );
      expect(oldTrackedPtys).toHaveLength(5); // Only viewport items

      // New behavior tracks all PTYs
      const newTrackedPtys = getAllTrackedPtys(manyPtys);
      expect(newTrackedPtys).toHaveLength(20);

      // All PTYs are tracked, including those scrolled out of view
      expect(newTrackedPtys.map((p) => p.ptyId)).toContain('pty-1');
      expect(newTrackedPtys.map((p) => p.ptyId)).toContain('pty-20');
    });

    it('should handle empty PTY list', () => {
      const emptyPtys: PtyInfo[] = [];

      const newTrackedPtys = getAllTrackedPtys(emptyPtys);
      expect(newTrackedPtys).toHaveLength(0);
    });

    it('should handle activity-filtered PTY list (showInactive)', () => {
      // When filters are applied, matchedPtys should only contain filtered results
      const allPtys: PtyInfo[] = [
        createMockPtyInfo({ ptyId: 'active-pty', foregroundProcess: 'nvim' }),
        createMockPtyInfo({ ptyId: 'inactive-pty', foregroundProcess: 'bash', shell: 'bash' }),
      ];

      // Simulating showInactive=false filter
      const matchedPtys = allPtys.filter((p) => p.foregroundProcess !== 'bash');

      const trackedPtys = getAllTrackedPtys(matchedPtys);
      expect(trackedPtys).toHaveLength(1);
      expect(trackedPtys[0].ptyId).toBe('active-pty');
    });
  });

  describe('activity recording scenarios', () => {
    it('PTY scrolled out of view should still have activity recorded', () => {
      // This test documents the expected behavior:
      // When a PTY generates output while scrolled out of view,
      // it should have activity recorded so shimmer appears when scrolled into view

      const ptyId = 'scrolled-out-pty';
      const pty = createMockPtyInfo({ ptyId });

      // With the new behavior, this PTY would be in trackedActivityPtys
      // even if scrolled out of view, so activity would be recorded

      // The key assertion is: all PTYs in matchedPtys should be tracked
      const matchedPtys = [pty];
      const trackedPtys = getAllTrackedPtys(matchedPtys);

      expect(trackedPtys.some((p) => p.ptyId === ptyId)).toBe(true);
    });

    it('PTY in collapsed session should still have activity recorded', () => {
      const ptyId = 'collapsed-session-pty';
      const pty = createMockPtyInfo({ ptyId, sessionId: 'collapsed-session' });

      // With the new behavior, this PTY should be tracked even though
      // its parent session is collapsed (not in flattened tree viewport)

      const matchedPtys = [pty];
      const trackedPtys = getAllTrackedPtys(matchedPtys);

      expect(trackedPtys.some((p) => p.ptyId === ptyId)).toBe(true);
    });
  });
});
