/**
 * Direct GhosttyCell → typed-array render path.
 *
 * Bypasses the TerminalCell intermediate representation entirely, writing
 * viewport data directly from the native GhosttyVtTerminal cell pool into
 * the OptimizedBuffer's typed arrays. This eliminates:
 *
 * - ~7,400 TerminalCell object allocations per frame (145×51 grid)
 * - ~14,800 fg/bg sub-object allocations per frame
 * - The convertCell → getCellColors property access overhead
 * - GC pressure from all these short-lived intermediate objects
 *
 * The GhosttyCell properties are already 0-255 integers (fg_r, bg_r, etc.),
 * matching the typed array element range — no conversion needed.
 */

import type { OptimizedBuffer } from '@opentui/core';
import type { GhosttyCell } from '../../terminal/ghostty-vt/types';
import { CellFlags } from '../../terminal/ghostty-vt/types';
import {
  getCachedRGBA,
  ATTR_BOLD,
  ATTR_ITALIC,
  ATTR_UNDERLINE,
  ATTR_STRIKETHROUGH,
} from '../../terminal/rendering';
import {
  SENTINEL_BG_R,
  SENTINEL_BG_G,
  SENTINEL_BG_B,
  SELECTION_FG_RGB,
  SELECTION_BG_RGB,
  SEARCH_MATCH_FG_RGB,
  SEARCH_MATCH_BG_RGB,
  SEARCH_CURRENT_FG_RGB,
  SEARCH_CURRENT_BG_RGB,
  WHITE_RGB,
} from './cell-rendering';

/** Bit 0 of GhosttyCell.cell_flags: has_default_bg */
const CELL_FLAG_DEFAULT_BG = 1;

export interface DirectRenderOptions {
  /** Whether the viewport is at the bottom (not scrolled back) */
  isAtBottom: boolean;
  /** Whether this pane is focused */
  isFocused: boolean;
  /** Cursor position and visibility from the emulator */
  cursorX: number;
  cursorY: number;
  cursorVisible: boolean;
  /** Has active selection overlay */
  hasSelection: boolean;
  /** Has active search overlay */
  hasSearch: boolean;
  /** Has active copy-mode selection */
  hasCopySelection: boolean;
  /** Copy mode is active */
  copyModeActive: boolean;
  /** Copy-mode cursor position (null when not in copy mode) */
  copyCursor: { x: number; absY: number } | null;
  /** Pre-extracted RGB8 for copy cursor fg */
  copyCursorFgRGB: [number, number, number];
  /** Pre-extracted RGB8 for copy cursor bg */
  copyCursorBgRGB: [number, number, number];
  /** Pre-extracted RGB8 for copy selection fg */
  copySelectionFgRGB: [number, number, number];
  /** Pre-extracted RGB8 for copy selection bg */
  copySelectionBgRGB: [number, number, number];
  /** Selection/search callback checks */
  isCellSelected: (ptyId: string, x: number, absoluteY: number) => boolean;
  isCopySelected: (ptyId: string, x: number, absoluteY: number) => boolean;
  isSearchMatch: (ptyId: string, x: number, absoluteY: number) => boolean;
  isCurrentMatch: (ptyId: string, x: number, absoluteY: number) => boolean;
  /** Pre-captured search snapshot (no signal reads) */
  searchSnapshot: {
    isMatch: (x: number, absoluteY: number) => boolean;
    isCurrent: (x: number, absoluteY: number) => boolean;
  } | null;
  /** PTY ID for selection/search callbacks */
  ptyId: string;
  /** Scrollback length for absolute Y calculation */
  scrollbackLength: number;
  /** Viewport offset for absolute Y calculation */
  viewportOffset: number;
}

/**
 * Render the viewport directly from the GhosttyCell pool into the
 * OptimizedBuffer's typed arrays, skipping TerminalCell conversion.
 *
 * This is the zero-allocation render path for the common case where
 * we're showing the live viewport (not scrolled back in scrollback).
 * It reads fg_r/fg_g/fg_b/bg_r/bg_g/bg_b from GhosttyCell (already
 * 0-255 integers) and writes them directly to the Uint16Array buffer.
 *
 * For scrolled-back views (viewportOffset > 0), fall back to the
 * TerminalCell-based renderRowDirect path since scrollback data is only
 * available as TerminalCell[] from the emulator's getScrollbackLine().
 */
