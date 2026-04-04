/**
 * Full refresh operation for Aggregate View.
 *
 * Performs a complete refresh of all PTYs across all sessions,
 * including session metadata, git info, and pane ordering.
 */

import * as errore from 'errore';
import { produce, type SetStoreFunction } from 'solid-js/store';

import type { AggregateViewState, PtyInfo } from '../types';
import type {
  SessionMetadata,
  SerializedSession,
  SerializedLayoutNode,
} from '../../../effect/models';
import type { PtyOwnership, CurrentSessionHints } from '../subscriptions/types';
import type { AggregatePtyMetadata, ResolvedPty } from './types';
import {
  listSessionsResult,
  getSessionSummaryResult,
  loadSession,
} from '../../../effect/bridge/session-bridge';
import {
  listAllPtysWithMetadata,
  getAggregateSessionPtyMapping,
  type PtyMetadata,
} from '../../../effect/bridge/aggregate-bridge';
import { getGlobalGitMetadataCache, type GitRepoMetadata } from '../../git-metadata-cache';
import { getGitInfo, getGitDiffStats } from '../../../effect/services/pty/helpers';
import { recomputeMatches, recomputeTree } from '../session/operations';
import { buildPtyIndex } from '../filter/operations';
import { extractGitMetadata } from '../git/metadata';
import { RefreshGuard } from './guard';
import { buildSessionPaneOrder, findWorkspaceIdForPane } from './session-utils';
import type { RefreshState } from '../subscriptions/types';
import {
  SessionStorageError,
  AggregateBridgeError,
  PtyMetadataError,
} from '../../../effect/errors';

/** Dependencies for full refresh */
export interface FullRefreshDeps {
  resolvePtyOwnership: (ptyId: string) => PtyOwnership | null;
  getCurrentSessionHints: () => CurrentSessionHints;
  getCurrentSessionPaneOrder: () => Map<string, number> | null;
}

/**
 * Perform a single full refresh of all PTYs and sessions.
 * This is the core refresh logic that fetches all data and updates state.
 */
