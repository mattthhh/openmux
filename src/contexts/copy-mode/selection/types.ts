/**
 * Selection types for copy mode
 */

import type { SelectionRange } from '../../../core/coordinates';
import type { SelectionBounds } from '../../../core/types';

/** Result of building a selection range */
export interface SelectionResult {
  range: SelectionRange;
  bounds: SelectionBounds;
}