export function renderViewportDirect(
  buffer: OptimizedBuffer,
  cellPool: GhosttyCell[],
  cols: number,
  rows: number,
  offsetX: number,
  offsetY: number,
  options: DirectRenderOptions
): void {
  const b = buffer.buffers;
  const charArr = b.char;
  const fgArr = b.fg;
  const bgArr = b.bg;
  const attrArr = b.attributes;
  const bufWidth = buffer.width;

  const {
    isAtBottom,
    isFocused,
    cursorX,
    cursorY,
    cursorVisible,
    ptyId,
    scrollbackLength,
    viewportOffset,
  } = options;

  const hasOverlays =
    options.hasSelection ||
    options.hasSearch ||
    options.hasCopySelection ||
    options.copyModeActive ||
    (isAtBottom && isFocused && cursorVisible) ||
    !!options.copyCursor;

  for (let y = 0; y < rows; y++) {
    const rowOffset = (y + offsetY) * bufWidth + offsetX;
    const poolOffset = y * cols;
    const absoluteY = scrollbackLength - viewportOffset + y;

    let prevWidth2 = false;
    let prevBgR = 0,
      prevBgG = 0,
      prevBgB = 0;
    let prevIsDefaultBg = false;

    let firstCharCode = 32;
    let firstFgR = 0,
      firstFgG = 0,
      firstFgB = 0;
    let firstBgR = 0,
      firstBgG = 0,
      firstBgB = 0;
    let firstAttrs = 0;

    for (let x = 0; x < cols; x++) {
      const cell = cellPool[poolOffset + x];
      const cellOffset = rowOffset + x;

      // Handle spacer after wide character
      if (prevWidth2) {
        charArr[cellOffset] = 0;
        const spBgR = prevIsDefaultBg ? SENTINEL_BG_R : prevBgR;
        const spBgG = prevIsDefaultBg ? SENTINEL_BG_G : prevBgG;
        const spBgB = prevIsDefaultBg ? SENTINEL_BG_B : prevBgB;
        fgArr[cellOffset * 4] = 0;
        fgArr[cellOffset * 4 + 1] = 0;
        fgArr[cellOffset * 4 + 2] = 0;
        fgArr[cellOffset * 4 + 3] = 255;
        bgArr[cellOffset * 4] = spBgR;
        bgArr[cellOffset * 4 + 1] = spBgG;
        bgArr[cellOffset * 4 + 2] = spBgB;
        bgArr[cellOffset * 4 + 3] = 255;
        attrArr[cellOffset] = 0;
        prevWidth2 = false;
        continue;
      }

      const flags = cell.flags;
      const isDefaultBg = (cell.cell_flags & CELL_FLAG_DEFAULT_BG) !== 0;
      const inverse = (flags & CellFlags.INVERSE) !== 0;
      const dim = (flags & CellFlags.FAINT) !== 0;
      const strikethrough = (flags & CellFlags.STRIKETHROUGH) !== 0;

      // Fast path: no overlays, no special styling
      // The vast majority of cells (~90%) take this path
      if (!hasOverlays && !dim && !inverse && !strikethrough) {
        let bgR = cell.bg_r,
          bgG = cell.bg_g,
          bgB = cell.bg_b;
        if (isDefaultBg) {
          bgR = SENTINEL_BG_R;
          bgG = SENTINEL_BG_G;
          bgB = SENTINEL_BG_B;
        }

        charArr[cellOffset] = cell.codepoint;
        const off = cellOffset * 4;
        fgArr[off] = cell.fg_r;
        fgArr[off + 1] = cell.fg_g;
        fgArr[off + 2] = cell.fg_b;
        fgArr[off + 3] = 255;
        bgArr[off] = bgR;
        bgArr[off + 1] = bgG;
        bgArr[off + 2] = bgB;
        bgArr[off + 3] = 255;

        let attrs = 0;
        if (flags & CellFlags.BOLD) attrs |= ATTR_BOLD;
        if (flags & CellFlags.ITALIC) attrs |= ATTR_ITALIC;
        if (flags & CellFlags.UNDERLINE) attrs |= ATTR_UNDERLINE;
        attrArr[cellOffset] = attrs;

        if (cell.width === 2) {
          prevWidth2 = true;
          prevBgR = bgR;
          prevBgG = bgG;
          prevBgB = bgB;
          prevIsDefaultBg = isDefaultBg;
        }

        if (x === 0) {
          firstCharCode = cell.codepoint;
          firstFgR = cell.fg_r;
          firstFgG = cell.fg_g;
          firstFgB = cell.fg_b;
          firstBgR = bgR;
          firstBgG = bgG;
          firstBgB = bgB;
          firstAttrs = attrs;
        }
        continue;
      }

      // Slow path: handle overlays, inverse, dim, etc.
      let fgR = cell.fg_r,
        fgG = cell.fg_g,
        fgB = cell.fg_b;
      let bgR = cell.bg_r,
        bgG = cell.bg_g,
        bgB = cell.bg_b;
      let attrs = 0;
      if (flags & CellFlags.BOLD) attrs |= ATTR_BOLD;
      if (flags & CellFlags.ITALIC) attrs |= ATTR_ITALIC;
      if (flags & CellFlags.UNDERLINE) attrs |= ATTR_UNDERLINE;
      if (strikethrough) attrs |= ATTR_STRIKETHROUGH;

      if (dim) {
        fgR = (fgR >> 1) | 0;
        fgG = (fgG >> 1) | 0;
        fgB = (fgB >> 1) | 0;
      }
      if (inverse) {
        let tmp = fgR;
        fgR = bgR;
        bgR = tmp;
        tmp = fgG;
        fgG = bgG;
        bgG = tmp;
        tmp = fgB;
        fgB = bgB;
        bgB = tmp;
      }

      const effectiveIsDefaultBg = !inverse && isDefaultBg;
      if (effectiveIsDefaultBg) {
        bgR = SENTINEL_BG_R;
        bgG = SENTINEL_BG_G;
        bgB = SENTINEL_BG_B;
      }

      // Check overlays (same priority as renderRowDirect)
      const isVirtualCursor =
        !!options.copyCursor && options.copyCursor.absY === absoluteY && options.copyCursor.x === x;
      const isRealCursor =
        !options.copyModeActive &&
        isAtBottom &&
        isFocused &&
        cursorVisible &&
        cursorY === y &&
        cursorX === x;

      if (isVirtualCursor) {
        fgR = options.copyCursorFgRGB[0];
        fgG = options.copyCursorFgRGB[1];
        fgB = options.copyCursorFgRGB[2];
        bgR = options.copyCursorBgRGB[0];
        bgG = options.copyCursorBgRGB[1];
        bgB = options.copyCursorBgRGB[2];
      } else if (isRealCursor) {
        // Keep fgR/fgG/fgB as cell's bg (after inverse), set bg to white
        bgR = WHITE_RGB[0];
        bgG = WHITE_RGB[1];
        bgB = WHITE_RGB[2];
      } else {
        const isSelected = options.hasSelection && options.isCellSelected(ptyId, x, absoluteY);
        const isCopySel = options.hasCopySelection && options.isCopySelected(ptyId, x, absoluteY);
        if (isCopySel) {
          fgR = options.copySelectionFgRGB[0];
          fgG = options.copySelectionFgRGB[1];
          fgB = options.copySelectionFgRGB[2];
          bgR = options.copySelectionBgRGB[0];
          bgG = options.copySelectionBgRGB[1];
          bgB = options.copySelectionBgRGB[2];
        } else if (isSelected) {
          fgR = SELECTION_FG_RGB[0];
          fgG = SELECTION_FG_RGB[1];
          fgB = SELECTION_FG_RGB[2];
          bgR = SELECTION_BG_RGB[0];
          bgG = SELECTION_BG_RGB[1];
          bgB = SELECTION_BG_RGB[2];
        } else if (options.hasSearch) {
          const isMatch = options.searchSnapshot
            ? options.searchSnapshot.isMatch(x, absoluteY)
            : options.isSearchMatch(ptyId, x, absoluteY);
          const isCurrent = options.searchSnapshot
            ? options.searchSnapshot.isCurrent(x, absoluteY)
            : options.isCurrentMatch(ptyId, x, absoluteY);
          if (isCurrent) {
            fgR = SEARCH_CURRENT_FG_RGB[0];
            fgG = SEARCH_CURRENT_FG_RGB[1];
            fgB = SEARCH_CURRENT_FG_RGB[2];
            bgR = SEARCH_CURRENT_BG_RGB[0];
            bgG = SEARCH_CURRENT_BG_RGB[1];
            bgB = SEARCH_CURRENT_BG_RGB[2];
          } else if (isMatch) {
            fgR = SEARCH_MATCH_FG_RGB[0];
            fgG = SEARCH_MATCH_FG_RGB[1];
            fgB = SEARCH_MATCH_FG_RGB[2];
            bgR = SEARCH_MATCH_BG_RGB[0];
            bgG = SEARCH_MATCH_BG_RGB[1];
            bgB = SEARCH_MATCH_BG_RGB[2];
          }
        }
      }

      charArr[cellOffset] = cell.codepoint;
      const off = cellOffset * 4;
      fgArr[off] = fgR;
      fgArr[off + 1] = fgG;
      fgArr[off + 2] = fgB;
      fgArr[off + 3] = 255;
      bgArr[off] = bgR;
      bgArr[off + 1] = bgG;
      bgArr[off + 2] = bgB;
      bgArr[off + 3] = 255;
      attrArr[cellOffset] = attrs;

      if (cell.width === 2) {
        prevWidth2 = true;
        prevBgR = bgR;
        prevBgG = bgG;
        prevBgB = bgB;
        prevIsDefaultBg = effectiveIsDefaultBg;
      }

      if (x === 0) {
        firstCharCode = cell.codepoint;
        firstFgR = fgR;
        firstFgG = fgG;
        firstFgB = fgB;
        firstBgR = bgR;
        firstBgG = bgG;
        firstBgB = bgB;
        firstAttrs = attrs;
      }
    }

    // Commit the first cell of each row via drawChar so the native renderer's
    // diff tracking recognizes the row as changed (typed-array writes bypass it).
    buffer.drawChar(
      firstCharCode,
      offsetX,
      y + offsetY,
      getCachedRGBA(firstFgR, firstFgG, firstFgB),
      getCachedRGBA(firstBgR, firstBgG, firstBgB),
      firstAttrs
    );
  }
}
