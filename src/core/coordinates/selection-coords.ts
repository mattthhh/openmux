/**
 * Selection coordinate utilities.
 * Pure functions for handling terminal selection coordinates and text extraction.
 */

import type { SelectionBounds, TerminalCell } from '../types';

/**
 * A point in the terminal, with both viewport and absolute coordinates.
 */
export interface SelectionPoint {
  /** Column (0-indexed). */
  x: number;
  /** Row in viewport (0-indexed). */
  y: number;
  /** Absolute row including scrollback. */
  absoluteY: number;
}

/**
 * Normalized selection range (start is always before end).
 *
 * Focus exclusion follows Zellij-style semantics: the selection grows away from the
 * focus cell, so the focus side is always treated as exclusive. Forward selections
 * exclude `end`, backward selections exclude `start`.
 */
export interface SelectionRange {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  /** True when focus is at `end`, false when focus is at `start`. */
  focusAtEnd: boolean;
}

/**
 * Function to get a line of cells from the terminal.
 */
export type LineGetter = (absoluteY: number) => TerminalCell[] | null;

type RowSelectionColumns = {
  startX: number;
  endX: number;
};

/**
 * Calculate absolute Y from viewport Y.
 */
export function toAbsoluteY(y: number, scrollbackLength: number, scrollOffset: number): number {
  return scrollbackLength - scrollOffset + y;
}

/**
 * Normalize selection so start is always before end.
 * Tracks whether focus is at end (forward) or start (backward) for exclusion.
 */
export function normalizeSelection(anchor: SelectionPoint, focus: SelectionPoint): SelectionRange {
  const anchorBefore =
    anchor.absoluteY < focus.absoluteY ||
    (anchor.absoluteY === focus.absoluteY && anchor.x <= focus.x);

  if (anchorBefore) {
    return {
      startX: anchor.x,
      startY: anchor.absoluteY,
      endX: focus.x,
      endY: focus.absoluteY,
      focusAtEnd: true,
    };
  }

  return {
    startX: focus.x,
    startY: focus.absoluteY,
    endX: anchor.x,
    endY: anchor.absoluteY,
    focusAtEnd: false,
  };
}

/**
 * Calculate bounding box from normalized selection range.
 * Enables O(1) spatial rejection in `isCellInRange` instead of per-cell scans.
 */
export function calculateBounds(range: SelectionRange): SelectionBounds {
  return {
    minX: Math.min(range.startX, range.endX),
    maxX: Math.max(range.startX, range.endX),
    minY: range.startY,
    maxY: range.endY,
  };
}

/**
 * Resolve the selected column span for one absolute row.
 *
 * Rows that extend "to the end of the line" use `rowLength - 1` as their upper
 * bound. Callers that only need membership checks can pass `Infinity` to model an
 * unbounded row while keeping the same focus-exclusion rules.
 */
function getRowSelectionColumns(
  absoluteY: number,
  rowLength: number,
  range: SelectionRange
): RowSelectionColumns | null {
  if (absoluteY < range.startY || absoluteY > range.endY) {
    return null;
  }

  const maxColumn = rowLength - 1;
  const columns = (() => {
    if (range.startY === range.endY) {
      return range.focusAtEnd
        ? { startX: range.startX, endX: range.endX - 1 }
        : { startX: range.startX + 1, endX: range.endX };
    }

    if (absoluteY === range.startY) {
      return {
        startX: range.focusAtEnd ? range.startX : range.startX + 1,
        endX: maxColumn,
      };
    }

    if (absoluteY === range.endY) {
      return {
        startX: 0,
        endX: range.focusAtEnd ? range.endX - 1 : range.endX,
      };
    }

    return {
      startX: 0,
      endX: maxColumn,
    };
  })();

  return columns.startX <= columns.endX ? columns : null;
}

/**
 * Check if a cell at `(x, absoluteY)` is within the selection range.
 */
export function isCellInRange(x: number, absoluteY: number, range: SelectionRange): boolean {
  const columns = getRowSelectionColumns(absoluteY, Number.POSITIVE_INFINITY, range);
  if (!columns) return false;
  return x >= columns.startX && x <= columns.endX;
}

function extractRowText(row: TerminalCell[], startX: number, endX: number): string {
  let rowText = '';

  for (let x = startX; x <= Math.min(endX, row.length - 1); x++) {
    const cell = row[x];
    if (!cell) continue;

    rowText += cell.char;

    if (cell.width === 2) {
      x += 1;
    }
  }

  return rowText.trimEnd();
}

function processRow(row: TerminalCell[], absoluteY: number, range: SelectionRange): string | null {
  const columns = getRowSelectionColumns(absoluteY, row.length, range);
  if (!columns) return null;
  return extractRowText(row, columns.startX, columns.endX);
}

/**
 * Extract text from the selected range.
 * Respects the Zellij-style rule that the focus cell itself is never copied.
 */
export function extractSelectedText(
  range: SelectionRange,
  _scrollbackLength: number,
  getLine: LineGetter
): string {
  const lines: string[] = [];

  for (let absoluteY = range.startY; absoluteY <= range.endY; absoluteY++) {
    const row = getLine(absoluteY);
    if (!row) continue;

    const rowText = processRow(row, absoluteY, range);
    if (rowText === null) continue;
    lines.push(rowText);
  }

  return lines.join('\n');
}
