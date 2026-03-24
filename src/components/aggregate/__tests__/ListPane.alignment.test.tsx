/**
 * ListPane alignment tests - Tests for git metadata column alignment logic.
 */

import { describe, it, expect, vi } from 'bun:test';
import type { FlattenedTreeItem, PtyInfo } from '../../../contexts/aggregate-view-types';

// Helper to create a mock PTY info with specific git metadata
function createMockPtyInfo(overrides: Partial<PtyInfo> = {}): PtyInfo {
  return {
    ptyId: 'pty-1',
    sessionId: 'session-1',
    cwd: '/home/test',
    workspaceId: 1,
    paneId: 'pane-1',
    gitBranch: undefined,
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
    foregroundProcess: undefined,
    shell: 'bash',
    title: undefined,
    sessionMetadata: undefined,
    ...overrides,
  };
}

// Helper to create a flattened tree item for a PTY
function createPtyTreeItem(ptyInfo: PtyInfo, index: number): FlattenedTreeItem {
  return {
    node: {
      type: 'pty',
      ptyInfo,
      parentSessionId: ptyInfo.sessionId,
    },
    depth: 1,
    isLast: true,
    prefix: '',
    index,
    parentSessionId: ptyInfo.sessionId,
  };
}

// Helper to create a session tree item
function createSessionTreeItem(sessionId: string, index: number): FlattenedTreeItem {
  return {
    node: {
      type: 'session',
      session: { id: sessionId, name: `Session ${sessionId}` },
      ptyCount: 0,
      activePtyCount: 0,
      loadState: { status: 'loaded' },
      isExpanded: true,
    },
    depth: 0,
    isLast: true,
    prefix: '',
    index,
    parentSessionId: undefined,
  };
}

// Replicate the maxMetaWidth calculation logic from ListPane
function calculateMaxMetaWidth(flattenedTree: FlattenedTreeItem[]): number {
  let max = 0;
  for (const item of flattenedTree) {
    if (item.node.type === 'pty') {
      const stats = item.node.ptyInfo.gitDiffStats;
      const parts: string[] = [];
      if (item.node.ptyInfo.gitDetached) parts.push('@');
      if (item.node.ptyInfo.gitState && item.node.ptyInfo.gitState !== 'none' && item.node.ptyInfo.gitState !== 'unknown') {
        parts.push('~');
      }
      if (stats && (stats.added > 0 || stats.removed > 0 || stats.binary > 0)) {
        if (stats.added > 0) parts.push(`+${stats.added}`);
        if (stats.removed > 0) parts.push(`-${stats.removed}`);
        if (stats.binary > 0) parts.push(`*${stats.binary}`);
      }
      if (item.node.ptyInfo.gitAhead && item.node.ptyInfo.gitAhead > 0) {
        parts.push(`↑${item.node.ptyInfo.gitAhead}`);
      }
      if (item.node.ptyInfo.gitBehind && item.node.ptyInfo.gitBehind > 0) {
        parts.push(`↓${item.node.ptyInfo.gitBehind}`);
      }
      max = Math.max(max, parts.join(' ').length);
    }
  }
  return max;
}

