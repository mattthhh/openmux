/**
 * Subset refresh operation for Aggregate View.
 * 
 * Performs targeted refresh of specific PTY IDs - used for:
 * - Polling updates on visible PTYs
 * - Incremental updates after lifecycle events
 * - Git metadata refresh for specific directories
 */

import * as errore from 'errore';
import { produce, type SetStoreFunction } from 'solid-js/store';
import { PtyMetadataError, ServicesNotInitializedError } from '../../../effect/errors';

import type { AggregateViewState } from '../aggregate-view-types';
import type { PtyMetadata } from '../../../effect/bridge/aggregate/types';
import { getPtyMetadata } from '../../../effect/bridge/aggregate';
import { getGlobalGitMetadataCache, type GitRepoMetadata } from '../../git-metadata-cache';
import { getGitInfo, getGitDiffStats } from '../../../effect/services/pty/helpers';
import { recomputeMatches, recomputeTree } from '../session/operations';
import { buildPtyIndex } from '../filter/operations';
import { extractGitMetadata } from '../git/metadata';
import { RefreshGuard } from './guard';
import type { RefreshState } from '../subscriptions/types';

/** Dependencies for subset refresh */
export interface SubsetRefreshDeps {
  // No external deps needed - all data comes from state and bridge
}

/**
 * Group PTY updates by their git repository key.
 * This allows batching updates for PTYs in the same repo.
 */
interface RepoGroup {
  repoKey: string | undefined;
  items: Array<{
    index: number;
    update: PtyMetadata;
    metadata: GitRepoMetadata | undefined;
  }>;
}

/**
 * Refresh a subset of PTYs by their IDs.
 * More efficient than full refresh when only specific PTYs need updating.
 */
export async function refreshPtysSubsetOnce(
  state: AggregateViewState,
  setState: SetStoreFunction<AggregateViewState>,
  ptyIds: string[],
  _deps?: SubsetRefreshDeps
): Promise<void | Error> {
  if (ptyIds.length === 0) return;

  // Fetch metadata for all requested PTYs in parallel
  const results = await Promise.all(
    ptyIds.map((id) => 
      getPtyMetadata(id, { skipGitDiffStats: true }).catch(
        (e) => new PtyMetadataError({ 
          operation: 'get', 
          ptyId: id, 
          cause: e 
        })
      )
    )
  );

  // Filter to successful results
  const updates = results.filter((result): result is PtyMetadata => 
    result !== null && !(result instanceof Error)
  );
  
  if (updates.length === 0) {
    const firstError = results.find(
      (result): result is ServicesNotInitializedError =>
        result instanceof Error
    );
    return firstError;
  }

  // Get git cache
  const gitCache = getGlobalGitMetadataCache({
    fetchGitInfo: (cwd) => getGitInfo(cwd, { force: false }),
    fetchDiffStats: getGitDiffStats,
  });

  // Fetch git metadata for all unique CWDs
  const cwds = [...new Set(updates.map((update) => update.cwd))];
  const gitMetadataMap = await gitCache.getMetadataBatch(cwds, { forceRefresh: true });

  // Group updates by repository for batch processing
  const updatesByRepo = new Map<string | undefined, RepoGroup['items']>();

  let didChange = false;
  setState(produce((s) => {
    // First pass: collect indices and group by repo
    for (const update of updates) {
      const index = s.allPtysIndex.get(update.ptyId);
      if (index === undefined || !s.allPtys[index]) continue;

      const gitMetadata = gitMetadataMap.get(update.cwd);
      const repoKey = gitMetadata?.repoKey;
      const group = updatesByRepo.get(repoKey);

      if (group) {
        group.push({ index, update, metadata: gitMetadata });
      } else {
        updatesByRepo.set(repoKey, [{ index, update, metadata: gitMetadata }]);
      }
    }

    // Second pass: apply updates
    for (const [, group] of updatesByRepo) {
      for (const { index, update, metadata } of group) {
        const prev = s.allPtys[index];
        const gitFields = extractGitMetadata(metadata);

        const updated = {
          ...prev,
          cwd: update.cwd,
          foregroundProcess: update.foregroundProcess,
          shell: update.shell ?? prev.shell,
          title: update.title ?? prev.title,
          workspaceId: update.workspaceId ?? prev.workspaceId,
          paneId: update.paneId ?? prev.paneId,
          ...gitFields,
        };

        // Only update if something changed
        if (
          prev.cwd !== updated.cwd ||
          prev.foregroundProcess !== updated.foregroundProcess ||
          prev.shell !== updated.shell ||
          prev.title !== updated.title ||
          prev.workspaceId !== updated.workspaceId ||
          prev.paneId !== updated.paneId ||
          prev.gitBranch !== updated.gitBranch ||
          prev.gitDirty !== updated.gitDirty ||
          prev.gitStaged !== updated.gitStaged ||
          prev.gitUnstaged !== updated.gitUnstaged ||
          prev.gitUntracked !== updated.gitUntracked ||
          prev.gitConflicted !== updated.gitConflicted ||
          prev.gitAhead !== updated.gitAhead ||
          prev.gitBehind !== updated.gitBehind ||
          prev.gitStashCount !== updated.gitStashCount ||
          prev.gitState !== updated.gitState ||
          prev.gitDetached !== updated.gitDetached ||
          prev.gitRepoKey !== updated.gitRepoKey
        ) {
          s.allPtys[index] = updated;
          didChange = true;
        }
      }
    }

    // Recompute tree if any changes were made
    if (didChange) {
      recomputeMatches(s);
      recomputeTree(s);
    }
  }));

  return;
}

/**
 * Queue a subset refresh with debouncing.
 * If a subset refresh is already in progress, queues the PTY IDs for the next batch.
 */
export async function refreshPtysSubset(
  state: AggregateViewState,
  setState: SetStoreFunction<AggregateViewState>,
  refreshState: RefreshState,
  ptyIds: string[]
): Promise<void> {
  if (ptyIds.length === 0) return;

  // Add all PTY IDs to pending set
  for (const ptyId of ptyIds) {
    refreshState.pendingSubsetPtyIds.add(ptyId);
  }

  // If already running, just queue - the running refresh will pick these up
  if (refreshState.subsetRefreshInProgress) {
    return;
  }

  // Process batches until pending is empty
  while (refreshState.pendingSubsetPtyIds.size > 0) {
    // Move pending to processing batch
    const nextPtyIds = [...refreshState.pendingSubsetPtyIds];
    refreshState.pendingSubsetPtyIds.clear();

    // Use guard to manage the in-progress flag
    await using _guardSubset = new RefreshGuard(refreshState, 'subsetRefreshInProgress');
    void _guardSubset;

    // Process this batch
    const result = await refreshPtysSubsetOnce(state, setState, nextPtyIds);
    if (result instanceof Error) {
      console.error('Failed to refresh aggregate PTY subset:', result.message);
    }
  }
}
