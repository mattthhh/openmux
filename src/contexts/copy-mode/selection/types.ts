/**
 * Selection types for copy mode
 */

import type { SelectionRange } from '../../../core/coordinates';
import type { SelectionBounds, TerminalCell } from '../../../core/types';
import type { CopyCursor, CopyVisualType } from '../types';

/** Result of building a selection range */
export interface SelectionResult {
  range: SelectionRange;
  bounds: SelectionBounds;
}
