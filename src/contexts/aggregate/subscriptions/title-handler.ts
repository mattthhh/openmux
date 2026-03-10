/**
 * Title change handler for Aggregate View.
 * 
 * Provides incremental updates for PTY title changes without full refresh.
 */

import { produce, type SetStoreFunction } from 'solid-js/store';
import type { AggregateViewState } from '../aggregate-view-types';

/** Title change event */
export interface TitleChangeEvent {
  ptyId: string;
  title: string;
}

/**
 * Create a title change handler that updates PTY titles incrementally.
 * This avoids full refresh by directly updating the title in state.
 */
export function createTitleChangeHandler(
  setState: SetStoreFunction<AggregateViewState>
): (event: TitleChangeEvent) => void {
  return (event: TitleChangeEvent) => {
    setState(produce((s) => {
      // Update in allPtys using O(1) lookup with ptyId validation
      const allIndex = s.allPtysIndex.get(event.ptyId);
      if (allIndex !== undefined && s.allPtys[allIndex]) {
        const ptyAtIndex = s.allPtys[allIndex];
        // Validate that the PTY at this index has the correct ID
        if (ptyAtIndex.ptyId === event.ptyId) {
          s.allPtys[allIndex] = { ...ptyAtIndex, title: event.title };
        }
      }
      
      // Update in matchedPtys using O(1) lookup with ptyId validation
      const matchedIndex = s.matchedPtysIndex.get(event.ptyId);
      if (matchedIndex !== undefined && s.matchedPtys[matchedIndex]) {
        const ptyAtIndex = s.matchedPtys[matchedIndex];
        // Validate that the PTY at this index has the correct ID
        if (ptyAtIndex.ptyId === event.ptyId) {
          s.matchedPtys[matchedIndex] = { ...ptyAtIndex, title: event.title };
        }
      }
    }));
  };
}
