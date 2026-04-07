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

export interface AggregatePtyMetadata {
  ptyId: string;
  cwd: string;
  gitBranch: string | undefined;
  gitDiffStats: PtyInfo['gitDiffStats'];
  gitDirty: boolean;
  gitStaged: number;
  gitUnstaged: number;
  gitUntracked: number;
  gitConflicted: number;
  gitAhead: number | undefined;
  gitBehind: number | undefined;
  gitStashCount: number | undefined;
  gitState: PtyInfo['gitState'];
  gitDetached: boolean;
  gitRepoKey: string | undefined;
  foregroundProcess: string | undefined;
  shell: string | undefined;
  title: string | undefined;
  workspaceId: number | undefined;
  paneId: string | undefined;
  sessionId?: string;
  sessionMetadata?: SessionMetadata;
}

export interface ResolvedPty {
  metadata: AggregatePtyMetadata;
  ownership: PtyOwnership;
  sessionMetadata: SessionMetadata;
}

export interface SessionSummary {
  workspaceCount: number;
  paneCount: number;
}

export interface CreateRefreshersParams {
  state: AggregateViewState;
  setState: SetStoreFunction<AggregateViewState>;
  refreshState: RefreshState;
  resolvePtyOwnership: (ptyId: string) => PtyOwnership | null;
  getCurrentSessionHints: () => CurrentSessionHints;
  getCurrentSessionPaneOrder: () => Map<string, number> | null;
  getCurrentSessionPtys?: () => CurrentSessionPty[];
}

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

function countSerializedPanes(node: SerializedLayoutNode | null | undefined): number {
  if (!node) return 0;
  if ('type' in node && node.type === 'split') {
    return countSerializedPanes(node.first) + countSerializedPanes(node.second);
  }
  return 1;
}

