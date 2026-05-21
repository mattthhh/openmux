/**
 * Cell Rendering - utilities for rendering terminal cells with styling
 */
import type { RGBA, OptimizedBuffer } from '@opentui/core';
import { RGBA as RGBAClass } from '@opentui/core';

/**
 * Sentinel color used for default-bg cells. The native OpenTUI renderer will emit
 * an SGR 48;2;R;G;Bm sequence for this color, which the stdout-rewrite
 * interceptor (libstdout-rewrite.dylib / .so) rewrites to ESC[49m + NUL
 * padding ("default background"). The replacement is the same 16-byte length
 * as the sentinel so write() byte-accounting stays accurate — no return-value
 * lying needed. This allows the host terminal's background (with blur/
 * transparency) to show through.
 *
 * We use RGB(13,17,23) — GitHub's dark bg — as a sentinel that won't be
 * confused with any real theme color or quantized to a 256-color entry.
 * It's dark enough to be invisible but distinct enough in the SGR stream.
 */
const DEFAULT_BG_SENTINEL = RGBAClass.fromInts(13, 17, 23);
import type { TerminalCell } from '../../core/types';
import {
  WHITE,
  BLACK,
  getCachedRGBA,
  ATTR_BOLD,
  ATTR_ITALIC,
  ATTR_UNDERLINE,
  ATTR_STRIKETHROUGH,
  SELECTION_BG,
  SELECTION_FG,
  SEARCH_MATCH_BG,
  SEARCH_MATCH_FG,
  SEARCH_CURRENT_BG,
  SEARCH_CURRENT_FG,
} from '../../terminal/rendering';

export interface CellRenderingDeps {
  isCellSelected: (ptyId: string, x: number, y: number) => boolean;
  isCopySelected?: (ptyId: string, x: number, y: number) => boolean;
  isSearchMatch: (ptyId: string, x: number, y: number) => boolean;
  isCurrentMatch: (ptyId: string, x: number, y: number) => boolean;
  getSelection: (ptyId: string) => { normalizedRange: unknown } | undefined;
}

export interface CellRenderingOptions {
  ptyId: string;
  hasSelection: boolean;
  hasSearch: boolean;
  hasCopySelection: boolean;
  copyModeActive: boolean;
  isAtBottom: boolean;
  isFocused: boolean;
  cursorX: number;
  cursorY: number;
  cursorVisible: boolean;
  copyCursor: { x: number; absY: number } | null;
  scrollbackLength: number;
  viewportOffset: number;
  copySelectionFg: RGBA;
  copySelectionBg: RGBA;
  copyCursorFg: RGBA;
  copyCursorBg: RGBA;
}

/**
 * Render a single terminal cell with appropriate styling
 * Returns the colors to use for the cell
 */
