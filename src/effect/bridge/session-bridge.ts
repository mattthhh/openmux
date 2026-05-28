/**
 * Session bridge functions (errore version)
 * Wraps SessionManager service for async/await usage
 */

import type { SessionId } from '../types';
import type { SerializedSession, SerializedWorkspace, SessionMetadata } from '../models';
import type {
  SessionMetadata as LegacySessionMetadata,
  Workspace,
  WorkspaceId,
} from '../../core/types';
import type { Workspaces } from '../../core/operations/layout-actions';
import type { WorkspaceState } from '../services/session-manager/types';
import { getSessionManager } from './services-instance';
import { resolveActiveWorkspaceId } from './session-bridge-utils';
import type { SessionError, SessionStorageError } from '../errors';
import { SessionCorruptedError, SessionNotFoundError } from '../errors';
import { repairLikelyTrailingPercentCwd } from '../../core/cwd-utils';

/** List all sessions */
export async function listSessions(): Promise<readonly SessionMetadata[]> {
  const result = await listSessionsResult();
  if (result instanceof Error) return [];
  return result;
}

/** List all sessions without collapsing errors to an empty array */
export async function listSessionsResult(): Promise<
  readonly SessionMetadata[] | SessionStorageError
> {
  const manager = getSessionManager();
  return manager.listSessions();
}

/** Create a new session */
export async function createSession(name: string): Promise<string | SessionStorageError> {
  const manager = getSessionManager();
  const result = await manager.createSession(name);
  if (result instanceof Error) return result;
  return result.id;
}

/** Load a session by ID */
export async function loadSession(id: string): Promise<SerializedSession | SessionError> {
  const manager = getSessionManager();
  const result = await manager.loadSession(id as SessionId);
  if (result instanceof Error) return result;
  return result;
}

/** Save a session */
export async function saveSession(session: SerializedSession): Promise<void | SessionStorageError> {
  const manager = getSessionManager();
  const result = await manager.saveSession(session);
  if (result instanceof Error) return result;
}

/** Delete a session */
export async function deleteSession(id: string): Promise<void | SessionError> {
  const manager = getSessionManager();
  const result = await manager.deleteSession(id as SessionId);
  if (result instanceof Error) return result;
}

/** Rename a session */
export async function renameSession(id: string, newName: string): Promise<void | SessionError> {
  const manager = getSessionManager();
  const result = await manager.renameSession(id as SessionId, newName);
  if (result instanceof Error) return result;
}

/** Get the active session ID */
export function getActiveSessionId(): string | null {
  const manager = getSessionManager();
  return manager.getActiveSessionId();
}

/** Set the active session ID */
export async function setActiveSessionId(id: string | null): Promise<void | SessionError> {
  const manager = getSessionManager();
  const result = await manager.setActiveSessionId(id ? (id as SessionId) : null);
  if (result instanceof Error) return result;
}

/** Switch to a session */
export async function switchToSession(id: string): Promise<void | SessionError> {
  const manager = getSessionManager();
  const result = await manager.switchToSession(id as SessionId);
  if (result instanceof Error) return result;
}

/** Get session metadata by ID */
export async function getSessionMetadata(id: string): Promise<SessionMetadata | null> {
  const result = await getSessionInfoResult(id);
  if (result instanceof Error) return null;
  return result?.metadata ?? null;
}

/** Update auto-name for a session */
export async function updateAutoName(id: string, cwd: string): Promise<void | SessionError> {
  const manager = getSessionManager();
  const result = await manager.updateAutoName(id as SessionId, cwd);
  if (result instanceof Error) return result;
}

/** Get session info (metadata + summary) without collapsing errors. */
export async function getSessionInfoResult(id: string): Promise<
  | {
      metadata: SessionMetadata;
      summary: { workspaceCount: number; paneCount: number };
    }
  | null
  | SessionError
> {
  const manager = getSessionManager();
  return manager.getSessionInfo(id as SessionId);
}

/** Get session summary (workspace/pane counts) */
export async function getSessionSummary(
  id: string
): Promise<{ workspaceCount: number; paneCount: number } | null> {
  const result = await getSessionSummaryResult(id);
  if (result instanceof Error) return null;
  return result;
}

/** Get session summary without collapsing errors to null */
export async function getSessionSummaryResult(
  id: string
): Promise<{ workspaceCount: number; paneCount: number } | null | SessionError> {
  const result = await getSessionInfoResult(id);
  if (result instanceof Error || result === null) return result;
  return result.summary;
}

