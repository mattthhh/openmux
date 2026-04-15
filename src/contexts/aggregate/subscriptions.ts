/**
 * Subscription management for Aggregate View.
 */

import { produce, type SetStoreFunction } from 'solid-js/store';

import type { SessionMetadata } from '../../effect/models';
import { runStream, streamFromSubscription, tap } from '../../effect/stream-utils';
import {
  subscribeToAllPtyActivity,
  subscribeToAllTitleChanges,
  subscribeToForegroundProcessChanges,
  subscribeToPtyLifecycle,
  type PtyTitleChangeEvent,
  type PtyForegroundProcessChangeEvent,
} from '../../effect/bridge/pty-bridge';
import { getPtyMetadata, removeAggregateSessionMappingForPty } from '../../effect/bridge/aggregate';
import { getGlobalGitMetadataCache } from '../git-metadata-cache';
import {
  getGitDiffStats,
  getGitInfo,
  subscribeToGitRepoChanges,
} from '../../effect/services/pty/helpers';
import { PtyMetadataError } from '../../effect/errors';
import { clonePtyStdoutActivity } from '../../core/shimmer';

import type { AggregateViewState, PendingPaneCreation, PtyInfo } from './types';
import { buildPtyIndex } from './filter';
import { applyGitMetadataSnapshot } from './git';
import {
  findPendingPaneCreationForLifecycle,
  getAppendedPaneOrder,
  getInsertedPaneOrder,
  removePendingPaneCreations,
} from './pending';
import { ptyMetadataToInfo } from './pty-info';
import { clearPreviewState } from './selection';
import {
  buildSessionPaneOrderFromAggregateState,
  getSessionPaneOrder,
  getSessionPaneOrderKey,
  setSessionPaneOrder,
} from './pane-order';
import {
  dedupeAggregatePtysByPane,
  findAggregatePtyIndexByPane,
  getSavedAggregatePtyId,
  isSavedAggregatePtyId,
} from './rows';
import { recomputeMatches, recomputeTree } from './session';

export interface SubscriptionManager {
  lifecycle: (() => void) | null;
  titleChange: (() => void) | null;
  processChange: (() => void) | null;
  gitChanges: (() => void) | null;
  polling: (() => void) | null;
}

export interface RefreshState {
  refreshInProgress: boolean;
  pendingFullRefresh: boolean;
}

export type RefreshFlagKey = 'refreshInProgress';

export interface PtyOwnership {
  sessionId: string;
  paneId?: string;
  workspaceId?: number;
}

export interface CurrentSessionHints {
  sessionId: string | null;
  lastActiveWorkspaceId?: number;
  focusedPaneId?: string;
}

export interface CurrentSessionPty {
  ptyId: string;
  paneId: string;
  workspaceId: number;
  title?: string;
  cwd?: string;
  /**
   * Effective owner session for the current in-memory layout snapshot.
   * This may differ transiently from SessionContext.activeSessionId during
   * cold-start/session-switch races, so refresh.ts must trust this value over
   * the hinted active session when it is present.
   */
  sessionId?: string;
}

export type TitleChangeHandler = (event: { ptyId: string; title: string }) => void;

export interface LifecycleEvent {
  type: 'created' | 'destroyed';
  ptyId: string;
}

export interface LifecycleHandlers {
  handlePtyCreated: (ptyId: string) => Promise<void>;
  handlePtyDestroyed: (ptyId: string) => void;
}

export interface SubscriptionSetupDeps {
  subscriptions: SubscriptionManager;
  subscriptionsEpoch: { value: number };
  refreshPtys: () => Promise<void>;
  handleTitleChange: TitleChangeHandler;
  handleProcessChange: (event: ProcessChangeEvent) => void;
  lifecycleHandlers: LifecycleHandlers;
}

export function createSubscriptionManager(): SubscriptionManager {
  return {
    lifecycle: null,
    titleChange: null,
    processChange: null,
    gitChanges: null,
    polling: null,
  };
}

export function createRefreshState(): RefreshState {
  return {
    refreshInProgress: false,
    pendingFullRefresh: false,
  };
}

export class RefreshGuard implements AsyncDisposable {
  constructor(
    private state: RefreshState,
    private key: RefreshFlagKey
  ) {
    this.state[this.key] = true;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.state[this.key] = false;
  }
}

export interface LifecycleHandlerDeps {
  resolvePtyOwnership: (ptyId: string) => PtyOwnership | null;
  getCurrentSessionHints: () => CurrentSessionHints;
}

function buildSessionPaneOrderFromState(
  state: Pick<AggregateViewState, 'allPtys' | 'sessionPaneOrderIndex'>,
  sessionId: string
): Map<string, number> {
  return buildSessionPaneOrderFromAggregateState(state, sessionId);
}

