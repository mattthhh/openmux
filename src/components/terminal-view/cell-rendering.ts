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
export const DEFAULT_BG_SENTINEL = RGBAClass.fromInts(13, 17, 23);
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
  /** Pre-captured search snapshot (no signal reads) for per-cell use */
  searchSnapshot?: {
    isMatch: (x: number, absoluteY: number) => boolean;
    isCurrent: (x: number, absoluteY: number) => boolean;
  } | null;
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

  // Fast path: most common case is no overlays, no cursor, no inverse/dim, default bg.
  // This avoids all the function calls (isCellSelected, isSearchMatch, etc.) and
  // extra RGBA lookups for the ~90% of cells that are plain terminal text.
  if (
    !hasSelection &&
    !hasSearch &&
    !hasCopySelection &&
    !copyModeActive &&
    !(isAtBottom && isFocused && cursorVisible) &&
    !copyCursor &&
    !cell.dim &&
    !cell.inverse &&
    !cell.strikethrough
  ) {
    let attributes = 0;
    if (cell.bold) attributes |= ATTR_BOLD;
    if (cell.italic) attributes |= ATTR_ITALIC;
    if (cell.underline) attributes |= ATTR_UNDERLINE;
    const fg = getCachedRGBA(cell.fg.r, cell.fg.g, cell.fg.b);
    const bg = cell.defaultBg
      ? DEFAULT_BG_SENTINEL
      : getCachedRGBA(cell.bg.r, cell.bg.g, cell.bg.b);
    return { fg, bg, attributes };
  }

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
  // When a search snapshot is available, use it to avoid per-cell signal reads
  const isMatch =
    hasSearch &&
    (options.searchSnapshot
      ? options.searchSnapshot.isMatch(x, absoluteY)
      : deps.isSearchMatch(ptyId, x, absoluteY));
  const isCurrent =
    hasSearch &&
    (options.searchSnapshot
      ? options.searchSnapshot.isCurrent(x, absoluteY)
      : deps.isCurrentMatch(ptyId, x, absoluteY));

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

  // Fast path: null/empty row — batch-draw spaces instead of per-cell setCell.
  // Padding cells must use the opaque fallbackBg (not the sentinel) so UI
  // elements don't bleed through. This was previously done per-cell.
  if (!row) {
    buffer.drawText(' '.repeat(cols), offsetX, rowIndex + offsetY, fallbackFg, fallbackBg, 0);
    return;
  }

  // Track the previous cell to detect spacer cells after wide characters
  let prevCellWasWide = false;
  let prevCellBg: RGBA | null = null;

  // Run-length buffer: accumulate contiguous same-style characters for
  // batch drawText instead of per-cell setCell. This reduces FFI call
  // count from cols-per-row to ~runs-per-row (3-10x fewer for typical
  // source code / shell output).
  let runChars = '';
  let runStartX = 0;
  let runFg: RGBA | null = null;
  let runBg: RGBA | null = null;
  let runAttrs = 0;
  let runActive = false;

  const flushRun = () => {
    if (runChars.length > 0 && runFg !== null && runBg !== null) {
      buffer.drawText(runChars, runStartX + offsetX, rowIndex + offsetY, runFg, runBg, runAttrs);
    }
    runChars = '';
    runFg = null;
    runBg = null;
    runAttrs = 0;
    runActive = false;
  };

  for (let x = 0; x < cols; x++) {
    const cell = row?.[x] ?? null;

    if (!cell) {
      // No cell data — flush any pending run and use setCell for padding
      flushRun();
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
      flushRun();
      buffer.drawChar(0, x + offsetX, rowIndex + offsetY, BLACK, prevCellBg, 0);
      prevCellWasWide = false;
      prevCellBg = null;
      continue;
    }

    const { fg, bg, attributes } = getCellColors(cell, x, absoluteY, rowIndex, options, deps);
    const char = cell.char || ' ';

    // Wide characters (width=2) cannot be batched into runs because drawText
    // would place a spacer via the width calculation, but the next iteration
    // also needs to handle the spacer explicitly via drawChar(0,...). Instead,
    // flush the run and render wide chars individually with setCell.
    if (cell.width === 2) {
      flushRun();
      buffer.setCell(x + offsetX, rowIndex + offsetY, char, fg, bg, attributes);
      prevCellWasWide = true;
      prevCellBg = bg;
      continue;
    }

    // Check if this cell continues the current run (same style)
    if (runActive && runFg === fg && runBg === bg && runAttrs === attributes) {
      runChars += char;
    } else {
      // Flush previous run and start a new one
      flushRun();
      runChars = char;
      runStartX = x;
      runFg = fg;
      runBg = bg;
      runAttrs = attributes;
      runActive = true;
    }
  }

  // Flush any remaining run
  flushRun();
}

