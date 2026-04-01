/**
 * ListPane alignment tests - Tests for per-row git metadata calculation.
 *
 * NOTE: We moved from global column alignment to per-row metadata.
 * Each PTY row now only reserves space for its own metadata, not a global max.
 * This prevents one PTY with massive stats from truncating all other PTY labels.
 */

import { describe, it, expect } from 'bun:test';
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

// Per-row metadata width calculation (replicated from PtyTreeRow)
function calculateRowMetaWidth(ptyInfo: PtyInfo): number {
  const parts: string[] = [];
  if (ptyInfo.gitDetached) parts.push('@');
  if (ptyInfo.gitState && ptyInfo.gitState !== 'none' && ptyInfo.gitState !== 'unknown') {
    parts.push('~');
  }
  if (ptyInfo.gitDiffStats) {
    const stats = ptyInfo.gitDiffStats;
    if (stats.added > 0) parts.push(`+${stats.added}`);
    if (stats.removed > 0) parts.push(`-${stats.removed}`);
    if (stats.binary > 0) parts.push(`*${stats.binary}`);
  }
  if (ptyInfo.gitAhead && ptyInfo.gitAhead > 0) {
    parts.push(`↑${ptyInfo.gitAhead}`);
  }
  if (ptyInfo.gitBehind && ptyInfo.gitBehind > 0) {
    parts.push(`↓${ptyInfo.gitBehind}`);
  }
  return parts.join(' ').length;
}

// Simulate label width calculation for a row (replicated from PtyTreeRow)
function calculateLabelMaxWidth(
  maxWidth: number,
  indentWidth: number,
  rowMetaWidth: number,
  spacing: number = 2,
  rightGutter: number = 1
): number {
  const availableWidth = maxWidth - indentWidth - rightGutter;
  const reserved = rowMetaWidth > 0 ? rowMetaWidth + spacing : 0;
  return Math.max(0, availableWidth - reserved);
}

