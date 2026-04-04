/**
 * Refresh orchestration for Aggregate View.
 */

import { produce, type SetStoreFunction } from 'solid-js/store';

import type { SerializedLayoutNode, SerializedSession, SessionMetadata } from '../../effect/models';
import {
  getSessionSummaryResult,
  listSessionsResult,
  loadSession,
} from '../../effect/bridge/session-bridge';
import {
  getAggregateSessionPtyMapping,
  getPtyMetadata,
  listAllPtyIds,
  listAllPtysWithMetadata,
  type PtyMetadata,
} from '../../effect/bridge/aggregate';
import { AggregateBridgeError, ServicesNotInitializedError } from '../../effect/errors';
import { getGlobalGitMetadataCache } from '../git-metadata-cache';
import { getGitDiffStats, getGitInfo } from '../../effect/services/pty/helpers';

import { buildPtyIndex } from './filter';
import {
  applyGitMetadataSnapshot,
  didPtyInfoChange,
  mergePtyInfoPreservingGitMetadata,
} from './git';
import { ptyMetadataToInfo } from './pty-info';
import {
  RefreshGuard,
  type CurrentSessionHints,
  type CurrentSessionPty,
  type PtyOwnership,
  type RefreshState,
} from './subscriptions';
import { recomputeMatches, recomputeTree } from './session';
import type { AggregateViewState, PtyInfo } from './types';

export { ptyMetadataToInfo } from './pty-info';

export interface AggregatePtyMetadata extends PtyMetadata {
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
  bootstrapPtys: () => Promise<void>;
}

