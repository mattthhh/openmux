/**
 * PTY Tree Row - Single line PTY display with shimmer for active PTYs
 *
 * Format:   [label] [git metadata]
 * - Left: indent + truncated folder/process label (uses full width if no metadata)
 * - Right: git metadata (@detached ~state +added -removed *binary ↑ahead ↓behind)
 * - Per-row: each row only reserves space for its own metadata (no global column alignment)
 *
 * EVENT-BASED SHIMMER:
 * - Uses lazy render-time calculation via getPtyShimmerColor()
 * - Subscribes to shared RAF signal only when PTY is active
 * - No global polling loop
 */

import { createEffect, createMemo, createSignal } from 'solid-js';
import type { PtyInfo } from '../../contexts/aggregate/types';
import type { AggregateTheme } from '../../core/types';
import { getPtyShimmerColor, hasActiveShimmer } from '../../core/shimmer';
import { useShimmerRenderTime, useShimmerStateVersion } from './hooks/useShimmerRenderTime';
import { getDirectoryName } from './utils';

export interface PtyTreeRowProps {
  /** PTY info to display */
  pty: PtyInfo;
  /** Whether this row is selected */
  isSelected: boolean;
  /** Max width for rendering */
  maxWidth: number;
  /** Max git metadata width across all PTYs for alignment - DEPRECATED, unused */
  maxMetaWidth?: number;
  /** Tree prefix glyph - IGNORED for cleaner look */
  treePrefix: string;
  /** Indentation string (just spaces, no tree glyphs) */
  indent: string;
  /** Theme colors */
  aggregateTheme: AggregateTheme;
  /** Host/background color used for codex-style dark shimmer */
  shimmerTargetColor: string;
  /** Base text colors */
  textColors: {
    foreground: string;
    muted: string;
    subtle: string;
  };
  /** Click handler */
  onClick?: () => void;
  /** Mouse down handler */
  onMouseDown?: () => void;
  /** Mouse up handler */
  onMouseUp?: () => void;
}

/**
 * Format git diff stats string
 */
function formatGitStats(pty: PtyInfo): string | null {
  const stats = pty.gitDiffStats;
  if (!stats || (stats.added === 0 && stats.removed === 0 && stats.binary === 0)) {
    return null;
  }

  const parts: string[] = [];
  if (stats.added > 0) parts.push(`+${stats.added}`);
  if (stats.removed > 0) parts.push(`-${stats.removed}`);
  if (stats.binary > 0) parts.push(`*${stats.binary}`);

  return parts.join(' ');
}

const KNOWN_SHELLS = new Set([
  'sh',
  'bash',
  'zsh',
  'fish',
  'dash',
  'ksh',
  'tcsh',
  'csh',
  'nu',
  'pwsh',
  'powershell',
]);

function getProcessBaseName(name: string | undefined): string {
  const raw = name?.trim();
  if (!raw) return '';
  const parts = raw.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? raw;
}

function normalizeProcessName(name: string | undefined): string {
  return getProcessBaseName(name).toLowerCase();
}

function getProcessDisplayName(pty: PtyInfo): string | null {
  const processName = getProcessBaseName(pty.foregroundProcess);
  const normalizedProcessName = processName.toLowerCase();
  const shellName = normalizeProcessName(pty.shell);

  if (!processName) {
    return null;
  }

  if (
    KNOWN_SHELLS.has(normalizedProcessName) ||
    (shellName && normalizedProcessName === shellName)
  ) {
    return null;
  }

  return processName;
}

/**
 * Build git metadata string
 */
function buildGitMetadata(pty: PtyInfo): string {
  const parts: string[] = [];

  // Detached HEAD indicator
  if (pty.gitDetached) {
    parts.push('@');
  }

  // Git state indicator (rebase, merge, etc.)
  if (pty.gitState && pty.gitState !== 'none' && pty.gitState !== 'unknown') {
    parts.push('~');
  }

  // Diff stats
  const diffStats = formatGitStats(pty);
  if (diffStats) {
    parts.push(diffStats);
  }

  // Ahead/behind indicators
  if (pty.gitAhead && pty.gitAhead > 0) {
    parts.push(`↑${pty.gitAhead}`);
  }
  if (pty.gitBehind && pty.gitBehind > 0) {
    parts.push(`↓${pty.gitBehind}`);
  }

  return parts.join(' ');
}

/**
 * Single line PTY row with shimmer effect for active PTYs
 *
 * EVENT-BASED: Only subscribes to RAF when PTY has active shimmer
 */
