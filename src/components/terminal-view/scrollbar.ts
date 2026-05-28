/**
 * Scrollbar Rendering - renders the scrollbar overlay for terminal
 */
import { RGBA, type OptimizedBuffer } from '@opentui/core';
import type { TerminalCell } from '../../core/types';
import { getCachedRGBA, SELECTION_BG } from '../../terminal/rendering';
import { getDefaultColors, getHostColors } from '../../terminal/terminal-colors';
import { mixColor, luminance, toRgba } from '../../terminal/color-utils';

const TRANSPARENT_BG = RGBA.fromInts(0, 0, 0, 0);
const TRACK_ALPHA = 160;
const THUMB_ALPHA = 200;

function getScrollbarColors(): { track: RGBA; thumb: RGBA } {
  const palette = getHostColors() ?? getDefaultColors();
  const isLight = luminance(palette.background) > 0.6;
  const track = mixColor(palette.background, palette.foreground, isLight ? 0.06 : 0.06);
  const thumb = mixColor(palette.background, palette.foreground, isLight ? 0.38 : 0.38);
  return {
    track: toRgba(track, TRACK_ALPHA),
    thumb: toRgba(thumb, THUMB_ALPHA),
  };
}

export interface ScrollbarOptions {
  viewportOffset: number;
  scrollbackLength: number;
  rows: number;
  cols: number;
  width: number;
  offsetX: number;
  offsetY: number;
  labelFg?: RGBA;
  labelBg?: RGBA;
  ptyId?: string;
  hasSelection?: boolean;
  hasCopySelection?: boolean;
  isCellSelected?: (ptyId: string, x: number, absY: number) => boolean;
  isCopySelected?: (ptyId: string, x: number, absY: number) => boolean;
  selectionBg?: RGBA;
  copySelectionBg?: RGBA;
}

/**
 * Render scrollbar when scrolled back (not at bottom)
 * Uses semi-transparent overlay to preserve underlying content visibility
 */
export function renderScrollbar(
  buffer: OptimizedBuffer,
  rowCache: (TerminalCell[] | null)[],
  options: ScrollbarOptions,
  fallbackFg: RGBA
): void {
  const {
    viewportOffset,
    scrollbackLength,
    rows,
    cols,
    width,
    offsetX,
    offsetY,
    ptyId,
    hasSelection,
    hasCopySelection,
    isCellSelected,
    isCopySelected,
    selectionBg,
    copySelectionBg,
  } = options;

  // Don't render if at bottom or no scrollback
  if (viewportOffset === 0 || scrollbackLength === 0) {
    return;
  }

  const totalLines = scrollbackLength + rows;
  const minThumbHeight = Math.max(2, Math.floor(rows * 0.05));
  const idealThumbHeight = Math.floor((rows * rows) / totalLines);
  const thumbHeight = Math.min(rows, Math.max(minThumbHeight, Math.max(1, idealThumbHeight)));
  const scrollRange = rows - thumbHeight;
  // Position: 0 at top (fully scrolled back), scrollRange at bottom (at live terminal)
  const thumbPosition = Math.floor((1 - viewportOffset / scrollbackLength) * scrollRange);

  // Render scrollbar on the rightmost column
  // Preserve underlying character but apply scrollbar background tint
  const scrollbarX = offsetX + width - 1;
  const contentCol = cols - 1; // Last column in terminal content

  const colors = getScrollbarColors();

  for (let y = 0; y < rows; y++) {
    const isThumb = y >= thumbPosition && y < thumbPosition + thumbHeight;
    // Get the underlying cell to preserve its character
    const row = rowCache[y];
    const cell = contentCol >= 0 ? row?.[contentCol] : null;
    const underlyingChar = cell?.char || ' ';
    const underlyingFg = cell ? getCachedRGBA(cell.fg.r, cell.fg.g, cell.fg.b) : fallbackFg;
    const overlayBg = isThumb ? colors.thumb : colors.track;
    if (ptyId) {
      const absY = scrollbackLength - viewportOffset + y;
      const copySelected = hasCopySelection && isCopySelected?.(ptyId, contentCol, absY);
      const mouseSelected =
        !copySelected && hasSelection && isCellSelected?.(ptyId, contentCol, absY);
      if (copySelected) {
        const base = copySelectionBg ?? selectionBg ?? SELECTION_BG;
        buffer.setCellWithAlphaBlending(
          scrollbarX,
          y + offsetY,
          underlyingChar,
          underlyingFg,
          base,
          0
        );
        buffer.setCellWithAlphaBlending(
          scrollbarX,
          y + offsetY,
          underlyingChar,
          underlyingFg,
          overlayBg,
          0
        );
        continue;
      } else if (mouseSelected) {
        const base = selectionBg ?? SELECTION_BG;
        buffer.setCellWithAlphaBlending(
          scrollbarX,
          y + offsetY,
          underlyingChar,
          underlyingFg,
          base,
          0
        );
        buffer.setCellWithAlphaBlending(
          scrollbarX,
          y + offsetY,
          underlyingChar,
          underlyingFg,
          overlayBg,
          0
        );
        continue;
      }
    }

    buffer.setCell(scrollbarX, y + offsetY, underlyingChar, underlyingFg, overlayBg, 0);
  }
}

export function renderScrollDepth(buffer: OptimizedBuffer, options: ScrollbarOptions): void {
  const { viewportOffset, scrollbackLength, width, offsetX, offsetY, labelFg, labelBg } = options;

  if (viewportOffset === 0 || scrollbackLength === 0) return;

  const label = ` ${formatLineCount(viewportOffset)}/${formatLineCount(scrollbackLength)} `;
  const innerWidth = width;
  const borderY = offsetY - 1;
  if (innerWidth <= 0 || borderY < 0 || label.length > innerWidth) return;

  const rightInset = 1;
  const startX = offsetX + Math.max(0, innerWidth - label.length - rightInset);
  const fg = labelFg ?? getCachedRGBA(160, 160, 160);
  const bg = labelBg ?? TRANSPARENT_BG;

  for (let i = 0; i < label.length; i++) {
    buffer.setCell(startX + i, borderY, label[i], fg, bg, 0);
  }
}

function formatLineCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) {
    const short = value < 10_000 ? (value / 1000).toFixed(1) : Math.round(value / 1000);
    return `${short}k`;
  }
  const short = value < 10_000_000 ? (value / 1_000_000).toFixed(1) : Math.round(value / 1_000_000);
  return `${short}m`;
}