/** Stamp the pending insertion's sortOrderHint into the sessionPaneOrderIndex.
 *  Ensures sortPtysForSession uses the correct (adjacent) position for newly
 *  created panes, instead of the layout-tree traversal order which appends
 *  them at the end of the session. */
function stampSortOrderHintIntoPaneIndex(
  state: Pick<AggregateViewState, 'sessionPaneOrderIndex'>,
  sessionId: string,
  paneId: string,
  sortOrderHint: number
): void {
  const sessionPaneOrder = getSessionPaneOrder(state.sessionPaneOrderIndex, sessionId);
  sessionPaneOrder.set(paneId, sortOrderHint);
  setSessionPaneOrder(state.sessionPaneOrderIndex, sessionId, sessionPaneOrder);
}

function getPendingInsertionOrder(
  state: Pick<AggregateViewState, 'allPtys' | 'sessionPaneOrderIndex'>,
  insertion: PendingPaneCreation
): number {
  if (insertion.sortOrderHint !== undefined) {
    return insertion.sortOrderHint;
  }

  const paneOrder = buildSessionPaneOrderFromState(state, insertion.sessionId);
  if (!insertion.insertAfterPaneId) {
    return getAppendedPaneOrder(paneOrder);
  }

  return (
    getInsertedPaneOrder(paneOrder, insertion.insertAfterPaneId) ?? getAppendedPaneOrder(paneOrder)
  );
}

function getEmptyGitFields(): Pick<
  PtyInfo,
  | 'gitBranch'
  | 'gitDiffStats'
  | 'gitDirty'
  | 'gitStaged'
  | 'gitUnstaged'
  | 'gitUntracked'
  | 'gitConflicted'
  | 'gitAhead'
  | 'gitBehind'
  | 'gitStashCount'
  | 'gitState'
  | 'gitDetached'
  | 'gitRepoKey'
  | 'gitIsWorktree'
  | 'gitCommonDir'
> {
  return {
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
    gitIsWorktree: false,
    gitCommonDir: null,
  };
}

