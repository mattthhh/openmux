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

import { For, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import type { PtyInfo } from '../../contexts/aggregate-view-types';
import type { AggregateTheme } from '../../core/types';
import {
  getPtyShimmerColor,
  hasActiveShimmer,
  hasPostShimmerGlow,
  clearPostShimmerGlow,
  suppressPtyShimmer,
  unsuppressPtyShimmer,
} from '../../core/shimmer';
import { useShimmerRenderTime, useShimmerStateVersion } from './hooks/useShimmerRenderTime';
import { getDirectoryName } from './utils';

export interface PtyTreeRowProps {
  /** PTY info to display */
  pty: PtyInfo;
  /** Whether this row is selected */
  isSelected: boolean;
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

/** Clear the remembered process for a PTY (on destruction). */
export function clearLastSeenProcess(ptyId: string): void {
  const entry = lastSeenProcess.get(ptyId);
  if (entry?.clearTimer) clearTimeout(entry.clearTimer);
  lastSeenProcess.delete(ptyId);
}

function getProcessDisplayName(pty: PtyInfo): string | null {
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

/**
 * ShimmeringLabel - Isolated component for shimmer animation
 *
 * This is a separate component to prevent the parent row from re-rendering
 * on every animation frame, which could interfere with mouse event handling.
 */
interface ShimmeringLabelProps {
  text: string;
  baseColor: string;
  ptyId: string;
  shimmerTargetColor: string;
  isAnimating: boolean;
}

/**
 * Pre-computed shimmer colors for a label.
 * Batched calculation reduces CPU from N calls per frame to 1 call per frame.
 */
interface ShimmerColors {
  colors: (string | undefined)[];
  defaultColor: string;
}

/**
 * Calculate shimmer colors for all characters in a label.
 * Single batch call instead of per-character calculations.
 */
function calculateShimmerColors(
  ptyId: string,
  text: string,
  baseColor: string,
  shimmerTargetColor: string,
  renderTime: number
): ShimmerColors {
  const colors: (string | undefined)[] = new Array(text.length);

  for (let i = 0; i < text.length; i++) {
    colors[i] = getPtyShimmerColor(ptyId, baseColor, i, text.length, renderTime, {
      targetColor: shimmerTargetColor,
    });
  }

  return { colors, defaultColor: baseColor };
}

function ShimmeringLabel(props: ShimmeringLabelProps) {
  // CRITICAL FIX: Only subscribe to RAF when actually animating
  // This prevents all visible rows from re-rendering at 60fps
  const renderTime = useShimmerRenderTime(() => props.isAnimating);

  // Batch calculate all shimmer colors once per frame
  const shimmerColors = createMemo(() =>
    calculateShimmerColors(
      props.ptyId,
      props.text,
      props.baseColor,
      props.shimmerTargetColor,
      renderTime()
    )
  );

  // Memoize character array to keep renderables stable across animation frames.
  // <For> uses keyed reconciliation so text nodes are reused (only fg color
  // updates) instead of destroyed and recreated on every RAF tick.
  // This prevents hit-testing transient nodes that have been unregistered
  // from Renderable.renderablesByNumber, which caused clicks to be lost.
  const characters = createMemo(() => Array.from(props.text));

  return (
    <For each={characters()}>
      {(char, index) => {
        // Access shimmerColors() reactively so SolidJS re-evaluates the fg prop
        // on each frame. <For> keeps the text node stable across frames (same
        // renderable ID), so hit-testing never targets a destroyed node.
        const color = () => shimmerColors().colors[index()] ?? shimmerColors().defaultColor;
        return (
          <text fg={color()} selectable={false}>
            {char}
          </text>
        );
      }}
    </For>
  );
}

/** Debounce before activating post-shimmer glow.
 *  Covers the gap between shimmer cycles so the glow only activates
 *  when shimmer is truly done, preventing a white flash. */
const GLOW_DEBOUNCE_MS = 1500;

/**
 * Single line PTY row with shimmer effect for active PTYs
 *
 * EVENT-BASED: Only subscribes to RAF when PTY has active shimmer
 */
export function PtyTreeRow(props: PtyTreeRowProps) {
  const shimmerStateVersion = useShimmerStateVersion();
  const [isAnimating, setIsAnimating] = createSignal(hasActiveShimmer(props.pty.ptyId));

  // Post-shimmer glow: bright white text until the user clicks the row to
  // preview the PTY. No timeout — cleared only by selection.
  // Initialize from the shimmer module so glow survives remount (session
  // group expand/collapse destroys and recreates PtyTreeRow instances).
  const [glowActive, setGlowActive] = createSignal(
    !hasActiveShimmer(props.pty.ptyId) && hasPostShimmerGlow(props.pty.ptyId)
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
    if (hasPostShimmerGlow(props.pty.ptyId) && !props.isSelected) {
      glowDebounce = setTimeout(() => {
        glowDebounce = null;
        // Re-check: shimmer may have restarted during the wait
        if (hasActiveShimmer(props.pty.ptyId)) return;
        if (hasPostShimmerGlow(props.pty.ptyId) && !props.isSelected) {
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

  // Cleanup: ensure shimmer suppression and glow debounce are removed on unmount
  onCleanup(() => {
    unsuppressPtyShimmer(props.pty.ptyId);
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
  const isBoldGlow = () => glowActive() && !props.isSelected;

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

  // Apply shimmer to label characters only while this row is actively animating.
  // NOTE: The shimmer is rendered as a separate component to isolate the
  // high-frequency re-renders (~60fps during animation) from the row's event
  // handlers. This prevents mouse click events from being lost during animation.
  //
  // CRITICAL: Text nodes don't receive onMouseDown events in OpenTUI (issue #112),
  // so we wrap the label in a box with the handler. During shimmer, the text
  // nodes are recreated rapidly, which causes clicks to be lost when they
  // target text nodes directly.
  const renderLabel = createMemo(() => {
    const text = displayLabel();
    const baseColor = baseFgColor();
    const bold = isBoldGlow();

    if (!isAnimating()) {
      if (bold) {
        return (
          <box style={{ height: 1, flexDirection: 'row' }} onMouseDown={handleClick}>
            <text fg={baseColor} selectable={false}>
              <b>{text}</b>
            </text>
          </box>
        );
      }
      return (
        <box style={{ height: 1, flexDirection: 'row' }} onMouseDown={handleClick}>
          <text fg={baseColor} selectable={false}>
            {text}
          </text>
        </box>
      );
    }

    // Use ShimmeringLabel component to isolate RAF-triggered re-renders.
    // Wrap in a box with onMouseDown since text nodes don't receive mouse events.
    return (
      <box style={{ height: 1, flexDirection: 'row' }} onMouseDown={handleClick}>
        <ShimmeringLabel
          text={text}
          baseColor={baseColor}
          ptyId={props.pty.ptyId}
          shimmerTargetColor={props.shimmerTargetColor}
          isAnimating={true}
        />
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
      {/* Label with optional shimmer */}
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
