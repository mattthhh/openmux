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
import { runStream, streamFromSubscription, tap, repeatWithInterval } from '../effect/stream-utils';
import {
  listSessionsResult,
  getSessionSummaryResult,
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
  pendingFullRefresh: boolean;
  pendingSubsetPtyIds: Set<string>;
}

type RefreshFlagKey = 'refreshInProgress' | 'subsetRefreshInProgress';

/** AsyncDisposable guard for refresh state flags */
class RefreshGuard implements AsyncDisposable {
  constructor(
    private state: RefreshState,
    private key: RefreshFlagKey
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
    pendingFullRefresh: false,
    pendingSubsetPtyIds: new Set(),
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
    // Create a shallow copy to prevent shared reference issues across PTYs
    gitDiffStats: metadata.diffStats ? { ...metadata.diffStats } : undefined,
  };
}

interface AggregatePtyMetadata extends PtyMetadata {
  sessionId?: string;
  sessionMetadata?: SessionMetadata;
}

function areGitDiffStatsEqual(
  a: GitDiffStats | undefined,
  b: GitDiffStats | undefined
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.added === b.added && a.removed === b.removed && a.binary === b.binary;
}

export function didPtyInfoChange(prev: PtyInfo, next: PtyInfo): boolean {
  return (
    prev.cwd !== next.cwd ||
    prev.foregroundProcess !== next.foregroundProcess ||
    prev.shell !== next.shell ||
    prev.title !== next.title ||
    prev.workspaceId !== next.workspaceId ||
    prev.paneId !== next.paneId ||
    prev.gitBranch !== next.gitBranch ||
    prev.gitDirty !== next.gitDirty ||
    prev.gitStaged !== next.gitStaged ||
    prev.gitUnstaged !== next.gitUnstaged ||
    prev.gitUntracked !== next.gitUntracked ||
    prev.gitConflicted !== next.gitConflicted ||
    prev.gitAhead !== next.gitAhead ||
    prev.gitBehind !== next.gitBehind ||
    prev.gitStashCount !== next.gitStashCount ||
    prev.gitState !== next.gitState ||
    prev.gitDetached !== next.gitDetached ||
    prev.gitRepoKey !== next.gitRepoKey ||
    !areGitDiffStatsEqual(prev.gitDiffStats, next.gitDiffStats)
  );
}