export function createLifecycleHandlers(
  state: AggregateViewState,
  setState: SetStoreFunction<AggregateViewState>,
  deps: LifecycleHandlerDeps
) {
  const { resolvePtyOwnership } = deps;

  const gitCache = getGlobalGitMetadataCache({
    fetchGitInfo: (cwd) => getGitInfo(cwd, { force: false }),
    fetchDiffStats: getGitDiffStats,
  });

  const getSessionMetadata = (sessionId: string): SessionMetadata | undefined => {
    return state.allSessions.get(sessionId);
  };

  const findMatchingPendingInsertion = (
    aggregateState: AggregateViewState,
    params: { ptyId: string; sessionId?: string | null; paneId?: string | null }
  ): PendingPaneCreation | null => {
    return findPendingPaneCreationForLifecycle(aggregateState, params);
  };

  const removeMatchingPendingInsertions = (
    aggregateState: AggregateViewState,
    params: { ptyId: string; sessionId?: string | null; paneId?: string | null }
  ): void => {
    const matchingInsertion = findMatchingPendingInsertion(aggregateState, params);
    if (matchingInsertion) {
      removePendingPaneCreations(
        aggregateState,
        (insertion) => insertion.id === matchingInsertion.id
      );
      return;
    }

    removePendingPaneCreations(
      aggregateState,
      (insertion) =>
        insertion.pendingPtyId === params.ptyId ||
        (!!params.paneId && insertion.pendingPaneId === params.paneId)
    );
  };

  /**
   * Phase 1: Insert an optimistic placeholder row for a newly created PTY.
   * Either replaces an existing saved-row for the same pane, or pushes
   * a new `...` placeholder. Also claims matching pending insertions.
   *
   * IMPORTANT: This function requires a known sessionId. When ownership is
   * null (lifecycle event arrived before createPTY set the mappings), the
   * caller must NOT invoke this function — return early and let the next
   * snapshot refresh populate the entry correctly instead.
   */
  const insertPlaceholderRow = (ptyId: string, ownership: PtyOwnership): void => {
    setState(
      produce((s) => {
        if (s.deletedPtyIds.has(ptyId)) {
          return;
        }

        // Skip if already tracked — avoids duplicates from concurrent
        // lifecycle events + snapshot refreshes.
        if (s.allPtysIndex.has(ptyId)) {
          // Still mark as pending so applySnapshot preserves the entry
          s.pendingPtyIds.add(ptyId);
          return;
        }

        const pendingInsertion = findMatchingPendingInsertion(s, {
          ptyId,
          sessionId: ownership.sessionId,
          paneId: ownership.paneId,
        });
        const claimedSessionId = pendingInsertion?.sessionId ?? ownership.sessionId;
        const claimedPaneId = pendingInsertion?.pendingPaneId ?? ownership.paneId;

        if (pendingInsertion) {
          pendingInsertion.pendingPtyId = ptyId;
          if (claimedPaneId && !pendingInsertion.pendingPaneId) {
            pendingInsertion.pendingPaneId = claimedPaneId;
          }
        }

        // Ownership is required — without a sessionId and paneId we cannot
        // create a valid placeholder that deduplication can merge later.
        if (!claimedSessionId || !claimedPaneId) {
          return;
        }

        s.pendingPtyIds.add(ptyId);

        const sortOrderHint = pendingInsertion
          ? (pendingInsertion.sortOrderHint ??
            (claimedPaneId
              ? s.sessionPaneOrderIndex.get(getSessionPaneOrderKey(claimedSessionId, claimedPaneId))
              : undefined) ??
            getPendingInsertionOrder(s, pendingInsertion))
          : undefined;
        const existingPaneIndex = findAggregatePtyIndexByPane(
          s.allPtys,
          claimedSessionId,
          claimedPaneId
        );
        if (existingPaneIndex !== -1 && s.allPtys[existingPaneIndex]) {
          const existingPanePty = s.allPtys[existingPaneIndex];
          clonePtyStdoutActivity(existingPanePty.ptyId, ptyId);

          if (claimedPaneId && sortOrderHint !== undefined) {
            stampSortOrderHintIntoPaneIndex(s, claimedSessionId, claimedPaneId, sortOrderHint);
          }

          s.allPtys[existingPaneIndex] = {
            ...existingPanePty,
            ptyId,
            paneId: claimedPaneId,
            sessionId: claimedSessionId,
            sessionMetadata: s.allSessions.get(claimedSessionId),
            workspaceId: existingPanePty.workspaceId ?? ownership.workspaceId,
            sortOrderHint: sortOrderHint ?? existingPanePty.sortOrderHint,
          };
          s.allPtysIndex = buildPtyIndex(s.allPtys);
          recomputeMatches(s);
          recomputeTree(s);
          return;
        }

        // Cross-session pane search: the exact (sessionId, paneId) lookup
        // failed. Check if a STALE entry for this pane exists under a
        // different session (e.g., from a wrong-sessionId placeholder that
        // was inserted before ownership was resolved). If found, replace it
        // with the correct-session entry instead of pushing a duplicate.
        if (claimedPaneId) {
          const staleIndex = s.allPtys.findIndex(
            (p) =>
              p.paneId === claimedPaneId &&
              p.sessionId !== claimedSessionId &&
              !isSavedAggregatePtyId(p.ptyId)
          );
          if (staleIndex !== -1 && s.allPtys[staleIndex]) {
            const stalePty = s.allPtys[staleIndex];
            clonePtyStdoutActivity(stalePty.ptyId, ptyId);

            // Clean up the stale ptyId from tracking sets
            s.pendingPtyIds.delete(stalePty.ptyId);
            s.recentlyAddedPtyIds.delete(stalePty.ptyId);

            if (claimedPaneId && sortOrderHint !== undefined) {
              stampSortOrderHintIntoPaneIndex(s, claimedSessionId, claimedPaneId, sortOrderHint);
            }

            s.allPtys[staleIndex] = {
              ...stalePty,
              ptyId,
              paneId: claimedPaneId,
              sessionId: claimedSessionId,
              sessionMetadata: s.allSessions.get(claimedSessionId),
              workspaceId: stalePty.workspaceId ?? ownership.workspaceId,
              sortOrderHint: sortOrderHint ?? stalePty.sortOrderHint,
            };
            s.allPtysIndex = buildPtyIndex(s.allPtys);
            recomputeMatches(s);
            recomputeTree(s);
            return;
          }
        }

        const placeholderPty: PtyInfo = {
          ptyId,
          sortOrderHint,
          cwd: '',
          ...getEmptyGitFields(),
          foregroundProcess: undefined,
          shell: 'shell',
          title: '...',
          workspaceId: ownership.workspaceId,
          paneId: claimedPaneId,
          sessionId: claimedSessionId,
          sessionMetadata: s.allSessions.get(claimedSessionId),
        };

        if (claimedPaneId && sortOrderHint !== undefined) {
          stampSortOrderHintIntoPaneIndex(s, claimedSessionId, claimedPaneId, sortOrderHint);
        }

        const newIndex = s.allPtys.length;
        s.allPtys.push(placeholderPty);
        s.allPtysIndex.set(ptyId, newIndex);

        recomputeMatches(s);
        recomputeTree(s);
      })
    );
  };

  /**
   * Phase 2: Stamp ownership metadata onto an existing placeholder row.
   * Fills in sessionId, sessionMetadata, workspaceId, paneId, and
   * pending-insertion sort order now that ownership is resolved.
   */
  const stampOwnershipOnPlaceholder = (ptyId: string, ownership: PtyOwnership): void => {
    const sessionMetadata = getSessionMetadata(ownership.sessionId);
    setState(
      produce((s) => {
        const placeholderIndex = s.allPtysIndex.get(ptyId);
        if (placeholderIndex === undefined || !s.allPtys[placeholderIndex]) {
          return;
        }

        const pendingInsertion = findMatchingPendingInsertion(s, {
          ptyId,
          sessionId: ownership.sessionId,
          paneId: ownership.paneId,
        });
        const sortOrderHint = pendingInsertion
          ? (pendingInsertion.sortOrderHint ??
            (ownership.paneId
              ? s.sessionPaneOrderIndex.get(
                  getSessionPaneOrderKey(ownership.sessionId, ownership.paneId)
                )
              : undefined) ??
            getPendingInsertionOrder(s, pendingInsertion))
          : s.allPtys[placeholderIndex].sortOrderHint;
        const resolvedPaneId = s.allPtys[placeholderIndex].paneId ?? ownership.paneId;

        // Stamp the sortOrderHint into the sessionPaneOrderIndex so that
        // sortPtysForSession uses the correct (adjacent) position for the pane.
        if (resolvedPaneId && sortOrderHint !== undefined) {
          stampSortOrderHintIntoPaneIndex(s, ownership.sessionId, resolvedPaneId, sortOrderHint);
        }

        s.allPtys[placeholderIndex] = {
          ...s.allPtys[placeholderIndex],
          sessionId: ownership.sessionId,
          sessionMetadata,
          workspaceId: s.allPtys[placeholderIndex].workspaceId ?? ownership.workspaceId,
          paneId: resolvedPaneId,
          sortOrderHint,
        };
        recomputeMatches(s);
        recomputeTree(s);
      })
    );
  };

  /**
   * Phase 3: Hydrate a placeholder row with live PTY metadata and git data.
   * Replaces the `...` title with the real cwd, title, process, etc.
   * If the PTY was deleted or un-pending in the meantime, removes the row.
   */
  const hydratePlaceholderRow = async (ptyId: string, ownership: PtyOwnership): Promise<void> => {
    const sessionMetadata = getSessionMetadata(ownership.sessionId);

    const metadataResult = await getPtyMetadata(ptyId, { skipGitDiffStats: true }).catch(
      (cause) =>
        new PtyMetadataError({
          operation: 'get',
          ptyId,
          reason: String(cause),
        })
    );
    if (!metadataResult || metadataResult instanceof Error) {
      setState(
        produce((s) => {
          s.pendingPtyIds.delete(ptyId);
          removeMatchingPendingInsertions(s, {
            ptyId,
            sessionId: ownership.sessionId,
            paneId: ownership.paneId,
          });
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
        })
      );
      return;
    }

    const gitMetadata = await gitCache.getMetadata(metadataResult.cwd);
    const basePty = ptyMetadataToInfo({
      ...metadataResult,
      sessionId: ownership.sessionId,
      sessionMetadata,
    });
    const hydratedPty = applyGitMetadataSnapshot(basePty, gitMetadata);
    const newPty: PtyInfo = {
      ...hydratedPty,
      workspaceId: ownership.workspaceId ?? hydratedPty.workspaceId,
      paneId: ownership.paneId ?? hydratedPty.paneId,
      sessionId: ownership.sessionId,
      sessionMetadata,
    };

    setState(
      produce((s) => {
        if (!s.pendingPtyIds.has(ptyId) || s.deletedPtyIds.has(ptyId)) {
          s.pendingPtyIds.delete(ptyId);

          const placeholderIndex = s.allPtysIndex.get(ptyId);
          if (placeholderIndex !== undefined) {
            s.allPtys.splice(placeholderIndex, 1);
            s.allPtysIndex = buildPtyIndex(s.allPtys);
            recomputeMatches(s);
            recomputeTree(s);
          }

          removeMatchingPendingInsertions(s, {
            ptyId,
            sessionId: ownership.sessionId,
            paneId: ownership.paneId,
          });

          return;
        }

        const existingIndex = s.allPtysIndex.get(ptyId);
        const existingPty = existingIndex !== undefined ? s.allPtys[existingIndex] : undefined;
        const nextPty: PtyInfo = {
          ...newPty,
          sortOrderHint: existingPty?.sortOrderHint,
          // Preserve git metadata from the placeholder to prevent flicker.
          // The placeholder may have inherited git metadata from a saved-row
          // that was replaced during insertPlaceholderRow. If the hydrated
          // metadata doesn't have git data (e.g. cache miss), the preserved
          // metadata is kept as a visual placeholder until the next refresh.
          ...(newPty.gitBranch === undefined && existingPty?.gitBranch !== undefined
            ? {
                gitBranch: existingPty.gitBranch,
                gitDiffStats:
                  newPty.gitDiffStats === undefined
                    ? existingPty.gitDiffStats
                    : newPty.gitDiffStats,
                gitDirty: existingPty.gitDirty,
                gitStaged: existingPty.gitStaged,
                gitUnstaged: existingPty.gitUnstaged,
                gitUntracked: existingPty.gitUntracked,
                gitConflicted: existingPty.gitConflicted,
                gitAhead: existingPty.gitAhead,
                gitBehind: existingPty.gitBehind,
                gitStashCount: existingPty.gitStashCount,
                gitState: existingPty.gitState,
                gitDetached: existingPty.gitDetached,
                gitRepoKey: existingPty.gitRepoKey,
                gitIsWorktree: existingPty.gitIsWorktree,
                gitCommonDir: existingPty.gitCommonDir,
              }
            : {}),
        };

        if (existingIndex !== undefined) {
          s.allPtys[existingIndex] = nextPty;
        } else {
          // The placeholder was replaced by applySnapshot (e.g., a saved: entry
          // for the same pane was preferred by dedupeAggregatePtysByPane).
          // Try to find the entry by pane key and update it instead of pushing
          // a duplicate. This is a safety net — the pendingPtyIds cleanup in
          // applySnapshot should prevent us from reaching this branch, but we
          // guard against it anyway.
          const paneKeyIndex = nextPty.paneId
            ? findAggregatePtyIndexByPane(s.allPtys, ownership.sessionId, nextPty.paneId)
            : -1;
          if (paneKeyIndex !== -1 && s.allPtys[paneKeyIndex]) {
            // Replace the saved: entry with the hydrated live entry
            s.allPtys[paneKeyIndex] = {
              ...s.allPtys[paneKeyIndex],
              ...nextPty,
              // Keep the existing sortOrderHint if the hydrated entry doesn't have one
              sortOrderHint: nextPty.sortOrderHint ?? s.allPtys[paneKeyIndex].sortOrderHint,
            };
            s.allPtysIndex = buildPtyIndex(s.allPtys);
          }
          // Do NOT push a new entry — the PTY is already represented.
          // The next refreshPtys() will update the entry with fresh metadata.
        }

        if (nextPty.paneId) {
          clonePtyStdoutActivity(
            getSavedAggregatePtyId(ownership.sessionId, nextPty.paneId),
            ptyId
          );
        }

        const pendingInsertion = findMatchingPendingInsertion(s, {
          ptyId,
          sessionId: ownership.sessionId,
          paneId: nextPty.paneId,
        });
        if (pendingInsertion && nextPty.paneId) {
          const existingPaneOrder = s.sessionPaneOrderIndex.get(
            getSessionPaneOrderKey(ownership.sessionId, nextPty.paneId)
          );
          // Use the explicit sortOrderHint if set, or the existing pane order
          // if it was already stamped by Phase 1/2. Avoid recomputing via
          // getInsertedPaneOrder which would produce a wrong midpoint when
          // the pane is already in the sessionPaneOrderIndex.
          const newOrder =
            pendingInsertion.sortOrderHint ??
            existingPaneOrder ??
            getPendingInsertionOrder(s, pendingInsertion);

          const sessionPaneOrder = buildSessionPaneOrderFromState(s, ownership.sessionId);
          sessionPaneOrder.set(nextPty.paneId, newOrder);
          setSessionPaneOrder(s.sessionPaneOrderIndex, ownership.sessionId, sessionPaneOrder);
          const nextIndex = s.allPtysIndex.get(ptyId);
          if (nextIndex !== undefined && s.allPtys[nextIndex]) {
            s.allPtys[nextIndex] = {
              ...s.allPtys[nextIndex],
              sortOrderHint: newOrder,
            };
          }
          removePendingPaneCreations(s, (insertion) => insertion.id === pendingInsertion.id);
        }

        s.pendingPtyIds.delete(ptyId);
        s.recentlyAddedPtyIds.add(ptyId);
        setTimeout(() => {
          setState(
            produce((s2) => {
              s2.recentlyAddedPtyIds.delete(ptyId);
            })
          );
        }, 5000);

        const loadState = s.sessionLoadStates.get(ownership.sessionId);
        if (loadState && loadState.status !== 'loaded') {
          s.sessionLoadStates.set(ownership.sessionId, {
            ...loadState,
            status: 'loaded',
            paneCount: (loadState.paneCount ?? 0) + 1,
          });
        }

        s.allPtys = dedupeAggregatePtysByPane(s.allPtys);
        s.allPtysIndex = buildPtyIndex(s.allPtys);

        const sessionPtyCount = s.allPtys.filter(
          (pty) => pty.sessionId === ownership.sessionId
        ).length;
        if (sessionPtyCount === 1) {
          s.expandedSessionIds.add(ownership.sessionId);
        }

        recomputeMatches(s);
        recomputeTree(s);
      })
    );
  };

  const MAX_OWNERSHIP_RETRIES = 5;
  const MAX_SESSION_METADATA_RETRIES = 5;

  const handlePtyCreated = async (ptyId: string, retryCount = 0): Promise<void> => {
    if (state.deletedPtyIds.has(ptyId)) {
      return;
    }

    const ownership = resolvePtyOwnership(ptyId);

    // When ownership is unknown, do NOT create any placeholder row.
    // The lifecycle event fires as a microtask BEFORE createPTY's
    // continuation sets aggregateSessionMappings/ptyToSessionMap, so
    // on the first call both trackedOwner and aggregateOwner are null.
    // Creating a placeholder with wrong/missing sessionId produces
    // entries that dedupeAggregatePtysByPane cannot merge, causing
    // duplication. Instead, return and let the next snapshot refresh
    // (refreshPtys) populate the entry correctly. The snapshot uses
    // getCurrentSessionPtys which reads from the layout directly.
    if (!ownership) {
      // Only retry if we haven't exceeded the limit. The first retry
      // uses queueMicrotask to run right after createPTY's continuation
      // sets the mappings. Subsequent retries use exponential backoff.
      if (retryCount < MAX_OWNERSHIP_RETRIES) {
        if (retryCount === 0) {
          queueMicrotask(() => void handlePtyCreated(ptyId, 1));
        } else {
          const delay = Math.min(50 * Math.pow(2, retryCount), 500);
          setTimeout(() => void handlePtyCreated(ptyId, retryCount + 1), delay);
        }
      }
      return;
    }

    // Phase 1: insert optimistic placeholder (ownership is known)
    insertPlaceholderRow(ptyId, ownership);

    const sessionMetadata = getSessionMetadata(ownership.sessionId);
    if (!sessionMetadata) {
      if (retryCount < MAX_SESSION_METADATA_RETRIES) {
        const delay = Math.min(50 * Math.pow(2, retryCount), 500);
        setTimeout(() => void handlePtyCreated(ptyId, retryCount + 1), delay);
        return;
      }
      setState(
        produce((s) => {
          s.pendingPtyIds.delete(ptyId);
          removeMatchingPendingInsertions(s, {
            ptyId,
            sessionId: ownership.sessionId,
            paneId: ownership.paneId,
          });
        })
      );
      return;
    }

    // Phase 2b: stamp ownership metadata onto the placeholder
    stampOwnershipOnPlaceholder(ptyId, ownership);

    // Phase 3: hydrate with live metadata
    await hydratePlaceholderRow(ptyId, ownership);
  };

  const handlePtyDestroyed = (ptyId: string): void => {
    setState(
      produce((s) => {
        s.deletedPtyIds.add(ptyId);
        removeAggregateSessionMappingForPty(ptyId);
        s.pendingPtyIds.delete(ptyId);
        s.recentlyAddedPtyIds.delete(ptyId);

        const index = s.allPtysIndex.get(ptyId);
        if (index === undefined) return;

        const pty = s.allPtys[index];
        if (!pty) return;

        removePendingPaneCreations(
          s,
          (insertion) =>
            insertion.pendingPtyId === ptyId ||
            insertion.insertAfterPtyId === ptyId ||
            (!!pty.paneId && insertion.pendingPaneId === pty.paneId)
        );

        const sessionId = pty.sessionId;
        const removedFlattenedIndex = s.flattenedTreeIndex.get(ptyId);

        s.allPtys.splice(index, 1);
        s.allPtysIndex = buildPtyIndex(s.allPtys);

        const loadState = s.sessionLoadStates.get(sessionId);
        if (loadState) {
          const newPaneCount = Math.max(0, (loadState.paneCount ?? 1) - 1);
          s.sessionLoadStates.set(sessionId, {
            ...loadState,
            paneCount: newPaneCount,
          });
        }

        if (s.selectedPtyId === ptyId && removedFlattenedIndex !== undefined) {
          const findNearestSelectable = (
            startIndex: number,
            direction: 'up' | 'down'
          ): { index: number; item: (typeof s.flattenedTree)[number] } | null => {
            const delta = direction === 'up' ? -1 : 1;
            let selectionIndex = startIndex + delta;

            while (selectionIndex >= 0 && selectionIndex < s.flattenedTree.length) {
              const item = s.flattenedTree[selectionIndex];
              if (item && item.node.type !== 'spacer') {
                return { index: selectionIndex, item };
              }
              selectionIndex += delta;
            }

            return null;
          };

          const findNearestPtyInSessionAbove = (
            startIndex: number,
            currentSessionId: string
          ): number | null => {
            for (let selectionIndex = startIndex - 1; selectionIndex >= 0; selectionIndex--) {
              const item = s.flattenedTree[selectionIndex];
              if (item?.node.type === 'session') {
                break;
              }
              if (item?.node.type === 'pty' && item.parentSessionId === currentSessionId) {
                return selectionIndex;
              }
            }

            return null;
          };

          const findSessionHeader = (
            startIndex: number,
            currentSessionId: string
          ): number | null => {
            for (let selectionIndex = startIndex - 1; selectionIndex >= 0; selectionIndex--) {
              const item = s.flattenedTree[selectionIndex];
              if (item?.node.type === 'session' && item.node.session.id === currentSessionId) {
                return selectionIndex;
              }
            }

            return null;
          };

          const replacementIndex =
            findNearestSelectable(removedFlattenedIndex, 'down')?.index ??
            findNearestPtyInSessionAbove(removedFlattenedIndex, sessionId) ??
            findSessionHeader(removedFlattenedIndex, sessionId) ??
            findNearestSelectable(removedFlattenedIndex, 'up')?.index ??
            null;

          if (replacementIndex !== null) {
            const newSelection = s.flattenedTree[replacementIndex];
            s.selectedIndex = replacementIndex;
            s.selectedPtyId =
              newSelection?.node.type === 'pty' ? newSelection.node.ptyInfo.ptyId : null;
            s.selectedSessionId =
              newSelection?.node.type === 'session'
                ? newSelection.node.session.id
                : (newSelection?.parentSessionId ?? null);
            if (s.selectedPtyId === null) {
              clearPreviewState(s);
            }
          } else {
            s.selectedPtyId = null;
            s.selectedSessionId = null;
            s.selectedIndex = 0;
            clearPreviewState(s);
          }
        }

        recomputeMatches(s);
        recomputeTree(s);
      })
    );
  };

  return { handlePtyCreated, handlePtyDestroyed };
}

