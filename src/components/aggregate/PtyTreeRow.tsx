/**
 * PTY Tree Row - Single line PTY display with shimmer for active PTYs
 *
 * Format:   [label] [git metadata]
 * - Left: indent + truncated folder/process label (uses full width if no metadata)
 * - Right: git metadata (@detached ~state +added -removed *binary ↑ahead ↓behind)
 * - Per-row: each row only reserves space for its own metadata (no global column alignment)
 *
 * NATIVE SHIMMER:
 * - Shimmer animation is applied via OpenTUI's colorMatrix post-processing pipeline
 * - Row positions are registered in shimmer-registry via renderAfter callback
 * - The post-processor reads positions + shimmer states and builds a cellMask
 * - No per-character JS color blending or SolidJS reactive churn during animation
 */

import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import type { Renderable } from '@opentui/core';
import type { PtyInfo } from '../../contexts/aggregate-view-types';
import type { AggregateTheme } from '../../core/types';
import {
  hasActiveShimmer,
  hasPostShimmerGlow,
  clearPostShimmerGlow,
  suppressPtyShimmer,
  unsuppressPtyShimmer,
} from '../../core/shimmer';
import { registerShimmerRow, unregisterShimmerRow, hexToRgb } from '../../core/shimmer-registry';
import { useShimmerStateVersion } from './hooks/useShimmerRenderTime';
import { getDirectoryName } from './utils';

