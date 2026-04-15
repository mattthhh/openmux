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

import { produce, type SetStoreFunction } from 'solid-js/store';

import type { SerializedLayoutNode, SerializedSession, SessionMetadata } from '../../effect/models';
import { getPtyMetadata } from '../../effect/bridge/aggregate';
import { listSessionsResult, loadSession } from '../../effect/bridge/session-bridge';
import { AggregateBridgeError } from '../../effect/errors';
import { clonePtyStdoutActivity } from '../../core/shimmer';
import { getGlobalGitMetadataCache } from '../git-metadata-cache';
import { getGitDiffStats, getGitInfo } from '../../effect/services/pty/helpers';

import { buildPtyIndex } from './filter';
import { applyGitMetadataSnapshot } from './git';
import { ptyMetadataToInfo } from './pty-info';
import {
  getSessionPaneOrder,
  getSessionPaneOrderKey,
  mergePaneOrder,
  setSessionPaneOrder,
} from './pane-order';
import {
  RefreshGuard,
  type CurrentSessionHints,
  type CurrentSessionPty,
  type PtyOwnership,
  type RefreshState,
} from './subscriptions';
import { recomputeMatches, recomputeTree } from './session';
import type { AggregateViewState, PtyInfo, SessionLoadState } from './types';
import { dedupeAggregatePtysByPane, getAggregatePaneKey, getSavedAggregatePtyId } from './rows';

export { ptyMetadataToInfo } from './pty-info';

export interface RefreshersResult {
  refreshPtys: () => Promise<void>;
  refreshPtysSubset: (ptyIds: string[]) => Promise<void>;
  initialLoad: () => Promise<void | Error>;
}