export function PtyTreeRow(props: PtyTreeRowProps) {
  const shimmerStateVersion = useShimmerStateVersion();
  const [isAnimating, setIsAnimating] = createSignal(hasActiveShimmer(props.pty.ptyId));
  const renderTime = useShimmerRenderTime(isAnimating);

  createEffect(() => {
    void shimmerStateVersion();
    if (isAnimating()) return;
    setIsAnimating(hasActiveShimmer(props.pty.ptyId));
  });

  createEffect(() => {
    if (!isAnimating()) return;
    const now = renderTime();
    if (hasActiveShimmer(props.pty.ptyId, now)) return;
    setIsAnimating(false);
  });

  // Selection colors
  const selectionColors = () => props.aggregateTheme.selection;
  const diffColors = () => props.aggregateTheme.diff;

  // Base foreground color
  const baseFgColor = () =>
    props.isSelected ? selectionColors().foreground : props.textColors.foreground;

  // Background color for selection
  const bgColor = () => (props.isSelected ? selectionColors().background : undefined);

  // Muted/subtle colors
  const mutedColor = () => (props.isSelected ? selectionColors().dim : props.textColors.muted);
  const subtleColor = () => (props.isSelected ? selectionColors().dim : props.textColors.subtle);

  // Show folder + active process, while still letting the label truncate before git metadata.
  const label = createMemo(() => {
    const directoryName = getDirectoryName(props.pty.cwd).trim();
    const processName = getProcessDisplayName(props.pty);
    const savedTitle = props.pty.title?.trim() ?? '';
    const shellName = getProcessBaseName(props.pty.shell) || 'shell';
    const baseLabel = directoryName || savedTitle || shellName;

    if (!processName || processName === baseLabel) {
      return baseLabel;
    }

    return `${baseLabel} (${processName})`;
  });

  // Git metadata for THIS row only
  const gitMeta = createMemo(() => buildGitMetadata(props.pty));
  const thisMetaWidth = () => gitMeta().length;

  // Calculate layout - clean, no tree glyphs
  const indentWidth = () => props.indent.length;
  const spacing = 2; // Double space between label and metadata
  const rightGutter = 1; // Minimum right-side padding

  // Available width for content.
  const availableWidth = () => props.maxWidth - indentWidth() - rightGutter;

  // Per-row: only reserve space for THIS row's metadata (if any)
  const reservedMetaWidth = () => (thisMetaWidth() > 0 ? thisMetaWidth() + spacing : 0);
  const labelMaxWidth = () => {
    const reserved = reservedMetaWidth();
    return Math.max(0, availableWidth() - reserved);
  };

  // Truncate the folder label, only reserving space for this row's own metadata
  const displayLabel = createMemo(() => {
    const text = label();
    const maxWidth = labelMaxWidth();
    if (maxWidth <= 0) return '';
    if (text.length <= maxWidth) return text;
    if (maxWidth === 1) return '…';
    return text.slice(0, maxWidth - 1) + '…';
  });

  // Padding to right-align the git metadata at the edge with a small gap
  // Formula: available space - label length - metadata length = padding before metadata
  const padding = createMemo(() => {
    const metaLen = thisMetaWidth();
    // If no metadata for this row, no padding needed
    if (metaLen === 0) return '';
    // Calculate padding to right-align metadata (with rightGutter already accounted in availableWidth)
    const labelLen = displayLabel().length;
    const padLen = Math.max(0, availableWidth() - labelLen - metaLen);
    return ' '.repeat(padLen);
  });

  // Apply shimmer to label characters only while this row is actively animating.
  const renderLabel = createMemo(() => {
    const text = displayLabel();
    const baseColor = baseFgColor();

    if (!isAnimating()) {
      return (
        <text fg={baseColor} selectable={false}>
          {text}
        </text>
      );
    }

    const now = renderTime();
    if (!hasActiveShimmer(props.pty.ptyId, now)) {
      return (
        <text fg={baseColor} selectable={false}>
          {text}
        </text>
      );
    }

    // Build shimmered text - character by character
    const shimmeredChars: JSX.Element[] = [];
    let currentRun = '';
    let currentColor = baseColor;

    for (let i = 0; i < text.length; i++) {
      const shimmerColor = getPtyShimmerColor(props.pty.ptyId, baseColor, i, text.length, now, {
        targetColor: props.shimmerTargetColor,
      });

      const nextColor = shimmerColor ?? baseColor;

      if (nextColor !== currentColor) {
        if (currentRun) {
          shimmeredChars.push(
            <text fg={currentColor} selectable={false}>
              {currentRun}
            </text>
          );
          currentRun = '';
        }
        currentColor = nextColor;
      }

      currentRun += text[i];
    }

    if (currentRun) {
      shimmeredChars.push(
        <text fg={currentColor} selectable={false}>
          {currentRun}
        </text>
      );
    }

    return <>{shimmeredChars}</>;
  });

  // Git metadata color mapping
  const renderGitMeta = () => {
    const meta = gitMeta();
    if (!meta) return null;

    const parts: JSX.Element[] = [];
    const tokens = meta.split(/(\s+)/);

    for (const token of tokens) {
      if (!token.trim()) {
        parts.push(<text selectable={false}>{token}</text>);
        continue;
      }

      // Color based on token prefix
      if (token.startsWith('+')) {
        parts.push(
          <text
            fg={props.isSelected ? diffColors().addedSelected : diffColors().added}
            selectable={false}
          >
            {token}
          </text>
        );
      } else if (token.startsWith('-')) {
        parts.push(
          <text
            fg={props.isSelected ? diffColors().removedSelected : diffColors().removed}
            selectable={false}
          >
            {token}
          </text>
        );
      } else if (token.startsWith('*')) {
        parts.push(
          <text fg={subtleColor()} selectable={false}>
            {token}
          </text>
        );
      } else if (token.startsWith('↑') || token.startsWith('↓')) {
        parts.push(
          <text fg={mutedColor()} selectable={false}>
            {token}
          </text>
        );
      } else if (token === '*' || token === '@' || token === '~') {
        parts.push(
          <text fg={subtleColor()} selectable={false}>
            {token}
          </text>
        );
      } else {
        parts.push(
          <text fg={mutedColor()} selectable={false}>
            {token}
          </text>
        );
      }
    }

    return <>{parts}</>;
  };

  const handleClick = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    props.onClick?.();
  };

  return (
    <box
      style={{ height: 1, width: props.maxWidth, flexDirection: 'row' }}
      backgroundColor={bgColor()}
      onMouseDown={handleClick}
    >
      {/* Indentation only - NO tree prefix */}
      <text fg={subtleColor()} selectable={false}>
        {props.indent}
      </text>
      {/* Label with optional shimmer */}
      {renderLabel()}
      {/* Padding */}
      <text selectable={false}>{padding()}</text>
      {/* Git metadata */}
      {renderGitMeta()}
    </box>
  );
}

// JSX type import
import type { JSX } from 'solid-js';
