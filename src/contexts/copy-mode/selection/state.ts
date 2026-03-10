/**
 * Selection state management for copy mode
 */

import type { CopyCursor, CopyVisualType } from '../types';
import type { CopyModeState } from '../types';
import type { ScrollMeta } from '../navigation/types';
import type { SelectionState, SelectionResult } from './types';
import {
  buildCharSelectionRange,
  buildLineSelectionRange,
  buildBlockSelectionRange,
} from '../selection-utils';

/** Build selection range based on visual type */
export const buildSelection = (
  anchor: CopyCursor,
  cursor: CopyCursor,
  visualType: CopyVisualType,
  cols: number
): SelectionResult => {
  switch (visualType) {
    case 'line':
      return buildLineSelectionRange(anchor, cursor, cols);
    case 'block':
      return buildBlockSelectionRange(anchor, cursor);
    case 'char':
    default:
      return buildCharSelectionRange(anchor, cursor, cols);
  }
};

/** Recompute selection range from current state */
export const recomputeSelection = (
  state: CopyModeState,
  meta: ScrollMeta
): CopyModeState => {
  if (!state.visualType || !state.anchor) {
    return { ...state, selectionRange: null, bounds: null };
  }

  const cols = meta.cols || 1;
  const { range, bounds } = buildSelection(
    state.anchor,
    state.cursor,
    state.visualType,
    cols
  );

  return {
    ...state,
    selectionRange: range,
    bounds,
  };
};

/** Start visual selection */
export const startSelection = (
  state: CopyModeState,
  type: CopyVisualType,
  meta: ScrollMeta
): CopyModeState => {
  return recomputeSelection(
    {
      ...state,
      anchor: state.cursor,
      visualType: type,
    },
    meta
  );
};

/** Toggle visual selection (start if not active, clear if active with same type) */
export const toggleVisual = (
  state: CopyModeState,
  type: CopyVisualType,
  meta: ScrollMeta
): CopyModeState => {
  if (state.visualType === type) {
    return { ...state, anchor: null, visualType: null, selectionRange: null, bounds: null };
  }
  return startSelection(state, type, meta);
};

/** Clear visual selection */
export const clearSelection = (state: CopyModeState): CopyModeState => ({
  ...state,
  anchor: null,
  visualType: null,
  selectionRange: null,
  bounds: null,
});

/** Select entire line at cursor */
export const selectLine = (state: CopyModeState, meta: ScrollMeta): CopyModeState =>
  startSelection(state, 'line', meta);

/** Build word selection context for inner/around modes */
export const buildWordSelection = (
  word: import('../text-utils').SpanResult,
  mode: 'inner' | 'around',
  isWhitespace: (char: string) => boolean
): { anchor: CopyCursor; cursor: CopyCursor } | null => {
  let start = word.start;
  let end = word.end;

  if (mode === 'around') {
    let hasTrailingSpace = false;
    for (let x = end + 1; x < word.line.length; x += 1) {
      const char = word.line[x]?.char ?? ' ';
      if (isWhitespace(char)) {
        hasTrailingSpace = true;
        end = x;
      } else {
        break;
      }
    }
    if (!hasTrailingSpace) {
      for (let x = start - 1; x >= 0; x -= 1) {
        const char = word.line[x]?.char ?? ' ';
        if (isWhitespace(char)) {
          start = x;
        } else {
          break;
        }
      }
    }
  }

  return {
    anchor: { x: start, absY: word.absY },
    cursor: { x: end, absY: word.absY },
  };
};
