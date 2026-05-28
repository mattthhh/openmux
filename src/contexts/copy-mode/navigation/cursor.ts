/**
 * Cursor movement and clamping utilities for copy mode
 */

import type { CopyCursor } from '../types';
import type { ScrollMeta } from './types';

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, max));

/** Clamp cursor to valid terminal bounds */
export const clampCursor = (cursor: CopyCursor, meta: ScrollMeta): CopyCursor | null => {
  if (!meta.terminalState || meta.rows <= 0 || meta.cols <= 0) {
    return null;
  }
  const maxAbsY = Math.max(0, meta.scrollbackLength + meta.rows - 1);
  return {
    x: clamp(cursor.x, 0, Math.max(0, meta.cols - 1)),
    absY: clamp(cursor.absY, 0, maxAbsY),
  };
};

/** Calculate initial cursor position when entering copy mode */
export const calculateInitialCursor = (
  cursorX: number,
  cursorY: number,
  viewportOffset: number,
  scrollbackLength: number,
  rows: number,
  cols: number
): CopyCursor => {
  const absY = viewportOffset > 0 ? scrollbackLength - viewportOffset : scrollbackLength + cursorY;
  const maxAbsY = Math.max(0, scrollbackLength + rows - 1);
  return {
    x: clamp(cursorX, 0, Math.max(0, cols - 1)),
    absY: clamp(absY, 0, maxAbsY),
  };
};

/** Move cursor by delta, returning new position (not clamped) */
export const moveCursorBy = (current: CopyCursor, dx: number, dy: number): CopyCursor => ({
  x: current.x + dx,
  absY: current.absY + dy,
});
