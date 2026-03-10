/**
 * Copy mode module
 * Vim-style copy mode for terminal panes
 */

export type {
  CopyModeContextValue,
  CopyCursor,
  CopyVisualType,
  CopyModeState,
} from './types';

export {
  CopyModeProvider,
  useCopyMode,
} from './CopyModeContext';

// Navigation exports
export type { ScrollMeta, GetScrollMeta, WordNavResult } from './navigation';
export {
  clampCursor,
  calculateInitialCursor,
  moveCursorBy,
  calculateScrollForVisibility,
  getLineCellsAt,
  moveWordForward,
  moveWordBackward,
  moveWordEnd,
  moveWideWordForward,
  moveWideWordBackward,
  moveWideWordEnd,
  getLineStartX,
  getLineEndX,
} from './navigation';

// Selection exports
export type { SelectionState, SelectionResult, WordSelectionContext } from './selection';
export {
  buildSelection,
  recomputeSelection,
  startSelection,
  toggleVisual,
  clearSelection,
  selectLine,
  buildWordSelection,
  hasSelection,
  isCellSelected,
  isCellSelectedSync,
  isCopyModeActive,
} from './selection';

// Text extraction exports
export {
  TextExtractionError,
  createLineAccessor,
  extractBlockText,
  extractRangeText,
  extractLineAtCursor,
  prepareCopyText,
  type CopyResult,
} from './text';

// Re-export text-utils for external use
export type { LineAccessor, SpanResult, RunResult } from './text-utils';
export {
  getLineEndX as getLineEndXFromUtils,
  getLineStartX as getLineStartXFromUtils,
  isWordChar,
  isWhitespaceChar,
  isWideWordChar,
  getRunAt,
  findNextRun,
  findPrevRun,
  findSpanAtOrAfter,
  findSpanAtOrBefore,
} from './text-utils';

// Re-export selection-utils for external use
export {
  buildCharSelectionRange,
  buildLineSelectionRange,
  buildBlockSelectionRange,
  isForwardSelection,
} from './selection-utils';
