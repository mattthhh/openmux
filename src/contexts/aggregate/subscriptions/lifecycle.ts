/**
 * PTY lifecycle handlers for Aggregate View.
 * 
 * Provides instant UI updates for PTY creation and destruction events.
 * Unlike the debounced full refresh, these handlers do targeted updates
 * for immediate visual feedback.
 */

import * as errore from 'errore';
import { produce, type SetStoreFunction } from 'solid-js/store';
import { PtyMetadataError } from '../../../effect/errors';

import type { AggregateViewState, PtyInfo } from '../types';
import type { PtyOwnership, CurrentSessionHints } from './types';
import { getPtyMetadata } from '../../../effect/bridge/aggregate-bridge';
import { getGlobalGitMetadataCache } from '../../git-metadata-cache';
import { getGitInfo, getGitDiffStats } from '../../../effect/services/pty/helpers';
import { recomputeMatches, recomputeTree } from '../session/operations';
import { buildPtyIndex } from '../filter/operations';
import { extractGitMetadata } from '../git/metadata';

/** Dependencies for lifecycle handlers */
export interface LifecycleHandlerDeps {
  resolvePtyOwnership: (ptyId: string) => PtyOwnership | null;
  getCurrentSessionHints: () => CurrentSessionHints;
}

/**
 * Create instant PTY lifecycle handlers for immediate UI updates.
 * Unlike the debounced full refresh, these do targeted updates.
 */
