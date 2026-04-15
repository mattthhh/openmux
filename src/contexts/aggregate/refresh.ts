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
import {
  dedupeAggregatePtysByPane,
  getAggregatePaneKey,
  getSavedAggregatePtyId,
  isSavedAggregatePtyId,
} from './rows';

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
        const optimisticPtys = s.allPtys.filter(
          (pty) =>
            (s.pendingPtyIds.has(pty.ptyId) || s.recentlyAddedPtyIds.has(pty.ptyId)) &&
            !s.deletedPtyIds.has(pty.ptyId)
        );
        const optimisticById = new Map(optimisticPtys.map((pty) => [pty.ptyId, pty] as const));
        const snapshotPtys = snapshot.ptys.filter((pty) => !s.deletedPtyIds.has(pty.ptyId));
        const snapshotPtyIds = new Set(snapshotPtys.map((pty) => pty.ptyId));
        const snapshotPaneKeys = new Set<string>();
        for (const pty of snapshotPtys) {
          const paneKey = getAggregatePaneKey(pty.sessionId, pty.paneId);
          if (paneKey) {
            snapshotPaneKeys.add(paneKey);
          }
        }
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
        // Build a pane-id-only index from snapshot entries so that a
        // wrong-sessionId optimistic entry is caught and corrected.
        // During cold-start and rapid session switches, a placeholder may
        // have been inserted with an incorrect sessionId (stale ptyToSessionMap
        // or aggregateSessionMappings). Instead of dropping these entries
        // (which loses the PTY from the aggregate view), we correct the
        // sessionId to match authoritative ownership, then carry them
        // forward. The subsequent dedup step merges the corrected entry
        // with any snapshot entry for the same pane.
        const snapshotPaneIdsBySession = new Map<string, Set<string>>();
        const snapshotPaneIdsAll = new Set<string>();
        for (const pty of snapshotPtys) {
          if (pty.paneId) {
            snapshotPaneIdsAll.add(pty.paneId);
            const sessionSet = snapshotPaneIdsBySession.get(pty.sessionId) ?? new Set<string>();
            sessionSet.add(pty.paneId);
            snapshotPaneIdsBySession.set(pty.sessionId, sessionSet);
          }
        }

        const carriedOptimisticPtys: PtyInfo[] = [];
        for (const pty of s.allPtys) {
          const paneKey = getAggregatePaneKey(pty.sessionId, pty.paneId);
          const matchesExactPaneKey = paneKey && snapshotPaneKeys.has(paneKey);

          if (matchesExactPaneKey) {
            // Exact (sessionId, paneId) match — snapshot covers this entry.
            continue;
          }

          if (
            !snapshotPtyIds.has(pty.ptyId) &&
            !(s.pendingPtyIds.has(pty.ptyId) || s.recentlyAddedPtyIds.has(pty.ptyId)) &&
            !s.deletedPtyIds.has(pty.ptyId)
          ) {
            // Not an optimistic entry — skip
            continue;
          }

          if (s.deletedPtyIds.has(pty.ptyId)) {
            continue;
          }

          // Check if the optimistic entry's ownership disagrees with its
          // stamped sessionId. If so, correct the sessionId instead of
          // dropping — the PTY should appear under the correct session.
          const ownership = resolvePtyOwnership(pty.ptyId);
          const ownershipDisagrees = ownership && ownership.sessionId !== pty.sessionId;

          if (ownershipDisagrees) {
            // Correct the sessionId to match authoritative ownership
            carriedOptimisticPtys.push({
              ...pty,
              sessionId: ownership!.sessionId,
              sessionMetadata: s.allSessions.get(ownership!.sessionId),
              paneId: ownership!.paneId ?? pty.paneId,
              workspaceId: ownership!.workspaceId ?? pty.workspaceId,
            });
            continue;
          }

          // If no ownership exists but the paneId is covered by the snapshot
          // under a different session, this is likely a wrong-session entry.
          // Only apply this when the ptyId is NOT a saved: entry.
          if (
            !ownership &&
            pty.paneId &&
            !isSavedAggregatePtyId(pty.ptyId) &&
            snapshotPaneIdsAll.has(pty.paneId) &&
            !snapshotPaneIdsBySession.get(pty.sessionId)?.has(pty.paneId)
          ) {
            // The snapshot covers this paneId but NOT under the entry's
            // stamped session. The entry has a wrong sessionId. We don't
            // know the correct session, so drop it — the snapshot entry
            // already represents this pane.
            continue;
          }

          carriedOptimisticPtys.push(pty);
        }

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

        // Cross-session pane reconciliation: after dedup by (sessionId, paneId),
        // entries with the same paneId but different sessionIds can survive.
        // This happens when a live PTY was stamped with a wrong sessionId
        // (e.g., stale ptyToSessionMap during cold start / rapid switch).
        // Use authoritative ownership to reassign the correct sessionId,
        // then re-dedup to merge the corrected entry with the snapshot entry.
        //
        // This is the safety net that catches any remaining bleed after
        // the carriedOptimisticPtys ownership filters.
        const paneIdToEntries = new Map<string, Array<{ index: number; pty: PtyInfo }>>();
        for (let i = 0; i < s.allPtys.length; i++) {
          const pty = s.allPtys[i];
          if (pty.paneId && !isSavedAggregatePtyId(pty.ptyId)) {
            const existing = paneIdToEntries.get(pty.paneId) ?? [];
            existing.push({ index: i, pty });
            paneIdToEntries.set(pty.paneId, existing);
          }
        }
        let needsReconcile = false;
        for (const [, entries] of paneIdToEntries) {
          if (entries.length <= 1) continue;
          // Multiple live entries for the same paneId across different sessions
          for (const entry of entries) {
            const ownership = resolvePtyOwnership(entry.pty.ptyId);
            if (ownership && ownership.sessionId !== entry.pty.sessionId) {
              // Ownership says this PTY belongs to a different session — fix it
              s.allPtys[entry.index] = {
                ...s.allPtys[entry.index],
                sessionId: ownership.sessionId,
                sessionMetadata: s.allSessions.get(ownership.sessionId),
              };
              needsReconcile = true;
            }
          }
        }
        if (needsReconcile) {
          s.allPtys = dedupeAggregatePtysByPane(s.allPtys);
        }

        s.allPtysIndex = buildPtyIndex(s.allPtys);

        // Clean up pendingPtyIds and recentlyAddedPtyIds for PTYs that are
        // no longer in allPtys. applySnapshot may replace a placeholder (real
        // ptyId) with a snapshot entry (saved: ptyId) for the same pane via
        // dedupeAggregatePtysByPane. The placeholder is gone from
        // allPtys/allPtysIndex, but pendingPtyIds still references it. If not
        // cleaned up, hydratePlaceholderRow finds the ptyId in pendingPtyIds
        // but not in allPtysIndex, and pushes a DUPLICATE entry — the
        // cold-start duplication bug.
        for (const ptyId of s.pendingPtyIds) {
          if (!s.allPtysIndex.has(ptyId)) {
            s.pendingPtyIds.delete(ptyId);
          }
        }
        for (const ptyId of s.recentlyAddedPtyIds) {
          if (!s.allPtysIndex.has(ptyId)) {
            s.recentlyAddedPtyIds.delete(ptyId);
          }
        }

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