/** Convert PtyMetadata from bridge to PtyInfo for state */
function ptyMetadataToInfo(metadata: AggregatePtyMetadata, existing?: PtyInfo): PtyInfo {
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
    title: metadata.title ?? existing?.title,
    workspaceId: metadata.workspaceId,
    paneId: metadata.paneId,
    sessionId: metadata.sessionId ?? existing?.sessionId ?? 'unknown',
    sessionMetadata: metadata.sessionMetadata ?? existing?.sessionMetadata,
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

function countSerializedPanes(node: SerializedLayoutNode | null | undefined): number {
  if (!node) return 0;
  if ('type' in node && node.type === 'split') {
    return countSerializedPanes(node.first) + countSerializedPanes(node.second);
  }
  return 1;
}

function getSessionSummaryFromDetails(session: SerializedSession): { workspaceCount: number; paneCount: number } {
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
  getCurrentSessionPaneOrder: () => Map<string, number> | null,
  getCurrentSessionPtys?: () => Array<{ ptyId: string; paneId: string; workspaceId: number; title?: string; cwd?: string }>
) {
  const gitCache = getGlobalGitMetadataCache({
    fetchGitInfo: (cwd) => getGitInfo(cwd, { force: true }),
    fetchDiffStats: getGitDiffStats,
  });

  /**
   * Lightweight initial load - shows sessions immediately with basic PTY info.
   * Used when aggregate view opens for instant feedback.
   */
  const initialLoadOnce = async (): Promise<void | Error> => {
    try {
      // Quick session list - this is fast
      const sessionsResult = await listSessionsResult();
      if (sessionsResult instanceof Error) {
        return sessionsResult;
      }
      const sessions = [...sessionsResult];

      // Get current session hints for quick PTY access
      const currentSessionHints = getCurrentSessionHints();
      const currentSessionPtys = getCurrentSessionPtys?.() ?? [];

      // Build minimal PTY info from current session (we already have this data)
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
        sessionMetadata: sessions.find((s) => s.id === currentSessionHints.sessionId),
      }));

      // Session metadata map
      const sessionMetadataById = new Map<string, SessionMetadata>(
        sessions.map((session) => [String(session.id), session])
      );

      // Load session summaries for pane counts (fast operation)
      const summaryEntries = await Promise.all(
        sessions.map(async (session) => {
          const summaryResult = await getSessionSummaryResult(String(session.id));
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
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  };

  const bootstrapPtysOnce = async (): Promise<void | Error> => {
    try {
      const sessionsResult = await listSessionsResult();
      if (sessionsResult instanceof Error) {
        return sessionsResult;
      }
      const sessions = [...sessionsResult];

      const sessionDetailsEntries = await Promise.all(
        sessions.map(async (session) => [String(session.id), await loadSession(String(session.id))] as const)
      );
      const sessionDetailsById = new Map(sessionDetailsEntries);
      const sessionMetadataById = new Map<string, SessionMetadata>(
        sessions.map((session) => [String(session.id), session])
      );

      const sessionMappingEntries = await Promise.all(
        sessions.map(async (session) => [String(session.id), await getAggregateSessionPtyMapping(String(session.id))] as const)
      );
      const sessionMappingById = new Map(sessionMappingEntries);

      const currentSessionHints = getCurrentSessionHints();
      const currentSessionPaneOrder = getCurrentSessionPaneOrder();
      const sessionPaneOrders = new Map<string, Map<string, number>>();
      const provisionalPtys: PtyInfo[] = [];
      const provisionalPaneCountBySession = new Map<string, number>();

      for (const [sessionId, sessionDetails] of sessionDetailsEntries) {
        if (sessionDetails instanceof Error) {
          continue;
        }

        const paneOrder = sessionId === currentSessionHints.sessionId && currentSessionPaneOrder
          ? currentSessionPaneOrder
          : buildSessionPaneOrder(sessionDetails);
        sessionPaneOrders.set(sessionId, paneOrder);

        const paneRecords = new Map(
          collectSessionPaneRecords(sessionDetails).map((record) => [record.paneId, record] as const)
        );
        const mappingInfo = sessionMappingById.get(sessionId);
        const sessionMetadata = sessionMetadataById.get(sessionId);
        if (!mappingInfo || !sessionMetadata) {
          continue;
        }

        for (const [paneId, ptyId] of mappingInfo.mapping) {
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
          provisionalPaneCountBySession.set(
            sessionId,
            (provisionalPaneCountBySession.get(sessionId) ?? 0) + 1
          );
        }
      }

      if (provisionalPtys.length === 0 && sessionPaneOrders.size === 0) {
        return;
      }

      setState(produce((s) => {
        for (const session of sessions) {
          s.allSessions.set(session.id, session);
        }

        for (const [sessionId, paneOrder] of sessionPaneOrders) {
          s.sessionPaneOrders.set(sessionId, paneOrder);
        }

        const existingIndex = new Map(s.allPtys.map((pty, index) => [pty.ptyId, index] as const));
        for (const pty of provisionalPtys) {
          const index = existingIndex.get(pty.ptyId);
          if (index === undefined) {
            existingIndex.set(pty.ptyId, s.allPtys.length);
            s.allPtys.push(pty);
          } else {
            s.allPtys[index] = {
              ...s.allPtys[index],
              ...pty,
            };
          }
          s.recentlyAddedPtyIds.add(pty.ptyId);
        }

        if (provisionalPtys.length > 0) {
          setTimeout(() => {
            setState(produce((s2) => {
              for (const pty of provisionalPtys) {
                s2.recentlyAddedPtyIds.delete(pty.ptyId);
              }
            }));
          }, 5000);
        }

        for (const [sessionId, paneCount] of provisionalPaneCountBySession) {
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
      }));

      return;
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
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

      const livePtysResult = await listAllPtysWithMetadata({ skipGitDiffStats: true });
      if (livePtysResult instanceof Error) {
        return livePtysResult;
      }
      const livePtys = livePtysResult;

      const sessionMetadataById = new Map<string, SessionMetadata>(
        sessions.map((session) => [String(session.id), session])
      );

      const sessionDetailsEntries = await Promise.all(
        sessions.map(async (session) => [String(session.id), await loadSession(String(session.id))] as const)
      );
      const sessionDetailsById = new Map(sessionDetailsEntries);
      const summaryBySessionId = new Map<string, { workspaceCount: number; paneCount: number } | null>(
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
        metadata: AggregatePtyMetadata;
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

      const freshPtys: PtyInfo[] = resolvedPtys.map(({ metadata, ownership, sessionMetadata }) => {
        const ptyInfo = ptyMetadataToInfo(metadata, existingPtysById.get(metadata.ptyId));

        return {
          ...ptyInfo,
          sessionId: ownership.sessionId,
          sessionMetadata,
          paneId: ownership.paneId ?? ptyInfo.paneId,
          workspaceId: ownership.workspaceId ?? ptyInfo.workspaceId,
        };
      });

      const livePaneCountBySession = new Map<string, number>();
      for (const pty of freshPtys) {
        livePaneCountBySession.set(pty.sessionId, (livePaneCountBySession.get(pty.sessionId) ?? 0) + 1);
      }

      setState(produce((s) => {
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
          const detailFocusedPaneId = detailWorkspaceId !== undefined
            ? detailValue?.workspaces.find((workspace) => workspace.id === detailWorkspaceId)?.focusedPaneId ?? undefined
            : undefined;

          const lastActiveWorkspaceId = currentSessionHints.sessionId === sessionId
            ? currentSessionHints.lastActiveWorkspaceId
            : detailWorkspaceId;
          const focusedPaneId = currentSessionHints.sessionId === sessionId
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

        // Build set of live PTY IDs from the service
        const livePtyIds = new Set(freshPtys.map(p => p.ptyId));

        // Clear deletedPtyIds only for PTYs confirmed gone from service
        // This prevents race condition where deferred destruction hasn't completed yet
        for (const deletedPtyId of s.deletedPtyIds) {
          if (!livePtyIds.has(deletedPtyId)) {
            // PTY is confirmed gone from service, safe to clear
            s.deletedPtyIds.delete(deletedPtyId);
          }
          // If PTY is still in live list, keep it in deletedPtyIds
          // (deferred destruction is still pending)
        }

        // Merge fresh PTYs while preserving pending and recently added PTYs
        // CRITICAL: Filter out deleted PTYs to prevent stale data
        const filteredFreshPtys = freshPtys.filter(p => !s.deletedPtyIds.has(p.ptyId));
        const freshPtyMap = new Map(filteredFreshPtys.map(p => [p.ptyId, p]));

        // Build new allPtys array:
        // 1. Start with fresh PTYs (they have most current data)
        // 2. For pending/recentlyAdded PTYs not in fresh, preserve them
        // 3. Filter out deleted PTYs even if pending/recentlyAdded (user explicitly deleted them)
        const currentPtyIds = new Set(s.allPtys.map(p => p.ptyId));
        const newFreshPtys = filteredFreshPtys.filter(p => !currentPtyIds.has(p.ptyId));

        // For existing PTYs: use fresh data if available, else keep current
        const mergedPtys = s.allPtys.map(pty => {
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
        }).filter((pty): pty is typeof pty & {} => pty !== null);

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
      }));

      return;
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
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

    const updates = results.filter((result): result is PtyMetadata => result !== null && !(result instanceof Error));
    if (updates.length === 0) {
      const firstError = results.find(
        (result): result is import('../effect/errors').ServicesNotInitializedError =>
          result instanceof Error
      );
      return firstError;
    }

    const cwds = [...new Set(updates.map((update) => update.cwd))];
    const gitMetadataMap = await gitCache.getMetadataBatch(cwds, { forceRefresh: true });
    const updatesByRepo = new Map<string | undefined, Array<{ index: number; update: PtyMetadata; metadata: GitRepoMetadata | undefined }>>();

    let didChange = false;
    setState(produce((s) => {
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

      for (const [, group] of updatesByRepo) {
        for (const { index, update, metadata } of group) {
          const prev = s.allPtys[index];
          const gitFields = extractGitMetadata(metadata);

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

          if (didPtyInfoChange(prev, updated)) {
            s.allPtys[index] = updated;
            didChange = true;
          }
        }
      }

      if (didChange) {
        recomputeMatches(s);
        recomputeTree(s);
      }
    }));

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
    initialLoad: initialLoadOnce,
    bootstrapPtys,
  };
}

/**
 * Create instant PTY lifecycle handlers for immediate UI updates.
 * Unlike the debounced full refresh, these do targeted updates.
 */
export function createLifecycleHandlers(
  state: AggregateViewState,
  setState: SetStoreFunction<AggregateViewState>,
  resolvePtyOwnership: (ptyId: string) => PtyOwnership | null,
  _getCurrentSessionHints: () => { sessionId: string | null; lastActiveWorkspaceId?: number; focusedPaneId?: string }
) {
  const gitCache = getGlobalGitMetadataCache({
    fetchGitInfo: (cwd) => getGitInfo(cwd, { force: false }),
    fetchDiffStats: getGitDiffStats,
  });

  /** Get session metadata for a session ID */
  const getSessionMetadata = (sessionId: string): SessionMetadata | undefined => {
    return state.allSessions.get(sessionId);
  };

  /**
   * Handle PTY created - add to list instantly.
   * Fetches metadata and inserts the new PTY.
   * Retries if ownership isn't available yet (race condition on creation).
   */
  const handlePtyCreated = async (ptyId: string, retryCount = 0): Promise<void> => {
    // Check if this PTY was recently deleted (race condition: create->destroy->create handler runs)
    if (state.deletedPtyIds.has(ptyId) && retryCount === 0) {
      // Wait for deleted tracking to clear before creating
      setTimeout(() => void handlePtyCreated(ptyId, retryCount), 100);
      return;
    }

    // Mark as pending immediately to prevent flickering during creation
    setState(produce((s) => {
      // If PTY was deleted while waiting, abort
      if (s.deletedPtyIds.has(ptyId)) {
        return;
      }

      s.pendingPtyIds.add(ptyId);

      // If this is the first attempt, add a placeholder PTY immediately
      // This ensures the pane appears in the list while we fetch metadata
      if (retryCount === 0 && !s.allPtysIndex.has(ptyId)) {
        const placeholderPty: PtyInfo = {
          ptyId,
          cwd: '',
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
          title: '...', // Loading indicator
          workspaceId: undefined,
          paneId: undefined,
          sessionId: '', // Will be filled in when ownership resolved
          sessionMetadata: undefined,
        };
        const newIndex = s.allPtys.length;
        s.allPtys.push(placeholderPty);
        s.allPtysIndex.set(ptyId, newIndex);
        recomputeMatches(s);
        recomputeTree(s);
      }
    }));

    const ownership = resolvePtyOwnership(ptyId);

    // If ownership not available yet, retry with backoff
    if (!ownership) {
      if (retryCount < 5) {
        const delay = Math.min(50 * Math.pow(2, retryCount), 500);
        setTimeout(() => void handlePtyCreated(ptyId, retryCount + 1), delay);
        return;
      }
      // Max retries reached - keep placeholder, clear pending
      setState(produce((s) => {
        s.pendingPtyIds.delete(ptyId);
        // Update title to show error state
        const index = s.allPtysIndex.get(ptyId);
        if (index !== undefined && s.allPtys[index]?.title === '...') {
          s.allPtys[index] = { ...s.allPtys[index], title: 'error' };
          recomputeMatches(s);
          recomputeTree(s);
        }
      }));
      return;
    }

    const sessionMetadata = getSessionMetadata(ownership.sessionId);
    if (!sessionMetadata) {
      // Session metadata not loaded yet, retry
      if (retryCount < 5) {
        const delay = Math.min(50 * Math.pow(2, retryCount), 500);
        setTimeout(() => void handlePtyCreated(ptyId, retryCount + 1), delay);
        return;
      }
      // Keep placeholder but clear pending status
      setState(produce((s) => {
        s.pendingPtyIds.delete(ptyId);
      }));
      return;
    }

    // Fetch metadata for the new PTY
    const metadataResult = await getPtyMetadata(ptyId, { skipGitDiffStats: true });
    if (!metadataResult || metadataResult instanceof Error) {
      setState(produce((s) => {
        s.pendingPtyIds.delete(ptyId);
        // Keep placeholder but mark as error
        const index = s.allPtysIndex.get(ptyId);
        if (index !== undefined) {
          s.allPtys[index] = {
            ...s.allPtys[index],
            sessionId: ownership.sessionId,
            sessionMetadata,
            title: metadataResult instanceof Error ? 'error' : 'shell',
          };
          recomputeMatches(s);
          recomputeTree(s);
        }
      }));
      return;
    }

    // Fetch git metadata for the CWD
    const gitMetadata = await gitCache.getMetadata(metadataResult.cwd);
    const gitFields = extractGitMetadata(gitMetadata);

    // Build the new PtyInfo
    const newPty: PtyInfo = {
      ptyId: metadataResult.ptyId,
      cwd: metadataResult.cwd,
      gitBranch: gitFields.gitBranch,
      gitDiffStats: gitFields.gitDiffStats,
      gitDirty: gitFields.gitDirty,
      gitStaged: gitFields.gitStaged,
      gitUnstaged: gitFields.gitUnstaged,
      gitUntracked: gitFields.gitUntracked,
      gitConflicted: gitFields.gitConflicted,
      gitAhead: gitFields.gitAhead,
      gitBehind: gitFields.gitBehind,
      gitStashCount: gitFields.gitStashCount,
      gitState: gitFields.gitState,
      gitDetached: gitFields.gitDetached,
      gitRepoKey: gitFields.gitRepoKey,
      foregroundProcess: metadataResult.foregroundProcess,
      shell: metadataResult.shell,
      title: metadataResult.title,
      workspaceId: ownership.workspaceId ?? metadataResult.workspaceId,
      paneId: ownership.paneId ?? metadataResult.paneId,
      sessionId: ownership.sessionId,
      sessionMetadata,
    };

    setState(produce((s) => {
      // Race condition check: if PTY is no longer pending or was deleted, abort
      if (!s.pendingPtyIds.has(ptyId) || s.deletedPtyIds.has(ptyId)) {
        // Clean up pending if it exists
        s.pendingPtyIds.delete(ptyId);

        // CRITICAL: Remove placeholder from allPtys to prevent orphaned entries
        // The placeholder was added at the start of handlePtyCreated, but if the
        // PTY was destroyed before we could fetch metadata, we need to clean it up
        const placeholderIndex = s.allPtysIndex.get(ptyId);
        if (placeholderIndex !== undefined) {
          s.allPtys.splice(placeholderIndex, 1);
          s.allPtysIndex = buildPtyIndex(s.allPtys);
          recomputeMatches(s);
          recomputeTree(s);
        }

        return; // PTY was destroyed while we were fetching metadata, don't add it
      }

      // Check if PTY already exists
      const existingIndex = s.allPtysIndex.get(ptyId);
      if (existingIndex !== undefined) {
        s.allPtys[existingIndex] = newPty;
      } else {
        // Add to the end of allPtys
        const newIndex = s.allPtys.length;
        s.allPtys.push(newPty);
        s.allPtysIndex.set(ptyId, newIndex);
      }

      // Clear pending status
      s.pendingPtyIds.delete(ptyId);

      // Mark as recently added for protection during initial load period
      s.recentlyAddedPtyIds.add(ptyId);
      // Clear after 5 seconds
      setTimeout(() => {
        setState(produce((s2) => {
          s2.recentlyAddedPtyIds.delete(ptyId);
        }));
      }, 5000);

      // Update session load state to loaded if it wasn't already
      const loadState = s.sessionLoadStates.get(ownership.sessionId);
      if (loadState && loadState.status !== 'loaded') {
        s.sessionLoadStates.set(ownership.sessionId, {
          ...loadState,
          status: 'loaded',
          paneCount: (loadState.paneCount ?? 0) + 1,
        });
      }

      // Auto-expand the session if this is the first PTY
      const sessionPtyCount = s.allPtys.filter(p => p.sessionId === ownership.sessionId).length;
      if (sessionPtyCount === 1) {
        s.expandedSessionIds.add(ownership.sessionId);
      }

      recomputeMatches(s);
      recomputeTree(s);
    }));
  };

  /**
   * Handle PTY destroyed - remove from list instantly.
   * This is synchronous for immediate UI feedback.
   * Selection moves to adjacent PTY (below first, then above).
   * 
   * The PTY is added to deletedPtyIds, which prevents it from being re-added
   * during background refresh. Entries are only cleared from deletedPtyIds
   * when refreshPtys confirms the PTY is actually gone from the service
   * (handling the race condition with deferred destruction).
   */
  const handlePtyDestroyed = (ptyId: string): void => {
    setState(produce((s) => {
      // Mark as deleted immediately (prevents background refresh from adding it back)
      s.deletedPtyIds.add(ptyId);

      // Clear from pending if it was still being created
      s.pendingPtyIds.delete(ptyId);
      // Clear from recently added (it's now legitimately gone)
      s.recentlyAddedPtyIds.delete(ptyId);

      // Note: deletedPtyIds entry is cleared by refreshPtysOnce when it confirms
      // the PTY is actually gone from the service (not just marked for deletion).
      // This prevents race conditions with deferred destruction.

      const index = s.allPtysIndex.get(ptyId);
      if (index === undefined) return;

      const pty = s.allPtys[index];
      if (!pty) return;

      const sessionId = pty.sessionId;

      // Get current position in flattened tree BEFORE modifying anything
      const removedFlattenedIndex = s.flattenedTreeIndex.get(ptyId);

      // Remove from allPtys
      s.allPtys.splice(index, 1);

      // Rebuild index for affected PTYs (indices shifted after removal)
      s.allPtysIndex = buildPtyIndex(s.allPtys);

      // Update session pane count
      const loadState = s.sessionLoadStates.get(sessionId);
      if (loadState) {
        const newPaneCount = Math.max(0, (loadState.paneCount ?? 1) - 1);
        s.sessionLoadStates.set(sessionId, {
          ...loadState,
          paneCount: newPaneCount,
        });
      }

      // Handle selection change BEFORE recomputing tree (we need old flattened tree)
      if (s.selectedPtyId === ptyId && removedFlattenedIndex !== undefined) {
        // Priority 1: Try to find PTY below in same session
        let newSelection: { index: number; ptyId: string; sessionId: string } | null = null;

        // Search downward first (below the deleted PTY)
        for (let i = removedFlattenedIndex + 1; i < s.flattenedTree.length; i++) {
          const item = s.flattenedTree[i];
          if (item?.node.type === 'session') break; // Stop at session boundary
          if (item?.node.type === 'pty' && item.parentSessionId === sessionId) {
            newSelection = { index: i, ptyId: item.node.ptyInfo.ptyId, sessionId };
            break;
          }
        }

        // Priority 2: If no PTY below, search upward (above the deleted PTY)
        if (!newSelection) {
          for (let i = removedFlattenedIndex - 1; i >= 0; i--) {
            const item = s.flattenedTree[i];
            if (item?.node.type === 'session') break; // Stop at session boundary
            if (item?.node.type === 'pty' && item.parentSessionId === sessionId) {
              newSelection = { index: i, ptyId: item.node.ptyInfo.ptyId, sessionId };
              break;
            }
          }
        }

        // Priority 3: If no PTY in same session, try any adjacent PTY
        if (!newSelection) {
          // Try below first
          for (let i = removedFlattenedIndex + 1; i < s.flattenedTree.length; i++) {
            const item = s.flattenedTree[i];
            if (item?.node.type === 'pty') {
              newSelection = { index: i, ptyId: item.node.ptyInfo.ptyId, sessionId: item.node.parentSessionId };
              break;
            }
          }
          // Then try above
          if (!newSelection) {
            for (let i = removedFlattenedIndex - 1; i >= 0; i--) {
              const item = s.flattenedTree[i];
              if (item?.node.type === 'pty') {
                newSelection = { index: i, ptyId: item.node.ptyInfo.ptyId, sessionId: item.node.parentSessionId };
                break;
              }
            }
          }
        }

        if (newSelection) {
          s.selectedIndex = newSelection.index;
          s.selectedPtyId = newSelection.ptyId;
          s.selectedSessionId = newSelection.sessionId;
        } else {
          // No other PTY found, select the session header
          s.selectedPtyId = null;
          s.selectedIndex = Math.max(0, removedFlattenedIndex - 1);
          // selectedSessionId stays as the current session
        }
      }

      recomputeMatches(s);
      recomputeTree(s);
    }));
  };

  return { handlePtyCreated, handlePtyDestroyed };
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
  handleTitleChange: (event: { ptyId: string; title: string }) => void,
  lifecycleHandlers: { handlePtyCreated: (ptyId: string) => Promise<void>; handlePtyDestroyed: (ptyId: string) => void }
): Promise<void> {
  const epoch = ++subscriptionsEpoch.value;

  // Subscribe to PTY lifecycle events for instant updates (no debounce)
  // Use targeted updates instead of full refresh for better performance
  const lifecycleStream = streamFromSubscription<{ type: 'created' | 'destroyed'; ptyId: string }>(
    ({ emit }) => subscribeToPtyLifecycle(emit)
  );

  const lifecycleUnsub = runStream(
    tap(lifecycleStream, (event) => {
      if (event.type === 'created') {
        void lifecycleHandlers.handlePtyCreated(event.ptyId);
      } else {
        lifecycleHandlers.handlePtyDestroyed(event.ptyId);
      }
    }),
    { label: 'aggregate-view-lifecycle' }
  );

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