export function collectSerializedPaneIds(
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

export function buildSessionPaneOrder(session: SerializedSession): Map<string, number> {
  const paneIds: string[] = [];

  for (const workspace of session.workspaces) {
    collectSerializedPaneIds(workspace.mainPane, paneIds);
    for (const pane of workspace.stackPanes) {
      collectSerializedPaneIds(pane, paneIds);
    }
  }

  return new Map(paneIds.map((paneId, index) => [paneId, index] as const));
}

export function findWorkspaceIdForPane(
  session: SerializedSession,
  paneId: string
): number | undefined {
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

function mergeSessionPaneOrder(
  existing: Map<string, number> | undefined,
  incoming: Map<string, number>
): Map<string, number> {
  if (!existing || existing.size === 0) {
    return new Map(incoming);
  }

  const incomingPaneIds = new Set(incoming.keys());
  const merged = new Map<string, number>();
  const existingEntries = [...existing.entries()]
    .filter(([paneId]) => incomingPaneIds.has(paneId))
    .sort(([, aOrder], [, bOrder]) => aOrder - bOrder);

  for (const [paneId, order] of existingEntries) {
    merged.set(paneId, order);
  }

  let nextOrder = existingEntries.reduce((maxOrder, [, order]) => Math.max(maxOrder, order), -1);

  for (const [paneId] of [...incoming.entries()].sort(
    ([, aOrder], [, bOrder]) => aOrder - bOrder
  )) {
    if (merged.has(paneId)) {
      continue;
    }

    nextOrder = Math.floor(nextOrder) + 1;
    merged.set(paneId, nextOrder);
  }

  return merged;
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
  const deletedPtyIdsSeenGoneFromService = new Set<string>();

  const initialLoad = async (): Promise<void | Error> => {
    try {
      const sessionsResult = await listSessionsResult();
      if (sessionsResult instanceof Error) {
        return sessionsResult;
      }
      const sessions = [...sessionsResult];

      const currentSessionHints = getCurrentSessionHints();
      const currentSessionPaneOrder = getCurrentSessionPaneOrder();
      const currentSessionPtys = getCurrentSessionPtys?.() ?? [];

      const quickPtys: PtyInfo[] = currentSessionPtys.map((pty) => ({
        ptyId: pty.ptyId,
        cwd: pty.cwd ?? '',
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
        title: pty.title,
        workspaceId: pty.workspaceId,
        paneId: pty.paneId,
        sessionId: currentSessionHints.sessionId ?? 'unknown',
        sessionMetadata: sessions.find((session) => session.id === currentSessionHints.sessionId),
      }));

      const summaryEntries = await Promise.all(
        sessions.map(async (session) => {
          const summaryResult = await getSessionSummaryResult(String(session.id));
          return [
            String(session.id),
            summaryResult instanceof Error ? null : summaryResult,
          ] as const;
        })
      );
      const summaryBySessionId = new Map<string, SessionSummary | null>(summaryEntries);

      setState(
        produce((s) => {
          s.allSessions.clear();
          for (const session of sessions) {
            s.allSessions.set(session.id, session);
          }

          const visibleQuickPtys = quickPtys.filter((pty) => !s.deletedPtyIds.has(pty.ptyId));

          if (currentSessionHints.sessionId && currentSessionPaneOrder) {
            s.sessionPaneOrders.set(
              currentSessionHints.sessionId,
              mergeSessionPaneOrder(
                s.sessionPaneOrders.get(currentSessionHints.sessionId),
                currentSessionPaneOrder
              )
            );
          }

          for (const pty of visibleQuickPtys) {
            s.recentlyAddedPtyIds.add(pty.ptyId);
          }

          setTimeout(() => {
            setState(
              produce((s2) => {
                for (const pty of visibleQuickPtys) {
                  s2.recentlyAddedPtyIds.delete(pty.ptyId);
                }
              })
            );
          }, 5000);

          const existingPtyIds = new Set(s.allPtys.map((pty) => pty.ptyId));
          const newPtys = visibleQuickPtys.filter((pty) => !existingPtyIds.has(pty.ptyId));

          if (newPtys.length > 0) {
            s.allPtys = [...s.allPtys, ...newPtys];
            s.allPtysIndex = buildPtyIndex(s.allPtys);
          }

          for (const session of sessions) {
            const sessionId = String(session.id);
            const summary = summaryBySessionId.get(sessionId);
            const isCurrentSession = sessionId === currentSessionHints.sessionId;
            const existingLoadState = s.sessionLoadStates.get(sessionId);
            if (!existingLoadState) {
              s.sessionLoadStates.set(sessionId, {
                status: isCurrentSession ? 'loaded' : 'unloaded',
                paneCount: summary?.paneCount ?? 0,
                lastActiveWorkspaceId: isCurrentSession
                  ? currentSessionHints.lastActiveWorkspaceId
                  : undefined,
                focusedPaneId: isCurrentSession ? currentSessionHints.focusedPaneId : undefined,
              });
            }
          }

          if (currentSessionHints.sessionId) {
            s.expandedSessionIds.add(currentSessionHints.sessionId);
          }

          recomputeMatches(s);
          recomputeTree(s);
        })
      );

      return;
    } catch (error) {
      return error instanceof AggregateBridgeError
        ? error
        : new AggregateBridgeError({
            operation: 'initialLoadOnce',
            target: 'aggregate-view',
            reason: String(error),
            cause: error instanceof Error ? error : undefined,
          });
    }
  };

  const bootstrapPtysOnce = async (): Promise<void | Error> => {
    try {
      const sessionsResult = await listSessionsResult();
      if (sessionsResult instanceof Error) {
        return sessionsResult;
      }
      const sessions = [...sessionsResult];

      const serviceLivePtyIdsResult = await listAllPtyIds();
      if (serviceLivePtyIdsResult instanceof Error) {
        return serviceLivePtyIdsResult;
      }
      const serviceLivePtyIds = new Set(serviceLivePtyIdsResult);

      const sessionDetailsEntries = await Promise.all(
        sessions.map(
          async (session) => [String(session.id), await loadSession(String(session.id))] as const
        )
      );
      const sessionDetailsById = new Map(sessionDetailsEntries);
      const sessionMetadataById = new Map<string, SessionMetadata>(
        sessions.map((session) => [String(session.id), session])
      );

      const sessionMappingEntries = await Promise.all(
        sessions.map(
          async (session) =>
            [String(session.id), await getAggregateSessionPtyMapping(String(session.id))] as const
        )
      );
      const sessionMappingById = new Map(sessionMappingEntries);

      const currentSessionHints = getCurrentSessionHints();
      const currentSessionPaneOrder = getCurrentSessionPaneOrder();
      const sessionPaneOrders = new Map<string, Map<string, number>>();
      const provisionalPtys: PtyInfo[] = [];

      for (const [sessionId, sessionDetails] of sessionDetailsEntries) {
        if (sessionDetails instanceof Error) {
          continue;
        }

        const paneOrder =
          sessionId === currentSessionHints.sessionId && currentSessionPaneOrder
            ? currentSessionPaneOrder
            : buildSessionPaneOrder(sessionDetails);
        sessionPaneOrders.set(sessionId, paneOrder);

        const paneRecords = new Map(
          collectSessionPaneRecords(sessionDetails).map(
            (record) => [record.paneId, record] as const
          )
        );
        const mappingInfo = sessionMappingById.get(sessionId);
        const sessionMetadata = sessionMetadataById.get(sessionId);
        if (!mappingInfo || mappingInfo instanceof Error || !sessionMetadata) {
          continue;
        }

        const stalePaneIds = new Set(mappingInfo.stalePaneIds);
        for (const [paneId, ptyId] of mappingInfo.mapping) {
          if (
            stalePaneIds.has(paneId) ||
            state.deletedPtyIds.has(ptyId) ||
            !serviceLivePtyIds.has(ptyId)
          ) {
            continue;
          }

          const paneRecord = paneRecords.get(paneId);
          provisionalPtys.push({
            ptyId,
            cwd: paneRecord?.cwd ?? '',
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
            title: paneRecord?.title,
            workspaceId: paneRecord?.workspaceId,
            paneId,
            sessionId,
            sessionMetadata,
          });
        }
      }

      if (provisionalPtys.length === 0 && sessionPaneOrders.size === 0) {
        return;
      }

      setState(
        produce((s) => {
          for (const session of sessions) {
            s.allSessions.set(session.id, session);
          }

          for (const [sessionId, paneOrder] of sessionPaneOrders) {
            s.sessionPaneOrders.set(
              sessionId,
              mergeSessionPaneOrder(s.sessionPaneOrders.get(sessionId), paneOrder)
            );
          }

          const visibleProvisionalPtys = provisionalPtys.filter(
            (pty) => !s.deletedPtyIds.has(pty.ptyId)
          );
          const visiblePaneCountBySession = new Map<string, number>();
          const existingIndex = new Map(s.allPtys.map((pty, index) => [pty.ptyId, index] as const));
          for (const pty of visibleProvisionalPtys) {
            const index = existingIndex.get(pty.ptyId);
            if (index === undefined) {
              existingIndex.set(pty.ptyId, s.allPtys.length);
              s.allPtys.push(pty);
            } else {
              s.allPtys[index] = mergePtyInfoPreservingGitMetadata(s.allPtys[index], {
                ...s.allPtys[index],
                ...pty,
              });
            }
            s.recentlyAddedPtyIds.add(pty.ptyId);
            visiblePaneCountBySession.set(
              pty.sessionId,
              (visiblePaneCountBySession.get(pty.sessionId) ?? 0) + 1
            );
          }

          if (visibleProvisionalPtys.length > 0) {
            setTimeout(() => {
              setState(
                produce((s2) => {
                  for (const pty of visibleProvisionalPtys) {
                    s2.recentlyAddedPtyIds.delete(pty.ptyId);
                  }
                })
              );
            }, 5000);
          }

          for (const [sessionId, paneCount] of visiblePaneCountBySession) {
            const sessionDetails = sessionDetailsById.get(sessionId);
            const detailValue = sessionDetails instanceof Error ? undefined : sessionDetails;
            const detailWorkspaceId = detailValue?.activeWorkspaceId;
            const detailFocusedPaneId =
              detailWorkspaceId !== undefined
                ? (detailValue?.workspaces.find((workspace) => workspace.id === detailWorkspaceId)
                    ?.focusedPaneId ?? undefined)
                : undefined;

            const currentHints = getCurrentSessionHints();
            const lastActiveWorkspaceId =
              currentHints.sessionId === sessionId
                ? currentHints.lastActiveWorkspaceId
                : detailWorkspaceId;
            const focusedPaneId =
              currentHints.sessionId === sessionId
                ? currentHints.focusedPaneId
                : detailFocusedPaneId;

            s.sessionLoadStates.set(sessionId, {
              status: 'loaded',
              paneCount: Math.max(paneCount, s.sessionLoadStates.get(sessionId)?.paneCount ?? 0),
              lastActiveWorkspaceId,
              focusedPaneId: focusedPaneId ?? undefined,
            });
            s.loadAttemptedSessionIds.delete(sessionId);
          }

          s.allPtysIndex = buildPtyIndex(s.allPtys);
          recomputeMatches(s);
          recomputeTree(s);
        })
      );

      return;
    } catch (error) {
      return error instanceof AggregateBridgeError
        ? error
        : new AggregateBridgeError({
            operation: 'bootstrapPtysOnce',
            target: 'aggregate-view',
            reason: String(error),
            cause: error instanceof Error ? error : undefined,
          });
    }
  };

  const refreshPtysOnce = async (): Promise<void | Error> => {
    setState('isLoading', true);

    try {
      const sessionsResult = await listSessionsResult();
      if (sessionsResult instanceof Error) {
        return sessionsResult;
      }
      const sessions = [...sessionsResult];

      const serviceLivePtyIdsResult = await listAllPtyIds();
      if (serviceLivePtyIdsResult instanceof Error) {
        return serviceLivePtyIdsResult;
      }
      const serviceLivePtyIds = new Set(serviceLivePtyIdsResult);

      const livePtysResult = await listAllPtysWithMetadata({ skipGitDiffStats: true });
      if (livePtysResult instanceof Error) {
        return livePtysResult;
      }
      const livePtys = livePtysResult;

      const sessionMetadataById = new Map<string, SessionMetadata>(
        sessions.map((session) => [String(session.id), session])
      );

      const sessionDetailsEntries = await Promise.all(
        sessions.map(
          async (session) => [String(session.id), await loadSession(String(session.id))] as const
        )
      );
      const sessionDetailsById = new Map(sessionDetailsEntries);
      const summaryBySessionId = new Map<string, SessionSummary | null>(
        sessionDetailsEntries.map(([sessionId, sessionDetails]) => [
          sessionId,
          sessionDetails instanceof Error ? null : getSessionSummaryFromDetails(sessionDetails),
        ])
      );

      const sessionPaneOrders = new Map<string, Map<string, number>>();
      for (const [sessionId, sessionDetails] of sessionDetailsEntries) {
        if (!(sessionDetails instanceof Error)) {
          sessionPaneOrders.set(sessionId, buildSessionPaneOrder(sessionDetails));
        }
      }

      const currentSessionHints = getCurrentSessionHints();
      const currentSessionPaneOrder = getCurrentSessionPaneOrder();
      const currentSessionPtyIds = new Set(
        (getCurrentSessionPtys?.() ?? []).map((pty) => pty.ptyId)
      );
      if (currentSessionHints.sessionId && currentSessionPaneOrder) {
        sessionPaneOrders.set(currentSessionHints.sessionId, currentSessionPaneOrder);
      }

      const sessionMappingEntries = await Promise.all(
        sessions.map(
          async (session) =>
            [String(session.id), await getAggregateSessionPtyMapping(String(session.id))] as const
        )
      );
      const mappedOwnershipByPtyId = new Map<string, PtyOwnership>();
      for (const [sessionId, mappingInfo] of sessionMappingEntries) {
        if (!mappingInfo || mappingInfo instanceof Error) continue;
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

      const resolvedPtys: ResolvedPty[] = [];
      for (const metadata of livePtys) {
        const ownership =
          resolvePtyOwnership(metadata.ptyId) ?? mappedOwnershipByPtyId.get(metadata.ptyId);
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

      const liveSessionIds = new Set(resolvedPtys.map(({ ownership }) => ownership.sessionId));
      const existingPtysById = new Map(state.allPtys.map((pty) => [pty.ptyId, pty] as const));
      const cwds = [...new Set(resolvedPtys.map(({ metadata }) => metadata.cwd))];
      const gitMetadataMap = await gitCache.getMetadataBatch(cwds, { forceRefresh: true });

      const freshPtys: PtyInfo[] = resolvedPtys.map(({ metadata, ownership, sessionMetadata }) => {
        const ptyInfo = ptyMetadataToInfo(metadata, existingPtysById.get(metadata.ptyId));
        const nextPty = applyGitMetadataSnapshot(ptyInfo, gitMetadataMap.get(metadata.cwd));

        return {
          ...nextPty,
          sessionId: ownership.sessionId,
          sessionMetadata,
          paneId: ownership.paneId ?? nextPty.paneId,
          workspaceId: ownership.workspaceId ?? nextPty.workspaceId,
        };
      });

      const livePaneCountBySession = new Map<string, number>();
      for (const pty of freshPtys) {
        livePaneCountBySession.set(
          pty.sessionId,
          (livePaneCountBySession.get(pty.sessionId) ?? 0) + 1
        );
      }

      setState(
        produce((s) => {
          const nextSessionIds = new Set<string>(sessions.map((session) => String(session.id)));

          s.allSessions.clear();
          for (const session of sessions) {
            s.allSessions.set(session.id, session);
          }

          const existingSessionPaneOrders = new Map(s.sessionPaneOrders);
          s.sessionPaneOrders.clear();
          for (const [sessionId, paneOrder] of sessionPaneOrders) {
            s.sessionPaneOrders.set(
              sessionId,
              mergeSessionPaneOrder(existingSessionPaneOrders.get(sessionId), paneOrder)
            );
          }

          s.manualSessionOrder = s.manualSessionOrder.filter((sessionId) =>
            nextSessionIds.has(sessionId)
          );

          for (const sessionId of [...s.sessionLoadStates.keys()]) {
            if (!nextSessionIds.has(sessionId)) {
              s.sessionLoadStates.delete(sessionId);
              s.sessionPaneOrders.delete(sessionId);
              s.loadingSessionIds.delete(sessionId);
              s.loadAttemptedSessionIds.delete(sessionId);
              s.expandedSessionIds.delete(sessionId);
            }
          }

          const protectedPaneCountBySession = new Map<string, number>();
          for (const pty of s.allPtys) {
            if (!s.pendingPtyIds.has(pty.ptyId) && !s.recentlyAddedPtyIds.has(pty.ptyId)) {
              continue;
            }

            protectedPaneCountBySession.set(
              pty.sessionId,
              (protectedPaneCountBySession.get(pty.sessionId) ?? 0) + 1
            );
          }

          for (const session of sessions) {
            const sessionId = String(session.id);
            const livePaneCount = livePaneCountBySession.get(sessionId) ?? 0;
            const protectedPaneCount = protectedPaneCountBySession.get(sessionId) ?? 0;
            const storedPaneCount = summaryBySessionId.get(sessionId)?.paneCount ?? 0;
            const paneCount = Math.max(livePaneCount, protectedPaneCount, storedPaneCount);

            const sessionDetails = sessionDetailsById.get(sessionId);
            const detailValue = sessionDetails instanceof Error ? undefined : sessionDetails;
            const detailWorkspaceId = detailValue?.activeWorkspaceId;
            const detailFocusedPaneId =
              detailWorkspaceId !== undefined
                ? (detailValue?.workspaces.find((workspace) => workspace.id === detailWorkspaceId)
                    ?.focusedPaneId ?? undefined)
                : undefined;

            const lastActiveWorkspaceId =
              currentSessionHints.sessionId === sessionId
                ? currentSessionHints.lastActiveWorkspaceId
                : detailWorkspaceId;
            const focusedPaneId =
              currentSessionHints.sessionId === sessionId
                ? currentSessionHints.focusedPaneId
                : detailFocusedPaneId;

            if (liveSessionIds.has(sessionId) || protectedPaneCount > 0) {
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

          for (const deletedPtyId of s.deletedPtyIds) {
            if (!serviceLivePtyIds.has(deletedPtyId)) {
              deletedPtyIdsSeenGoneFromService.add(deletedPtyId);
              if (
                !mappedOwnershipByPtyId.has(deletedPtyId) &&
                !currentSessionPtyIds.has(deletedPtyId)
              ) {
                s.deletedPtyIds.delete(deletedPtyId);
                deletedPtyIdsSeenGoneFromService.delete(deletedPtyId);
              }
              continue;
            }

            if (deletedPtyIdsSeenGoneFromService.has(deletedPtyId)) {
              s.deletedPtyIds.delete(deletedPtyId);
              deletedPtyIdsSeenGoneFromService.delete(deletedPtyId);
            }
          }

          const filteredFreshPtys = freshPtys.filter((pty) => !s.deletedPtyIds.has(pty.ptyId));
          const freshPtyMap = new Map(filteredFreshPtys.map((pty) => [pty.ptyId, pty]));
          const currentPtyIds = new Set(s.allPtys.map((pty) => pty.ptyId));
          const newFreshPtys = filteredFreshPtys.filter((pty) => !currentPtyIds.has(pty.ptyId));

          const mergedPtys = s.allPtys
            .map((pty) => {
              if (s.deletedPtyIds.has(pty.ptyId)) {
                return null;
              }

              const freshPty = freshPtyMap.get(pty.ptyId);
              if (freshPty) {
                return freshPty;
              }
              if (s.pendingPtyIds.has(pty.ptyId) || s.recentlyAddedPtyIds.has(pty.ptyId)) {
                return pty;
              }
              return null;
            })
            .filter((pty): pty is PtyInfo => pty !== null);

          s.allPtys = [...mergedPtys, ...newFreshPtys];
          s.allPtysIndex = buildPtyIndex(s.allPtys);

          const selectedStillExists = s.selectedPtyId && s.allPtysIndex.has(s.selectedPtyId);
          if (!selectedStillExists && s.selectedPtyId) {
            s.selectedPtyId = null;
          }

          recomputeMatches(s);
          recomputeTree(s);

          if (s.selectedPtyId) {
            const newIndex = s.flattenedTreeIndex.get(s.selectedPtyId);
            if (newIndex !== undefined) {
              s.selectedIndex = newIndex;
            }
          }
        })
      );

      return;
    } catch (error) {
      return error instanceof AggregateBridgeError
        ? error
        : new AggregateBridgeError({
            operation: 'fullRefreshOnce',
            target: 'aggregate-view',
            reason: String(error),
            cause: error instanceof Error ? error : undefined,
          });
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

  const bootstrapPtys = async () => {
    const result = await bootstrapPtysOnce();
    if (result instanceof Error) {
      console.error('Failed to bootstrap aggregate PTYs:', result.message);
    }
  };

  const refreshPtysSubsetOnce = async (ptyIds: string[]): Promise<void | Error> => {
    const results = await Promise.all(
      ptyIds.map((id) => getPtyMetadata(id, { skipGitDiffStats: true }))
    );

    const updates = results.filter(
      (result): result is PtyMetadata => result !== null && !(result instanceof Error)
    );
    if (updates.length === 0) {
      const firstError = results.find(
        (result): result is ServicesNotInitializedError => result instanceof Error
      );
      return firstError;
    }

    const cwds = [...new Set(updates.map((update) => update.cwd))];
    const gitMetadataMap = await gitCache.getMetadataBatch(cwds, { forceRefresh: false });

    let didChange = false;
    setState(
      produce((s) => {
        for (const update of updates) {
          const index = s.allPtysIndex.get(update.ptyId);
          if (index === undefined || !s.allPtys[index]) continue;

          const prev = s.allPtys[index];
          const updatedBase = {
            ...prev,
            cwd: update.cwd,
            foregroundProcess: update.foregroundProcess,
            shell: update.shell ?? prev.shell,
            title: update.title ?? prev.title,
            workspaceId: update.workspaceId ?? prev.workspaceId,
            paneId: update.paneId ?? prev.paneId,
          };
          const updated = applyGitMetadataSnapshot(updatedBase, gitMetadataMap.get(update.cwd));

          if (didPtyInfoChange(prev, updated)) {
            s.allPtys[index] = updated;
            didChange = true;
          }
        }

        if (didChange) {
          recomputeMatches(s);
          recomputeTree(s);
        }
      })
    );

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

  return {
    refreshPtys,
    refreshPtysSubset,
    initialLoad,
    bootstrapPtys,
  };
}
