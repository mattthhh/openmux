/**
 * Session bridge functions (errore version)
 * Wraps SessionManager service for async/await usage
 * 
 * Directly uses SessionManager interface without Effect runtime.
 * Backward-compatible versions use the global services singleton.
 */

import type { SessionManager } from "../services/SessionManager"
import type { SessionId } from "../types"
import type {
  SerializedSession,
  SessionMetadata,
} from "../models"
import type {
  SessionMetadata as LegacySessionMetadata,
  Workspace,
  WorkspaceId,
} from "../../core/types"
import type { Workspaces } from "../../core/operations/layout-actions"
import type { WorkspaceState } from "../services/session-manager/types"
import { getSessionManager } from "./services-instance"
import { resolveActiveWorkspaceId } from "./session-bridge-utils"
import type {
  SessionError,
  SessionStorageError,
} from "../errors"
import {
  SessionCorruptedError,
  SessionNotFoundError,
} from "../errors"
import * as errore from "errore"

/** List all sessions */
export async function listSessions(): Promise<readonly SessionMetadata[]> {
  return listSessionsWithService(getSessionManager())
}

/** List all sessions without collapsing errors to an empty array */
export async function listSessionsResult(): Promise<readonly SessionMetadata[] | SessionStorageError> {
  return listSessionsResultWithService(getSessionManager())
}

/** Create a new session */
export async function createSession(name: string): Promise<string | SessionStorageError> {
  return createSessionWithService(getSessionManager(), name)
}

/** Load a session by ID */
export async function loadSession(id: string): Promise<SerializedSession | SessionError> {
  return loadSessionWithService(getSessionManager(), id)
}

/** Save a session */
export async function saveSession(session: SerializedSession): Promise<void | SessionStorageError> {
  return saveSessionWithService(getSessionManager(), session)
}

/** Delete a session */
export async function deleteSession(id: string): Promise<void | SessionError> {
  return deleteSessionWithService(getSessionManager(), id)
}

/** Rename a session */
export async function renameSession(id: string, newName: string): Promise<void | SessionError> {
  return renameSessionWithService(getSessionManager(), id, newName)
}

/** Get the active session ID */
export function getActiveSessionId(): string | null {
  return getActiveSessionIdWithService(getSessionManager())
}

/** Set the active session ID */
export async function setActiveSessionId(id: string | null): Promise<void | SessionError> {
  return setActiveSessionIdWithService(getSessionManager(), id)
}

/** Switch to a session */
export async function switchToSession(id: string): Promise<void | SessionError> {
  return switchToSessionWithService(getSessionManager(), id)
}

/** Get session metadata by ID */
export async function getSessionMetadata(id: string): Promise<SessionMetadata | null> {
  return getSessionMetadataWithService(getSessionManager(), id)
}

/** Update auto-name for a session */
export async function updateAutoName(id: string, cwd: string): Promise<void | SessionError> {
  return updateAutoNameWithService(getSessionManager(), id, cwd)
}

/** Get session summary (workspace/pane counts) */
export async function getSessionSummary(
  id: string
): Promise<{ workspaceCount: number; paneCount: number } | null> {
  return getSessionSummaryWithService(getSessionManager(), id)
}

/** Get session summary without collapsing errors to null */
export async function getSessionSummaryResult(
  id: string
): Promise<{ workspaceCount: number; paneCount: number } | null | SessionError> {
  return getSessionSummaryResultWithService(getSessionManager(), id)
}

/** Get persisted aggregate session ordering */
export async function getAggregateSessionOrder(): Promise<string[]> {
  return getAggregateSessionOrderWithService(getSessionManager())
}

/** Get persisted aggregate session ordering without collapsing errors to an empty array */
export async function getAggregateSessionOrderResult(): Promise<string[] | SessionStorageError> {
  return getAggregateSessionOrderResultWithService(getSessionManager())
}

/** Persist aggregate session ordering */
export async function setAggregateSessionOrder(order: string[]): Promise<void | SessionStorageError> {
  return setAggregateSessionOrderWithService(getSessionManager(), order)
}

/** Create a new session (legacy compatibility) */
export async function createSessionLegacy(name?: string): Promise<LegacySessionMetadata | SessionStorageError> {
  return createSessionLegacyWithService(getSessionManager(), name)
}