export interface TitleChangeEvent {
  ptyId: string;
  title: string;
}

export function createTitleChangeHandler(
  setState: SetStoreFunction<AggregateViewState>
): (event: TitleChangeEvent) => void {
  return (event: TitleChangeEvent) => {
    setState(
      produce((s) => {
        const allIndex = s.allPtysIndex.get(event.ptyId);
        if (allIndex !== undefined && s.allPtys[allIndex]) {
          const ptyAtIndex = s.allPtys[allIndex];
          if (ptyAtIndex.ptyId === event.ptyId) {
            s.allPtys[allIndex] = { ...ptyAtIndex, title: event.title };
          }
        }

        const matchedIndex = s.matchedPtysIndex.get(event.ptyId);
        if (matchedIndex !== undefined && s.matchedPtys[matchedIndex]) {
          const ptyAtIndex = s.matchedPtys[matchedIndex];
          if (ptyAtIndex.ptyId === event.ptyId) {
            s.matchedPtys[matchedIndex] = { ...ptyAtIndex, title: event.title };
          }
        }
      })
    );
  };
}

export interface ProcessChangeEvent {
  ptyId: string;
  processName: string;
}

export function createProcessChangeHandler(
  setState: SetStoreFunction<AggregateViewState>
): (event: ProcessChangeEvent) => void {
  return (event: ProcessChangeEvent) => {
    setState(
      produce((s) => {
        const allIndex = s.allPtysIndex.get(event.ptyId);
        if (allIndex !== undefined && s.allPtys[allIndex]) {
          const ptyAtIndex = s.allPtys[allIndex];
          if (ptyAtIndex.ptyId === event.ptyId) {
            s.allPtys[allIndex] = { ...ptyAtIndex, foregroundProcess: event.processName };
          }
        }

        const matchedIndex = s.matchedPtysIndex.get(event.ptyId);
        if (matchedIndex !== undefined && s.matchedPtys[matchedIndex]) {
          const ptyAtIndex = s.matchedPtys[matchedIndex];
          if (ptyAtIndex.ptyId === event.ptyId) {
            s.matchedPtys[matchedIndex] = { ...ptyAtIndex, foregroundProcess: event.processName };
          }
        }
      })
    );
  };
}