/**
 * Render a row of terminal cells by writing directly to the OptimizedBuffer's
 * typed arrays. This bypasses FFI (setCell/drawText/drawChar) entirely,
 * reducing per-cell cost from ~5μs (FFI + live renderer overhead) to ~30ns
 * (typed array write). For a 145×51 grid with no run coalescence (e.g.
 * truecolor gradients), this cuts draw time from ~35ms to ~1ms.
 *
 * The native renderer's diff pass reads the same typed arrays after
 * renderAfter returns, so changes are picked up automatically.
 */
export function renderRowDirect(
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
  const absoluteY = scrollbackLength - viewportOffset + rowIndex;

  // Helper: extract 0-255 RGB from an RGBA object (which stores 0-1 floats)
  const rgba8 = (c: RGBA): [number, number, number] => [
    (c as unknown as { r: number }).r * 255,
    (c as unknown as { g: number }).g * 255,
    (c as unknown as { b: number }).b * 255,
  ];

  const b = buffer.buffers;
  const rowOffset = (rowIndex + offsetY) * buffer.width + offsetX;

  if (!row) {
    // Null row: fill with fallback colors. Still use drawText for the single
    // FFI call since null rows are rare and drawText is fast for uniform rows.
    buffer.drawText(' '.repeat(cols), offsetX, rowIndex + offsetY, fallbackFg, fallbackBg, 0);
    return;
  }

  // Write cells directly to typed arrays
  const charArr = b.char;
  const fgArr = b.fg;
  const bgArr = b.bg;
  const attrArr = b.attributes;

  // Wide-char tracking: after a cell with width===2, the next cell is
  // a spacer/continuation that must be written as codepoint 0 (not a
  // space) so the renderer treats it as part of the wide glyph.
  let prevCellWasWide = false;
  let prevCellBgR = 0;
  let prevCellBgG = 0;
  let prevCellBgB = 0;
  let prevCellIsDefaultBg = false;

  for (let x = 0; x < cols; x++) {
    const cell = row[x];
    const cellOffset = rowOffset + x;

    // If the previous cell was wide (width===2), this cell is a
    // continuation/spacer. Write codepoint 0 with the wide char's bg
    // so the renderer treats it as invisible (part of the wide glyph).
    // This matches renderRow's buffer.drawChar(0, ...) FFI call.
    if (prevCellWasWide) {
      charArr[cellOffset] = 0; // continuation codepoint
      fgArr[cellOffset * 4] = 0;
      fgArr[cellOffset * 4 + 1] = 0;
      fgArr[cellOffset * 4 + 2] = 0;
      fgArr[cellOffset * 4 + 3] = 255; // opaque fg (matches FFI drawChar)
      const spBgR = prevCellIsDefaultBg ? 13 : prevCellBgR;
      const spBgG = prevCellIsDefaultBg ? 17 : prevCellBgG;
      const spBgB = prevCellIsDefaultBg ? 23 : prevCellBgB;
      bgArr[cellOffset * 4] = spBgR;
      bgArr[cellOffset * 4 + 1] = spBgG;
      bgArr[cellOffset * 4 + 2] = spBgB;
      bgArr[cellOffset * 4 + 3] = 255;
      attrArr[cellOffset] = 0;
      prevCellWasWide = false;
      continue;
    }

    if (!cell) {
      // No cell data — use fallback
      charArr[cellOffset] = 32; // space
      const [fR, fG, fB] = rgba8(fallbackFg);
      fgArr[cellOffset * 4] = fR;
      fgArr[cellOffset * 4 + 1] = fG;
      fgArr[cellOffset * 4 + 2] = fB;
      fgArr[cellOffset * 4 + 3] = 255;
      const [bR, bG, bB] = rgba8(fallbackBg);
      bgArr[cellOffset * 4] = bR;
      bgArr[cellOffset * 4 + 1] = bG;
      bgArr[cellOffset * 4 + 2] = bB;
      bgArr[cellOffset * 4 + 3] = 255;
      attrArr[cellOffset] = 0;
      continue;
    }

    // Get cell colors using the same logic as getCellColors, but write
    // the raw RGB values directly instead of creating RGBA objects
    let fgR = cell.fg.r,
      fgG = cell.fg.g,
      fgB = cell.fg.b;
    let bgR = cell.bg.r,
      bgG = cell.bg.g,
      bgB = cell.bg.b;
    const isDefaultBg = !cell.inverse && !!cell.defaultBg;

    // Fast path: no overlays, no special styling
    const noOverlays =
      !options.hasSelection &&
      !options.hasSearch &&
      !options.hasCopySelection &&
      !options.copyModeActive &&
      !(options.isAtBottom && options.isFocused && options.cursorVisible) &&
      !options.copyCursor &&
      !cell.dim &&
      !cell.inverse &&
      !cell.strikethrough;

    let charCode = cell.char ? cell.char.codePointAt(0)! : 32;
    let attributes = 0;
    if (cell.bold) attributes |= ATTR_BOLD;
    if (cell.italic) attributes |= ATTR_ITALIC;
    if (cell.underline) attributes |= ATTR_UNDERLINE;

    if (noOverlays) {
      // Default background sentinel: RGB(13,17,23)
      if (isDefaultBg) {
        bgR = 13;
        bgG = 17;
        bgB = 23;
      }
    } else {
      // Slow path: same logic as getCellColors
      if (cell.dim) {
        fgR = Math.floor(fgR * 0.5);
        fgG = Math.floor(fgG * 0.5);
        fgB = Math.floor(fgB * 0.5);
      }
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
      if (isDefaultBg) {
        bgR = 13;
        bgG = 17;
        bgB = 23;
      }

      // Check overlays
      const isVirtualCursor =
        !!options.copyCursor && options.copyCursor.absY === absoluteY && options.copyCursor.x === x;
      const isRealCursor =
        !options.copyModeActive &&
        options.isAtBottom &&
        options.isFocused &&
        options.cursorVisible &&
        options.cursorY === rowIndex &&
        options.cursorX === x;

      if (isVirtualCursor) {
        [fgR, fgG, fgB] = rgba8(options.copyCursorFg);
        [bgR, bgG, bgB] = rgba8(options.copyCursorBg);
      } else if (isRealCursor) {
        // Inverted cursor: fg = cell's bg, bg = white
        // fgR/G/B already has the cell's bg (after inverse)
        bgR = 255;
        bgG = 255;
        bgB = 255;
      } else {
        const isSelected = options.hasSelection && deps.isCellSelected(options.ptyId, x, absoluteY);
        const isCopySelected =
          options.hasCopySelection && deps.isCopySelected?.(options.ptyId, x, absoluteY);
        if (isCopySelected) {
          [fgR, fgG, fgB] = rgba8(options.copySelectionFg);
          [bgR, bgG, bgB] = rgba8(options.copySelectionBg);
        } else if (isSelected) {
          [fgR, fgG, fgB] = rgba8(SELECTION_FG);
          [bgR, bgG, bgB] = rgba8(SELECTION_BG);
        } else if (options.hasSearch) {
          const isMatch = options.searchSnapshot
            ? options.searchSnapshot.isMatch(x, absoluteY)
            : deps.isSearchMatch(options.ptyId, x, absoluteY);
          const isCurrent = options.searchSnapshot
            ? options.searchSnapshot.isCurrent(x, absoluteY)
            : deps.isCurrentMatch(options.ptyId, x, absoluteY);
          if (isCurrent) {
            [fgR, fgG, fgB] = rgba8(SEARCH_CURRENT_FG);
            [bgR, bgG, bgB] = rgba8(SEARCH_CURRENT_BG);
          } else if (isMatch) {
            [fgR, fgG, fgB] = rgba8(SEARCH_MATCH_FG);
            [bgR, bgG, bgB] = rgba8(SEARCH_MATCH_BG);
          }
        }
      }

      if (cell.strikethrough) attributes |= ATTR_STRIKETHROUGH;
    }

    // Write directly to typed arrays
    charArr[cellOffset] = charCode;
    const off = cellOffset * 4;
    fgArr[off] = fgR;
    fgArr[off + 1] = fgG;
    fgArr[off + 2] = fgB;
    fgArr[off + 3] = 255;
    bgArr[off] = bgR;
    bgArr[off + 1] = bgG;
    bgArr[off + 2] = bgB;
    bgArr[off + 3] = 255;
    attrArr[cellOffset] = attributes;

    // Track wide chars for spacer handling on next iteration
    if (cell.width === 2) {
      prevCellWasWide = true;
      prevCellBgR = bgR;
      prevCellBgG = bgG;
      prevCellBgB = bgB;
      prevCellIsDefaultBg = isDefaultBg;
    }
  }
}
