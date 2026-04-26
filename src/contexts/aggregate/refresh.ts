/**
 * Refresh orchestration for Aggregate View.
 *
 * Source of truth:
 * - Active session: current in-memory layout
 * - Other sessions: persisted session workspaces on disk
 *
 * Live PTY metadata is treated as an overlay on top of that stable workspace snapshot.
 * We intentionally do not derive the aggregate list from a global scan of live PTYs,
 * because that can surface orphaned/shadow PTYs that do not belong to any session workspace.
 */

import type { SetStoreFunction } from 'solid-js/store';

import { buildPtyIndex } from './filter';
import { ptyMetadataToInfo } from './pty-info';
import {
  RefreshGuard,
  type CurrentSessionHints,
  type CurrentSessionPty,
  type PtyOwnership,
  type RefreshState,
} from './subscriptions';
import type { AggregateViewState, PtyInfo, SessionLoadState } from './types';
import { createSuspendedPtyCache, SuspendedPtyCache } from './refresh/suspended-pty-cache';
import { createBuildSnapshot, type SnapshotResult } from './refresh/build-snapshot';
import { applySnapshot } from './refresh/apply-snapshot';

export { ptyMetadataToInfo } from './pty-info';

export interface RefreshersResult {
  refreshPtys: () => Promise<void>;
  /** Fast refresh: only the active session, no git metadata. */
  refreshActiveSession: () => Promise<void | Error>;
  refreshPtysSubset: (ptyIds: string[]) => Promise<void>;
  initialLoad: () => Promise<void | Error>;
  /** Live PTY metadata cache for non-active sessions. */
  suspendedPtyCache: SuspendedPtyCache;
}

export function createAggregateViewRefreshers(
  state: AggregateViewState,
  setState: SetStoreFunction<AggregateViewState>,
  refreshState: RefreshState,
  resolvePtyOwnership: (ptyId: string) => PtyOwnership | null,
  getCurrentSessionHints: () => CurrentSessionHints,
  getCurrentSessionPaneOrder: () => Map<string, number> | null,
  getCurrentSessionPtys?: () => CurrentSessionPty[]
): RefreshersResult {
  const suspendedPtyCache = createSuspendedPtyCache();
  const buildSnapshot = createBuildSnapshot({
    state,
    resolvePtyOwnership,
    getCurrentSessionHints,
    getCurrentSessionPaneOrder,
    getCurrentSessionPtys,
    suspendedPtyCache,
  });

  const refreshPtysOnce = async (options: {
    forceGitRefresh: boolean;
    activeSessionOnly?: boolean;
    skipGitMetadata?: boolean;
    mergeWithExisting?: boolean;
  }): Promise<void | Error> => {
    setState('isLoading', true);
    const snapshot = await buildSnapshot(options);
    if (snapshot instanceof Error) {
      setState('isLoading', false);
      return snapshot;
    }

    applySnapshot(state, setState, snapshot, { mergeWithExisting: options.mergeWithExisting });
    return;
  };

  const refreshPtys = async () => {
    if (refreshState.refreshInProgress) {
      refreshState.pendingFullRefresh = true;
      return;
    }

    do {
      refreshState.pendingFullRefresh = false;
      await using _guardRefresh = new RefreshGuard(refreshState, 'refreshInProgress');
      void _guardRefresh;

      const result = await refreshPtysOnce({ forceGitRefresh: true });
      if (result instanceof Error) {
        console.error('Failed to refresh aggregate PTYs:', result.message);
      }
    } while (refreshState.pendingFullRefresh);
  };

  const initialLoad = async (): Promise<void | Error> => {
    // Fast path: load only the active session without git metadata.
    // The full refreshPtys() call that follows will hydrate the rest.
    // Go through the guard to prevent concurrent snapshot builds.
    if (refreshState.refreshInProgress) {
      refreshState.pendingFullRefresh = true;
      return;
    }
    refreshState.refreshInProgress = true;
    try {
      const result = await refreshPtysOnce({
        forceGitRefresh: false,
        activeSessionOnly: true,
        skipGitMetadata: true,
      });
      if (refreshState.pendingFullRefresh) {
        refreshState.pendingFullRefresh = false;
        void refreshPtys();
      }
      return result;
    } finally {
      refreshState.refreshInProgress = false;
    }
  };

  const refreshPtysSubset = async (_ptyIds: string[]) => {
    // Simplicity over clever partial mutation: rebuild the stable snapshot.
    await refreshPtys();
  };

  /** Fast refresh: only the active session, no git metadata.
   *  Used by handlePtyCreated to make new PTYs appear instantly
   *  without waiting for the full snapshot build. */
  const refreshActiveSession = async (): Promise<void | Error> => {
    if (refreshState.refreshInProgress) {
      refreshState.pendingFullRefresh = true;
      return;
    }
    refreshState.refreshInProgress = true;
    try {
      const result = await refreshPtysOnce({
        forceGitRefresh: false,
        activeSessionOnly: true,
        skipGitMetadata: true,
        mergeWithExisting: true,
      });
      // Schedule a full refresh in the background to hydrate git metadata
      // and load other sessions.
      if (refreshState.pendingFullRefresh) {
        refreshState.pendingFullRefresh = false;
        void refreshPtys();
      }
      return result;
    } finally {
      refreshState.refreshInProgress = false;
    }
  };

  return {
    refreshPtys,
    refreshActiveSession,
    refreshPtysSubset,
    initialLoad,
    suspendedPtyCache,
  };
}
