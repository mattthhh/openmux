/**
 * Subscription management for Aggregate View.
 */

import { produce, type SetStoreFunction } from 'solid-js/store';

import type { SessionMetadata } from '../../effect/models';
import { runStream, streamFromSubscription, tap } from '../../effect/stream-utils';
import {
  subscribeToAllPtyActivity,
  subscribeToAllTitleChanges,
  subscribeToPtyLifecycle,
  type PtyTitleChangeEvent,
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
import { buildSessionPaneOrderFromAggregateState, setSessionPaneOrder } from './pane-order';
import { dedupeAggregatePtysByPane, getSavedAggregatePtyId } from './rows';
import { recomputeMatches, recomputeTree } from './session';

export interface SubscriptionManager {
  lifecycle: (() => void) | null;
  titleChange: (() => void) | null;
  gitChanges: (() => void) | null;
  polling: (() => void) | null;
}

export interface RefreshState {
  refreshInProgress: boolean;
  subsetRefreshInProgress: boolean;
  pendingFullRefresh: boolean;
  pendingSubsetPtyIds: Set<string>;
}

export type RefreshFlagKey = 'refreshInProgress' | 'subsetRefreshInProgress';

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
  refreshPtysSubset: (ptyIds: string[]) => Promise<void>;
  handleTitleChange: TitleChangeHandler;
  lifecycleHandlers: LifecycleHandlers;
}

export function createSubscriptionManager(): SubscriptionManager {
  return {
    lifecycle: null,
    titleChange: null,
    gitChanges: null,
    polling: null,
  };
}