describe('ListPane per-row metadata', () => {
  describe('calculateRowMetaWidth', () => {
    it('should return 0 for PTY with no git metadata', () => {
      const pty = createMockPtyInfo({ gitDiffStats: undefined });
      expect(calculateRowMetaWidth(pty)).toBe(0);
    });

    it('should return 0 for PTY with empty diff stats', () => {
      const pty = createMockPtyInfo({ gitDiffStats: { added: 0, removed: 0, binary: 0 } });
      expect(calculateRowMetaWidth(pty)).toBe(0);
    });

    it('should calculate width for single added files', () => {
      const pty = createMockPtyInfo({ gitDiffStats: { added: 5, removed: 0, binary: 0 } });
      expect(calculateRowMetaWidth(pty)).toBe('+5'.length);
    });

    it('should calculate width for added and removed', () => {
      const pty = createMockPtyInfo({ gitDiffStats: { added: 1545, removed: 29, binary: 0 } });
      expect(calculateRowMetaWidth(pty)).toBe('+1545 -29'.length);
    });

    it('should calculate width for all diff stats', () => {
      const pty = createMockPtyInfo({ gitDiffStats: { added: 10, removed: 5, binary: 2 } });
      expect(calculateRowMetaWidth(pty)).toBe('+10 -5 *2'.length);
    });

    it('should include detached HEAD indicator', () => {
      const pty = createMockPtyInfo({
        gitDetached: true,
        gitDiffStats: { added: 1, removed: 0, binary: 0 },
      });
      expect(calculateRowMetaWidth(pty)).toBe('@ +1'.length);
    });

    it('should include git state indicator', () => {
      const pty = createMockPtyInfo({
        gitState: 'rebase',
        gitDiffStats: { added: 1, removed: 0, binary: 0 },
      });
      expect(calculateRowMetaWidth(pty)).toBe('~ +1'.length);
    });

    it('should include ahead indicator', () => {
      const pty = createMockPtyInfo({
        gitAhead: 3,
        gitDiffStats: { added: 0, removed: 0, binary: 0 },
      });
      expect(calculateRowMetaWidth(pty)).toBe('↑3'.length);
    });

    it('should include behind indicator', () => {
      const pty = createMockPtyInfo({
        gitBehind: 5,
        gitDiffStats: { added: 0, removed: 0, binary: 0 },
      });
      expect(calculateRowMetaWidth(pty)).toBe('↓5'.length);
    });

    it('should calculate width for PTY with all indicators', () => {
      const pty = createMockPtyInfo({
        gitDetached: true,
        gitState: 'rebase',
        gitDiffStats: { added: 1545, removed: 29, binary: 1 },
        gitAhead: 3,
        gitBehind: 2,
      });
      // Expected: "@ ~ +1545 -29 *1 ↑3 ↓2"
      expect(calculateRowMetaWidth(pty)).toBe('@ ~ +1545 -29 *1 ↑3 ↓2'.length);
    });
  });

  describe('per-row label width calculation', () => {
    it('should give full width to PTY with no metadata', () => {
      const pty = createMockPtyInfo({ gitDiffStats: undefined });
      const rowMetaWidth = calculateRowMetaWidth(pty);
      const labelWidth = calculateLabelMaxWidth(50, 4, rowMetaWidth);
      // 50 - 4 (indent) - 1 (gutter) = 45 (no metadata reserved)
      expect(labelWidth).toBe(45);
    });

    it('should reserve space for PTY with metadata', () => {
      const pty = createMockPtyInfo({ gitDiffStats: { added: 5, removed: 0, binary: 0 } });
      const rowMetaWidth = calculateRowMetaWidth(pty); // "+5" = 2 chars
      const labelWidth = calculateLabelMaxWidth(50, 4, rowMetaWidth);
      // 50 - 4 (indent) - 1 (gutter) - 2 (meta) - 2 (spacing) = 41
      expect(labelWidth).toBe(41);
    });

    it('should reserve more space for PTY with large metadata', () => {
      const pty = createMockPtyInfo({
        gitDiffStats: { added: 1952, removed: 1887, binary: 46 },
      });
      const rowMetaWidth = calculateRowMetaWidth(pty); // "+1952 -1887 *46" = 15 chars
      const labelWidth = calculateLabelMaxWidth(50, 4, rowMetaWidth);
      // 50 - 4 (indent) - 1 (gutter) - 15 (meta) - 2 (spacing) = 28
      expect(rowMetaWidth).toBe(15);
      expect(labelWidth).toBe(28);
    });

    it('should allow each PTY to use full width regardless of other PTYs', () => {
      // PTY 1: no metadata - gets full width
      const pty1 = createMockPtyInfo({ gitDiffStats: undefined });
      const width1 = calculateLabelMaxWidth(50, 4, calculateRowMetaWidth(pty1));

      // PTY 2: massive metadata - only reserves its own space (15 chars for "+1952 -1887 *46")
      const pty2 = createMockPtyInfo({
        gitDiffStats: { added: 1952, removed: 1887, binary: 46 },
      });
      const width2 = calculateLabelMaxWidth(50, 4, calculateRowMetaWidth(pty2));

      // PTY 3: small metadata - only reserves its own space
      const pty3 = createMockPtyInfo({ gitDiffStats: { added: 2, removed: 0, binary: 0 } });
      const width3 = calculateLabelMaxWidth(50, 4, calculateRowMetaWidth(pty3));

      // PTY 1 should have more space than PTY 2 (45 vs 28)
      expect(width1).toBeGreaterThan(width2);
      // PTY 3 should have more space than PTY 2 (41 vs 28)
      expect(width3).toBeGreaterThan(width2);
      // PTY 1 should have full width (no metadata reserved)
      expect(width1).toBe(45);
      expect(width2).toBe(28);
      expect(width3).toBe(41);
    });
  });

  describe('right-align padding calculation', () => {
    // Simulate the right-align padding calculation from PtyTreeRow
    function calculateRightAlignPadding(
      availableWidth: number,
      labelLength: number,
      metaWidth: number
    ): number {
      if (metaWidth === 0) return 0;
      return Math.max(0, availableWidth - labelLength - metaWidth);
    }

    it('should calculate padding to right-align metadata', () => {
      // availableWidth = 50 - 4 (indent) - 1 (gutter) = 45
      const availableWidth = 45;

      // Short label with metadata: padding pushes metadata to the right
      const labelLen = 8; // "openmux"
      const metaLen = 9; // "+188 -189"
      const padding = calculateRightAlignPadding(availableWidth, labelLen, metaLen);
      // 45 - 8 - 9 = 28 spaces before metadata
      expect(padding).toBe(28);
    });

    it('should handle long labels that fill most of the space', () => {
      const availableWidth = 45;
      const labelLen = 40; // Long folder name
      const metaLen = 4; // "+42"
      const padding = calculateRightAlignPadding(availableWidth, labelLen, metaLen);
      // 45 - 40 - 4 = 1 space before metadata
      expect(padding).toBe(1);
    });

    it('should return zero padding when label uses all available space', () => {
      const availableWidth = 45;
      const labelLen = 43; // Almost full
      const metaLen = 2; // "+5"
      const padding = calculateRightAlignPadding(availableWidth, labelLen, metaLen);
      // 45 - 43 - 2 = 0, but metadata still shown (may overlap or truncate)
      expect(padding).toBe(0);
    });

    it('should return zero padding for PTY with no metadata', () => {
      const availableWidth = 45;
      const labelLen = 10;
      const metaLen = 0;
      const padding = calculateRightAlignPadding(availableWidth, labelLen, metaLen);
      expect(padding).toBe(0);
    });
  });

  describe('viewport independence', () => {
    it('each row calculates its own width independently of tree contents', () => {
      const ptyWithMassiveStats = createMockPtyInfo({
        ptyId: 'pty-1',
        gitDiffStats: { added: 1952, removed: 1887, binary: 46 },
      });
      const ptyWithNoStats = createMockPtyInfo({
        ptyId: 'pty-2',
        gitDiffStats: undefined,
      });

      // Create trees with different compositions
      const tree1 = [createPtyTreeItem(ptyWithMassiveStats, 0)];
      const tree2 = [createPtyTreeItem(ptyWithNoStats, 0)];
      const tree3 = [
        createPtyTreeItem(ptyWithMassiveStats, 0),
        createPtyTreeItem(ptyWithNoStats, 1),
      ];

      // Each row's metadata width should be independent of the tree
      const width1 = calculateRowMetaWidth(tree1[0].node.ptyInfo);
      const width2 = calculateRowMetaWidth(tree2[0].node.ptyInfo);
      const width3a = calculateRowMetaWidth(tree3[0].node.ptyInfo);
      const width3b = calculateRowMetaWidth(tree3[1].node.ptyInfo);

      // Massive stats PTY has same width regardless of tree (15 chars: "+1952 -1887 *46")
      expect(width1).toBe(width3a);
      expect(width1).toBe(15);

      // No stats PTY has same width regardless of tree
      expect(width2).toBe(width3b);
      expect(width2).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle mixed tree with sessions and PTYs', () => {
      const tree: FlattenedTreeItem[] = [
        createSessionTreeItem('session-1', 0),
        createPtyTreeItem(
          createMockPtyInfo({ gitDiffStats: { added: 10, removed: 0, binary: 0 } }),
          1
        ),
        createSessionTreeItem('session-2', 2),
        createPtyTreeItem(
          createMockPtyInfo({ gitDiffStats: { added: 100, removed: 50, binary: 0 } }),
          3
        ),
      ];

      // Each PTY calculates its own metadata width
      const pty1Width = calculateRowMetaWidth((tree[1].node as { ptyInfo: PtyInfo }).ptyInfo);
      const pty2Width = calculateRowMetaWidth((tree[3].node as { ptyInfo: PtyInfo }).ptyInfo);

      expect(pty1Width).toBe('+10'.length);
      expect(pty2Width).toBe('+100 -50'.length);
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
      // Placeholders don't have git metadata
      expect(tree[0].node.type).toBe('placeholder');
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
      // Spacers don't have git metadata
      expect(tree[0].node.type).toBe('spacer');
    });
  });
});