export async function setupSubscriptions(
  state: AggregateViewState,
  deps: SubscriptionSetupDeps
): Promise<void> {
  const { subscriptions, subscriptionsEpoch, handleTitleChange, lifecycleHandlers } = deps;

  const refreshPtys = deps.refreshPtys;

  const epoch = ++subscriptionsEpoch.value;

  const lifecycleStream = streamFromSubscription<{ type: 'created' | 'destroyed'; ptyId: string }>(
    ({ emit }) => subscribeToPtyLifecycle(emit)
  );

  const lifecycleUnsub = runStream(
    tap(lifecycleStream, (event) => {
      if (event.type === 'created') {
        void lifecycleHandlers.handlePtyCreated(event.ptyId);
        return;
      }
      lifecycleHandlers.handlePtyDestroyed(event.ptyId);
    }),
    { label: 'aggregate-view-lifecycle' }
  );

  if (epoch !== subscriptionsEpoch.value || !state.showAggregateView) {
    lifecycleUnsub();
    return;
  }
  subscriptions.lifecycle = lifecycleUnsub;

  const titleStream = tap(
    streamFromSubscription<PtyTitleChangeEvent>(({ emit }) => subscribeToAllTitleChanges(emit)),
    (event) => handleTitleChange(event)
  );
  const titleUnsub = runStream(titleStream, { label: 'aggregate-view-title' });

  if (epoch !== subscriptionsEpoch.value || !state.showAggregateView) {
    titleUnsub();
    return;
  }
  subscriptions.titleChange = titleUnsub;

  const processChangeStream = tap(
    streamFromSubscription<PtyForegroundProcessChangeEvent>(({ emit }) =>
      subscribeToForegroundProcessChanges(emit)
    ),
    (event) => deps.handleProcessChange(event)
  );
  const processChangeUnsub = runStream(processChangeStream, {
    label: 'aggregate-view-process-change',
  });

  if (epoch !== subscriptionsEpoch.value || !state.showAggregateView) {
    processChangeUnsub();
    return;
  }
  subscriptions.processChange = processChangeUnsub;

  const gitChangeUnsub = createGitRepoChangeRefresh(state, subscriptionsEpoch, epoch, refreshPtys);
  if (epoch !== subscriptionsEpoch.value || !state.showAggregateView) {
    gitChangeUnsub();
    return;
  }
  subscriptions.gitChanges = gitChangeUnsub;

  if (epoch !== subscriptionsEpoch.value || !state.showAggregateView) {
    return;
  }

  const activityUnsub = createActivityBasedRefresh(state, subscriptionsEpoch, epoch, refreshPtys);
  if (epoch !== subscriptionsEpoch.value || !state.showAggregateView) {
    activityUnsub();
    return;
  }
  subscriptions.polling = activityUnsub;
}

