/**
 * PtyTreeRow alignment tests - Tests for label truncation and metadata positioning.
 */

import { describe, it, expect } from 'bun:test';
import type { PtyInfo } from '../../../contexts/aggregate-view-types';

// Helper to create a mock PTY info
function createMockPtyInfo(overrides: Partial<PtyInfo> = {}): PtyInfo {
  return {
    ptyId: 'pty-1',
    sessionId: 'session-1',
    cwd: '/home/test/project',
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
    foregroundProcess: 'nvim',
    shell: 'zsh',
    title: undefined,
    sessionMetadata: undefined,
    ...overrides,
  };
}

// Replicate the git metadata formatting logic from PtyTreeRow
function buildGitMetadata(pty: PtyInfo): string {
  const parts: string[] = [];

  if (pty.gitDetached) {
    parts.push('@');
  }

  if (pty.gitState && pty.gitState !== 'none' && pty.gitState !== 'unknown') {
    parts.push('~');
  }

  const stats = pty.gitDiffStats;
  if (stats && (stats.added > 0 || stats.removed > 0 || stats.binary > 0)) {
    if (stats.added > 0) parts.push(`+${stats.added}`);
    if (stats.removed > 0) parts.push(`-${stats.removed}`);
    if (stats.binary > 0) parts.push(`*${stats.binary}`);
  }

  if (pty.gitAhead && pty.gitAhead > 0) {
    parts.push(`↑${pty.gitAhead}`);
  }
  if (pty.gitBehind && pty.gitBehind > 0) {
    parts.push(`↓${pty.gitBehind}`);
  }

  return parts.join(' ');
}

// Replicate label building logic
function getDirectoryName(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean);
  return parts[parts.length - 1] || cwd;
}

function getProcessBaseName(name: string | undefined): string {
  const raw = name?.trim();
  if (!raw) return '';
  const parts = raw.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? raw;
}

function getProcessDisplayName(pty: PtyInfo): string | null {
  const KNOWN_SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'tcsh', 'csh', 'nu', 'pwsh', 'powershell']);
  const processName = getProcessBaseName(pty.foregroundProcess);
  const normalizedProcessName = processName.toLowerCase();
  const shellName = getProcessBaseName(pty.shell)?.toLowerCase();

  if (!processName) {
    return null;
  }

  if (KNOWN_SHELLS.has(normalizedProcessName) || (shellName && normalizedProcessName === shellName)) {
    return null;
  }

  return processName;
}

function buildLabel(pty: PtyInfo): string {
  const directoryName = getDirectoryName(pty.cwd).trim();
  const processName = getProcessDisplayName(pty);
  const savedTitle = pty.title?.trim() ?? '';
  const shellName = getProcessBaseName(pty.shell) || 'shell';
  const baseLabel = directoryName || savedTitle || shellName;

  if (!processName || processName === baseLabel) {
    return baseLabel;
  }

  return `${baseLabel} (${processName})`;
}

// Layout calculation logic
interface LayoutParams {
  maxWidth: number;
  indent: string;
  maxMetaWidth: number;
  spacing: number;
}

interface LayoutResult {
  availableWidth: number;
  reservedMetaWidth: number;
  labelMaxWidth: number;
  displayLabel: string;
  padding: string;
  metadata: string;
}

