/**
 * Viewport and scroll utilities for copy mode
 */

import type { CopyCursor } from '../types';
import type { TerminalCell } from '../../../core/types';
import type { ScrollMeta } from './types';

/** Calculate scroll offset needed to make cursor visible */
export const calculateScrollForVisibility = (
  cursor: CopyCursor,
  meta: ScrollMeta
): number | null => {
  if (meta.rows <= 0) return null;

  const topAbsY = meta.scrollbackLength - meta.viewportOffset;
  const bottomAbsY = topAbsY + meta.rows - 1;

  if (cursor.absY < topAbsY) {
    return meta.scrollbackLength - cursor.absY;
  }
  if (cursor.absY > bottomAbsY) {
    return meta.scrollbackLength - (cursor.absY - (meta.rows - 1));
  }
  return null;
};

/** Get line cells at absolute Y position (handles scrollback vs live) */
export const getLineCellsAt = (absY: number, meta: ScrollMeta): TerminalCell[] | null => {
  if (!meta.terminalState) return null;

  if (absY < meta.scrollbackLength) {
    return meta.emulator?.getScrollbackLine(absY) ?? null;
  }
  const liveY = absY - meta.scrollbackLength;
  return meta.terminalState.cells[liveY] ?? null;
};