function collectSerializedPaneIds(
  node: SerializedLayoutNode | null | undefined,
  result: string[]
): void {
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

function collectSessionPaneRecords(session: SerializedSession): Array<{
  paneId: string;
  cwd: string;
  title: string | undefined;
  workspaceId: number;
}> {
  const result: Array<{
    paneId: string;
    cwd: string;
    title: string | undefined;
    workspaceId: number;
  }> = [];

  const collect = (node: SerializedLayoutNode | null | undefined, workspaceId: number): void => {
    if (!node) return;
    if ('type' in node && node.type === 'split') {
      collect(node.first, workspaceId);
      collect(node.second, workspaceId);
      return;
    }

    const pane = node as { id: string; cwd: string; title?: string };
    result.push({
      paneId: pane.id,
      cwd: pane.cwd,
      title: pane.title,
      workspaceId,
    });
  };

  for (const workspace of session.workspaces) {
    collect(workspace.mainPane, workspace.id);
    for (const pane of workspace.stackPanes) {
      collect(pane, workspace.id);
    }
  }

  return result;
}

function getEmptyGitMetadata(): Pick<
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

function buildSavedPaneInfo(params: {
  sessionId: string;
  sessionMetadata: SessionMetadata;
  paneId: string;
  workspaceId: number;
  cwd: string;
  title: string | undefined;
  existing?: PtyInfo;
}): PtyInfo {
  const { sessionId, sessionMetadata, paneId, workspaceId, cwd, title, existing } = params;

  return {
    ptyId: getSavedAggregatePtyId(sessionId, paneId),
    cwd,
    foregroundProcess: existing?.foregroundProcess,
    shell: existing?.shell,
    workspaceId,
    paneId,
    sessionId,
    sessionMetadata,
    // Use the serialized title from the session data, not the '...'
    // placeholder title from a stale existing entry. The '...' title
    // means "data not yet loaded" — the serialized data IS the real data.
    title: existing?.title && existing.title !== '...' ? existing.title : title,
    sortOrderHint: existing?.sortOrderHint,
    ...getEmptyGitMetadata(),
  };
}

function buildLivePaneFallback(params: {
  sessionId: string;
  sessionMetadata: SessionMetadata;
  pty: CurrentSessionPty;
}): PtyInfo {
  const { sessionId, sessionMetadata, pty } = params;

  return {
    ptyId: pty.ptyId,
    cwd: pty.cwd ?? '',
    foregroundProcess: undefined,
    shell: undefined,
    workspaceId: pty.workspaceId,
    paneId: pty.paneId,
    sessionId,
    sessionMetadata,
    title: pty.title,
    sortOrderHint: undefined,
    ...getEmptyGitMetadata(),
  };
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
  const gitCache = getGlobalGitMetadataCache({
    fetchGitInfo: (cwd) => getGitInfo(cwd, { force: false }),
    fetchDiffStats: getGitDiffStats,
  });

  const buildSnapshot = async (options: {
    forceGitRefresh: boolean;
    /** Only load the active session (skip non-active session disk reads and git). */
    activeSessionOnly?: boolean;
    /** Skip git metadata hydration entirely (apply empty git fields). */
    skipGitMetadata?: boolean;
  }): Promise<
    | {
        sessions: SessionMetadata[];
        sessionLoadStates: Map<string, SessionLoadState>;
        sessionPaneOrders: Map<string, Map<string, number>>;
        ptys: PtyInfo[];
      }
    | Error
  > => {
    try {
      const sessionsResult = await listSessionsResult();
      if (sessionsResult instanceof Error) {
        return sessionsResult;
      }
      const sessions = [...sessionsResult];
      const currentSessionHints = getCurrentSessionHints();
      const currentSessionPaneOrder = getCurrentSessionPaneOrder();
      const currentSessionPtys = (getCurrentSessionPtys?.() ?? []).filter(
        (pty) => !state.deletedPtyIds.has(pty.ptyId)
      );
      const hintedSessionId = currentSessionHints.sessionId;
      // currentSessionPtys come from the live in-memory layout. During cold-start
      // and session-switch races, a PTY may already have moved to another session
      // while the stamped sessionId (or the active-session hint) is still stale.
      // Prefer authoritative ownership resolution over the stamped/current hint.
      const currentSessionPtysBySession = new Map<string, CurrentSessionPty[]>();
      for (const pty of currentSessionPtys) {
        const ownership = resolvePtyOwnership(pty.ptyId);
        const ptySessionId = ownership?.sessionId ?? pty.sessionId ?? hintedSessionId;
        if (!ptySessionId) {
          continue;
        }

        const ownedPty: CurrentSessionPty = ownership
          ? {
              ...pty,
              sessionId: ownership.sessionId,
              paneId: ownership.paneId ?? pty.paneId,
              workspaceId: ownership.workspaceId ?? pty.workspaceId,
            }
          : {
              ...pty,
              sessionId: ptySessionId,
            };

        const existing = currentSessionPtysBySession.get(ptySessionId) ?? [];
        existing.push(ownedPty);
        currentSessionPtysBySession.set(ptySessionId, existing);
      }
      const currentLiveSessionIds = [...currentSessionPtysBySession.keys()];
      const effectiveCurrentSessionId =
        currentLiveSessionIds.length === 1 ? currentLiveSessionIds[0] : hintedSessionId;

      // When loading only the active session, defer non-active session disk reads.
      const sessionsToLoad = options.activeSessionOnly
        ? sessions.filter((s) => String(s.id) === effectiveCurrentSessionId)
        : sessions;
      const sessionDetailsEntries = await Promise.all(
        sessionsToLoad.map(
          async (session) => [String(session.id), await loadSession(String(session.id))] as const
        )
      );
      const sessionDetailsById = new Map(sessionDetailsEntries);

      const sessionLoadStates = new Map<string, SessionLoadState>();
      const sessionPaneOrders = new Map<string, Map<string, number>>();
      const provisionalPtys: PtyInfo[] = [];
      const previousPanePtyByKey = new Map<string, PtyInfo>();
      for (const pty of dedupeAggregatePtysByPane(state.allPtys)) {
        const paneKey = getAggregatePaneKey(pty.sessionId, pty.paneId);
        if (!paneKey) {
          continue;
        }
        previousPanePtyByKey.set(paneKey, pty);
      }

      const currentLiveMetadataEntries = await Promise.all(
        currentSessionPtys.map(
          async (pty) =>
            [pty.ptyId, await getPtyMetadata(pty.ptyId, { skipGitDiffStats: true })] as const
        )
      );
      const currentLiveMetadata = new Map(currentLiveMetadataEntries);
      const existingCurrentSessionPtys = effectiveCurrentSessionId
        ? state.allPtys.filter((pty) => {
            if (pty.sessionId !== effectiveCurrentSessionId || pty.ptyId.startsWith('saved:')) {
              return false;
            }

            const ownership = resolvePtyOwnership(pty.ptyId);
            return !ownership || ownership.sessionId === effectiveCurrentSessionId;
          })
        : [];

      for (const session of sessions) {
        const sessionId = String(session.id);

        // When activeSessionOnly, mark non-active sessions as unloaded and skip.
        // They will be hydrated by the subsequent full refreshPtys() call.
        if (options.activeSessionOnly && sessionId !== effectiveCurrentSessionId) {
          sessionLoadStates.set(sessionId, {
            status: 'unloaded',
          });
          continue;
        }

        const sessionDetails = sessionDetailsById.get(sessionId);
        const loadedSession =
          sessionDetails && !(sessionDetails instanceof Error) ? sessionDetails : null;

        const currentLivePtysForSession = currentSessionPtysBySession.get(sessionId) ?? [];
        if (currentLivePtysForSession.length > 0) {
          const paneOrder =
            currentSessionPaneOrder ??
            (loadedSession ? buildSessionPaneOrder(loadedSession) : new Map<string, number>());
          // Ensure all live PTY pane IDs are in the pane order.
          // New panes that aren't in the layout yet get appended at the end.
          for (const livePty of currentLivePtysForSession) {
            if (livePty.paneId && !paneOrder.has(livePty.paneId)) {
              const maxOrder = [...paneOrder.values()].reduce((max, o) => Math.max(max, o), -1);
              paneOrder.set(livePty.paneId, maxOrder + 1);
            }
          }
          sessionPaneOrders.set(sessionId, paneOrder);

          for (const currentPty of currentLivePtysForSession) {
            const metadataResult = currentLiveMetadata.get(currentPty.ptyId);
            const nextPty =
              metadataResult && !(metadataResult instanceof Error) && metadataResult !== null
                ? ptyMetadataToInfo({
                    ...metadataResult,
                    sessionId,
                    sessionMetadata: session,
                    paneId: currentPty.paneId,
                    workspaceId: currentPty.workspaceId,
                    title: metadataResult.title ?? currentPty.title,
                  })
                : buildLivePaneFallback({
                    sessionId,
                    sessionMetadata: session,
                    pty: currentPty,
                  });

            provisionalPtys.push(nextPty);
          }

          sessionLoadStates.set(sessionId, {
            status: 'loaded',
            paneCount: currentLivePtysForSession.length,
            lastActiveWorkspaceId: currentSessionHints.lastActiveWorkspaceId,
            focusedPaneId: currentSessionHints.focusedPaneId,
          });
          continue;
        }

        if (sessionId === effectiveCurrentSessionId && existingCurrentSessionPtys.length > 0) {
          const paneOrder =
            currentSessionPaneOrder ??
            new Map(
              existingCurrentSessionPtys
                .filter((pty) => !!pty.paneId)
                .map((pty, index) => [pty.paneId as string, index] as const)
            );
          sessionPaneOrders.set(sessionId, paneOrder);
          provisionalPtys.push(...existingCurrentSessionPtys.map((pty) => ({ ...pty })));
          sessionLoadStates.set(sessionId, {
            status: 'loaded',
            paneCount: existingCurrentSessionPtys.length,
            lastActiveWorkspaceId: currentSessionHints.lastActiveWorkspaceId,
            focusedPaneId: currentSessionHints.focusedPaneId,
          });
          continue;
        }

        if (sessionDetails instanceof Error) {
          sessionLoadStates.set(sessionId, {
            status: 'error',
            error: sessionDetails.message,
          });
          continue;
        }

        if (!loadedSession) {
          sessionLoadStates.set(sessionId, {
            status: 'error',
            error: 'Session data unavailable',
          });
          continue;
        }

        const paneOrder = buildSessionPaneOrder(loadedSession);
        sessionPaneOrders.set(sessionId, paneOrder);

        const paneRecords = collectSessionPaneRecords(loadedSession);
        for (const paneRecord of paneRecords) {
          const savedPtyId = getSavedAggregatePtyId(sessionId, paneRecord.paneId);
          const previousPanePty = previousPanePtyByKey.get(
            getAggregatePaneKey(sessionId, paneRecord.paneId) ?? ''
          );
          if (previousPanePty && previousPanePty.ptyId !== savedPtyId) {
            clonePtyStdoutActivity(previousPanePty.ptyId, savedPtyId);
          }

          provisionalPtys.push(
            buildSavedPaneInfo({
              sessionId,
              sessionMetadata: session,
              paneId: paneRecord.paneId,
              workspaceId: paneRecord.workspaceId,
              cwd: paneRecord.cwd,
              title: paneRecord.title,
              existing: previousPanePty,
            })
          );
        }

        const activeWorkspace = loadedSession.workspaces.find(
          (workspace) => workspace.id === loadedSession.activeWorkspaceId
        );
        sessionLoadStates.set(sessionId, {
          status: 'loaded',
          paneCount: paneRecords.length,
          lastActiveWorkspaceId: loadedSession.activeWorkspaceId,
          focusedPaneId: activeWorkspace?.focusedPaneId ?? undefined,
        });
      }

      // Skip git metadata hydration when requested (fast initial load).
      // The subsequent full refreshPtys() will hydrate git data.
      let ptys: PtyInfo[];
      if (options.skipGitMetadata) {
        ptys = provisionalPtys;
      } else {
        const cwds = [...new Set(provisionalPtys.map((pty) => pty.cwd).filter(Boolean))];
        const gitMetadataMap = await gitCache.getMetadataBatch(cwds, {
          forceRefresh: options.forceGitRefresh,
        });
        ptys = provisionalPtys.map((pty) =>
          applyGitMetadataSnapshot(pty, gitMetadataMap.get(pty.cwd))
        );
      }

      return {
        sessions,
        sessionLoadStates,
        sessionPaneOrders,
        ptys,
      };
    } catch (error) {
      return error instanceof AggregateBridgeError
        ? error
        : new AggregateBridgeError({
            operation: 'aggregate snapshot refresh',
            target: 'aggregate-view',
            reason: String(error),
            cause: error instanceof Error ? error : undefined,
          });
    }
  };

  const applySnapshot = (snapshot: {
    sessions: SessionMetadata[];
    sessionLoadStates: Map<string, SessionLoadState>;
    sessionPaneOrders: Map<string, Map<string, number>>;
    ptys: PtyInfo[];
  }) => {
    setState(
      produce((s) => {
        const previousPaneOrderIndex = new Map(s.sessionPaneOrderIndex);
        const snapshotPtys = snapshot.ptys.filter((pty) => !s.deletedPtyIds.has(pty.ptyId));

        // Single-writer principle: the snapshot IS allPtys.
        // No carriedOptimisticPtys, no cross-session reconciliation.
        // The snapshot is built from authoritative sources (layout + disk)
        // and is the sole source of truth for which PTYs exist and which
        // session they belong to. This eliminates the race condition where
        // optimistic entries from handlePtyCreated could have wrong sessionIds.
        //
        // Preserve sortOrderHint from pending pane creations so that
        // newly created panes maintain their intended position.
        const pendingSortHints = new Map<string, number>();
        for (const insertion of s.pendingPaneCreations) {
          if (insertion.pendingPtyId && insertion.sortOrderHint !== undefined) {
            pendingSortHints.set(insertion.pendingPtyId, insertion.sortOrderHint);
          }
        }

        const finalPtys = snapshotPtys.map((pty) => {
          const sortHint = pendingSortHints.get(pty.ptyId);
          return sortHint !== undefined ? { ...pty, sortOrderHint: sortHint } : pty;
        });

        s.isLoading = false;
        s.allSessions.clear();
        for (const session of snapshot.sessions) {
          s.allSessions.set(session.id, session);
        }

        s.sessionLoadStates.clear();
        for (const [sessionId, loadState] of snapshot.sessionLoadStates) {
          s.sessionLoadStates.set(sessionId, loadState);
        }

        s.loadingSessionIds.clear();
        s.loadAttemptedSessionIds.clear();

        s.sessionPaneOrders = new Map();
        s.sessionPaneOrderIndex.clear();
        for (const [sessionId, paneOrder] of snapshot.sessionPaneOrders) {
          const existingOrder = getSessionPaneOrder(previousPaneOrderIndex, sessionId);
          const mergedPaneOrder = mergePaneOrder(
            existingOrder.size > 0 ? existingOrder : undefined,
            paneOrder
          );
          s.sessionPaneOrders.set(sessionId, mergedPaneOrder);
          setSessionPaneOrder(s.sessionPaneOrderIndex, sessionId, mergedPaneOrder);
        }

        // Preserve pane sort orders from pending pane creations so that
        // newly created panes maintain their intended position.
        for (const insertion of s.pendingPaneCreations) {
          if (!insertion.pendingPaneId || insertion.sortOrderHint === undefined) {
            continue;
          }
          const sessionPaneOrder =
            s.sessionPaneOrders.get(insertion.sessionId) ?? new Map<string, number>();
          sessionPaneOrder.set(insertion.pendingPaneId, insertion.sortOrderHint);
          s.sessionPaneOrders.set(insertion.sessionId, sessionPaneOrder);
          setSessionPaneOrder(s.sessionPaneOrderIndex, insertion.sessionId, sessionPaneOrder);
        }

        s.allPtys = dedupeAggregatePtysByPane(finalPtys);
        s.allPtysIndex = buildPtyIndex(s.allPtys);

        // Clear stale tracking sets — the snapshot is authoritative now.
        s.pendingPtyIds.clear();
        s.recentlyAddedPtyIds.clear();

        if (s.expandedSessionIds.size === 0) {
          for (const session of snapshot.sessions) {
            s.expandedSessionIds.add(session.id);
          }
        }

        recomputeMatches(s);
        recomputeTree(s);
      })
    );
  };

  const refreshPtysOnce = async (options: {
    forceGitRefresh: boolean;
    activeSessionOnly?: boolean;
    skipGitMetadata?: boolean;
  }): Promise<void | Error> => {
    setState('isLoading', true);
    const snapshot = await buildSnapshot(options);
    if (snapshot instanceof Error) {
      setState('isLoading', false);
      return snapshot;
    }

    applySnapshot(snapshot);
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

  return {
    refreshPtys,
    refreshPtysSubset,
    initialLoad,
  };
}