/** Get persisted aggregate session ordering */
export async function getAggregateSessionOrder(): Promise<string[]> {
  const result = await getAggregateSessionOrderResult();
  if (result instanceof Error) return [];
  return result;
}

/** Get persisted aggregate session ordering without collapsing errors to an empty array */
export async function getAggregateSessionOrderResult(): Promise<string[] | SessionStorageError> {
  const manager = getSessionManager();
  return manager.aggregateOrder.get();
}

/** Persist aggregate session ordering */
export async function setAggregateSessionOrder(
  order: string[]
): Promise<void | SessionStorageError> {
  const manager = getSessionManager();
  const result = await manager.aggregateOrder.set(order);
  if (result instanceof Error) return result;
}

/** Get persisted aggregate hidden session groups */
export async function getAggregateHiddenSessionGroups(): Promise<string[]> {
  const result = await getAggregateHiddenSessionGroupsResult();
  if (result instanceof Error) return [];
  return result;
}

/** Get persisted aggregate hidden session groups without collapsing errors */
export async function getAggregateHiddenSessionGroupsResult(): Promise<
  string[] | SessionStorageError
> {
  const manager = getSessionManager();
  return manager.hiddenGroups.get();
}

/** Persist aggregate hidden session groups */
export async function setAggregateHiddenSessionGroups(
  hiddenGroupIds: string[]
): Promise<void | SessionStorageError> {
  const manager = getSessionManager();
  const result = await manager.hiddenGroups.set(hiddenGroupIds);
  if (result instanceof Error) return result;
}
/** Create a new session (legacy compatibility) */
export async function createSessionLegacy(
  name?: string
): Promise<LegacySessionMetadata | SessionStorageError> {
  const manager = getSessionManager();
  const result = await manager.createSession(name);
  if (result instanceof Error) return result;
  return toLegacySessionMetadata(result);
}

/** List all sessions (legacy compatibility) */
export async function listSessionsLegacy(): Promise<LegacySessionMetadata[]> {
  const manager = getSessionManager();
  const result = await manager.listSessions();
  if (result instanceof Error) return [];
  return [...result].map(toLegacySessionMetadata);
}

/** Get active session ID (legacy compatibility) */
export function getActiveSessionIdLegacy(): string | null {
  return getActiveSessionId();
}

/** Rename session (legacy compatibility) */
export async function renameSessionLegacy(id: string, name: string): Promise<void | SessionError> {
  return renameSession(id, name);
}

/** Delete session (legacy compatibility) */
export async function deleteSessionLegacy(id: string): Promise<void | SessionError> {
  return deleteSession(id);
}

/** Convert Effect SessionMetadata to LegacySessionMetadata */
function toLegacySessionMetadata(metadata: SessionMetadata): LegacySessionMetadata {
  return {
    id: metadata.id,
    name: metadata.name,
    createdAt: metadata.createdAt,
    lastSwitchedAt: metadata.lastSwitchedAt,
    autoNamed: metadata.autoNamed,
  };
}
function deserializeLayoutNode(serialized: {
  type?: string;
  id: string;
  direction?: string;
  ratio?: number;
  first?: unknown;
  second?: unknown;
  title?: string;
  cwd?: string;
}): {
  type?: string;
  id: string;
  direction?: string;
  ratio?: number;
  first?: unknown;
  second?: unknown;
  title?: string;
  cwd?: string;
} {
  if (serialized.type === 'split') {
    return {
      type: 'split',
      id: serialized.id,
      direction: serialized.direction as 'horizontal' | 'vertical',
      ratio: serialized.ratio ?? 0.5,
      first: deserializeLayoutNode(
        serialized.first as {
          type?: string;
          id: string;
          direction?: string;
          ratio?: number;
          first?: unknown;
          second?: unknown;
          title?: string;
          cwd?: string;
        }
      ),
      second: deserializeLayoutNode(
        serialized.second as {
          type?: string;
          id: string;
          direction?: string;
          ratio?: number;
          first?: unknown;
          second?: unknown;
          title?: string;
          cwd?: string;
        }
      ),
    };
  }

  return {
    id: serialized.id,
    title: serialized.title,
    cwd: serialized.cwd ? repairLikelyTrailingPercentCwd(serialized.cwd) : serialized.cwd,
  };
}

