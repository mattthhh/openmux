/**
 * Selection module for copy mode
 * Selection state management and queries
 */

export type { SelectionResult } from './types';
export {
  buildSelection,
  recomputeSelection,
  startSelection,
  toggleVisual,
  clearSelection,
  selectLine,
  buildWordSelection,
} from './state';
export { hasSelection, isCellSelected, isCellSelectedSync, isCopyModeActive } from './queries';
