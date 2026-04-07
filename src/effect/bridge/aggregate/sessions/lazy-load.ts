/**
 * Lazy Loading for Session PTYs
 * Functions for loading session PTYs on demand
 */

import type { PtyService } from '../../../services/Pty';
import type { SessionManager } from '../../../services/SessionManager';
import type { PtyId, SessionId, Cols, Rows } from '../../../types';
import type { SerializedSession, SerializedLayoutNode } from '../../../models';
import type { PtyMetadata, LoadSessionPtysResult, SessionPtyMapping } from '../types';
import { asPtyId, aggregateSessionMappings, sessionPtyCache } from '../cache/session-pty-cache';
import { batchFetchPtyMetadata } from '../metadata/fetch';
import { getPtyService, getSessionManager, hasServices } from '../../services-instance';
import { getSessionPtyMapping, registerPtyPane } from '../../shim-bridge';
import { ServicesNotInitializedError, AggregateBridgeError } from '../../../errors';
import type { SessionError } from '../../../errors';

/** Find the workspace ID containing a pane ID in serialized session data */
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

function collectPaneRecords(
  node: SerializedLayoutNode | null | undefined,
  result: Array<{ paneId: string; cwd: string }>
): void {
  if (!node) return;
  if ('type' in node && node.type === 'split') {
    collectPaneRecords(node.first, result);
    collectPaneRecords(node.second, result);
    return;
  }
  const pane = node as { id: string; cwd: string };
  result.push({ paneId: pane.id, cwd: pane.cwd });
}

function getAllWorkspacePaneRecords(
  session: SerializedSession
): Array<{ paneId: string; cwd: string }> {
  const result: Array<{ paneId: string; cwd: string }> = [];

  for (const workspace of session.workspaces) {
    collectPaneRecords(workspace.mainPane, result);
    for (const pane of workspace.stackPanes) {
      collectPaneRecords(pane, result);
    }
  }

  return result;
}

async function getStoredSessionPtyMapping(
  sessionId: string
): Promise<SessionPtyMapping | undefined> {
  const shimMapping = await getSessionPtyMapping(sessionId);
  const localMapping = aggregateSessionMappings.get(sessionId);

  if (!shimMapping && !localMapping) {
    return undefined;
  }

  const mergedMapping = new Map(shimMapping?.mapping ?? []);
  const nextLocalMapping = localMapping ? new Map(localMapping) : null;

  if (nextLocalMapping) {
    for (const paneId of shimMapping?.stalePaneIds ?? []) {
      nextLocalMapping.delete(paneId);
    }

    for (const [paneId, ptyId] of nextLocalMapping) {
      const shimPtyId = shimMapping?.mapping.get(paneId);
      if (shimPtyId && shimPtyId !== ptyId) {
        nextLocalMapping.delete(paneId);
        continue;
      }
      if (!mergedMapping.has(paneId)) {
        mergedMapping.set(paneId, ptyId);
      }
    }

    const changed =
      nextLocalMapping.size !== localMapping?.size ||
      [...nextLocalMapping].some(([paneId, ptyId]) => localMapping?.get(paneId) !== ptyId);

    if (changed) {
      setStoredSessionPtyMapping(sessionId, nextLocalMapping);
    }
  }

  if (mergedMapping.size === 0 && (shimMapping?.stalePaneIds.length ?? 0) === 0) {
    return undefined;
  }

  return {
    mapping: mergedMapping,
    stalePaneIds: shimMapping?.stalePaneIds ?? [],
  };
}

function setStoredSessionPtyMapping(sessionId: string, mapping: Map<string, string>): void {
  if (mapping.size === 0) {
    aggregateSessionMappings.delete(sessionId);
    return;
  }
  aggregateSessionMappings.set(sessionId, new Map(mapping));
}

export async function getAggregateSessionPtyMapping(
  sessionId: string
): Promise<SessionPtyMapping | undefined> {
  return getStoredSessionPtyMapping(sessionId);
}

/**
 * Load a specific session's PTYs with explicit services.
 *
 * @param pty - The PTY service
 * @param sessionManager - The session manager service
 * @param sessionId - The session ID to load
 * @param options.skipGitDiffStats - Skip expensive git diff stats
 * @returns The loaded PTY metadata or null if session not found
 */