/** List all sessions (legacy compatibility) */
export async function listSessionsLegacy(): Promise<LegacySessionMetadata[]> {
  return listSessionsLegacyWithService(getSessionManager())
}

/** Get active session ID (legacy compatibility) */
export function getActiveSessionIdLegacy(): string | null {
  return getActiveSessionIdLegacyWithService(getSessionManager())
}

/** Rename session (legacy compatibility) */
export async function renameSessionLegacy(id: string, name: string): Promise<void | SessionError> {
  return renameSessionLegacyWithService(getSessionManager(), id, name)
}

/** Delete session (legacy compatibility) */
export async function deleteSessionLegacy(id: string): Promise<void | SessionError> {
  return deleteSessionLegacyWithService(getSessionManager(), id)
}

/** Save the current session state */
export async function saveCurrentSession(
  metadata: LegacySessionMetadata,
  workspaces: Workspaces,
  activeWorkspaceId: WorkspaceId,
  getCwd: (ptyId: string) => Promise<string>
): Promise<void | SessionStorageError> {
  return saveCurrentSessionWithService(getSessionManager(), metadata, workspaces, activeWorkspaceId, getCwd)
}

/** Load a session from disk */
export async function loadSessionData(
  sessionId: string
): Promise<
  | {
      metadata: LegacySessionMetadata
      workspaces: Workspaces
      activeWorkspaceId: WorkspaceId
      cwdMap: Map<string, string>
    }
  | SessionCorruptedError
  | SessionNotFoundError
> {
  return loadSessionDataWithService(getSessionManager(), sessionId)
}

/** List sessions with a specific service */
export async function listSessionsWithService(manager: SessionManager): Promise<readonly SessionMetadata[]> {
  const result = await listSessionsResultWithService(manager)
  if (result instanceof Error) return []
  return result
}

/** List sessions with a specific service without collapsing errors */
export async function listSessionsResultWithService(
  manager: SessionManager
): Promise<readonly SessionMetadata[] | SessionStorageError> {
  return manager.listSessions()
}

/** Create session with a specific service */
export async function createSessionWithService(manager: SessionManager, name: string): Promise<string | SessionStorageError> {
  const result = await manager.createSession(name)
  if (result instanceof Error) return result
  return result.id
}

/** Load session with a specific service */
export async function loadSessionWithService(manager: SessionManager, id: string): Promise<SerializedSession | SessionError> {
  const result = await manager.loadSession(id as SessionId)
  if (result instanceof Error) return result
  return result
}

/** Save session with a specific service */
export async function saveSessionWithService(manager: SessionManager, session: SerializedSession): Promise<void | SessionStorageError> {
  const result = await manager.saveSession(session)
  if (result instanceof Error) return result
}

/** Delete session with a specific service */
export async function deleteSessionWithService(manager: SessionManager, id: string): Promise<void | SessionError> {
  const result = await manager.deleteSession(id as SessionId)
  if (result instanceof Error) return result
}

/** Rename session with a specific service */
export async function renameSessionWithService(
  manager: SessionManager,
  id: string,
  newName: string
): Promise<void | SessionError> {
  const result = await manager.renameSession(id as SessionId, newName)
  if (result instanceof Error) return result
}

/** Get active session ID with a specific service */
export function getActiveSessionIdWithService(manager: SessionManager): string | null {
  return manager.getActiveSessionId()
}

/** Set active session ID with a specific service */
export async function setActiveSessionIdWithService(manager: SessionManager, id: string | null): Promise<void | SessionError> {
  const result = await manager.setActiveSessionId(id ? (id as SessionId) : null)
  if (result instanceof Error) return result
}

/** Switch to session with a specific service */
export async function switchToSessionWithService(manager: SessionManager, id: string): Promise<void | SessionError> {
  const result = await manager.switchToSession(id as SessionId)
  if (result instanceof Error) return result
}

/** Get session metadata with a specific service */
export async function getSessionMetadataWithService(
  manager: SessionManager,
  id: string
): Promise<SessionMetadata | null> {
  const result = await manager.getSessionMetadata(id as SessionId)
  if (result instanceof Error) return null
  return result
}

