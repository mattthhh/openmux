/**
 * Backward compatibility wrapper for createAggregateViewRefreshers.
 * 
 * This provides the same API as the original monolithic function,
 * but delegates to the new modular implementation.
 */

import type { SetStoreFunction } from 'solid-js/store';
import type { AggregateViewState } from '../types';
import type { RefreshState, PtyOwnership, CurrentSessionHints, CurrentSessionPty } from '../subscriptions/types';
import { refreshPtysOnce } from './full-refresh';
import { refreshPtysSubsetOnce } from './subset-refresh';
import { initialLoadOnce } from './initial-load';

/** Parameters for creating aggregate view refreshers */
export interface CreateRefreshersParams {
  state: AggregateViewState;
  setState: SetStoreFunction<AggregateViewState>;
  refreshState: RefreshState;
  resolvePtyOwnership: (ptyId: string) => PtyOwnership | null;
  getCurrentSessionHints: () => CurrentSessionHints;
  getCurrentSessionPaneOrder: () => Map<string, number> | null;
  getCurrentSessionPtys?: () => CurrentSessionPty[];
}

/** Result of createAggregateViewRefreshers */
export interface RefreshersResult {
  /** Full refresh of all PTYs */
  refreshPtys: () => Promise<void>;
  /** Subset refresh for specific PTY IDs */
  refreshPtysSubset: (ptyIds: string[]) => Promise<void>;
  /** Initial lightweight load for instant feedback */
  initialLoad: () => Promise<void | Error>;
}

/**
 * Create aggregate view refreshers with backward-compatible API.
 * 
 * This is the legacy entry point that matches the original API.
 * New code should use the individual functions directly:
 * - refreshPtysOnce
 * - refreshPtysSubsetOnce
 * - initialLoadOnce
 */
export function createAggregateViewRefreshers(
  state: AggregateViewState,
  setState: SetStoreFunction<AggregateViewState>,
  refreshState: RefreshState,
  resolvePtyOwnership: (ptyId: string) => PtyOwnership | null,
  getCurrentSessionHints: () => CurrentSessionHints,
  getCurrentSessionPaneOrder: () => Map<string, number> | null,
  getCurrentSessionPtys?: () => CurrentSessionPty[]
): RefreshersResult {
  // Wrap refreshPtysOnce with the refresh state management
  const refreshPtys = async (): Promise<void> => {
    if (refreshState.refreshInProgress) {
      refreshState.pendingFullRefresh = true;
      return;
    }

    do {
      refreshState.pendingFullRefresh = false;
      refreshState.refreshInProgress = true;
      
      try {
        const result = await refreshPtysOnce(state, setState, {
          resolvePtyOwnership,
          getCurrentSessionHints,
          getCurrentSessionPaneOrder,
        });
        
        if (result instanceof Error) {
          console.error('Failed to refresh aggregate PTYs:', result.message);
        }
      } finally {
        refreshState.refreshInProgress = false;
      }
    } while (refreshState.pendingFullRefresh);
  };

  // Wrap refreshPtysSubsetOnce with pending tracking
  const refreshPtysSubset = async (ptyIds: string[]): Promise<void> => {
    if (ptyIds.length === 0) return;

    for (const ptyId of ptyIds) {
      refreshState.pendingSubsetPtyIds.add(ptyId);
    }

    if (refreshState.subsetRefreshInProgress) {
      return;
    }

    while (refreshState.pendingSubsetPtyIds.size > 0) {
      const nextPtyIds = [...refreshState.pendingSubsetPtyIds];
      refreshState.pendingSubsetPtyIds.clear();

      refreshState.subsetRefreshInProgress = true;
      
      try {
        const result = await refreshPtysSubsetOnce(state, setState, nextPtyIds);
        if (result instanceof Error) {
          console.error('Failed to refresh aggregate PTY subset:', result.message);
        }
      } finally {
        refreshState.subsetRefreshInProgress = false;
      }
    }
  };

  // Wrap initialLoadOnce with dependencies
  const initialLoad = async (): Promise<void | Error> => {
    return initialLoadOnce(state, setState, {
      getCurrentSessionHints,
      getCurrentSessionPtys,
    });
  };

  return { refreshPtys, refreshPtysSubset, initialLoad };
}