function getSessionSummaryFromDetails(session: SerializedSession): SessionSummary {
  let workspaceCount = 0;
  let paneCount = 0;

  for (const workspace of session.workspaces) {
    if (!workspace.mainPane && workspace.stackPanes.length === 0) {
      continue;
    }

    workspaceCount += 1;
    paneCount += countSerializedPanes(workspace.mainPane);
    for (const pane of workspace.stackPanes) {
      paneCount += countSerializedPanes(pane);
    }
  }

  return { workspaceCount, paneCount };
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
    title: existing?.title ?? title,
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
  _resolvePtyOwnership: (ptyId: string) => PtyOwnership | null,
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
      const activeSessionId = currentSessionHints.sessionId;

      const sessionDetailsEntries = await Promise.all(
        sessions.map(
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
      const existingActivePtys = activeSessionId
        ? state.allPtys.filter(
            (pty) => pty.sessionId === activeSessionId && !pty.ptyId.startsWith('saved:')
          )
        : [];

      for (const session of sessions) {
        const sessionId = String(session.id);
        const sessionDetails = sessionDetailsById.get(sessionId);
        const loadedSession =
          sessionDetails && !(sessionDetails instanceof Error) ? sessionDetails : null;

        if (sessionId === activeSessionId && currentSessionPtys.length > 0) {
          const paneOrder =
            currentSessionPaneOrder ??
            (loadedSession ? buildSessionPaneOrder(loadedSession) : new Map<string, number>());
          sessionPaneOrders.set(sessionId, paneOrder);

          for (const currentPty of currentSessionPtys) {
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
            paneCount: currentSessionPtys.length,
            lastActiveWorkspaceId: currentSessionHints.lastActiveWorkspaceId,
            focusedPaneId: currentSessionHints.focusedPaneId,
          });
          continue;
        }

        if (sessionId === activeSessionId && existingActivePtys.length > 0) {
          const paneOrder =
            currentSessionPaneOrder ??
            new Map(
              existingActivePtys
                .filter((pty) => !!pty.paneId)
                .map((pty, index) => [pty.paneId as string, index] as const)
            );
          sessionPaneOrders.set(sessionId, paneOrder);
          provisionalPtys.push(...existingActivePtys.map((pty) => ({ ...pty })));
          sessionLoadStates.set(sessionId, {
            status: 'loaded',
            paneCount: existingActivePtys.length,
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

      const cwds = [...new Set(provisionalPtys.map((pty) => pty.cwd).filter(Boolean))];
      const gitMetadataMap = await gitCache.getMetadataBatch(cwds, {
        forceRefresh: options.forceGitRefresh,
      });
      const ptys = provisionalPtys.map((pty) =>
        applyGitMetadataSnapshot(pty, gitMetadataMap.get(pty.cwd))
      );

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
        const optimisticPtys = s.allPtys.filter(
          (pty) =>
            (s.pendingPtyIds.has(pty.ptyId) || s.recentlyAddedPtyIds.has(pty.ptyId)) &&
            !s.deletedPtyIds.has(pty.ptyId)
        );
        const optimisticById = new Map(optimisticPtys.map((pty) => [pty.ptyId, pty] as const));
        const snapshotPtys = snapshot.ptys.filter((pty) => !s.deletedPtyIds.has(pty.ptyId));
        const snapshotPtyIds = new Set(snapshotPtys.map((pty) => pty.ptyId));
        const mergedSnapshotPtys = snapshotPtys.map((pty) => {
          const optimistic = optimisticById.get(pty.ptyId);
          if (!optimistic) {
            return pty;
          }

          return {
            ...pty,
            sortOrderHint: optimistic.sortOrderHint ?? pty.sortOrderHint,
            title:
              s.pendingPtyIds.has(pty.ptyId) && optimistic.title === '...'
                ? optimistic.title
                : pty.title,
          };
        });
        const carriedOptimisticPtys = s.allPtys.filter(
          (pty) =>
            !snapshotPtyIds.has(pty.ptyId) &&
            (s.pendingPtyIds.has(pty.ptyId) || s.recentlyAddedPtyIds.has(pty.ptyId)) &&
            !s.deletedPtyIds.has(pty.ptyId)
        );

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

        const optimisticPaneOrders = new Map<string, Map<string, number>>();
        const setOptimisticPaneOrder = (
          sessionId: string,
          paneId: string,
          order: number | undefined
        ): void => {
          if (order === undefined) {
            return;
          }

          const sessionPaneOrder = optimisticPaneOrders.get(sessionId) ?? new Map<string, number>();
          sessionPaneOrder.set(paneId, order);
          optimisticPaneOrders.set(sessionId, sessionPaneOrder);
        };

        for (const pty of optimisticPtys) {
          if (!pty.paneId) continue;
          setOptimisticPaneOrder(
            pty.sessionId,
            pty.paneId,
            pty.sortOrderHint ??
              previousPaneOrderIndex.get(getSessionPaneOrderKey(pty.sessionId, pty.paneId))
          );
        }

        for (const insertion of s.pendingPaneCreations) {
          if (!insertion.pendingPaneId) {
            continue;
          }

          setOptimisticPaneOrder(
            insertion.sessionId,
            insertion.pendingPaneId,
            insertion.sortOrderHint
          );
        }

        for (const [sessionId, paneOrder] of optimisticPaneOrders) {
          const sessionPaneOrder = s.sessionPaneOrders.get(sessionId) ?? new Map<string, number>();
          for (const [paneId, order] of paneOrder) {
            sessionPaneOrder.set(paneId, order);
          }
          s.sessionPaneOrders.set(sessionId, sessionPaneOrder);
          setSessionPaneOrder(s.sessionPaneOrderIndex, sessionId, sessionPaneOrder);
        }

        s.allPtys = dedupeAggregatePtysByPane([...mergedSnapshotPtys, ...carriedOptimisticPtys]);
        s.allPtysIndex = buildPtyIndex(s.allPtys);

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

  const refreshPtysOnce = async (forceGitRefresh: boolean): Promise<void | Error> => {
    setState('isLoading', true);
    const snapshot = await buildSnapshot({ forceGitRefresh });
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

      const result = await refreshPtysOnce(true);
      if (result instanceof Error) {
        console.error('Failed to refresh aggregate PTYs:', result.message);
      }
    } while (refreshState.pendingFullRefresh);
  };

  const initialLoad = async (): Promise<void | Error> => {
    return refreshPtysOnce(false);
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
