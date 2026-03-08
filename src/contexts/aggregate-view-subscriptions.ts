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
  listSessions,
  getSessionSummary,
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
}

/** AsyncDisposable guard for refresh state flags */
class RefreshGuard implements AsyncDisposable {
  constructor(
    private state: RefreshState,
    private key: keyof RefreshState
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

/** Convert PtyMetadata from bridge to PtyInfo for state */
function ptyMetadataToInfo(metadata: PtyMetadata, existing?: PtyInfo): PtyInfo {
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
    sessionId: (metadata as unknown as Record<string, unknown>).sessionId as string ?? existing?.sessionId ?? 'unknown',
    sessionMetadata: (metadata as unknown as Record<string, unknown>).sessionMetadata as SessionMetadata ?? existing?.sessionMetadata,
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
  // Initialize git metadata cache with 500ms debounce for diff stats
  const gitCache = getGlobalGitMetadataCache({
    fetchGitInfo: (cwd) => getGitInfo(cwd, { force: true }),
    fetchDiffStats: getGitDiffStats,
  });

  const refreshPtys = async () => {
    if (refreshState.refreshInProgress) return;
    await using _guardRefresh = new RefreshGuard(refreshState, 'refreshInProgress');
    void _guardRefresh;

    setState('isLoading', true);

    const sessions = await listSessions();
    const sessionMetadataById = new Map<string, SessionMetadata>(
      sessions.map((session) => [String(session.id), session])
    );
    const livePtys = await listAllPtysWithMetadata({ skipGitDiffStats: true });

    const summaryEntries = await Promise.all(
      sessions.map(async (session) => [String(session.id), await getSessionSummary(String(session.id))] as const)
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
      metadata: PtyMetadata;
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

      metadata.paneId = ownership.paneId;
      metadata.workspaceId = ownership.workspaceId;
      (metadata as unknown as Record<string, unknown>).sessionId = ownership.sessionId;
      (metadata as unknown as Record<string, unknown>).sessionMetadata = sessionMetadata;
      resolvedPtys.push({ metadata, ownership, sessionMetadata });
    }

    const cwds = [...new Set(resolvedPtys.map(({ metadata }) => metadata.cwd))];
    const gitMetadataMap = await gitCache.getMetadataBatch(cwds, { forceRefresh: true });
    const liveSessionIds = new Set(resolvedPtys.map(({ ownership }) => ownership.sessionId));

    setState(produce((s) => {
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
        const livePaneCount = freshPtys.filter((pty) => pty.sessionId === sessionId).length;
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
      s.isLoading = false;
      recomputeMatches(s);
      recomputeTree(s);
    }));
  };

  const refreshPtysSubset = async (ptyIds: string[]) => {
    if (refreshState.subsetRefreshInProgress || ptyIds.length === 0) return;
    await using _guardSubset = new RefreshGuard(refreshState, 'subsetRefreshInProgress');
    void _guardSubset;

    // Fetch metadata for all requested PTYs
    const results = await Promise.all(
      ptyIds.map((id) => getPtyMetadata(id, { skipGitDiffStats: true }))
    );
    const updates = results.filter((result): result is PtyMetadata => result !== null);

    if (updates.length === 0) return;

    // Get unique CWDs for batch git metadata fetch
    const cwds = [...new Set(updates.map(u => u.cwd))];
    const gitMetadataMap = await gitCache.getMetadataBatch(cwds, { forceRefresh: true });

    // Group updates by repo key for atomic batched updates
    const updatesByRepo = new Map<string | undefined, Array<{ index: number; update: PtyMetadata; metadata: GitRepoMetadata | undefined }>>();

    setState(produce((s) => {
      // First pass: collect all updates grouped by repo key
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

      // Second pass: apply updates atomically per repo
      for (const [, group] of updatesByRepo) {
        // All PTYs in the same repo get the same metadata object (reference equality)
        for (const { index, update, metadata } of group) {
          const prev = s.allPtys[index];
          const gitFields = extractGitMetadata(metadata);

          // Check if repo key changed
          const prevRepoKey = prev.gitRepoKey;
          const newRepoKey = gitFields.gitRepoKey;
          const repoKeyChanged = prevRepoKey !== newRepoKey;

          // Preserve diff stats if repo unchanged
          if (!repoKeyChanged && prev.gitDiffStats !== undefined && gitFields.gitDiffStats === undefined) {
            gitFields.gitDiffStats = prev.gitDiffStats;
          }

          // Build updated PTY info preserving session fields
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

          // Only update if something actually changed (reference equality check for metadata)
          const gitChanged =
            prev.gitBranch !== updated.gitBranch ||
            prev.gitDirty !== updated.gitDirty ||
            prev.gitStaged !== updated.gitStaged ||
            prev.gitUnstaged !== updated.gitUnstaged ||
            prev.gitUntracked !== updated.gitUntracked ||
            prev.gitConflicted !== updated.gitConflicted ||
            prev.gitRepoKey !== updated.gitRepoKey ||
            prev.gitDiffStats !== updated.gitDiffStats;

          const otherChanged =
            prev.foregroundProcess !== updated.foregroundProcess ||
            prev.cwd !== updated.cwd;

          if (gitChanged || otherChanged) {
            s.allPtys[index] = updated;
          }
        }
      }

      recomputeMatches(s);
      recomputeTree(s);
    }));
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