function calculateLayout(label: string, metadata: string, params: LayoutParams): LayoutResult {
  const indentWidth = params.indent.length;
  const rightGutter = 1;
  const availableWidth = params.maxWidth - indentWidth - rightGutter;
  const reservedMetaWidth = params.maxMetaWidth;
  const labelMaxWidth = Math.max(0, availableWidth - (reservedMetaWidth > 0 ? reservedMetaWidth + params.spacing : 0));
  
  // Truncate label with ellipsis
  let displayLabel = label;
  if (label.length > labelMaxWidth) {
    if (labelMaxWidth <= 0) {
      displayLabel = '';
    } else if (labelMaxWidth === 1) {
      displayLabel = '…';
    } else {
      displayLabel = label.slice(0, labelMaxWidth - 1) + '…';
    }
  }

  // Calculate padding with right-alignment
  let padding = '';
  if (metadata.length > 0) {
    const targetColumn = labelMaxWidth + params.spacing;
    const currentPos = displayLabel.length;
    const baseGap = Math.max(0, targetColumn - currentPos);
    const rightAlignPadding = Math.max(0, reservedMetaWidth - metadata.length);
    padding = ' '.repeat(baseGap + rightAlignPadding);
  }

  return {
    availableWidth,
    reservedMetaWidth,
    labelMaxWidth,
    displayLabel,
    padding,
    metadata,
  };
}

