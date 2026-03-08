/**
 * Subscription management for AggregateViewContext.
 */

import { produce, type SetStoreFunction } from 'solid-js/store';
import type { PtyInfo, AggregateViewState } from './aggregate-view-types';
import type { SessionMetadata, SerializedLayoutNode, SerializedSession } from '../effect/models';
import {
  buildPtyIndex,
  recomputeMatches,
  recomputeTree,
} from './aggregate-view-helpers';
import { runStream, streamFromSubscription, debounce, tap, repeatWithInterval } from '../effect/stream-utils';
import {
  listSessionsResult,
  getSessionSummaryResult,
  loadSession,
} from '../effect/bridge/session-bridge';
import {
  listAllPtysWithMetadata,
  getPtyMetadata,
  getAggregateSessionPtyMapping,
  type PtyMetadata,
} from '../effect/bridge/aggregate-bridge';
import {
  subscribeToPtyLifecycle,
  subscribeToAllTitleChanges,
  type PtyTitleChangeEvent,
} from '../effect/bridge/pty-bridge';
import {
  getGlobalGitMetadataCache,
  type GitRepoMetadata,
} from './git-metadata-cache';
import { getGitInfo, getGitDiffStats } from '../effect/services/pty/helpers';
import type { GitDiffStats } from './aggregate-view-types';
import type { GitInfo } from '../effect/services/pty/helpers';

export interface SubscriptionManager {
  lifecycle: (() => void) | null;
  titleChange: (() => void) | null;
  polling: (() => void) | null;
}

export interface RefreshState {
  refreshInProgress: boolean;
  subsetRefreshInProgress: boolean;
  pendingFullRefresh: boolean;
  pendingSubsetPtyIds: Set<string>;
}

type RefreshFlagKey = 'refreshInProgress' | 'subsetRefreshInProgress';