describe('ListPane git metadata alignment', () => {
  describe('calculateMaxMetaWidth', () => {
    it('should return 0 when tree has no PTYs', () => {
      const tree: FlattenedTreeItem[] = [
        createSessionTreeItem('session-1', 0),
      ];
      expect(calculateMaxMetaWidth(tree)).toBe(0);
    });

    it('should return 0 when PTYs have no git metadata', () => {
      const tree: FlattenedTreeItem[] = [
        createPtyTreeItem(createMockPtyInfo({ gitDiffStats: undefined }), 0),
        createPtyTreeItem(createMockPtyInfo({ gitDiffStats: { added: 0, removed: 0, binary: 0 } }), 1),
      ];
      expect(calculateMaxMetaWidth(tree)).toBe(0);
    });

    it('should calculate width for single PTY with added files', () => {
      const tree: FlattenedTreeItem[] = [
        createPtyTreeItem(createMockPtyInfo({ gitDiffStats: { added: 5, removed: 0, binary: 0 } }), 0),
      ];
      expect(calculateMaxMetaWidth(tree)).toBe('+5'.length);
    });

    it('should calculate width for PTY with added and removed', () => {
      const tree: FlattenedTreeItem[] = [
        createPtyTreeItem(createMockPtyInfo({ gitDiffStats: { added: 1545, removed: 29, binary: 0 } }), 0),
      ];
      expect(calculateMaxMetaWidth(tree)).toBe('+1545 -29'.length);
    });

    it('should calculate width for PTY with all diff stats', () => {
      const tree: FlattenedTreeItem[] = [
        createPtyTreeItem(createMockPtyInfo({ gitDiffStats: { added: 10, removed: 5, binary: 2 } }), 0),
      ];
      expect(calculateMaxMetaWidth(tree)).toBe('+10 -5 *2'.length);
    });

    it('should include detached HEAD indicator', () => {
      const tree: FlattenedTreeItem[] = [
        createPtyTreeItem(createMockPtyInfo({ gitDetached: true, gitDiffStats: { added: 1, removed: 0, binary: 0 } }), 0),
      ];
      expect(calculateMaxMetaWidth(tree)).toBe('@ +1'.length);
    });

    it('should include git state indicator', () => {
      const tree: FlattenedTreeItem[] = [
        createPtyTreeItem(createMockPtyInfo({ gitState: 'rebase', gitDiffStats: { added: 1, removed: 0, binary: 0 } }), 0),
      ];
      expect(calculateMaxMetaWidth(tree)).toBe('~ +1'.length);
    });

    it('should include ahead indicator', () => {
      const tree: FlattenedTreeItem[] = [
        createPtyTreeItem(createMockPtyInfo({ gitAhead: 3, gitDiffStats: { added: 0, removed: 0, binary: 0 } }), 0),
      ];
      expect(calculateMaxMetaWidth(tree)).toBe('↑3'.length);
    });

    it('should include behind indicator', () => {
      const tree: FlattenedTreeItem[] = [
        createPtyTreeItem(createMockPtyInfo({ gitBehind: 5, gitDiffStats: { added: 0, removed: 0, binary: 0 } }), 0),
      ];
      expect(calculateMaxMetaWidth(tree)).toBe('↓5'.length);
    });

    it('should calculate max across multiple PTYs with different metadata', () => {
      const tree: FlattenedTreeItem[] = [
        createPtyTreeItem(createMockPtyInfo({ gitDiffStats: { added: 1, removed: 0, binary: 0 } }), 0),
        createPtyTreeItem(createMockPtyInfo({ gitDiffStats: { added: 100, removed: 50, binary: 10 } }), 1),
        createPtyTreeItem(createMockPtyInfo({ gitDiffStats: { added: 5, removed: 0, binary: 0 } }), 2),
      ];
      // Max should be the longest: "+100 -50 *10"
      expect(calculateMaxMetaWidth(tree)).toBe('+100 -50 *10'.length);
    });

    it('should handle PTY with all indicators', () => {
      const tree: FlattenedTreeItem[] = [
        createPtyTreeItem(createMockPtyInfo({
          gitDetached: true,
          gitState: 'rebase',
          gitDiffStats: { added: 1545, removed: 29, binary: 1 },
          gitAhead: 3,
          gitBehind: 2,
        }), 0),
      ];
      // Expected: "@ ~ +1545 -29 *1 ↑3 ↓2"
      expect(calculateMaxMetaWidth(tree)).toBe('@ ~ +1545 -29 *1 ↑3 ↓2'.length);
    });

    it('should handle mixed tree with sessions and PTYs', () => {
      const tree: FlattenedTreeItem[] = [
        createSessionTreeItem('session-1', 0),
        createPtyTreeItem(createMockPtyInfo({ gitDiffStats: { added: 10, removed: 0, binary: 0 } }), 1),
        createSessionTreeItem('session-2', 2),
        createPtyTreeItem(createMockPtyInfo({ gitDiffStats: { added: 100, removed: 50, binary: 0 } }), 3),
      ];
      expect(calculateMaxMetaWidth(tree)).toBe('+100 -50'.length);
    });

    it('should handle empty tree', () => {
      expect(calculateMaxMetaWidth([])).toBe(0);
    });

    it('should handle placeholder nodes', () => {
      const tree: FlattenedTreeItem[] = [
        {
          node: {
            type: 'placeholder',
            parentSessionId: 'session-1',
            message: '...',
            isLoading: true,
          },
          depth: 1,
          isLast: true,
          prefix: '',
          index: 0,
          parentSessionId: 'session-1',
        },
      ];
      expect(calculateMaxMetaWidth(tree)).toBe(0);
    });

    it('should handle spacer nodes', () => {
      const tree: FlattenedTreeItem[] = [
        {
          node: { type: 'spacer' },
          depth: 0,
          isLast: true,
          prefix: '',
          index: 0,
          parentSessionId: undefined,
        },
      ];
      expect(calculateMaxMetaWidth(tree)).toBe(0);
    });
  });

  describe('alignment stability', () => {
    it('should produce same maxMetaWidth regardless of PTY order', () => {
      const pty1 = createMockPtyInfo({ gitDiffStats: { added: 100, removed: 0, binary: 0 } });
      const pty2 = createMockPtyInfo({ gitDiffStats: { added: 1, removed: 0, binary: 0 } });
      
      const tree1 = [createPtyTreeItem(pty1, 0), createPtyTreeItem(pty2, 1)];
      const tree2 = [createPtyTreeItem(pty2, 0), createPtyTreeItem(pty1, 1)];
      
      expect(calculateMaxMetaWidth(tree1)).toBe(calculateMaxMetaWidth(tree2));
      expect(calculateMaxMetaWidth(tree1)).toBe('+100'.length);
    });

    it('should produce same maxMetaWidth when viewport changes (simulating scroll)', () => {
      const ptys: PtyInfo[] = [
        createMockPtyInfo({ ptyId: 'pty-1', gitDiffStats: { added: 1, removed: 0, binary: 0 } }),
        createMockPtyInfo({ ptyId: 'pty-2', gitDiffStats: { added: 100, removed: 0, binary: 0 } }),
        createMockPtyInfo({ ptyId: 'pty-3', gitDiffStats: { added: 10, removed: 0, binary: 0 } }),
      ];
      
      // Full tree
      const fullTree = ptys.map((pty, i) => createPtyTreeItem(pty, i));
      const fullMax = calculateMaxMetaWidth(fullTree);
      
      // Viewport showing only first 2 (simulating scroll position 0)
      const viewport1 = fullTree.slice(0, 2);
      
      // Viewport showing only last 2 (simulating scroll position 1)
      const viewport2 = fullTree.slice(1, 3);
      
      // These should be the same because we calculate from the full tree
      expect(fullMax).toBe('+100'.length);
      // viewport1 only sees +1 and +100, max is +100
      expect(calculateMaxMetaWidth(viewport1)).toBe('+100'.length);
      // viewport2 only sees +100 and +10, max is +100
      expect(calculateMaxMetaWidth(viewport2)).toBe('+100'.length);
    });
  });
});