describe('PtyTreeRow alignment', () => {
  describe('label building', () => {
    it('should use directory name as base label', () => {
      const pty = createMockPtyInfo({ cwd: '/home/user/projects/my-app', foregroundProcess: undefined });
      expect(buildLabel(pty)).toBe('my-app');
    });

    it('should include process name when not a shell', () => {
      const pty = createMockPtyInfo({ cwd: '/home/user/project', foregroundProcess: 'nvim' });
      expect(buildLabel(pty)).toBe('project (nvim)');
    });

    it('should not include process name for shells', () => {
      const pty = createMockPtyInfo({ cwd: '/home/user/project', foregroundProcess: 'zsh', shell: 'zsh' });
      expect(buildLabel(pty)).toBe('project');
    });

    it('should fall back to shell name when cwd and title are empty', () => {
      const pty = createMockPtyInfo({ cwd: '', title: undefined, shell: 'bash', foregroundProcess: undefined });
      expect(buildLabel(pty)).toBe('bash');
    });

    it('should use title when available and no cwd', () => {
      const pty = createMockPtyInfo({ cwd: '', title: 'Terminal', shell: 'bash', foregroundProcess: undefined });
      expect(buildLabel(pty)).toBe('Terminal');
    });
  });

  describe('git metadata formatting', () => {
    it('should return empty string when no metadata', () => {
      const pty = createMockPtyInfo();
      expect(buildGitMetadata(pty)).toBe('');
    });

    it('should format added files', () => {
      const pty = createMockPtyInfo({ gitDiffStats: { added: 5, removed: 0, binary: 0 } });
      expect(buildGitMetadata(pty)).toBe('+5');
    });

    it('should format added and removed', () => {
      const pty = createMockPtyInfo({ gitDiffStats: { added: 1545, removed: 29, binary: 0 } });
      expect(buildGitMetadata(pty)).toBe('+1545 -29');
    });

    it('should format all diff stats', () => {
      const pty = createMockPtyInfo({ gitDiffStats: { added: 10, removed: 5, binary: 2 } });
      expect(buildGitMetadata(pty)).toBe('+10 -5 *2');
    });

    it('should include detached HEAD indicator', () => {
      const pty = createMockPtyInfo({ gitDetached: true, gitDiffStats: { added: 1, removed: 0, binary: 0 } });
      expect(buildGitMetadata(pty)).toBe('@ +1');
    });

    it('should include git state indicator', () => {
      const pty = createMockPtyInfo({ gitState: 'rebase', gitDiffStats: { added: 1, removed: 0, binary: 0 } });
      expect(buildGitMetadata(pty)).toBe('~ +1');
    });

    it('should include ahead/behind indicators', () => {
      const pty = createMockPtyInfo({ gitAhead: 3, gitBehind: 2, gitDiffStats: { added: 0, removed: 0, binary: 0 } });
      expect(buildGitMetadata(pty)).toBe('↑3 ↓2');
    });

    it('should include all indicators when present', () => {
      const pty = createMockPtyInfo({
        gitDetached: true,
        gitState: 'merge',
        gitDiffStats: { added: 100, removed: 50, binary: 5 },
        gitAhead: 1,
        gitBehind: 3,
      });
      expect(buildGitMetadata(pty)).toBe('@ ~ +100 -50 *5 ↑1 ↓3');
    });
  });

  describe('layout calculation', () => {
    const defaultParams: LayoutParams = {
      maxWidth: 50,
      indent: '    ', // 4 spaces
      maxMetaWidth: 10,
      spacing: 2,
    };

    it('should calculate available width correctly', () => {
      const layout = calculateLayout('project', '+1545 -29', defaultParams);
      expect(layout.availableWidth).toBe(45); // 50 - 4 indent - 1 right gutter
    });

    it('should reserve space for max metadata width', () => {
      const layout = calculateLayout('project', '+1545 -29', defaultParams);
      expect(layout.reservedMetaWidth).toBe(10);
    });

    it('should calculate label max width correctly', () => {
      const layout = calculateLayout('project', '+1545 -29', defaultParams);
      // 45 available - (10 meta + 2 spacing) = 33
      expect(layout.labelMaxWidth).toBe(33);
    });

    it('should not truncate short labels', () => {
      const layout = calculateLayout('my-app', '+1545 -29', defaultParams);
      expect(layout.displayLabel).toBe('my-app');
    });

    it('should truncate long labels with ellipsis', () => {
      const longLabel = 'very-long-project-name-that-needs-truncation';
      const layout = calculateLayout(longLabel, '+1545 -29', defaultParams);
      // Max label width is 33, so we get 32 chars + ellipsis
      expect(layout.displayLabel.length).toBe(33);
      expect(layout.displayLabel.endsWith('…')).toBe(true);
    });

    it('should handle labels that exactly fit', () => {
      const label = 'a'.repeat(33);
      const layout = calculateLayout(label, '+1545 -29', defaultParams);
      expect(layout.displayLabel).toBe(label);
      expect(layout.displayLabel.endsWith('…')).toBe(false);
    });

    it('should calculate padding for alignment when metadata present', () => {
      const layout = calculateLayout('my-app', '+1545 -29', defaultParams);
      // Label is 6 chars, max label width is 33
      // Target column is 33 + 2 spacing = 35
      // Base gap = 35 - 6 = 29
      // Right-align padding = 10 (maxMetaWidth) - 9 (metaLen) = 1
      // Total padding = 30
      expect(layout.padding.length).toBe(30);
    });

    it('should right-align short metadata within reserved space', () => {
      // Meta "@" with maxMetaWidth of 10 should be right-aligned
      const layout = calculateLayout('my-app', '@', { ...defaultParams, maxMetaWidth: 10 });
      // Label = 6 chars
      // labelMaxWidth = 45 - (10 + 2) = 33
      // targetColumn = 33 + 2 = 35
      // baseGap = 35 - 6 = 29
      // rightAlignPadding = 10 - 1 = 9
      // total padding = 38
      // Metadata start position = 6 + 38 = 44
      expect(layout.padding.length).toBe(38);
      expect(layout.displayLabel.length + layout.padding.length).toBe(44);
      // Metadata end position should be at the right edge of reserved space (before gutter)
      expect(layout.displayLabel.length + layout.padding.length + layout.metadata.length).toBe(45);
    });

    it('should align metadata END position regardless of label length', () => {
      const shortLayout = calculateLayout('a', '+1', defaultParams);
      const longLayout = calculateLayout('my-project-name', '+1', defaultParams);

      // With right-alignment, the END position (metadata start + metadata length) should be consistent
      // Not the start position, since short metadata gets pushed right
      const shortEndPos = shortLayout.displayLabel.length + shortLayout.padding.length + shortLayout.metadata.length;
      const longEndPos = longLayout.displayLabel.length + longLayout.padding.length + longLayout.metadata.length;

      expect(shortEndPos).toBe(longEndPos);
      // End position = targetColumn (35) + maxMetaWidth (10) = 45 (minus right gutter already accounted)
      expect(shortEndPos).toBe(45);
    });

    it('should return empty padding when no metadata', () => {
      const layout = calculateLayout('my-app', '', { ...defaultParams, maxMetaWidth: 0 });
      expect(layout.padding).toBe('');
      expect(layout.labelMaxWidth).toBe(45); // Full available width (50 - 4 - 1)
    });

    it('should handle zero metadata width', () => {
      const layout = calculateLayout('my-app', '', { ...defaultParams, maxMetaWidth: 0 });
      expect(layout.reservedMetaWidth).toBe(0);
      expect(layout.labelMaxWidth).toBe(45);
    });

    it('should handle very narrow widths', () => {
      const narrowParams: LayoutParams = {
        maxWidth: 10,
        indent: '    ',
        maxMetaWidth: 10,
        spacing: 2,
      };
      const layout = calculateLayout('project', '+1', narrowParams);
      // 10 - 4 indent - 1 gutter = 5 available, minus 10+2 meta = negative, clamped to 0
      expect(layout.labelMaxWidth).toBe(0);
      expect(layout.displayLabel).toBe('');
    });

    it('should produce ellipsis for 1-char label width', () => {
      const params: LayoutParams = {
        maxWidth: 20,
        indent: '    ',
        maxMetaWidth: 10,
        spacing: 2,
      };
      const layout = calculateLayout('project', '+1', params);
      // 20 - 4 - 1 = 15 available, minus 10+2 = 3 label width, minus 1 for ellipsis = 2 chars
      expect(layout.labelMaxWidth).toBe(3);
      expect(layout.displayLabel).toBe('pr…');
    });
  });

  describe('alignment consistency', () => {
    it('should align metadata at same position for all rows with same maxMetaWidth', () => {
      const params: LayoutParams = {
        maxWidth: 50,
        indent: '    ',
        maxMetaWidth: 15, // Simulating the shared max from ListPane
        spacing: 2,
      };

      // Simulate multiple PTYs with different label lengths and metadata
      const rows = [
        { label: 'short', meta: '+1' },
        { label: 'medium-length-name', meta: '+100 -50' },
        { label: 'very-long-project-name-here', meta: '+1545 -29 *1' },
      ];

      const layouts = rows.map(r => calculateLayout(r.label, r.meta, params));

      // All metadata END positions should align (right edge of reserved space)
      const metaEndPositions = layouts.map(l => l.displayLabel.length + l.padding.length + l.metadata.length);
      
      expect(metaEndPositions[0]).toBe(metaEndPositions[1]);
      expect(metaEndPositions[1]).toBe(metaEndPositions[2]);
      // labelMaxWidth = (50 - 4 - 1) - (15 + 2) = 45 - 17 = 28
      // targetColumn = 28 + 2 = 30 (start of reserved space)
      // end position = 30 + 15 (reserved width) = 45
      expect(metaEndPositions[0]).toBe(45);
    });

    it('should truncate labels to fit metadata when screen is narrow', () => {
      const params: LayoutParams = {
        maxWidth: 30,
        indent: '    ',
        maxMetaWidth: 15,
        spacing: 2,
      };

      const layout = calculateLayout('my-very-long-project-name', '+1545 -29', params);
      
      // 30 - 4 - 1 = 25 available, minus 15+2 = 8 label width
      expect(layout.labelMaxWidth).toBe(8);
      // Truncated label with ellipsis: 7 chars + "…"
      expect(layout.displayLabel).toBe('my-very…');
      // Metadata right-aligned: label (8) + padding (7) = 15 start position
      // Padding = baseGap (10-8=2) + rightAlign (15-9=6) = 8
      expect(layout.displayLabel.length + layout.padding.length).toBe(16);
      // Metadata end position = 16 + 9 = 25 (at right edge of available space)
      expect(layout.displayLabel.length + layout.padding.length + layout.metadata.length).toBe(25);
    });
  });
});