/** Update auto-name with a specific service */
export async function updateAutoNameWithService(manager: SessionManager, id: string, cwd: string): Promise<void | SessionError> {
  const result = await manager.updateAutoName(id as SessionId, cwd)
  if (result instanceof Error) return result
}

/** Get session summary with a specific service */
export async function getSessionSummaryWithService(
  manager: SessionManager,
  id: string
): Promise<{ workspaceCount: number; paneCount: number } | null> {
  const result = await getSessionSummaryResultWithService(manager, id)
  if (result instanceof Error) return null
  return result
}

/** Get session summary with a specific service without collapsing errors */
export async function getSessionSummaryResultWithService(
  manager: SessionManager,
  id: string
): Promise<{ workspaceCount: number; paneCount: number } | null | SessionError> {
  return manager.getSessionSummary(id as SessionId)
}

/** Get persisted aggregate session ordering with a specific service */
export async function getAggregateSessionOrderWithService(
  manager: SessionManager
): Promise<string[]> {
  const result = await getAggregateSessionOrderResultWithService(manager)
  if (result instanceof Error) return []
  return result
}

/** Get persisted aggregate session ordering with a specific service without collapsing errors */
export async function getAggregateSessionOrderResultWithService(
  manager: SessionManager
): Promise<string[] | SessionStorageError> {
  return manager.getAggregateSessionOrder()
}

/** Persist aggregate session ordering with a specific service */
export async function setAggregateSessionOrderWithService(
  manager: SessionManager,
  order: string[]
): Promise<void | SessionStorageError> {
  const result = await manager.setAggregateSessionOrder(order)
  if (result instanceof Error) return result
}

/** Create session (legacy) with a specific service */
export async function createSessionLegacyWithService(
  manager: SessionManager,
  name?: string
): Promise<LegacySessionMetadata | SessionStorageError> {
  const result = await manager.createSession(name)
  if (result instanceof Error) return result
  return result as unknown as LegacySessionMetadata
}

/** List sessions (legacy) with a specific service */
export async function listSessionsLegacyWithService(manager: SessionManager): Promise<LegacySessionMetadata[]> {
  const result = await manager.listSessions()
  if (result instanceof Error) return []
  return [...result] as unknown as LegacySessionMetadata[]
}

/** Get active session ID (legacy) with a specific service */
export function getActiveSessionIdLegacyWithService(manager: SessionManager): string | null {
  return getActiveSessionIdWithService(manager)
}

/** Rename session (legacy) with a specific service */
export async function renameSessionLegacyWithService(manager: SessionManager, id: string, name: string): Promise<void | SessionError> {
  return renameSessionWithService(manager, id, name)
}

/** Delete session (legacy) with a specific service */
export async function deleteSessionLegacyWithService(manager: SessionManager, id: string): Promise<void | SessionError> {
  return deleteSessionWithService(manager, id)
}

function deserializeLayoutNode(serialized: { type?: string; id: string; direction?: string; ratio?: number; first?: unknown; second?: unknown; title?: string; cwd?: string }): { type?: string; id: string; direction?: string; ratio?: number; first?: unknown; second?: unknown; title?: string; cwd?: string } {
  if (serialized.type === "split") {
    return {
      type: "split",
      id: serialized.id,
      direction: serialized.direction as "horizontal" | "vertical",
      ratio: serialized.ratio ?? 0.5,
      first: deserializeLayoutNode(serialized.first as { type?: string; id: string; direction?: string; ratio?: number; first?: unknown; second?: unknown; title?: string; cwd?: string }),
      second: deserializeLayoutNode(serialized.second as { type?: string; id: string; direction?: string; ratio?: number; first?: unknown; second?: unknown; title?: string; cwd?: string }),
    }
  }

  return {
    id: serialized.id,
    title: serialized.title,
    cwd: serialized.cwd,
  }
}