/** AsyncDisposable guard for refresh state flags */
class RefreshGuard implements AsyncDisposable {
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

export function createSubscriptionManager(): SubscriptionManager {
  return {
    lifecycle: null,
    titleChange: null,
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

/** Git metadata fields that can be applied to a PtyInfo */
interface GitMetadataFields {
  gitBranch: string | undefined;
  gitDiffStats: GitDiffStats | undefined;
  gitDirty: boolean;
  gitStaged: number;
  gitUnstaged: number;
  gitUntracked: number;
  gitConflicted: number;
  gitAhead: number | undefined;
  gitBehind: number | undefined;
  gitStashCount: number | undefined;
  gitState: GitInfo["state"] | undefined;
  gitDetached: boolean;
  gitRepoKey: string | undefined;
}

/** Extract git metadata fields from GitRepoMetadata */
function extractGitMetadata(metadata: GitRepoMetadata | undefined): GitMetadataFields {
  if (!metadata) {
    return {
      gitBranch: undefined,
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
      gitDiffStats: undefined,
    };
  }

  return {
    gitBranch: metadata.branch,
    gitDirty: metadata.dirty,
    gitStaged: metadata.staged,
    gitUnstaged: metadata.unstaged,
    gitUntracked: metadata.untracked,
    gitConflicted: metadata.conflicted,
    gitAhead: metadata.ahead,
    gitBehind: metadata.behind,
    gitStashCount: metadata.stashCount,
    gitState: metadata.state,
    gitDetached: metadata.detached,
    gitRepoKey: metadata.repoKey,
    gitDiffStats: metadata.diffStats,
  };
}

interface AggregatePtyMetadata extends PtyMetadata {
  sessionId?: string;
  sessionMetadata?: SessionMetadata;
}

function areGitDiffStatsEqual(
  a: GitDiffStats | undefined,
  b: GitDiffStats | undefined
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.added === b.added && a.removed === b.removed && a.binary === b.binary;
}

export function didPtyInfoChange(prev: PtyInfo, next: PtyInfo): boolean {
  return (
    prev.cwd !== next.cwd ||
    prev.foregroundProcess !== next.foregroundProcess ||
    prev.shell !== next.shell ||
    prev.title !== next.title ||
    prev.workspaceId !== next.workspaceId ||
    prev.paneId !== next.paneId ||
    prev.gitBranch !== next.gitBranch ||
    prev.gitDirty !== next.gitDirty ||
    prev.gitStaged !== next.gitStaged ||
    prev.gitUnstaged !== next.gitUnstaged ||
    prev.gitUntracked !== next.gitUntracked ||
    prev.gitConflicted !== next.gitConflicted ||
    prev.gitAhead !== next.gitAhead ||
    prev.gitBehind !== next.gitBehind ||
    prev.gitStashCount !== next.gitStashCount ||
    prev.gitState !== next.gitState ||
    prev.gitDetached !== next.gitDetached ||
    prev.gitRepoKey !== next.gitRepoKey ||
    !areGitDiffStatsEqual(prev.gitDiffStats, next.gitDiffStats)
  );
}

/** Convert PtyMetadata from bridge to PtyInfo for state */
function ptyMetadataToInfo(metadata: AggregatePtyMetadata, existing?: PtyInfo): PtyInfo {
  return {
    ptyId: metadata.ptyId,
    cwd: metadata.cwd,
    gitBranch: metadata.gitBranch,
    gitDiffStats: metadata.gitDiffStats,
    gitDirty: metadata.gitDirty,
    gitStaged: metadata.gitStaged,
    gitUnstaged: metadata.gitUnstaged,
    gitUntracked: metadata.gitUntracked,
    gitConflicted: metadata.gitConflicted,
    gitAhead: metadata.gitAhead,
    gitBehind: metadata.gitBehind,
    gitStashCount: metadata.gitStashCount,
    gitState: metadata.gitState,
    gitDetached: metadata.gitDetached,
    gitRepoKey: metadata.gitRepoKey,
    foregroundProcess: metadata.foregroundProcess,
    shell: metadata.shell,
    title: metadata.title,
    workspaceId: metadata.workspaceId,
    paneId: metadata.paneId,
    sessionId: metadata.sessionId ?? existing?.sessionId ?? 'unknown',
    sessionMetadata: metadata.sessionMetadata ?? existing?.sessionMetadata,
  };
}

function collectSerializedPaneIds(node: SerializedLayoutNode | null | undefined, result: string[]): void {
  if (!node) return;
  if ('type' in node && node.type === 'split') {
    collectSerializedPaneIds(node.first, result);
    collectSerializedPaneIds(node.second, result);
    return;
  }
  result.push(node.id);
}

function buildSessionPaneOrder(session: SerializedSession): Map<string, number> {
  const paneIds: string[] = [];

  for (const workspace of session.workspaces) {
    collectSerializedPaneIds(workspace.mainPane, paneIds);
    for (const pane of workspace.stackPanes) {
      collectSerializedPaneIds(pane, paneIds);
    }
  }

  return new Map(paneIds.map((paneId, index) => [paneId, index] as const));
}

function findWorkspaceIdForPane(session: SerializedSession, paneId: string): number | undefined {
  const containsPane = (node: SerializedLayoutNode | null | undefined): boolean => {
    if (!node) return false;
    if ('type' in node && node.type === 'split') {
      return containsPane(node.first) || containsPane(node.second);
    }
    return node.id === paneId;
  };

  for (const workspace of session.workspaces) {
    if (containsPane(workspace.mainPane)) {
      return workspace.id;
    }
    for (const pane of workspace.stackPanes) {
      if (containsPane(pane)) {
        return workspace.id;
      }
    }
  }

  return undefined;
}

export interface PtyOwnership {
  sessionId: string;
  paneId?: string;
  workspaceId?: number;
}

export function createAggregateViewRefreshers(
  state: AggregateViewState,
  setState: SetStoreFunction<AggregateViewState>,
  refreshState: RefreshState,
  resolvePtyOwnership: (ptyId: string) => PtyOwnership | null,
  getCurrentSessionHints: () => { sessionId: string | null; lastActiveWorkspaceId?: number; focusedPaneId?: string },
  getCurrentSessionPaneOrder: () => Map<string, number> | null
) {
  const gitCache = getGlobalGitMetadataCache({
    fetchGitInfo: (cwd) => getGitInfo(cwd, { force: true }),
    fetchDiffStats: getGitDiffStats,
  });

  const refreshPtysOnce = async (): Promise<void | Error> => {
    setState('isLoading', true);

    try {
      const sessionsResult = await listSessionsResult();
      if (sessionsResult instanceof Error) {
        return sessionsResult;
      }
      const sessions = [...sessionsResult];

      const livePtysResult = await listAllPtysWithMetadata({ skipGitDiffStats: true });
      if (livePtysResult instanceof Error) {
        return livePtysResult;
      }
      const livePtys = livePtysResult;

      const sessionMetadataById = new Map<string, SessionMetadata>(
        sessions.map((session) => [String(session.id), session])
      );

      const summaryEntries = await Promise.all(
        sessions.map(async (session) => {
          const summaryResult = await getSessionSummaryResult(String(session.id));
          return [
            String(session.id),
            summaryResult instanceof Error ? null : summaryResult,
          ] as const;
        })
      );
      const summaryBySessionId = new Map<string, { workspaceCount: number; paneCount: number } | null>(summaryEntries);

      const sessionDetailsEntries = await Promise.all(
        sessions.map(async (session) => [String(session.id), await loadSession(String(session.id))] as const)
      );
      const sessionDetailsById = new Map(sessionDetailsEntries);

      const sessionPaneOrders = new Map<string, Map<string, number>>();
      for (const [sessionId, sessionDetails] of sessionDetailsEntries) {
        if (!(sessionDetails instanceof Error)) {
          sessionPaneOrders.set(sessionId, buildSessionPaneOrder(sessionDetails));
        }
      }

      const currentSessionHints = getCurrentSessionHints();
      const currentSessionPaneOrder = getCurrentSessionPaneOrder();
      if (currentSessionHints.sessionId && currentSessionPaneOrder) {
        sessionPaneOrders.set(currentSessionHints.sessionId, currentSessionPaneOrder);
      }

      const sessionMappingEntries = await Promise.all(
        sessions.map(async (session) => [String(session.id), await getAggregateSessionPtyMapping(String(session.id))] as const)
      );
      const mappedOwnershipByPtyId = new Map<string, PtyOwnership>();
      for (const [sessionId, mappingInfo] of sessionMappingEntries) {
        if (!mappingInfo) continue;
        const sessionDetails = sessionDetailsById.get(sessionId);
        const detailValue = sessionDetails instanceof Error ? undefined : sessionDetails;
        for (const [paneId, ptyId] of mappingInfo.mapping) {
          mappedOwnershipByPtyId.set(ptyId, {
            sessionId,
            paneId,
            workspaceId: detailValue ? findWorkspaceIdForPane(detailValue, paneId) : undefined,
          });
        }
      }

      const resolvedPtys: Array<{
        metadata: AggregatePtyMetadata;
        ownership: PtyOwnership;
        sessionMetadata: SessionMetadata;
      }> = [];

      for (const metadata of livePtys) {
        const ownership = resolvePtyOwnership(metadata.ptyId) ?? mappedOwnershipByPtyId.get(metadata.ptyId);
        if (!ownership) {
          continue;
        }

        const sessionMetadata = sessionMetadataById.get(ownership.sessionId);
        if (!sessionMetadata) {
          continue;
        }

        const enrichedMetadata: AggregatePtyMetadata = {
          ...metadata,
          paneId: ownership.paneId ?? metadata.paneId,
          workspaceId: ownership.workspaceId ?? metadata.workspaceId,
          sessionId: ownership.sessionId,
          sessionMetadata,
        };
        resolvedPtys.push({ metadata: enrichedMetadata, ownership, sessionMetadata });
      }

      const cwds = [...new Set(resolvedPtys.map(({ metadata }) => metadata.cwd))];
      const gitMetadataMap = await gitCache.getMetadataBatch(cwds, { forceRefresh: true });
      const liveSessionIds = new Set(resolvedPtys.map(({ ownership }) => ownership.sessionId));

      const freshPtys: PtyInfo[] = resolvedPtys.map(({ metadata, ownership, sessionMetadata }) => {
        const gitMetadata = gitMetadataMap.get(metadata.cwd);
        const gitFields = extractGitMetadata(gitMetadata);
        const ptyInfo = ptyMetadataToInfo(metadata);

        return {
          ...ptyInfo,
          sessionId: ownership.sessionId,
          sessionMetadata,
          paneId: ownership.paneId ?? ptyInfo.paneId,
          workspaceId: ownership.workspaceId ?? ptyInfo.workspaceId,
          ...gitFields,
        };
      });

      const livePaneCountBySession = new Map<string, number>();
      for (const pty of freshPtys) {
        livePaneCountBySession.set(pty.sessionId, (livePaneCountBySession.get(pty.sessionId) ?? 0) + 1);
      }

      setState(produce((s) => {
        const nextSessionIds = new Set<string>(sessions.map((session) => String(session.id)));

        s.allSessions.clear();
        for (const session of sessions) {
          s.allSessions.set(session.id, session);
        }

        s.sessionPaneOrders.clear();
        for (const [sessionId, paneOrder] of sessionPaneOrders) {
          s.sessionPaneOrders.set(sessionId, paneOrder);
        }

        s.manualSessionOrder = s.manualSessionOrder.filter((sessionId) => nextSessionIds.has(sessionId));

        for (const sessionId of [...s.sessionLoadStates.keys()]) {
          if (!nextSessionIds.has(sessionId)) {
            s.sessionLoadStates.delete(sessionId);
            s.sessionPaneOrders.delete(sessionId);
            s.loadingSessionIds.delete(sessionId);
            s.loadAttemptedSessionIds.delete(sessionId);
            s.expandedSessionIds.delete(sessionId);
          }
        }

        for (const session of sessions) {
          const sessionId = String(session.id);
          const livePaneCount = livePaneCountBySession.get(sessionId) ?? 0;
          const storedPaneCount = summaryBySessionId.get(sessionId)?.paneCount ?? 0;
          const paneCount = livePaneCount > 0 ? livePaneCount : storedPaneCount;

          const sessionDetails = sessionDetailsById.get(sessionId);
          const detailValue = sessionDetails instanceof Error ? undefined : sessionDetails;
          const detailWorkspaceId = detailValue?.activeWorkspaceId;
          const detailFocusedPaneId = detailWorkspaceId !== undefined
            ? detailValue?.workspaces.find((workspace) => workspace.id === detailWorkspaceId)?.focusedPaneId ?? undefined
            : undefined;

          const lastActiveWorkspaceId = currentSessionHints.sessionId === sessionId
            ? currentSessionHints.lastActiveWorkspaceId
            : detailWorkspaceId;
          const focusedPaneId = currentSessionHints.sessionId === sessionId
            ? currentSessionHints.focusedPaneId
            : detailFocusedPaneId;

          if (liveSessionIds.has(sessionId)) {
            s.sessionLoadStates.set(sessionId, {
              status: 'loaded',
              paneCount,
              lastActiveWorkspaceId,
              focusedPaneId: focusedPaneId ?? undefined,
            });
            s.loadAttemptedSessionIds.delete(sessionId);
          } else if (!s.loadingSessionIds.has(sessionId)) {
            s.sessionLoadStates.set(sessionId, {
              status: 'unloaded',
              paneCount,
              lastActiveWorkspaceId,
              focusedPaneId: focusedPaneId ?? undefined,
            });
          }
        }

        s.allPtys = freshPtys;
        s.allPtysIndex = buildPtyIndex(freshPtys);
        recomputeMatches(s);
        recomputeTree(s);
      }));

      return;
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    } finally {
      setState('isLoading', false);
    }
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

      const result = await refreshPtysOnce();
      if (result instanceof Error) {
        console.error('Failed to refresh aggregate PTYs:', result.message);
      }
    } while (refreshState.pendingFullRefresh);
  };

  const refreshPtysSubsetOnce = async (ptyIds: string[]): Promise<void | Error> => {
    const results = await Promise.all(
      ptyIds.map((id) => getPtyMetadata(id, { skipGitDiffStats: true }))
    );

    const updates = results.filter((result): result is PtyMetadata => result !== null && !(result instanceof Error));
    if (updates.length === 0) {
      const firstError = results.find(
        (result): result is import('../effect/errors').ServicesNotInitializedError =>
          result instanceof Error
      );
      return firstError;
    }

    const cwds = [...new Set(updates.map((update) => update.cwd))];
    const gitMetadataMap = await gitCache.getMetadataBatch(cwds, { forceRefresh: true });
    const updatesByRepo = new Map<string | undefined, Array<{ index: number; update: PtyMetadata; metadata: GitRepoMetadata | undefined }>>();

    let didChange = false;
    setState(produce((s) => {
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

      for (const [, group] of updatesByRepo) {
        for (const { index, update, metadata } of group) {
          const prev = s.allPtys[index];
          const gitFields = extractGitMetadata(metadata);
          const repoKeyChanged = prev.gitRepoKey !== gitFields.gitRepoKey;

          if (!repoKeyChanged && prev.gitDiffStats !== undefined && gitFields.gitDiffStats === undefined) {
            gitFields.gitDiffStats = prev.gitDiffStats;
          }

          const updated: PtyInfo = {
            ...prev,
            cwd: update.cwd,
            foregroundProcess: update.foregroundProcess,
            shell: update.shell ?? prev.shell,
            title: update.title ?? prev.title,
            workspaceId: update.workspaceId ?? prev.workspaceId,
            paneId: update.paneId ?? prev.paneId,
            ...gitFields,
          };

          if (didPtyInfoChange(prev, updated)) {
            s.allPtys[index] = updated;
            didChange = true;
          }
        }
      }

      if (didChange) {
        recomputeMatches(s);
        recomputeTree(s);
      }
    }));

    return;
  };

  const refreshPtysSubset = async (ptyIds: string[]) => {
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

      await using _guardSubset = new RefreshGuard(refreshState, 'subsetRefreshInProgress');
      void _guardSubset;

      const result = await refreshPtysSubsetOnce(nextPtyIds);
      if (result instanceof Error) {
        console.error('Failed to refresh aggregate PTY subset:', result.message);
      }
    }
  };

  return { refreshPtys, refreshPtysSubset };
}

export function createTitleChangeHandler(
  setState: SetStoreFunction<AggregateViewState>
) {
  return (event: { ptyId: string; title: string }) => {
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

export async function setupSubscriptions(
  state: AggregateViewState,
  subscriptions: SubscriptionManager,
  subscriptionsEpoch: { value: number },
  refreshPtys: () => Promise<void>,
  refreshPtysSubset: (ptyIds: string[]) => Promise<void>,
  handleTitleChange: (event: { ptyId: string; title: string }) => void
): Promise<void> {
  const epoch = ++subscriptionsEpoch.value;

  // Subscribe to PTY lifecycle events for auto-refresh (created/destroyed)
  const lifecycleStream = tap(
    debounce(
      streamFromSubscription(({ emit }) => subscribeToPtyLifecycle(emit)),
      100
    ),
    () => void refreshPtys()
  );
  const lifecycleUnsub = runStream(lifecycleStream, { label: 'aggregate-view-lifecycle' });
  if (epoch !== subscriptionsEpoch.value || !state.showAggregateView) {
    lifecycleUnsub();
    return;
  }
  subscriptions.lifecycle = lifecycleUnsub;

  // Subscribe to title changes - use incremental update instead of full refresh
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

  // Predictable polling: refresh visible git metadata on one cadence.
  if (epoch !== subscriptionsEpoch.value || !state.showAggregateView) {
    return;
  }

  const pollMs = 2000;
  const pollStream = repeatWithInterval(async () => {
    if (!state.showAggregateView || state.allPtys.length === 0) return;
    await refreshPtysSubset(state.allPtys.map((pty) => pty.ptyId));
  }, pollMs);
  subscriptions.polling = runStream(pollStream, { label: 'aggregate-view-poll' });
}

export function cleanupSubscriptions(
  subscriptions: SubscriptionManager,
  subscriptionsEpoch: { value: number }
): void {
  subscriptionsEpoch.value += 1;
  subscriptions.lifecycle?.();
  subscriptions.titleChange?.();
  subscriptions.polling?.();
  subscriptions.lifecycle = null;
  subscriptions.titleChange = null;
  subscriptions.polling = null;
}