export function createRefreshState(): RefreshState {
  return {
    refreshInProgress: false,
    subsetRefreshInProgress: false,
    pendingFullRefresh: false,
    pendingSubsetPtyIds: new Set(),
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
  state: Pick<AggregateViewState, 'allPtys' | 'sessionPaneOrders' | 'sessionPaneOrderIndex'>,
  sessionId: string
): Map<string, number> {
  return buildSessionPaneOrderFromAggregateState(state, sessionId);
}

function getPendingInsertionOrder(
  state: Pick<AggregateViewState, 'allPtys' | 'sessionPaneOrders' | 'sessionPaneOrderIndex'>,
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

  const handlePtyCreated = async (ptyId: string, retryCount = 0): Promise<void> => {
    const initialOwnership = resolvePtyOwnership(ptyId);

    if (state.deletedPtyIds.has(ptyId) && retryCount === 0) {
      setTimeout(() => void handlePtyCreated(ptyId, retryCount), 100);
      return;
    }

    setState(
      produce((s) => {
        if (s.deletedPtyIds.has(ptyId)) {
          return;
        }

        s.pendingPtyIds.add(ptyId);

        if (retryCount === 0 && !s.allPtysIndex.has(ptyId)) {
          const pendingInsertion = findMatchingPendingInsertion(s, {
            ptyId,
            sessionId: initialOwnership?.sessionId,
            paneId: initialOwnership?.paneId,
          });
          const placeholderPty: PtyInfo = {
            ptyId,
            sortOrderHint: pendingInsertion
              ? getPendingInsertionOrder(s, pendingInsertion)
              : undefined,
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
            title: '...',
            workspaceId: undefined,
            paneId: undefined,
            sessionId: pendingInsertion?.sessionId ?? '',
            sessionMetadata: pendingInsertion?.sessionId
              ? s.allSessions.get(pendingInsertion.sessionId)
              : undefined,
          };

          const newIndex = s.allPtys.length;
          s.allPtys.push(placeholderPty);
          s.allPtysIndex.set(ptyId, newIndex);

          recomputeMatches(s);
          recomputeTree(s);
        }
      })
    );

    const ownership = initialOwnership ?? resolvePtyOwnership(ptyId);

    if (!ownership) {
      if (retryCount < 5) {
        const delay = Math.min(50 * Math.pow(2, retryCount), 500);
        setTimeout(() => void handlePtyCreated(ptyId, retryCount + 1), delay);
        return;
      }
      setState(
        produce((s) => {
          s.pendingPtyIds.delete(ptyId);
          const index = s.allPtysIndex.get(ptyId);
          if (index !== undefined && s.allPtys[index]?.title === '...') {
            s.allPtys[index] = { ...s.allPtys[index], title: 'error' };
            recomputeMatches(s);
            recomputeTree(s);
          }
        })
      );
      return;
    }

    const sessionMetadata = getSessionMetadata(ownership.sessionId);
    if (!sessionMetadata) {
      if (retryCount < 5) {
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
        s.allPtys[placeholderIndex] = {
          ...s.allPtys[placeholderIndex],
          sessionId: ownership.sessionId,
          sessionMetadata,
          workspaceId: s.allPtys[placeholderIndex].workspaceId ?? ownership.workspaceId,
          paneId: s.allPtys[placeholderIndex].paneId ?? ownership.paneId,
          sortOrderHint: pendingInsertion
            ? getPendingInsertionOrder(s, pendingInsertion)
            : s.allPtys[placeholderIndex].sortOrderHint,
        };
        recomputeMatches(s);
        recomputeTree(s);
      })
    );

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
        };

        if (existingIndex !== undefined) {
          s.allPtys[existingIndex] = nextPty;
        } else {
          const newIndex = s.allPtys.length;
          s.allPtys.push(nextPty);
          s.allPtysIndex.set(ptyId, newIndex);
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
          const sessionPaneOrder = buildSessionPaneOrderFromState(s, ownership.sessionId);
          const newOrder = getPendingInsertionOrder(s, pendingInsertion);

          sessionPaneOrder.set(nextPty.paneId, newOrder);
          s.sessionPaneOrders.set(ownership.sessionId, new Map(sessionPaneOrder));
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

export async function setupSubscriptions(
  state: AggregateViewState,
  deps: SubscriptionSetupDeps
): Promise<void> {
  const {
    subscriptions,
    subscriptionsEpoch,
    refreshPtysSubset,
    handleTitleChange,
    lifecycleHandlers,
  } = deps;

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

  const gitChangeUnsub = createGitRepoChangeRefresh(
    state,
    subscriptionsEpoch,
    epoch,
    refreshPtysSubset
  );
  if (epoch !== subscriptionsEpoch.value || !state.showAggregateView) {
    gitChangeUnsub();
    return;
  }
  subscriptions.gitChanges = gitChangeUnsub;

  if (epoch !== subscriptionsEpoch.value || !state.showAggregateView) {
    return;
  }

  const activityUnsub = createActivityBasedRefresh(
    state,
    subscriptionsEpoch,
    epoch,
    refreshPtysSubset
  );
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
  refreshPtysSubset: (ptyIds: string[]) => Promise<void>
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

    void refreshPtysSubset(affectedPtyIds);
  });
}

export function createActivityBasedRefresh(
  state: AggregateViewState,
  subscriptionsEpoch: { value: number },
  epoch: number,
  refreshPtysSubset: (ptyIds: string[]) => Promise<void>
): () => void {
  const pendingPtyIds = new Set<string>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const debounceMs = 500;

  const flushPending = async (): Promise<void> => {
    debounceTimer = null;

    if (!state.showAggregateView || pendingPtyIds.size === 0) return;

    const ptyIdsToRefresh = Array.from(pendingPtyIds);
    pendingPtyIds.clear();

    if (subscriptionsEpoch.value !== epoch) return;

    await refreshPtysSubset(ptyIdsToRefresh);
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
    tap(activityStream, (event) => {
      if (!state.allPtysIndex.has(event.ptyId)) return;

      pendingPtyIds.add(event.ptyId);
      scheduleFlush();
    }),
    { label: 'aggregate-view-activity-refresh' }
  );

  return () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    pendingPtyIds.clear();
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
  subscriptions.gitChanges?.();
  subscriptions.polling?.();
  subscriptions.lifecycle = null;
  subscriptions.titleChange = null;
  subscriptions.gitChanges = null;
  subscriptions.polling = null;
}