export function createGitRepoChangeRefresh(
  state: AggregateViewState,
  subscriptionsEpoch: { value: number },
  epoch: number,
  refreshPtys: () => Promise<void>
): () => void {
  return subscribeToGitRepoChanges((event) => {
    if (!state.showAggregateView || subscriptionsEpoch.value !== epoch) {
      return;
    }

    const affectedPtyIds = state.allPtys
      .filter((pty) => pty.gitRepoKey === event.repoKey)
      .map((pty) => pty.ptyId);

    if (affectedPtyIds.length === 0) {
      return;
    }

    void refreshPtys();
  });
}

export function createActivityBasedRefresh(
  state: AggregateViewState,
  subscriptionsEpoch: { value: number },
  epoch: number,
  refreshPtys: () => Promise<void>
): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const debounceMs = 500;

  const flushPending = async (): Promise<void> => {
    debounceTimer = null;

    if (!state.showAggregateView) return;
    if (subscriptionsEpoch.value !== epoch) return;

    await refreshPtys();
  };

  const scheduleFlush = (): void => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => void flushPending(), debounceMs);
  };

  const activityStream = streamFromSubscription<{ ptyId: string }>(({ emit }) =>
    subscribeToAllPtyActivity(emit)
  );

  const activityUnsub = runStream(
    tap(activityStream, () => {
      scheduleFlush();
    }),
    { label: 'aggregate-view-activity-refresh' }
  );

  return () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    activityUnsub();
  };
}

export function cleanupSubscriptions(
  subscriptions: SubscriptionManager,
  subscriptionsEpoch: { value: number }
): void {
  subscriptionsEpoch.value += 1;
  subscriptions.lifecycle?.();
  subscriptions.titleChange?.();
  subscriptions.processChange?.();
  subscriptions.gitChanges?.();
  subscriptions.polling?.();
  subscriptions.lifecycle = null;
  subscriptions.titleChange = null;
  subscriptions.processChange = null;
  subscriptions.gitChanges = null;
  subscriptions.polling = null;
}
