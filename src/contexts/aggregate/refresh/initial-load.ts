/**
 * Fast initial aggregate-view population using current session layout state.
 */

import { produce, type SetStoreFunction } from 'solid-js/store';

import { getSessionSummaryResult, listSessionsResult } from '../../../effect/bridge/session-bridge';
import { AggregateBridgeError } from '../../../effect/errors';

import { buildPtyIndex } from '../filter';
import { mergeSessionPaneOrder } from '../pane-order';
import { recomputeMatches, recomputeTree } from '../session';
import type { AggregateViewState, PtyInfo } from '../types';
import type { CurrentSessionLayoutPty, CurrentSessionMetadata } from '../current-session';
import type { SessionSummary } from './shared';

export interface InitialLoadParams {
  state: AggregateViewState;
  setState: SetStoreFunction<AggregateViewState>;
  getCurrentSessionMetadata: () => CurrentSessionMetadata;
  getCurrentSessionPaneOrder: () => Map<string, number> | null;
  getCurrentSessionLayoutPtys?: () => CurrentSessionLayoutPty[];
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

export async function runInitialLoad(params: InitialLoadParams): Promise<void | Error> {
  const {
    setState,
    getCurrentSessionMetadata,
    getCurrentSessionPaneOrder,
    getCurrentSessionLayoutPtys,
  } = params;

  try {
    const sessionsResult = await listSessionsResult();
    if (sessionsResult instanceof Error) {
      return sessionsResult;
    }
    const sessions = [...sessionsResult];

    const currentSessionMetadata = getCurrentSessionMetadata();
    const currentSessionPaneOrder = getCurrentSessionPaneOrder();
    const currentSessionLayoutPtys = getCurrentSessionLayoutPtys?.() ?? [];

    const quickPtys: PtyInfo[] = currentSessionLayoutPtys.map((pty) => ({
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
      sessionId: currentSessionMetadata.sessionId ?? 'unknown',
      sessionMetadata: sessions.find((session) => session.id === currentSessionMetadata.sessionId),
      sortOrderHint: undefined,
    }));

    const summaryEntries = await Promise.all(
      sessions.map(async (session) => {
        const summaryResult = await getSessionSummaryResult(String(session.id));
        return [String(session.id), summaryResult instanceof Error ? null : summaryResult] as const;
      })
    );
    const summaryBySessionId = new Map<string, SessionSummary | null>(summaryEntries);

    const visibleQuickPtys = quickPtys.filter((pty) => !params.state.deletedPtyIds.has(pty.ptyId));
    const visibleQuickPtyIds = visibleQuickPtys.map((pty) => pty.ptyId);

    setState(
      produce((s) => {
        s.allSessions.clear();
        for (const session of sessions) {
          s.allSessions.set(session.id, session);
        }

        if (currentSessionMetadata.sessionId && currentSessionPaneOrder) {
          mergeSessionPaneOrder(
            s.sessionPaneOrderIndex,
            currentSessionMetadata.sessionId,
            currentSessionPaneOrder
          );
        }

        for (const ptyId of visibleQuickPtyIds) {
          s.recentlyAddedPtyIds.add(ptyId);
        }

        const existingPtyIds = new Set(s.allPtys.map((pty) => pty.ptyId));
        const newPtys = visibleQuickPtys.filter((pty) => !existingPtyIds.has(pty.ptyId));

        if (newPtys.length > 0) {
          s.allPtys = [...s.allPtys, ...newPtys];
          s.allPtysIndex = buildPtyIndex(s.allPtys);
        }

        for (const session of sessions) {
          const sessionId = String(session.id);
          const summary = summaryBySessionId.get(sessionId);
          const isCurrentSession = sessionId === currentSessionMetadata.sessionId;
          const existingLoadState = s.sessionLoadStates.get(sessionId);
          if (!existingLoadState) {
            s.sessionLoadStates.set(sessionId, {
              status: isCurrentSession ? 'loaded' : 'unloaded',
              paneCount: summary?.paneCount ?? 0,
              lastActiveWorkspaceId: isCurrentSession
                ? currentSessionMetadata.lastActiveWorkspaceId
                : undefined,
              focusedPaneId: isCurrentSession ? currentSessionMetadata.focusedPaneId : undefined,
            });
          }
        }

        if (currentSessionMetadata.sessionId) {
          s.expandedSessionIds.add(currentSessionMetadata.sessionId);
        }

        recomputeMatches(s);
        recomputeTree(s);
      })
    );

    scheduleRecentlyAddedPtyCleanup(setState, visibleQuickPtyIds);
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
}
