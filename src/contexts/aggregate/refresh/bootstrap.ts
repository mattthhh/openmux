/**
 * Bootstrap aggregate rows from persisted session mappings before full hydration.
 */

import { produce, type SetStoreFunction } from 'solid-js/store';

import { getAggregateSessionPtyMapping, listAllPtyIds } from '../../../effect/bridge/aggregate';
import { listSessionsResult, loadSession } from '../../../effect/bridge/session-bridge';
import { AggregateBridgeError } from '../../../effect/errors';
import type { SessionMetadata } from '../../../effect/models';

import { buildPtyIndex } from '../filter';
import { mergePtyInfoPreservingGitMetadata } from '../git';
import { mergeSessionPaneOrder } from '../pane-order';
import { recomputeMatches, recomputeTree } from '../session';
import type { AggregateViewState, PtyInfo } from '../types';
import type { CurrentSessionMetadata } from '../current-session';
import { buildSessionPaneOrder, collectSessionPaneRecords } from './shared';

export interface BootstrapPtysParams {
  state: AggregateViewState;
  setState: SetStoreFunction<AggregateViewState>;
  getCurrentSessionMetadata: () => CurrentSessionMetadata;
  getCurrentSessionPaneOrder: () => Map<string, number> | null;
}

function scheduleRecentlyAddedPtyCleanup(
  setState: SetStoreFunction<AggregateViewState>,
  ptyIds: string[]
): void {
  if (ptyIds.length === 0) return;

  setTimeout(() => {
    setState(
      produce((s) => {
        for (const ptyId of ptyIds) {
          s.recentlyAddedPtyIds.delete(ptyId);
        }
      })
    );
  }, 5000);
}

export async function runBootstrapPtys(params: BootstrapPtysParams): Promise<void | Error> {
  const { state, setState, getCurrentSessionMetadata, getCurrentSessionPaneOrder } = params;

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

    const currentSessionMetadata = getCurrentSessionMetadata();
    const currentSessionPaneOrder = getCurrentSessionPaneOrder();
    const sessionPaneOrders = new Map<string, Map<string, number>>();
    const provisionalPtys: PtyInfo[] = [];

    for (const [sessionId, sessionDetails] of sessionDetailsEntries) {
      if (sessionDetails instanceof Error) {
        continue;
      }

      const paneOrder =
        sessionId === currentSessionMetadata.sessionId && currentSessionPaneOrder
          ? currentSessionPaneOrder
          : buildSessionPaneOrder(sessionDetails);
      sessionPaneOrders.set(sessionId, paneOrder);

      const paneRecords = new Map(
        collectSessionPaneRecords(sessionDetails).map((record) => [record.paneId, record] as const)
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
          sortOrderHint: undefined,
        });
      }
    }

    if (provisionalPtys.length === 0 && sessionPaneOrders.size === 0) {
      return;
    }

    const visibleProvisionalPtys = provisionalPtys.filter(
      (pty) => !state.deletedPtyIds.has(pty.ptyId)
    );
    const visibleProvisionalPtyIds = visibleProvisionalPtys.map((pty) => pty.ptyId);

    setState(
      produce((s) => {
        for (const session of sessions) {
          s.allSessions.set(session.id, session);
        }

        for (const [sessionId, paneOrder] of sessionPaneOrders) {
          mergeSessionPaneOrder(s.sessionPaneOrderIndex, sessionId, paneOrder);
        }

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

        for (const [sessionId, paneCount] of visiblePaneCountBySession) {
          const sessionDetails = sessionDetailsById.get(sessionId);
          const detailValue = sessionDetails instanceof Error ? undefined : sessionDetails;
          const detailWorkspaceId = detailValue?.activeWorkspaceId;
          const detailFocusedPaneId =
            detailWorkspaceId !== undefined
              ? (detailValue?.workspaces.find((workspace) => workspace.id === detailWorkspaceId)
                  ?.focusedPaneId ?? undefined)
              : undefined;

          const currentSession = getCurrentSessionMetadata();
          const lastActiveWorkspaceId =
            currentSession.sessionId === sessionId
              ? currentSession.lastActiveWorkspaceId
              : detailWorkspaceId;
          const focusedPaneId =
            currentSession.sessionId === sessionId
              ? currentSession.focusedPaneId
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

    scheduleRecentlyAddedPtyCleanup(setState, visibleProvisionalPtyIds);
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
}