/** Deserialize workspace from stored format */
function deserializeWorkspace(serialized: SerializedWorkspace): Workspace {
  return {
    id: serialized.id as WorkspaceId,
    label: serialized.label,
    mainPane: serialized.mainPane ? deserializeLayoutNode(serialized.mainPane) : null,
    stackPanes: serialized.stackPanes.map(deserializeLayoutNode),
    focusedPaneId: serialized.focusedPaneId,
    activeStackIndex: serialized.activeStackIndex,
    lastFocusedPaneIds: [...(serialized.lastFocusedPaneIds ?? [])],
    layoutMode: serialized.layoutMode as Workspace['layoutMode'],
    zoomed: serialized.zoomed,
  };
}

/** Extract CWD map from serialized session */
function extractCwdMap(session: SerializedSession): Map<string, string> {
  const cwdMap = new Map<string, string>();
  const collectCwds = (node: unknown) => {
    if (!node) return;
    const n = node as {
      type?: string;
      first?: unknown;
      second?: unknown;
      id?: string;
      cwd?: string;
    };
    if (n.type === 'split') {
      collectCwds(n.first);
      collectCwds(n.second);
      return;
    }
    if (n.id && n.cwd) {
      cwdMap.set(n.id, repairLikelyTrailingPercentCwd(n.cwd));
    }
  };

  for (const ws of session.workspaces) {
    collectCwds(ws.mainPane);
    for (const pane of ws.stackPanes) {
      collectCwds(pane);
    }
  }
  return cwdMap;
}

/** Save the current session state */
export async function saveCurrentSession(
  metadata: LegacySessionMetadata,
  workspaces: Workspaces,
  activeWorkspaceId: WorkspaceId,
  getCwd: (ptyId: string) => Promise<string>
): Promise<void | SessionStorageError> {
  const manager = getSessionManager();

  const effectMetadata: SessionMetadata = {
    id: metadata.id as SessionId,
    name: metadata.name,
    createdAt: metadata.createdAt,
    lastSwitchedAt: metadata.lastSwitchedAt,
    autoNamed: metadata.autoNamed,
  };

  const workspaceState = new Map<number, WorkspaceState>();

  for (const [idStr, ws] of Object.entries(workspaces)) {
    if (!ws) continue;
    const id = Number(idStr);
    workspaceState.set(id, {
      mainPane: ws.mainPane ?? null,
      stackPanes: ws.stackPanes,
      focusedPaneId: ws.focusedPaneId ?? undefined,
      layoutMode: ws.layoutMode,
      activeStackIndex: ws.activeStackIndex,
      zoomed: ws.zoomed,
      label: ws.label,
    });
  }

  const result = await manager.snapshot.save({
    metadata: effectMetadata,
    workspaces: workspaceState,
    activeWorkspaceId,
    getCwd,
  });
  if (result instanceof Error) return result;
}

/** Load a session from disk */
export async function loadSessionData(sessionId: string): Promise<
  | {
      metadata: LegacySessionMetadata;
      workspaces: Workspaces;
      activeWorkspaceId: WorkspaceId;
      cwdMap: Map<string, string>;
    }
  | SessionCorruptedError
  | SessionNotFoundError
> {
  const manager = getSessionManager();
  const session = await manager.loadSession(sessionId as SessionId);

  if (session instanceof Error) {
    if (session._tag === 'SessionNotFoundError') {
      return new SessionNotFoundError({ sessionId, cause: session });
    }
    return new SessionCorruptedError({
      sessionId,
      reason: session.message,
      cause: session,
    });
  }

  const metadata: LegacySessionMetadata = {
    id: session.metadata.id,
    name: session.metadata.name,
    createdAt: session.metadata.createdAt,
    lastSwitchedAt: session.metadata.lastSwitchedAt,
    autoNamed: session.metadata.autoNamed,
  };

  const workspaces: Workspaces = {};
  for (const ws of session.workspaces) {
    workspaces[ws.id as WorkspaceId] = deserializeWorkspace(ws);
  }

  const storedActiveId = session.activeWorkspaceId as WorkspaceId;
  const resolvedActiveWorkspaceId = resolveActiveWorkspaceId(workspaces, storedActiveId);

  const cwdMap = extractCwdMap(session);

  return {
    metadata,
    workspaces,
    activeWorkspaceId: resolvedActiveWorkspaceId,
    cwdMap,
  };
}