export async function loadSessionPtysWithService(
  pty: PtyService,
  sessionManager: SessionManager,
  sessionId: string,
  options: { skipGitDiffStats?: boolean } = {}
): Promise<PtyMetadata[] | null> {
  const sessionData = await sessionManager.loadSession(sessionId as SessionId);
  if (sessionData instanceof Error) {
    return null;
  }

  const storedMapping = await getStoredSessionPtyMapping(sessionId);
  const paneToPtyMap = storedMapping?.mapping ?? new Map<string, string>();
  const paneIdByPtyId = new Map<string, string>();

  let activeSessionPtyIds: PtyId[] = [];

  if (paneToPtyMap.size > 0) {
    activeSessionPtyIds = [...paneToPtyMap.values()].map((ptyId) => asPtyId(ptyId));
    for (const [paneId, ptyId] of paneToPtyMap) {
      paneIdByPtyId.set(ptyId, paneId);
    }
  }

  const ptys: PtyMetadata[] = [];
  const livePtyIds = new Set<string>();
  for await (const metadata of batchFetchPtyMetadata(
    pty,
    activeSessionPtyIds,
    { skipGitDiffStats: options.skipGitDiffStats },
    8
  )) {
    livePtyIds.add(metadata.ptyId);
    const paneId = paneIdByPtyId.get(metadata.ptyId);
    if (paneId) {
      metadata.paneId = paneId;
      metadata.workspaceId = findWorkspaceIdForPane(sessionData, paneId);
    }
    ptys.push(metadata);
  }

  const livePaneToPtyMap = new Map([...paneToPtyMap].filter(([, ptyId]) => livePtyIds.has(ptyId)));
  if (livePaneToPtyMap.size !== paneToPtyMap.size) {
    setStoredSessionPtyMapping(sessionId, livePaneToPtyMap);
  }

  sessionPtyCache.set(
    sessionId as SessionId,
    [...livePtyIds].map((ptyId) => asPtyId(ptyId)),
    true
  );

  return ptys;
}

/**
 * Load PTYs for a specific session on demand (lazy loading).
 * This does NOT block the current session - it's an async fetch.
 *
 * Explicit-service version used by the aggregate bridge service.
 */
export async function loadSessionPtysOnDemandWithService(
  ptyService: PtyService,
  sessionManager: SessionManager,
  sessionId: string,
  options?: { createIfMissing?: boolean }
): Promise<LoadSessionPtysResult | SessionError | AggregateBridgeError> {
  const sessionResult = await sessionManager.loadSession(sessionId as SessionId);
  if (sessionResult instanceof Error) {
    return sessionResult;
  }

  let ptys = await loadSessionPtysWithService(ptyService, sessionManager, sessionId, {
    skipGitDiffStats: true,
  });

  const createIfMissing = options?.createIfMissing ?? true;

  if (createIfMissing && (ptys?.length ?? 0) === 0) {
    const paneRecords = getAllWorkspacePaneRecords(sessionResult);
    const existingMapping = await getStoredSessionPtyMapping(sessionId);
    const nextMapping = new Map<string, string>(existingMapping?.mapping ?? []);

    for (const { paneId, cwd } of paneRecords) {
      if (nextMapping.has(paneId)) {
        continue;
      }

      const created = await ptyService.create({
        cols: 80 as Cols,
        rows: 24 as Rows,
        cwd,
      });
      if (created instanceof Error) {
        continue;
      }

      const ptyId = String(created);
      nextMapping.set(paneId, ptyId);
      setStoredSessionPtyMapping(sessionId, nextMapping);
      await registerPtyPane(sessionId, paneId, ptyId).catch((e) => {
        console.warn(`Failed to register PTY pane mapping for session ${sessionId}:`, e);
      });
    }

    ptys = await loadSessionPtysWithService(ptyService, sessionManager, sessionId, {
      skipGitDiffStats: true,
    });
  }

  if (ptys === null) {
    return new AggregateBridgeError({
      operation: 'load session PTYs on demand',
      target: sessionId,
      reason: 'session PTY mapping could not be resolved',
    });
  }

  return {
    sessionId,
    ptys,
    lastActiveWorkspaceId: sessionResult.activeWorkspaceId,
  };
}

/**
 * Load PTYs for a specific session on demand (lazy loading).
 * This does NOT block the current session - it's an async fetch.
 *
 * Backward-compatible wrapper that resolves services from the bridge singleton.
 */
export async function loadSessionPtysOnDemand(
  sessionId: string,
  options?: { createIfMissing?: boolean }
): Promise<
  LoadSessionPtysResult | SessionError | AggregateBridgeError | ServicesNotInitializedError
> {
  if (!hasServices()) {
    return new ServicesNotInitializedError({ operation: 'aggregate session PTY load' });
  }

  return loadSessionPtysOnDemandWithService(
    getPtyService(),
    getSessionManager(),
    sessionId,
    options
  );
}
