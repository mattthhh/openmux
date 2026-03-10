/**
 * Navigation module for copy mode
 * Cursor movement, viewport handling, and word navigation
 */

export type { ScrollMeta, GetScrollMeta } from './types';
export { clampCursor, calculateInitialCursor, moveCursorBy } from './cursor';
export {
  calculateScrollForVisibility,
  getLineCellsAt,
} from './viewport';
export {
  moveWordForward,
  moveWordBackward,
  moveWordEnd,
  moveWideWordForward,
  moveWideWordBackward,
  moveWideWordEnd,
  getLineStartX,
  getLineEndX,
  type WordNavResult,
} from './word';
