/**
 * Initial load operation for Aggregate View.
 * 
 * Lightweight initial load - shows sessions immediately with basic PTY info.
 * Used when aggregate view opens for instant feedback.
 */

import * as errore from 'errore';
import { produce, type SetStoreFunction } from 'solid-js/store';

import type { AggregateViewState, PtyInfo } from '../aggregate-view-types';
import type { SessionMetadata } from '../../effect/models';
import type { CurrentSessionPty, CurrentSessionHints } from '../subscriptions/types';
import { listSessionsResult, getSessionSummaryResult } from '../../../effect/bridge/session-bridge';
import { recomputeMatches, recomputeTree } from '../session/operations';
import { buildPtyIndex } from '../filter/operations';
import { AggregateBridgeError, SessionStorageError } from '../../../effect/errors';

/** Dependencies for initial load */
export interface InitialLoadDeps {
  getCurrentSessionHints: () => CurrentSessionHints;
  getCurrentSessionPtys?: () => CurrentSessionPty[];
}

/**
 * Lightweight initial load - shows sessions immediately with basic PTY info.
 * Used when aggregate view opens for instant feedback.
 */
export async function initialLoadOnce(
  state: AggregateViewState,
  setState: SetStoreFunction<AggregateViewState>,
  deps: InitialLoadDeps
): Promise<void | Error> {
  const { getCurrentSessionHints, getCurrentSessionPtys } = deps;

  // Quick session list - this is fast
  const sessionsResult = await listSessionsResult().catch(
    (e) => new AggregateBridgeError({ 
      operation: 'listSessions', 
      target: 'initialLoad', 
      cause: e 
    })
  );
  if (sessionsResult instanceof Error) return sessionsResult;
  const sessions = [...sessionsResult];

  // Get current session hints for quick PTY access
  const currentSessionHints = getCurrentSessionHints();
  const currentSessionPtys = getCurrentSessionPtys?.() ?? [];

  // Build minimal PTY info from current session (we already have this data)
  const quickPtys: PtyInfo[] = currentSessionPtys.map(pty => ({
    ptyId: pty.ptyId,
    cwd: '', // Will be filled in by background refresh
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
    sessionMetadata: sessions.find(s => s.id === currentSessionHints.sessionId),
  }));

  // Session metadata map
  const sessionMetadataById = new Map<string, SessionMetadata>(
    sessions.map((session) => [String(session.id), session])
  );

  // Load session summaries for pane counts (fast operation)
  const summaryEntries = await Promise.all(
    sessions.map(async (session) => {
      const summaryResult = await getSessionSummaryResult(String(session.id)).catch(
        (e) => new SessionStorageError({ 
          operation: 'getSummary', 
          path: String(session.id), 
          cause: e 
        })
      );
      return [
        String(session.id),
        summaryResult instanceof Error ? null : summaryResult,
      ] as const;
    })
  );
  const summaryBySessionId = new Map<string, { workspaceCount: number; paneCount: number } | null>(summaryEntries);

  setState(produce((s) => {
    // Update sessions
    s.allSessions.clear();
    for (const session of sessions) {
      s.allSessions.set(session.id, session);
    }

    // Mark all current PTYs as recently added (protected from background refresh)
    for (const pty of quickPtys) {
      s.recentlyAddedPtyIds.add(pty.ptyId);
    }

    // Clear recentlyAdded after 5 seconds (gives more time for background refresh + pane creation)
    setTimeout(() => {
      setState(produce((s2) => {
        for (const pty of quickPtys) {
          s2.recentlyAddedPtyIds.delete(pty.ptyId);
        }
      }));
    }, 5000);

    // Merge with any existing PTYs (in case of refresh)
    const existingPtyIds = new Set(s.allPtys.map(p => p.ptyId));
    const newPtys = quickPtys.filter(p => !existingPtyIds.has(p.ptyId));

    if (newPtys.length > 0) {
      s.allPtys = [...s.allPtys, ...newPtys];
      s.allPtysIndex = buildPtyIndex(s.allPtys);
    }

    // Set up initial load states
    for (const session of sessions) {
      const sessionId = String(session.id);
      const summary = summaryBySessionId.get(sessionId);
      const isCurrentSession = sessionId === currentSessionHints.sessionId;

      // Current session is considered loaded immediately
      // Other sessions are marked unloaded for lazy loading
      const existingLoadState = s.sessionLoadStates.get(sessionId);
      if (!existingLoadState) {
        s.sessionLoadStates.set(sessionId, {
          status: isCurrentSession ? 'loaded' : 'unloaded',
          paneCount: summary?.paneCount ?? 0,
          lastActiveWorkspaceId: isCurrentSession ? currentSessionHints.lastActiveWorkspaceId : undefined,
          focusedPaneId: isCurrentSession ? currentSessionHints.focusedPaneId : undefined,
        });
      }
    }

    // Auto-expand current session
    if (currentSessionHints.sessionId) {
      s.expandedSessionIds.add(currentSessionHints.sessionId);
    }

    recomputeMatches(s);
    recomputeTree(s);
  }));

  return;
}