export function getCellColors(
  cell: TerminalCell,
  x: number,
  absoluteY: number,
  screenY: number,
  options: CellRenderingOptions,
  deps: CellRenderingDeps
): { fg: RGBA; bg: RGBA; attributes: number } {
  const {
    ptyId,
    hasSelection,
    hasSearch,
    hasCopySelection,
    copyModeActive,
    isAtBottom,
    isFocused,
    cursorX,
    cursorY,
    cursorVisible,
    copyCursor,
    copySelectionFg,
    copySelectionBg,
    copyCursorFg,
    copyCursorBg,
  } = options;

  // Only show cursor when at bottom (not scrolled back) and focused
  const isVirtualCursor = !!copyCursor && copyCursor.absY === absoluteY && copyCursor.x === x;
  const isRealCursor =
    !copyModeActive &&
    isAtBottom &&
    isFocused &&
    cursorVisible &&
    cursorY === screenY &&
    cursorX === x;
  const isCursor = isVirtualCursor || isRealCursor;

  // Check if cell is selected (skip function call if no active selection)
  const isSelected = hasSelection && deps.isCellSelected(ptyId, x, absoluteY);
  const isCopySelected = hasCopySelection && deps.isCopySelected?.(ptyId, x, absoluteY);

  // Check if cell is a search match (skip function calls if no active search)
  const isMatch = hasSearch && deps.isSearchMatch(ptyId, x, absoluteY);
  const isCurrent = hasSearch && deps.isCurrentMatch(ptyId, x, absoluteY);

  // Determine cell colors
  let fgR = cell.fg.r,
    fgG = cell.fg.g,
    fgB = cell.fg.b;
  let bgR = cell.bg.r,
    bgG = cell.bg.g,
    bgB = cell.bg.b;

  // Apply dim effect
  if (cell.dim) {
    fgR = Math.floor(fgR * 0.5);
    fgG = Math.floor(fgG * 0.5);
    fgB = Math.floor(fgB * 0.5);
  }

  // Apply inverse (avoid array destructuring for performance)
  if (cell.inverse) {
    const tmpR = fgR;
    fgR = bgR;
    bgR = tmpR;
    const tmpG = fgG;
    fgG = bgG;
    bgG = tmpG;
    const tmpB = fgB;
    fgB = bgB;
    bgB = tmpB;
  }

  let fg = getCachedRGBA(fgR, fgG, fgB);
  // Determine the real bg (before substituting sentinel) so that cursor/selection
  // styling can use it without leaking the sentinel into foreground SGR sequences.
  const realBg = getCachedRGBA(bgR, bgG, bgB);
  // Use default background sentinel when the cell has no explicit bg color.
  // This lets the host terminal's background (with blur/transparency) show through.
  // The sentinel is rewritten to ESC[49m + NUL padding at the C level by libstdout-rewrite.
  // The replacement is the same 16-byte length so no write() byte-count lie is needed.
  //
  // When cell.inverse is true, fg and bg have been swapped above — so the visual
  // background is the original foreground, which is never a "default background".
  // Applying the sentinel after inversion would make an inverse-cursor (or any
  // inverse cell on a default-bg cell) invisible: the post-swap bg (original fg)
  // gets replaced with transparent, and the fg (original bg = dark) becomes
  // dark-on-transparent = invisible on dark themes.
  const isDefaultBg = !cell.inverse && !!cell.defaultBg;
  let bg = isDefaultBg ? DEFAULT_BG_SENTINEL : realBg;

  // Apply styling in priority order: cursor > copy selection > selection > current match > other matches
  // IMPORTANT: Never use DEFAULT_BG_SENTINEL as a foreground color — only background.
  // It must not leak into \x1b[38;2;...m (fg) sequences.
  if (isCursor) {
    // Cursor styling (highest priority when visible)
    if (isVirtualCursor) {
      fg = copyCursorFg;
      bg = copyCursorBg;
    } else {
      fg = realBg; // Use the real bg color for inverted cursor fg (never the sentinel)
      bg = WHITE;
    }
  } else if (isCopySelected) {
    fg = copySelectionFg;
    bg = copySelectionBg;
  } else if (isSelected) {
    // Selection styling
    fg = SELECTION_FG;
    bg = SELECTION_BG;
  } else if (isCurrent) {
    // Current search match (bright yellow)
    fg = SEARCH_CURRENT_FG;
    bg = SEARCH_CURRENT_BG;
  } else if (isMatch) {
    // Other search matches (orange)
    fg = SEARCH_MATCH_FG;
    bg = SEARCH_MATCH_BG;
  }

  // Calculate attributes
  let attributes = 0;
  if (cell.bold) attributes |= ATTR_BOLD;
  if (cell.italic) attributes |= ATTR_ITALIC;
  if (cell.underline) attributes |= ATTR_UNDERLINE;
  if (cell.strikethrough) attributes |= ATTR_STRIKETHROUGH;

  return { fg, bg, attributes };
}

/**
 * Render a row of terminal cells to the buffer
 */
export function renderRow(
  buffer: OptimizedBuffer,
  row: TerminalCell[] | null,
  rowIndex: number,
  cols: number,
  offsetX: number,
  offsetY: number,
  options: CellRenderingOptions,
  deps: CellRenderingDeps,
  fallbackFg: RGBA,
  fallbackBg: RGBA
): void {
  const { scrollbackLength, viewportOffset } = options;

  // Calculate absolute Y for selection check (accounts for scrollback)
  const absoluteY = scrollbackLength - viewportOffset + rowIndex;

  // Track the previous cell to detect spacer cells after wide characters
  let prevCellWasWide = false;
  let prevCellBg: RGBA | null = null;

  for (let x = 0; x < cols; x++) {
    const cell = row?.[x] ?? null;

    if (!cell) {
      // No cell data (padding/empty area) — use the opaque fallback bg.
      // Only PTY-derived cells with defaultBg=true use the sentinel;
      // padding cells must be opaque so UI elements don't bleed through.
      buffer.setCell(x + offsetX, rowIndex + offsetY, ' ', fallbackFg, fallbackBg, 0);
      prevCellWasWide = false;
      prevCellBg = null;
      continue;
    }

    // If previous cell was wide (width=2), this is a spacer cell
    // Use drawChar with codepoint 0 to mark as continuation without overwriting the wide char
    // IMPORTANT: Use BLACK for fg (spacers are invisible), only use sentinel for bg.
    // Never pass DEFAULT_BG_SENTINEL as fg — it would leak into \x1b[38;2;...m.
    if (prevCellWasWide && prevCellBg) {
      buffer.drawChar(0, x + offsetX, rowIndex + offsetY, BLACK, prevCellBg, 0);
      prevCellWasWide = false;
      prevCellBg = null;
      continue;
    }

    const { fg, bg, attributes } = getCellColors(cell, x, absoluteY, rowIndex, options, deps);

    // Write cell directly to buffer (with offset for pane position)
    // Use fallback space if char is empty to ensure cell is always overwritten
    buffer.setCell(x + offsetX, rowIndex + offsetY, cell.char || ' ', fg, bg, attributes);

    // Track if this cell was wide for next iteration
    prevCellWasWide = cell.width === 2;
    prevCellBg = prevCellWasWide ? bg : null;
  }
}
