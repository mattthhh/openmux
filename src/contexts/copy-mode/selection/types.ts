/**
 * Selection types for copy mode
 */

import type { SelectionRange } from '../../../core/coordinates';
import type { SelectionBounds } from '../../../core/types';
import type { CopyCursor, CopyVisualType } from '../types';

/** Selection state within copy mode */
export interface SelectionState {
  anchor: CopyCursor | null;
  visualType: CopyVisualType | null;
  selectionRange: SelectionRange | null;
  bounds: SelectionBounds | null;
}

/** Result of building a selection range */
export interface SelectionResult {
  range: SelectionRange;
  bounds: SelectionBounds;
}

/** Word selection with context for inner/around modes */
export interface WordSelectionContext {
  start: number;
  end: number;
  absY: number;
  line: import('../../../core/types').TerminalCell[];
}