export interface PtyTreeRowProps {
  /** PTY info to display */
  pty: PtyInfo;
  /** Whether this row is selected */
  isSelected: boolean;
  /** PTY ID of the currently focused pane (main terminal view).
   *  Used to suppress glow for PTYs the user is already watching. */
  focusedPtyId: string | null;
  /** Max width for rendering */
  maxWidth: number;
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

/** Per-PTY memory of the last seen non-shell foreground process.
 *
 *  zig-pty alternates rapidly between child and shell during loops:
 *    for i in 1 2 3; do sleep 1; done  →  bash↔sleep↔bash↔sleep
 *
 *  This causes the process name to flicker in the display. We smooth it
 *  by remembering the last non-shell process and keeping it visible
 *  when the shell briefly becomes foreground.
 *
 *  The cache is cleared by a timer: when the foreground becomes the
 *  shell, we start a 500ms clear timer. If the child comes back before
 *  it fires (loop iteration), the timer is cancelled. When the child
 *  truly exits, the timer fires and the cache is deleted.
 *
 *  Module-level so it survives component remount (session group switch). */
const lastSeenProcess = new Map<
  string,
  { name: string; clearTimer: ReturnType<typeof setTimeout> | null }
>();

const PROCESS_CLEAR_DELAY_MS = 500;

/** Reactive version counter bumped each time the lastSeenProcess cache is
 *  mutated by a timer. PtyTreeRow's label memo calls processCacheVersion()
 *  via getProcessDisplayName, so a version change forces re-evaluation and
 *  the stale cached process name is removed from the display. */
const [processCacheVersion, setProcessCacheVersion] = createSignal(0);

/** Clear the remembered process for a PTY (on destruction). */
export function clearLastSeenProcess(ptyId: string): void {
  const entry = lastSeenProcess.get(ptyId);
  if (entry?.clearTimer) clearTimeout(entry.clearTimer);
  lastSeenProcess.delete(ptyId);
}

function getProcessDisplayName(pty: PtyInfo): string | null {
  // Subscribe to cache version so the label memo re-evaluates when the
  // smoothing timer fires and clears a stale process name.
  void processCacheVersion();
  const processName = getProcessBaseName(pty.foregroundProcess);
  const normalizedProcessName = processName.toLowerCase();
  const shellName = normalizeProcessName(pty.shell);

  const isShell =
    !processName ||
    KNOWN_SHELLS.has(normalizedProcessName) ||
    (shellName && normalizedProcessName === shellName);

  if (!isShell && processName) {
    // Non-shell process: remember it, cancel any pending clear timer
    const entry = lastSeenProcess.get(pty.ptyId);
    if (entry?.clearTimer) {
      clearTimeout(entry.clearTimer);
      entry.clearTimer = null;
    }
    lastSeenProcess.set(pty.ptyId, { name: processName, clearTimer: null });
    return processName;
  }

  // Shell or empty foreground: return cached name if available
  const cached = lastSeenProcess.get(pty.ptyId);
  if (cached) {
    // Start a clear timer if one isn't already running
    if (!cached.clearTimer) {
      cached.clearTimer = setTimeout(() => {
        lastSeenProcess.delete(pty.ptyId);
        // Bump version so any PtyTreeRow displaying this PTY re-evaluates
        // its label memo. Without this, the expired cache entry is deleted
        // but nothing triggers a re-render — the stale process name sticks.
        setProcessCacheVersion((v) => v + 1);
      }, PROCESS_CLEAR_DELAY_MS);
    }
    return cached.name;
  }

  return null;
}

/**
 * Build git metadata string
 */
function buildGitMetadata(pty: PtyInfo): string {
  const parts: string[] = [];

  // Worktree indicator
  if (pty.gitIsWorktree) {
    parts.push('⌁');
  }

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

/** Debounce before activating post-shimmer glow.
 *  Covers the gap between shimmer cycles so the glow only activates
 *  when shimmer is truly done, preventing a white flash. */
const GLOW_DEBOUNCE_MS = 1500;

/**
 * Single line PTY row with shimmer effect for active PTYs
 *
 * NATIVE POST-PROCESS: Shimmer animation is applied via colorMatrix
 * in the renderer's post-process pipeline. No per-character JS blending.
 */
export function PtyTreeRow(props: PtyTreeRowProps) {
  const shimmerStateVersion = useShimmerStateVersion();
  const [isAnimating, setIsAnimating] = createSignal(hasActiveShimmer(props.pty.ptyId));

  // Whether the user is currently watching this PTY — either it's
  // selected in the aggregate view (being previewed) or it's the
  // focused PTY in the main terminal (output is visible in real-time).
  // In either case, the user saw the output, so glow is unnecessary.
  const isUserWatching = () => props.isSelected || props.pty.ptyId === props.focusedPtyId;

  // Post-shimmer glow: bright text until the user clicks the row to
  // preview the PTY. No timeout — cleared only by selection.
  // Initialize from the shimmer module so glow survives remount (session
  // group expand/collapse destroys and recreates PtyTreeRow instances).
  // But suppress glow initialization if the user is already watching.
  const [glowActive, setGlowActive] = createSignal(
    !hasActiveShimmer(props.pty.ptyId) && hasPostShimmerGlow(props.pty.ptyId) && !isUserWatching()
  );

  // Debounce timer for glow activation — shared across effects below.
  let glowDebounce: ReturnType<typeof setTimeout> | null = null;

  // Disable shimmer when this PTY is selected (being previewed)
  createEffect(() => {
    if (props.isSelected) {
      suppressPtyShimmer(props.pty.ptyId);
      clearPostShimmerGlow(props.pty.ptyId);
      if (glowDebounce) {
        clearTimeout(glowDebounce);
        glowDebounce = null;
      }
      setGlowActive(false);
    } else {
      unsuppressPtyShimmer(props.pty.ptyId);
    }
  });

  // Effect 1: Start shimmer when conditions are met
  createEffect(() => {
    void shimmerStateVersion();
    if (isAnimating()) return;
    setIsAnimating(hasActiveShimmer(props.pty.ptyId));
  });

  // Effect 2: Detect when shimmer ENDS — defer glow to avoid
  // a flash when shimmer pauses briefly then restarts from queued
  // or new activity.
  createEffect(() => {
    void shimmerStateVersion();
    if (!isAnimating()) return;
    const now = Date.now();
    if (hasActiveShimmer(props.pty.ptyId, now)) return;
    setIsAnimating(false);
    // Cancel any pending glow from a previous shimmer end
    if (glowDebounce) clearTimeout(glowDebounce);
    // Defer glow: if shimmer restarts before the timer fires it is
    // cancelled and the glow never appears, avoiding the flash.
    if (hasPostShimmerGlow(props.pty.ptyId) && !isUserWatching()) {
      glowDebounce = setTimeout(() => {
        glowDebounce = null;
        // Re-check: shimmer may have restarted during the wait
        if (hasActiveShimmer(props.pty.ptyId)) return;
        if (hasPostShimmerGlow(props.pty.ptyId) && !isUserWatching()) {
          setGlowActive(true);
        }
      }, GLOW_DEBOUNCE_MS);
    }
  });

  // New shimmer starts → cancel pending glow debounce
  createEffect(() => {
    if (!isAnimating()) return;
    if (glowDebounce) {
      clearTimeout(glowDebounce);
      glowDebounce = null;
    }
    setGlowActive(false);
  });

  // Track previous ptyId for cleanup when the component is recycled
  // by <For> (index-based reconciliation). Without this, switching
  // session groups fast would leak stale shimmer registrations from
  // the old ptyId at positions now occupied by different rows.
  let prevPtyId = props.pty.ptyId;
  createEffect(() => {
    const currentPtyId = props.pty.ptyId;
    if (currentPtyId !== prevPtyId) {
      unregisterShimmerRow(prevPtyId);
      unsuppressPtyShimmer(prevPtyId);
      prevPtyId = currentPtyId;
    }
  });

  // Cleanup: ensure shimmer suppression, glow debounce, and registry are removed on unmount
  onCleanup(() => {
    unsuppressPtyShimmer(props.pty.ptyId);
    unregisterShimmerRow(props.pty.ptyId);
    if (glowDebounce) {
      clearTimeout(glowDebounce);
      glowDebounce = null;
    }
  });

  // Selection colors
  const selectionColors = () => props.aggregateTheme.selection;
  const diffColors = () => props.aggregateTheme.diff;

  // Base foreground color
  const baseFgColor = () => {
    if (props.isSelected) return selectionColors().foreground;
    return props.textColors.foreground;
  };

  // Whether to render the label in bold (post-shimmer glow)
  const isBoldGlow = () => glowActive() && !isUserWatching();

  // Background color
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

  const handleClick = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    props.onClick?.();
  };

  // Label rendered as plain text — shimmer is applied by the native
  // post-processor via colorMatrix, not per-character JS blending.
  // The label box uses renderAfter to register its buffer position
  // with shimmer-registry so the post-processor knows which cells to modify.
  const labelRenderAfter = function (this: Renderable) {
    const lbl = displayLabel();
    if (lbl.length === 0) return;
    const fg = baseFgColor();
    registerShimmerRow(props.pty.ptyId, {
      y: this.screenY,
      labelStartX: this.screenX,
      labelLength: lbl.length,
      labelText: lbl,
      fgColor: hexToRgb(fg),
      bgColor: hexToRgb(props.shimmerTargetColor),
    });
  };

  // Render the label — plain text with base FG color.
  // Bold glow is still rendered via <b> when active (the post-processor
  // applies a gain boost as well, but bold text remains more readable).
  const renderLabel = createMemo(() => {
    const text = displayLabel();
    const baseColor = baseFgColor();
    const bold = isBoldGlow();

    if (bold) {
      return (
        <box
          style={{ height: 1, flexDirection: 'row' }}
          renderAfter={labelRenderAfter}
          onMouseDown={handleClick}
        >
          <text fg={baseColor} selectable={false}>
            <b>{text}</b>
          </text>
        </box>
      );
    }

    return (
      <box
        style={{ height: 1, flexDirection: 'row' }}
        renderAfter={labelRenderAfter}
        onMouseDown={handleClick}
      >
        <text fg={baseColor} selectable={false}>
          {text}
        </text>
      </box>
    );
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

    // Wrap in box with onMouseDown since text nodes don't receive mouse events
    return (
      <box style={{ height: 1, flexDirection: 'row' }} onMouseDown={handleClick}>
        <>{parts}</>
      </box>
    );
  };

  return (
    <box
      style={{ height: 1, width: props.maxWidth, flexDirection: 'row' }}
      backgroundColor={bgColor()}
      onMouseDown={handleClick}
    >
      {/* Indentation only - NO tree prefix */}
      <box style={{ height: 1, flexDirection: 'row' }} onMouseDown={handleClick}>
        <text fg={subtleColor()} selectable={false}>
          {props.indent}
        </text>
      </box>
      {/* Label — shimmer applied by native post-processor */}
      {renderLabel()}
      {/* Padding */}
      <box style={{ height: 1, flexDirection: 'row' }} onMouseDown={handleClick}>
        <text selectable={false}>{padding()}</text>
      </box>
      {/* Git metadata */}
      {renderGitMeta()}
    </box>
  );
}

// JSX type import
import type { JSX } from 'solid-js';