export async function refreshPtysOnce(
  state: AggregateViewState,
  setState: SetStoreFunction<AggregateViewState>,
  deps: FullRefreshDeps
): Promise<void | Error> {
  const { resolvePtyOwnership, getCurrentSessionHints, getCurrentSessionPaneOrder } = deps;

  // Get all sessions
  const sessionsResult = await listSessionsResult().catch(
    (e) =>
      new SessionStorageError({
        operation: 'listSessions',
        path: 'aggregate',
        reason: String(e),
      })
  );
  if (sessionsResult instanceof Error) return sessionsResult;
  const sessions = [...sessionsResult];

  // Get all live PTYs
  const livePtysResult = await listAllPtysWithMetadata({ skipGitDiffStats: true }).catch(
    (e) =>
      new AggregateBridgeError({
        operation: 'listAllPtysWithMetadata',
        target: 'aggregate',
        reason: String(e),
      })
  );
  if (livePtysResult instanceof Error) return livePtysResult;
  const livePtys = livePtysResult;

  // Build session metadata map
  const sessionMetadataById = new Map<string, SessionMetadata>(
    sessions.map((session) => [String(session.id), session])
  );

  // Load session summaries
  const summaryEntries = await Promise.all(
    sessions.map(async (session) => {
      const summaryResult = await getSessionSummaryResult(String(session.id)).catch(
        (e) =>
          new SessionStorageError({
            operation: 'getSummary',
            path: String(session.id),
            reason: String(e),
          })
      );
      return [String(session.id), summaryResult instanceof Error ? null : summaryResult] as const;
    })
  );
  const summaryBySessionId = new Map<string, { workspaceCount: number; paneCount: number } | null>(
    summaryEntries
  );

  // Load session details for pane ordering
  const sessionDetailsEntries = await Promise.all(
    sessions.map(
      async (session) =>
        [
          String(session.id),
          await loadSession(String(session.id)).catch(
            (e) =>
              new SessionStorageError({
                operation: 'load',
                path: String(session.id),
                reason: String(e),
              })
          ),
        ] as const
    )
  );
  const sessionDetailsById = new Map(sessionDetailsEntries);

  // Build session pane orders
  const sessionPaneOrders = new Map<string, Map<string, number>>();
  for (const [sessionId, sessionDetails] of sessionDetailsEntries) {
    if (!(sessionDetails instanceof Error)) {
      sessionPaneOrders.set(sessionId, buildSessionPaneOrder(sessionDetails));
    }
  }

  // Merge current session pane order if available
  const currentSessionHints = getCurrentSessionHints();
  const currentSessionPaneOrder = getCurrentSessionPaneOrder();
  if (currentSessionHints.sessionId && currentSessionPaneOrder) {
    sessionPaneOrders.set(currentSessionHints.sessionId, currentSessionPaneOrder);
  }

  // Load session PTY mappings
  const sessionMappingEntries = await Promise.all(
    sessions.map(
      async (session) =>
        [
          String(session.id),
          await getAggregateSessionPtyMapping(String(session.id)).catch(
            (e) =>
              new AggregateBridgeError({
                operation: 'getSessionPtyMapping',
                target: String(session.id),
                reason: String(e),
              })
          ),
        ] as const
    )
  );

  const mappedOwnershipByPtyId = new Map<string, PtyOwnership>();
  for (const [sessionId, mappingInfo] of sessionMappingEntries) {
    if (!mappingInfo) continue;
    if (mappingInfo instanceof Error) continue;
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

  // Resolve PTYs with ownership
  const resolvedPtys: ResolvedPty[] = [];
  for (const metadata of livePtys) {
    const ownership =
      resolvePtyOwnership(metadata.ptyId) ?? mappedOwnershipByPtyId.get(metadata.ptyId);
    if (!ownership) continue;

    const sessionMetadata = sessionMetadataById.get(ownership.sessionId);
    if (!sessionMetadata) continue;

    const enrichedMetadata: AggregatePtyMetadata = {
      ...metadata,
      paneId: ownership.paneId ?? metadata.paneId,
      workspaceId: ownership.workspaceId ?? metadata.workspaceId,
      sessionId: ownership.sessionId,
      sessionMetadata,
    };
    resolvedPtys.push({ metadata: enrichedMetadata, ownership, sessionMetadata });
  }

  // Fetch git metadata for all unique CWDs
  const gitCache = getGlobalGitMetadataCache({
    fetchGitInfo: (cwd) => getGitInfo(cwd, { force: true }),
    fetchDiffStats: getGitDiffStats,
  });
  const cwds = [...new Set(resolvedPtys.map(({ metadata }) => metadata.cwd))];
  const gitMetadataMap = await gitCache.getMetadataBatch(cwds, { forceRefresh: true });
  const liveSessionIds = new Set(resolvedPtys.map(({ ownership }) => ownership.sessionId));

  // Build fresh PTY info array
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

  // Calculate live pane counts per session
  const livePaneCountBySession = new Map<string, number>();
  for (const pty of freshPtys) {
    livePaneCountBySession.set(pty.sessionId, (livePaneCountBySession.get(pty.sessionId) ?? 0) + 1);
  }

  // Update state
  setState(
    produce((s) => {
      const nextSessionIds = new Set<string>(sessions.map((session) => String(session.id)));

      // Update sessions map
      s.allSessions.clear();
      for (const session of sessions) {
        s.allSessions.set(session.id, session);
      }

      // Update session pane orders
      s.sessionPaneOrders.clear();
      for (const [sessionId, paneOrder] of sessionPaneOrders) {
        s.sessionPaneOrders.set(sessionId, paneOrder);
      }

      // Clean up manual order - remove deleted sessions
      s.manualSessionOrder = s.manualSessionOrder.filter((sessionId) =>
        nextSessionIds.has(sessionId)
      );

      // Clean up load states for deleted sessions
      for (const sessionId of [...s.sessionLoadStates.keys()]) {
        if (!nextSessionIds.has(sessionId)) {
          s.sessionLoadStates.delete(sessionId);
          s.sessionPaneOrders.delete(sessionId);
          s.loadingSessionIds.delete(sessionId);
          s.loadAttemptedSessionIds.delete(sessionId);
          s.expandedSessionIds.delete(sessionId);
        }
      }

      // Update or create session load states
      for (const session of sessions) {
        const sessionId = String(session.id);
        const livePaneCount = livePaneCountBySession.get(sessionId) ?? 0;
        const storedPaneCount = summaryBySessionId.get(sessionId)?.paneCount ?? 0;
        const paneCount = livePaneCount > 0 ? livePaneCount : storedPaneCount;

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

      // Merge fresh PTYs while preserving pending and recently added PTYs
      // CRITICAL: Filter out deleted PTYs to prevent stale data
      const filteredFreshPtys = freshPtys.filter((p) => !s.deletedPtyIds.has(p.ptyId));
      const freshPtyMap = new Map(filteredFreshPtys.map((p) => [p.ptyId, p]));

      // Build new allPtys array:
      // 1. Start with fresh PTYs (they have most current data)
      // 2. For pending/recentlyAdded PTYs not in fresh, preserve them
      // 3. Filter out deleted PTYs even if pending/recentlyAdded (user explicitly deleted them)
      const currentPtyIds = new Set(s.allPtys.map((p) => p.ptyId));
      const newFreshPtys = filteredFreshPtys.filter((p) => !currentPtyIds.has(p.ptyId));

      // For existing PTYs: use fresh data if available, else keep current
      const mergedPtys = s.allPtys
        .map((pty) => {
          // If this PTY was deleted, filter it out regardless of other status
          if (s.deletedPtyIds.has(pty.ptyId)) {
            return null;
          }

          const freshPty = freshPtyMap.get(pty.ptyId);
          if (freshPty) {
            // PTY exists in both: use fresh data (it has proper session info)
            return freshPty;
          }
          // PTY not in fresh list: keep current only if pending or recently added
          if (s.pendingPtyIds.has(pty.ptyId) || s.recentlyAddedPtyIds.has(pty.ptyId)) {
            return pty;
          }
          // PTY not in fresh and not pending: it was removed, filter it out
          return null;
        })
        .filter((pty): pty is typeof pty & {} => pty !== null);

      s.allPtys = [...mergedPtys, ...newFreshPtys];
      s.allPtysIndex = buildPtyIndex(s.allPtys);

      // Preserve selection if the selected PTY still exists after refresh
      const selectedStillExists = s.selectedPtyId && s.allPtysIndex.has(s.selectedPtyId);
      if (!selectedStillExists && s.selectedPtyId) {
        // Selected PTY no longer exists, clear it (let next selection logic handle it)
        s.selectedPtyId = null;
      }

      recomputeMatches(s);
      recomputeTree(s);

      // After tree recompute, fix up selection index if needed
      if (s.selectedPtyId) {
        const newIndex = s.flattenedTreeIndex.get(s.selectedPtyId);
        if (newIndex !== undefined) {
          s.selectedIndex = newIndex;
        }
      }
    })
  );

  return;
}

function hasGitMetadata(pty: PtyInfo): boolean {
  return (
    pty.gitBranch !== undefined ||
    pty.gitDiffStats !== undefined ||
    pty.gitDirty ||
    pty.gitStaged > 0 ||
    pty.gitUnstaged > 0 ||
    pty.gitUntracked > 0 ||
    pty.gitConflicted > 0 ||
    pty.gitAhead !== undefined ||
    pty.gitBehind !== undefined ||
    pty.gitStashCount !== undefined ||
    pty.gitState !== undefined ||
    pty.gitDetached ||
    pty.gitRepoKey !== undefined
  );
}

function mergePtyInfoPreservingGitMetadata(existing: PtyInfo | undefined, next: PtyInfo): PtyInfo {
  if (!existing || existing.cwd !== next.cwd) {
    return next;
  }

  const incomingHasGitMetadata = hasGitMetadata(next);
  const nextWithPreservedDiffStats =
    next.gitDiffStats === undefined && existing.gitDiffStats !== undefined
      ? { ...next, gitDiffStats: existing.gitDiffStats }
      : next;

  if (incomingHasGitMetadata || !hasGitMetadata(existing)) {
    return nextWithPreservedDiffStats;
  }

  return {
    ...nextWithPreservedDiffStats,
    gitBranch: existing.gitBranch,
    gitDiffStats: existing.gitDiffStats,
    gitDirty: existing.gitDirty,
    gitStaged: existing.gitStaged,
    gitUnstaged: existing.gitUnstaged,
    gitUntracked: existing.gitUntracked,
    gitConflicted: existing.gitConflicted,
    gitAhead: existing.gitAhead,
    gitBehind: existing.gitBehind,
    gitStashCount: existing.gitStashCount,
    gitState: existing.gitState,
    gitDetached: existing.gitDetached,
    gitRepoKey: existing.gitRepoKey,
  };
}

/**
 * Convert PtyMetadata to PtyInfo with optional existing info for fallback.
 */
export function ptyMetadataToInfo(metadata: AggregatePtyMetadata, existing?: PtyInfo): PtyInfo {
  return mergePtyInfoPreservingGitMetadata(existing, {
    ptyId: metadata.ptyId,
    sortOrderHint: existing?.sortOrderHint,
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
  });
}
