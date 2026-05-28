import type { SelectionBounds } from '../../core/types';
import {
  type SelectionPoint,
  type SelectionRange,
  normalizeSelection,
  calculateBounds,
} from '../../core/coordinates';
import type { CopyCursor } from './types';

type SelectionResult = {
  range: SelectionRange;
  bounds: SelectionBounds;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, max));

export const isForwardSelection = (anchor: CopyCursor, cursor: CopyCursor): boolean => {
  return cursor.absY > anchor.absY || (cursor.absY === anchor.absY && cursor.x >= anchor.x);
};

export const buildCharSelectionRange = (
  anchor: CopyCursor,
  cursor: CopyCursor,
  cols: number
): SelectionResult => {
  const forward = isForwardSelection(anchor, cursor);
  const focusX = forward ? cursor.x + 1 : cursor.x - 1;
  const clampedFocusX = clamp(focusX, -1, Math.max(cols, 0));
  const anchorPoint: SelectionPoint = { x: anchor.x, y: 0, absoluteY: anchor.absY };
  const focusPoint: SelectionPoint = { x: clampedFocusX, y: 0, absoluteY: cursor.absY };
  const range = normalizeSelection(anchorPoint, focusPoint);
  return { range, bounds: calculateBounds(range) };
};

export const buildLineSelectionRange = (
  anchor: CopyCursor,
  cursor: CopyCursor,
  cols: number
): SelectionResult => {
  const forward = isForwardSelection(anchor, cursor);
  const startY = Math.min(anchor.absY, cursor.absY);
  const endY = Math.max(anchor.absY, cursor.absY);
  const safeCols = Math.max(1, cols);
  const range: SelectionRange = forward
    ? { startX: 0, startY, endX: safeCols, endY, focusAtEnd: true }
    : { startX: -1, startY, endX: Math.max(0, safeCols - 1), endY, focusAtEnd: false };
  return { range, bounds: calculateBounds(range) };
};

export const buildBlockSelectionRange = (
  anchor: CopyCursor,
  cursor: CopyCursor
): SelectionResult => {
  const anchorPoint: SelectionPoint = { x: anchor.x, y: 0, absoluteY: anchor.absY };
  const focusPoint: SelectionPoint = { x: cursor.x, y: 0, absoluteY: cursor.absY };
  const range = normalizeSelection(anchorPoint, focusPoint);
  return { range, bounds: calculateBounds(range) };
};
