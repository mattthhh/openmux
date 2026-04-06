/**
 * Full aggregate-view refresh and subset metadata hydration.
 */

import { produce, type SetStoreFunction } from 'solid-js/store';

import {
  getAggregateSessionPtyMapping,
  getPtyMetadata,
  listAllPtyIds,
  listAllPtysWithMetadata,
  type PtyMetadata,
} from '../../../effect/bridge/aggregate';
import { listSessionsResult, loadSession } from '../../../effect/bridge/session-bridge';
import { AggregateBridgeError } from '../../../effect/errors';
import type { SessionMetadata } from '../../../effect/models';
import type { GitMetadataCache } from '../../git-metadata-cache';

import { buildPtyIndex } from '../filter';
import { applyGitMetadataSnapshot, didPtyInfoChange } from '../git';
import { getSessionPaneOrder, mergePaneOrder, setSessionPaneOrder } from '../pane-order';
import { ptyMetadataToInfo } from '../pty-info';
import { recomputeMatches, recomputeTree } from '../session';
import type { AggregateViewState, PtyInfo } from '../types';
import type {
  CurrentSessionLayoutPty,
  CurrentSessionMetadata,
  PtyOwnership,
} from '../current-session';
import {
  buildSessionPaneOrder,
  findWorkspaceIdForPane,
  getSessionSummaryFromDetails,
  type ResolvedPty,
  type SessionSummary,
} from './shared';

export interface FullRefreshParams {
  state: AggregateViewState;
  setState: SetStoreFunction<AggregateViewState>;
  gitCache: GitMetadataCache;
  deletedPtyIdsSeenGoneFromService: Set<string>;
  resolvePtyOwnership: (ptyId: string) => PtyOwnership | null;
  getCurrentSessionMetadata: () => CurrentSessionMetadata;
  getCurrentSessionPaneOrder: () => Map<string, number> | null;
  getCurrentSessionLayoutPtys?: () => CurrentSessionLayoutPty[];
}

export interface SubsetRefreshParams {
  state: AggregateViewState;
  setState: SetStoreFunction<AggregateViewState>;
  gitCache: GitMetadataCache;
  ptyIds: string[];
}

export async function runFullRefresh(params: FullRefreshParams): Promise<void | Error> {
  const {
    state,
    setState,
    gitCache,
    deletedPtyIdsSeenGoneFromService,
    resolvePtyOwnership,
    getCurrentSessionMetadata,
    getCurrentSessionPaneOrder,
    getCurrentSessionLayoutPtys,
  } = params;

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

    const currentSessionMetadata = getCurrentSessionMetadata();
    const currentSessionPaneOrder = getCurrentSessionPaneOrder();
    const currentSessionLayoutPtyIds = new Set(
      (getCurrentSessionLayoutPtys?.() ?? []).map((pty) => pty.ptyId)
    );
    if (currentSessionMetadata.sessionId && currentSessionPaneOrder) {
      sessionPaneOrders.set(currentSessionMetadata.sessionId, currentSessionPaneOrder);
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

      resolvedPtys.push({
        ...metadata,
        paneId: ownership.paneId ?? metadata.paneId,
        workspaceId: ownership.workspaceId ?? metadata.workspaceId,
        sessionId: ownership.sessionId,
        sessionMetadata,
      });
    }

    const liveSessionIds = new Set(resolvedPtys.map((pty) => pty.sessionId));
    const existingPtysById = new Map(state.allPtys.map((pty) => [pty.ptyId, pty] as const));
    const cwds = [...new Set(resolvedPtys.map((pty) => pty.cwd))];
    const gitMetadataMap = await gitCache.getMetadataBatch(cwds, { forceRefresh: true });

    const freshPtys: PtyInfo[] = resolvedPtys.map((resolvedPty) => {
      const ptyInfo = ptyMetadataToInfo(resolvedPty, existingPtysById.get(resolvedPty.ptyId));
      return applyGitMetadataSnapshot(ptyInfo, gitMetadataMap.get(resolvedPty.cwd));
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

        const existingSessionPaneOrders = new Map(s.sessionPaneOrderIndex);
        s.sessionPaneOrderIndex.clear();
        for (const [sessionId, paneOrder] of sessionPaneOrders) {
          const existingOrder = getSessionPaneOrder(existingSessionPaneOrders, sessionId);
          const mergedPaneOrder = mergePaneOrder(
            existingOrder.size > 0 ? existingOrder : undefined,
            paneOrder
          );
          setSessionPaneOrder(s.sessionPaneOrderIndex, sessionId, mergedPaneOrder);
        }

        s.manualSessionOrder = s.manualSessionOrder.filter((sessionId) =>
          nextSessionIds.has(sessionId)
        );

        for (const sessionId of [...s.sessionLoadStates.keys()]) {
          if (!nextSessionIds.has(sessionId)) {
            s.sessionLoadStates.delete(sessionId);
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
            currentSessionMetadata.sessionId === sessionId
              ? currentSessionMetadata.lastActiveWorkspaceId
              : detailWorkspaceId;
          const focusedPaneId =
            currentSessionMetadata.sessionId === sessionId
              ? currentSessionMetadata.focusedPaneId
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
              !currentSessionLayoutPtyIds.has(deletedPtyId)
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
        const freshPtyMap = new Map(filteredFreshPtys.map((pty) => [pty.ptyId, pty] as const));
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
}

export async function runSubsetRefresh(params: SubsetRefreshParams): Promise<void | Error> {
  const { state, setState, gitCache, ptyIds } = params;

  const results = await Promise.all(
    ptyIds.map((id) => getPtyMetadata(id, { skipGitDiffStats: true }))
  );

  const updates = results.filter(
    (result): result is PtyMetadata => result !== null && !(result instanceof Error)
  );
  if (updates.length === 0) {
    const firstError = results.find((result) => result instanceof Error);
    return firstError ?? undefined;
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
}
