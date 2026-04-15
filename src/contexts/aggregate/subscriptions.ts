/**
 * Subscription management for Aggregate View.
 */

import { produce, type SetStoreFunction } from 'solid-js/store';

import { runStream, streamFromSubscription, tap } from '../../effect/stream-utils';
import {
  subscribeToAllPtyActivity,
  subscribeToAllTitleChanges,
  subscribeToForegroundProcessChanges,
  subscribeToPtyLifecycle,
  type PtyTitleChangeEvent,
  type PtyForegroundProcessChangeEvent,
} from '../../effect/bridge/pty-bridge';
import { removeAggregateSessionMappingForPty } from '../../effect/bridge/aggregate';
import { subscribeToGitRepoChanges } from '../../effect/services/pty/helpers';

import type { AggregateViewState, PendingPaneCreation, PtyInfo } from './types';
import { buildPtyIndex } from './filter';
import {
  findPendingPaneCreationForLifecycle,
  getAppendedPaneOrder,
  getInsertedPaneOrder,
  removePendingPaneCreations,
} from './pending';
import { clearPreviewState } from './selection';
import {
  buildSessionPaneOrderFromAggregateState,
  getSessionPaneOrder,
  setSessionPaneOrder,
  getPendingPaneOrderKey,
} from './pane-order';
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
  refreshPtys: () => Promise<void>;
  /** Fast refresh: only the active session, no git metadata.
   *  Used by handlePtyCreated to make new PTYs appear instantly. */
  refreshActiveSession: () => Promise<void | Error>;
}

function buildSessionPaneOrderFromState(
  state: Pick<AggregateViewState, 'allPtys' | 'sessionPaneOrderIndex'>,
  sessionId: string
): Map<string, number> {
  return buildSessionPaneOrderFromAggregateState(state, sessionId);
}
export function createLifecycleHandlers(
  state: AggregateViewState,
  setState: SetStoreFunction<AggregateViewState>,
  deps: LifecycleHandlerDeps
) {
  const { resolvePtyOwnership } = deps;

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
   * Handle PTY creation lifecycle event.
   *
   * Single-writer principle: do NOT insert into allPtys here.
   * Instead, clean up any pending pane creation that matches this PTY,
   * then trigger refreshPtys(). The snapshot will include the new PTY
   * via getCurrentSessionPtys (which reads from the layout), and
   * applySnapshot will write it to allPtys with the correct sessionId.
   *
   * This eliminates the race condition where the old 3-phase insert
   * (insertPlaceholderRow → stampOwnershipOnPlaceholder → hydratePlaceholderRow)
   * could write entries with wrong sessionIds due to stale ptyToSessionMap
   * or aggregateSessionMappings during rapid session switches.
   */
  const handlePtyCreated = async (ptyId: string): Promise<void> => {
    if (state.deletedPtyIds.has(ptyId)) {
      return;
    }

    // Clean up any pending pane creation that matches this PTY.
    // Before removing, stamp its sortOrderHint into sessionPaneOrderIndex
    // so that applySnapshot preserves the intended position.
    const ownership = resolvePtyOwnership(ptyId);
    if (ownership) {
      setState(
        produce((s) => {
          const matchingInsertion = findMatchingPendingInsertion(s, {
            ptyId,
            sessionId: ownership.sessionId,
            paneId: ownership.paneId,
          });

          if (matchingInsertion) {
            // Stamp sortOrderHint into sessionPaneOrderIndex before removing
            // the pending creation, so applySnapshot reads it from there.
            // Also migrate any synthetic pending key (__pending_<id>) to the
            // real paneId so the order survives applySnapshot's rebuild.
            if (matchingInsertion.sortOrderHint !== undefined) {
              const realPaneId = ownership.paneId ?? matchingInsertion.pendingPaneId;
              if (realPaneId) {
                const sessionPaneOrder = getSessionPaneOrder(
                  s.sessionPaneOrderIndex,
                  ownership.sessionId
                );
                sessionPaneOrder.set(realPaneId, matchingInsertion.sortOrderHint);
                // Remove the synthetic key if it was used before the real paneId was known.
                const pendingKey = getPendingPaneOrderKey(matchingInsertion.id);
                if (sessionPaneOrder.has(pendingKey)) {
                  sessionPaneOrder.delete(pendingKey);
                }
                setSessionPaneOrder(s.sessionPaneOrderIndex, ownership.sessionId, sessionPaneOrder);
              }
            }

            removePendingPaneCreations(s, (insertion) => insertion.id === matchingInsertion.id);
          } else {
            // Fallback: remove by ptyId/paneId match
            removePendingPaneCreations(
              s,
              (insertion) =>
                insertion.pendingPtyId === ptyId ||
                (!!ownership.paneId && insertion.pendingPaneId === ownership.paneId)
            );
          }
        })
      );
    }

    // Fast path: refresh only the active session without git metadata.
    // This makes the new PTY appear in allPtys almost instantly instead
    // of waiting for the full snapshot build (all sessions + git metadata).
    // A full refresh is scheduled in the background to hydrate the rest.
    await deps.refreshActiveSession();
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