export function createLifecycleHandlers(
  state: AggregateViewState,
  setState: SetStoreFunction<AggregateViewState>,
  deps: LifecycleHandlerDeps
) {
  const { resolvePtyOwnership, getCurrentSessionHints } = deps;

  const gitCache = getGlobalGitMetadataCache({
    fetchGitInfo: (cwd) => getGitInfo(cwd, { force: false }),
    fetchDiffStats: getGitDiffStats,
  });

  /** Get session metadata for a session ID */
  const getSessionMetadata = (sessionId: string) => {
    return state.allSessions.get(sessionId);
  };

  /**
   * Handle PTY created - add to list instantly.
   * Fetches metadata and inserts the new PTY.
   * Retries if ownership isn't available yet (race condition on creation).
   */
  const handlePtyCreated = async (ptyId: string, retryCount = 0): Promise<void> => {
    // Check if this PTY was recently deleted (race condition: create->destroy->create handler runs)
    if (state.deletedPtyIds.has(ptyId) && retryCount === 0) {
      // Wait for deleted tracking to clear before creating
      setTimeout(() => void handlePtyCreated(ptyId, retryCount), 100);
      return;
    }

    // Mark as pending immediately to prevent flickering during creation
    setState(produce((s) => {
      // If PTY was deleted while waiting, abort
      if (s.deletedPtyIds.has(ptyId)) {
        return;
      }

      s.pendingPtyIds.add(ptyId);

      // If this is the first attempt, add a placeholder PTY immediately
      // This ensures the pane appears in the list while we fetch metadata
      if (retryCount === 0 && !s.allPtysIndex.has(ptyId)) {
        const placeholderPty: PtyInfo = {
          ptyId,
          cwd: '',
          gitBranch: undefined,
          gitDiffStats: undefined,
          gitDirty: false,
          gitStaged: 0,
          gitUnstaged: 0,
          gitUntracked: 0,
          gitConflicted: 0,
          gitAhead: undefined,
          gitBehind: undefined,
          gitStashCount: undefined,
          gitState: undefined,
          gitDetached: false,
          gitRepoKey: undefined,
          foregroundProcess: undefined,
          shell: undefined,
          title: '...', // Loading indicator
          workspaceId: undefined,
          paneId: undefined,
          sessionId: '', // Will be filled in when ownership resolved
          sessionMetadata: undefined,
        };
        const newIndex = s.allPtys.length;
        s.allPtys.push(placeholderPty);
        s.allPtysIndex.set(ptyId, newIndex);
        recomputeMatches(s);
        recomputeTree(s);
      }
    }));

    const ownership = resolvePtyOwnership(ptyId);

    // If ownership not available yet, retry with backoff
    if (!ownership) {
      if (retryCount < 5) {
        const delay = Math.min(50 * Math.pow(2, retryCount), 500);
        setTimeout(() => void handlePtyCreated(ptyId, retryCount + 1), delay);
        return;
      }
      // Max retries reached - keep placeholder, clear pending
      setState(produce((s) => {
        s.pendingPtyIds.delete(ptyId);
        // Update title to show error state
        const index = s.allPtysIndex.get(ptyId);
        if (index !== undefined && s.allPtys[index]?.title === '...') {
          s.allPtys[index] = { ...s.allPtys[index], title: 'error' };
          recomputeMatches(s);
          recomputeTree(s);
        }
      }));
      return;
    }

    const sessionMetadata = getSessionMetadata(ownership.sessionId);
    if (!sessionMetadata) {
      // Session metadata not loaded yet, retry
      if (retryCount < 5) {
        const delay = Math.min(50 * Math.pow(2, retryCount), 500);
        setTimeout(() => void handlePtyCreated(ptyId, retryCount + 1), delay);
        return;
      }
      // Keep placeholder but clear pending status
      setState(produce((s) => {
        s.pendingPtyIds.delete(ptyId);
      }));
      return;
    }

    // Fetch metadata for the new PTY
    const metadataResult = await getPtyMetadata(ptyId, { skipGitDiffStats: true }).catch(
      (e) => new PtyMetadataError({ 
        operation: 'get', 
        ptyId, 
        reason: String(e) 
      })
    );
    
    if (!metadataResult || metadataResult instanceof Error) {
      setState(produce((s) => {
        s.pendingPtyIds.delete(ptyId);
        // Keep placeholder but mark as error
        const index = s.allPtysIndex.get(ptyId);
        if (index !== undefined) {
          s.allPtys[index] = {
            ...s.allPtys[index],
            sessionId: ownership.sessionId,
            sessionMetadata,
            title: metadataResult instanceof Error ? 'error' : 'shell',
          };
          recomputeMatches(s);
          recomputeTree(s);
        }
      }));
      return;
    }

    // Fetch git metadata for the CWD
    const gitMetadata = await gitCache.getMetadata(metadataResult.cwd);
    const gitFields = extractGitMetadata(gitMetadata);

    // Build the new PtyInfo
    const newPty: PtyInfo = {
      ptyId: metadataResult.ptyId,
      cwd: metadataResult.cwd,
      gitBranch: gitFields.gitBranch,
      gitDiffStats: gitFields.gitDiffStats,
      gitDirty: gitFields.gitDirty,
      gitStaged: gitFields.gitStaged,
      gitUnstaged: gitFields.gitUnstaged,
      gitUntracked: gitFields.gitUntracked,
      gitConflicted: gitFields.gitConflicted,
      gitAhead: gitFields.gitAhead,
      gitBehind: gitFields.gitBehind,
      gitStashCount: gitFields.gitStashCount,
      gitState: gitFields.gitState,
      gitDetached: gitFields.gitDetached,
      gitRepoKey: gitFields.gitRepoKey,
      foregroundProcess: metadataResult.foregroundProcess,
      shell: metadataResult.shell,
      title: metadataResult.title,
      workspaceId: ownership.workspaceId ?? metadataResult.workspaceId,
      paneId: ownership.paneId ?? metadataResult.paneId,
      sessionId: ownership.sessionId,
      sessionMetadata,
    };

    setState(produce((s) => {
      // Race condition check: if PTY is no longer pending or was deleted, abort
      if (!s.pendingPtyIds.has(ptyId) || s.deletedPtyIds.has(ptyId)) {
        // Clean up pending if it exists
        s.pendingPtyIds.delete(ptyId);
        return; // PTY was destroyed while we were fetching metadata, don't add it
      }

      // Check if PTY already exists
      const existingIndex = s.allPtysIndex.get(ptyId);
      if (existingIndex !== undefined) {
        s.allPtys[existingIndex] = newPty;
      } else {
        // Add to the end of allPtys
        const newIndex = s.allPtys.length;
        s.allPtys.push(newPty);
        s.allPtysIndex.set(ptyId, newIndex);
      }

      // Clear pending status
      s.pendingPtyIds.delete(ptyId);

      // Mark as recently added for protection during initial load period
      s.recentlyAddedPtyIds.add(ptyId);
      // Clear after 5 seconds
      setTimeout(() => {
        setState(produce((s2) => {
          s2.recentlyAddedPtyIds.delete(ptyId);
        }));
      }, 5000);

      // Update session load state to loaded if it wasn't already
      const loadState = s.sessionLoadStates.get(ownership.sessionId);
      if (loadState && loadState.status !== 'loaded') {
        s.sessionLoadStates.set(ownership.sessionId, {
          ...loadState,
          status: 'loaded',
          paneCount: (loadState.paneCount ?? 0) + 1,
        });
      }

      // Auto-expand the session if this is the first PTY
      const sessionPtyCount = s.allPtys.filter(p => p.sessionId === ownership.sessionId).length;
      if (sessionPtyCount === 1) {
        s.expandedSessionIds.add(ownership.sessionId);
      }

      recomputeMatches(s);
      recomputeTree(s);
    }));
  };

  /**
   * Handle PTY destroyed - remove from list instantly.
   * This is synchronous for immediate UI feedback.
   * Selection moves to adjacent PTY (below first, then above).
   */
  const handlePtyDestroyed = (ptyId: string): void => {
    setState(produce((s) => {
      // Mark as deleted immediately (prevents background refresh from adding it back)
      s.deletedPtyIds.add(ptyId);

      // Clear from pending if it was still being created
      s.pendingPtyIds.delete(ptyId);
      // Clear from recently added (it's now legitimately gone)
      s.recentlyAddedPtyIds.delete(ptyId);

      // Clear deleted tracking after 5 seconds (prevents memory leak, allows legitimate re-add)
      setTimeout(() => {
        setState(produce((s2) => {
          s2.deletedPtyIds.delete(ptyId);
        }));
      }, 5000);

      const index = s.allPtysIndex.get(ptyId);
      if (index === undefined) return;

      const pty = s.allPtys[index];
      if (!pty) return;

      const sessionId = pty.sessionId;

      // Get current position in flattened tree BEFORE modifying anything
      const removedFlattenedIndex = s.flattenedTreeIndex.get(ptyId);

      // Remove from allPtys
      s.allPtys.splice(index, 1);

      // Rebuild index for affected PTYs (indices shifted after removal)
      s.allPtysIndex = buildPtyIndex(s.allPtys);

      // Update session pane count
      const loadState = s.sessionLoadStates.get(sessionId);
      if (loadState) {
        const newPaneCount = Math.max(0, (loadState.paneCount ?? 1) - 1);
        s.sessionLoadStates.set(sessionId, {
          ...loadState,
          paneCount: newPaneCount,
        });
      }

      // Handle selection change BEFORE recomputing tree (we need old flattened tree)
      if (s.selectedPtyId === ptyId && removedFlattenedIndex !== undefined) {
        // Priority 1: Try to find PTY below in same session
        let newSelection: { 
          index: number; 
          ptyId: string; 
          sessionId: string 
        } | null = null;

        // Search downward first (below the deleted PTY)
        for (let i = removedFlattenedIndex + 1; i < s.flattenedTree.length; i++) {
          const item = s.flattenedTree[i];
          if (item?.node.type === 'session') break; // Stop at session boundary
          if (item?.node.type === 'pty' && item.parentSessionId === sessionId) {
            newSelection = { 
              index: i, 
              ptyId: item.node.ptyInfo.ptyId, 
              sessionId 
            };
            break;
          }
        }

        // Priority 2: If no PTY below, search upward (above the deleted PTY)
        if (!newSelection) {
          for (let i = removedFlattenedIndex - 1; i >= 0; i--) {
            const item = s.flattenedTree[i];
            if (item?.node.type === 'session') break; // Stop at session boundary
            if (item?.node.type === 'pty' && item.parentSessionId === sessionId) {
              newSelection = { 
                index: i, 
                ptyId: item.node.ptyInfo.ptyId, 
                sessionId 
              };
              break;
            }
          }
        }

        // Priority 3: If no PTY in same session, try any adjacent PTY
        if (!newSelection) {
          // Try below first
          for (let i = removedFlattenedIndex + 1; i < s.flattenedTree.length; i++) {
            const item = s.flattenedTree[i];
            if (item?.node.type === 'pty') {
              newSelection = { 
                index: i, 
                ptyId: item.node.ptyInfo.ptyId, 
                sessionId: item.node.parentSessionId 
              };
              break;
            }
          }
          // Then try above
          if (!newSelection) {
            for (let i = removedFlattenedIndex - 1; i >= 0; i--) {
              const item = s.flattenedTree[i];
              if (item?.node.type === 'pty') {
                newSelection = { 
                  index: i, 
                  ptyId: item.node.ptyInfo.ptyId, 
                  sessionId: item.node.parentSessionId 
                };
                break;
              }
            }
          }
        }

        if (newSelection) {
          s.selectedIndex = newSelection.index;
          s.selectedPtyId = newSelection.ptyId;
          s.selectedSessionId = newSelection.sessionId;
        } else {
          // No other PTY found, select the session header
          s.selectedPtyId = null;
          s.selectedIndex = Math.max(0, removedFlattenedIndex - 1);
          // selectedSessionId stays as the current session
        }
      }

      recomputeMatches(s);
      recomputeTree(s);
    }));
  };

  return { handlePtyCreated, handlePtyDestroyed };
}
