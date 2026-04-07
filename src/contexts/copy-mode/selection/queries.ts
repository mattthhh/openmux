/**
 * Selection query utilities for copy mode
 */

import { isCellInRange } from '../../../core/coordinates';
import type { CopyModeState } from '../types';

/** Check if copy mode has an active selection for a PTY */
export const hasSelection = (state: CopyModeState | null, ptyId: string): boolean => {
  if (!state || state.ptyId !== ptyId) return false;
  return !!state.selectionRange;
};

/** Check if a cell is within the current selection (uses full range check) */
export const isCellSelected = (
  state: CopyModeState | null,
  ptyId: string,
  x: number,
  absY: number
): boolean => {
  if (!state || state.ptyId !== ptyId || !state.selectionRange || !state.bounds) {
    return false;
  }

  // Block selection uses rectangular bounds
  if (state.visualType === 'block' && state.anchor) {
    const minX = Math.min(state.anchor.x, state.cursor.x);
    const maxX = Math.max(state.anchor.x, state.cursor.x);
    const minY = Math.min(state.anchor.absY, state.cursor.absY);
    const maxY = Math.max(state.anchor.absY, state.cursor.absY);

    if (absY < minY || absY > maxY) return false;
    if (x < minX || x > maxX) return false;
    return true;
  }

  // Character/line selection uses full range check from coordinates module
  return isCellInRange(x, absY, state.selectionRange);
};

/** Check if copy mode is active (optionally for specific PTY) */
export const isCopyModeActive = (state: CopyModeState | null, ptyId?: string): boolean => {
  if (!state) return false;
  if (!ptyId) return true;
  return state.ptyId === ptyId;
};

/** Synchronous version of isCellSelected for render hot path */
export const isCellSelectedSync = (
  state: CopyModeState | null,
  ptyId: string,
  x: number,
  absY: number
): boolean => {
  if (!state || state.ptyId !== ptyId || !state.anchor) {
    return false;
  }

  // Block selection - rectangular bounds
  if (state.visualType === 'block') {
    const minX = Math.min(state.anchor.x, state.cursor.x);
    const maxX = Math.max(state.anchor.x, state.cursor.x);
    const minY = Math.min(state.anchor.absY, state.cursor.absY);
    const maxY = Math.max(state.anchor.absY, state.cursor.absY);

    return absY >= minY && absY <= maxY && x >= minX && x <= maxX;
  }

  // Character/line selection - need range check
  if (!state.selectionRange) return false;

  const { bounds } = state;
  if (!bounds) return false;

  // Quick bounds rejection
  if (absY < bounds.minY || absY > bounds.maxY) return false;

  // Single line selection
  if (bounds.minY === bounds.maxY) {
    const { focusAtEnd } = state.selectionRange;
    if (focusAtEnd) {
      return x >= bounds.minX && x < bounds.maxX;
    } else {
      return x > bounds.minX && x <= bounds.maxX;
    }
  }

  // Multi-line selection
  if (absY === bounds.minY) {
    // First line - depends on direction
    if (!state.selectionRange.focusAtEnd) {
      // Backward: focus at start, exclude startX
      return x > bounds.minX;
    }
    return x >= bounds.minX;
  }

  if (absY === bounds.maxY) {
    // Last line - depends on direction
    if (state.selectionRange.focusAtEnd) {
      // Forward: focus at end, exclude endX
      return x < bounds.maxX;
    }
    return x <= bounds.maxX;
  }

  // Middle lines: entirely selected
  return true;
};