function deserializeWorkspace(serialized: { id: number; label?: string; mainPane: unknown; stackPanes: unknown[]; focusedPaneId: string | null; activeStackIndex: number; lastFocusedPaneIds?: (string | null)[]; layoutMode: string; zoomed: boolean }): Workspace {
  return {
    id: serialized.id as WorkspaceId,
    label: serialized.label ?? undefined,
    mainPane: serialized.mainPane ? deserializeLayoutNode(serialized.mainPane as { type?: string; id: string; direction?: string; ratio?: number; first?: unknown; second?: unknown; title?: string; cwd?: string }) : null,
    stackPanes: (serialized.stackPanes as { type?: string; id: string; direction?: string; ratio?: number; first?: unknown; second?: unknown; title?: string; cwd?: string }[]).map(deserializeLayoutNode),
    focusedPaneId: serialized.focusedPaneId,
    activeStackIndex: serialized.activeStackIndex,
    lastFocusedPaneIds: [...(serialized.lastFocusedPaneIds ?? [])],
    layoutMode: serialized.layoutMode as "vertical" | "horizontal" | "stacked",
    zoomed: serialized.zoomed,
  }
}

function extractCwdMap(session: SerializedSession): Map<string, string> {
  const cwdMap = new Map<string, string>()
  const collectCwds = (node: unknown) => {
    if (!node) return
    const n = node as { type?: string; first?: unknown; second?: unknown; id?: string; cwd?: string }
    if (n.type === "split") {
      collectCwds(n.first)
      collectCwds(n.second)
      return
    }
    if (n.id && n.cwd) {
      cwdMap.set(n.id, n.cwd)
    }
  }

  for (const ws of session.workspaces) {
    collectCwds(ws.mainPane)
    for (const pane of ws.stackPanes) {
      collectCwds(pane)
    }
  }
  return cwdMap
}

/** Save current session with a specific service */
export async function saveCurrentSessionWithService(
  manager: SessionManager,
  metadata: LegacySessionMetadata,
  workspaces: Workspaces,
  activeWorkspaceId: WorkspaceId,
  getCwd: (ptyId: string) => Promise<string>
): Promise<void | SessionStorageError> {
  const effectMetadata: SessionMetadata = {
    id: metadata.id as SessionId,
    name: metadata.name,
    createdAt: metadata.createdAt,
    lastSwitchedAt: metadata.lastSwitchedAt,
    autoNamed: metadata.autoNamed,
  }

  const workspaceState = new Map<number, WorkspaceState>()

  for (const [idStr, ws] of Object.entries(workspaces)) {
    if (!ws) continue
    const id = Number(idStr)
    workspaceState.set(id, {
      mainPane: ws.mainPane ?? null,
      stackPanes: ws.stackPanes,
      focusedPaneId: ws.focusedPaneId ?? undefined,
      layoutMode: ws.layoutMode,
      activeStackIndex: ws.activeStackIndex,
      zoomed: ws.zoomed,
      label: ws.label,
    })
  }

  const result = await manager.quickSave(effectMetadata, workspaceState, activeWorkspaceId, getCwd)
  if (result instanceof Error) return result
}

/** Load session data with a specific service */
export async function loadSessionDataWithService(
  manager: SessionManager,
  sessionId: string
): Promise<
  | {
      metadata: LegacySessionMetadata
      workspaces: Workspaces
      activeWorkspaceId: WorkspaceId
      cwdMap: Map<string, string>
    }
  | SessionCorruptedError
  | SessionNotFoundError
> {
  const session = await manager.loadSession(sessionId as SessionId)
  if (session instanceof Error) {
    if (session._tag === 'SessionNotFoundError') {
      return new SessionNotFoundError({ sessionId, cause: session })
    }
    return new SessionCorruptedError({
      sessionId,
      reason: session.message,
      cause: session,
    })
  }

  const metadata: LegacySessionMetadata = {
    id: session.metadata.id,
    name: session.metadata.name,
    createdAt: session.metadata.createdAt,
    lastSwitchedAt: session.metadata.lastSwitchedAt,
    autoNamed: session.metadata.autoNamed,
  }

  const workspaces: Workspaces = {}
  for (const ws of session.workspaces) {
    workspaces[ws.id as WorkspaceId] = deserializeWorkspace(ws as unknown as Parameters<typeof deserializeWorkspace>[0])
  }

  const storedActiveId = session.activeWorkspaceId as WorkspaceId
  const resolvedActiveWorkspaceId = resolveActiveWorkspaceId(
    workspaces,
    storedActiveId
  )

  const cwdMap = extractCwdMap(session)

  return {
    metadata,
    workspaces,
    activeWorkspaceId: resolvedActiveWorkspaceId,
    cwdMap,
  }
}
